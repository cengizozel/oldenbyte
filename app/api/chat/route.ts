import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { anytypeReadObject, anytypeDeepLink } from "@/lib/anytype";
import { buildProviders, type AssistantConfigs } from "@/lib/assistant/registry";
import type { Proposal, Action } from "@/lib/assistant/types";

// Server-side proxy to any OpenAI-compatible chat endpoint (Ollama, LM Studio,
// llama.cpp, vLLM, OpenAI itself, …). Running it server-side avoids CORS and
// mixed-content blocking when the dashboard is served over HTTPS but the model
// runs on plain http://localhost.
//
// When data-source configs ride the request, the model is handed tools and we
// run an agentic loop: the model decides when to read a dashboard widget,
// query the calendar, search Kiwix/Anytype, or (with the write toggles) create
// and remove events and notes. Which tools exist is decided by the provider
// registry (lib/assistant) — one provider per integration — so the loop below
// stays integration-agnostic. Tool progress streams inside <think>…</think> so
// the client shows it as a collapsible research trail.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChatMessage = { role: string; content: string } & Record<string, any>;

// Strip trailing slashes so we can safely append "/chat/completions" etc.
function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// GET /api/chat?baseUrl=…&apiKey=… — list available models from {baseUrl}/models
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const baseUrl = request.nextUrl.searchParams.get("baseUrl");
  const apiKey = request.nextUrl.searchParams.get("apiKey") ?? "";

  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    return NextResponse.json({ error: "Missing or invalid baseUrl" }, { status: 400 });
  }

  try {
    const res = await fetch(`${normalizeBase(baseUrl)}/models`, {
      headers: authHeaders(apiKey),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw: unknown[] = data.data ?? data.models ?? [];
    const models = raw
      .map((m) => (typeof m === "string" ? m : (m as { id?: string; name?: string }).id ?? (m as { name?: string }).name))
      .filter((m): m is string => Boolean(m));
    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json({ error: `Could not list models: ${String(err)}` }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const {
    baseUrl,
    apiKey = "",
    model,
    messages,
    stream = true,
    maxTokens = 0,
    reasoningEffort = "",
    kiwix = null,
    anytype = null,
    dashboard = null,
    caldav = null,
    today = "",
    timezone = "",
    ttl = 0,
  }: {
    baseUrl: string; apiKey?: string; model: string; messages: ChatMessage[];
    stream?: boolean; maxTokens?: number; reasoningEffort?: string;
    kiwix?: AssistantConfigs["kiwix"];
    anytype?: AssistantConfigs["anytype"];
    dashboard?: AssistantConfigs["dashboard"];
    caldav?: AssistantConfigs["caldav"];
    today?: string;    // the client's local date (YYYY-MM-DD), for calendar anchoring
    timezone?: string; // the client's IANA zone, for event times
    ttl?: number; // LM Studio idle-unload, in seconds; set the model's linger per request
  } = await request.json();

  if (!baseUrl || !/^https?:\/\//.test(baseUrl) || !model || !Array.isArray(messages)) {
    return NextResponse.json({ error: "Missing baseUrl, model, or messages" }, { status: 400 });
  }

  const url = `${normalizeBase(baseUrl)}/chat/completions`;
  const upstreamHeaders = { "Content-Type": "application/json", ...authHeaders(apiKey) };
  const extra = {
    ...(Number(maxTokens) > 0 ? { max_tokens: Math.floor(Number(maxTokens)) } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    // LM Studio reads `ttl` (idle seconds) off the request to set auto-unload.
    // Other servers ignore the unknown field. Only sent for LM Studio durations.
    ...(Number(ttl) > 0 ? { ttl: Math.floor(Number(ttl)) } : {}),
  };
  // Hosted APIs reject unknown/unsupported params more eagerly than local
  // servers; this heuristic gates the local-only tweaks below.
  const isHosted = /(openai|anthropic|googleapis|mistral|groq)\.com/i.test(baseUrl);

  // ── Agentic path: providers decide which tools exist ────────────────────────
  const providers = buildProviders({ dashboard, caldav, kiwix, anytype, today, timezone });
  if (providers.length) {
    const encoder = new TextEncoder();
    const MAX_ITERS = 10;

    const readable = new ReadableStream({
      async start(controller) {
        const emit = (s: string) => controller.enqueue(encoder.encode(s));
        let thinkOpen = false;
        const openThink = () => { if (!thinkOpen) { emit("<think>"); thinkOpen = true; } };
        const closeThink = () => { if (thinkOpen) { emit("</think>\n\n"); thinkOpen = false; } };
        let totalTokens = 0;
        const convo: ChatMessage[] = [...messages];

        // Citation registry: every article the model retrieves gets a stable
        // number. Attribution is data-first — the trace owns it, inline [n] is just
        // decoration. `opened` tracks articles actually READ via a read tool, so a
        // correctly-read source still shows even if the model forgets to print [n].
        const sources: { n: number; title: string; url: string }[] = [];
        const proposals: Proposal[] = [];
        const actions: Action[] = [];
        const byUrl = new Map<string, number>();
        const opened = new Set<number>();
        const cite = (title: string, url: string): number => {
          const existing = byUrl.get(url);
          if (existing) return existing;
          const n = sources.length + 1;
          sources.push({ n, title, url });
          byUrl.set(url, n);
          return n;
        };
        let finalAnswer = "";
        let searched = false;  // model has run at least one search
        let nudges = 0;        // times we've bounced a snippet-only answer
        let errored = false;   // upstream failed: end the turn, skip the forced final

        // The trailer must reach the client even on failure — proposals and
        // sources gathered before an error would otherwise vanish with it.
        const emitTrailer = (error?: string) => {
          const usedNums = new Set<number>();
          for (const m of finalAnswer.matchAll(/\[(\d+)\]/g)) usedNums.add(Number(m[1]));
          const shownSources = sources
            .filter((s) => opened.has(s.n) || usedNums.has(s.n))
            .map((s) => ({ ...s, cited: usedNums.has(s.n) }));
          emit("\x1e" + JSON.stringify({
            tokens: totalTokens, sources: shownSources, proposals, actions,
            ...(error ? { error } : {}),
          }));
        };

        // One non-streaming completion, used by the map-reduce summarizer to digest
        // each chunk of a long note. Bounded + tool-free; reasoning is disabled on
        // local backends (a thinking model would spend the whole cap on <think> and
        // return a truncated reasoning fragment instead of a summary).
        const complete = async (msgs: ChatMessage[]): Promise<string> => {
          const res = await fetch(url, {
            method: "POST",
            headers: upstreamHeaders,
            body: JSON.stringify({
              model, messages: msgs, stream: false, max_tokens: 384,
              ...(isHosted ? {} : { reasoning_effort: "none" }),
            }),
            signal: request.signal,
          });
          if (!res.ok) throw new Error(`summarize HTTP ${res.status}`);
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content ?? "";
          return content
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/^<think>[\s\S]*$/gi, "") // cap cut the stream mid-think: no summary at all
            .trim();
        };

        // Map-reduce digest of a long Anytype note: summarize each ~6k chunk on its
        // own (so nothing overflows context), return the per-part summaries for the
        // main model to synthesize. Emits progress into the thinking trail.
        // Owned by the loop (not the anytype provider) because it needs `complete`.
        const summarizeObject = async (id: string, focus: string): Promise<string> => {
          const at = anytype!;
          const obj = await anytypeReadObject(at.baseUrl, at.apiKey, at.spaceId, id, request.signal);
          const n = cite(obj.name, anytypeDeepLink(at.spaceId, id));
          opened.add(n);
          const md = obj.markdown || "";
          const CHUNK = 6000, MAX_CHUNKS = 40;
          const chunks: string[] = [];
          for (let p = 0; p < md.length && chunks.length < MAX_CHUNKS; p += CHUNK) chunks.push(md.slice(p, p + CHUNK));
          const truncated = md.length > MAX_CHUNKS * CHUNK;
          openThink();
          emit(`\n🧩 digesting [${n}] ${obj.name} — ${chunks.length} part(s)${truncated ? " (capped)" : ""}; this can take a minute on a long note…\n`);
          const focusLine = focus ? `Focus on: ${focus}. ` : "";
          const parts: string[] = [];
          for (let k = 0; k < chunks.length; k++) {
            emit(`  · part ${k + 1}/${chunks.length}\n`);
            const s = await complete([
              { role: "system", content: "You summarize one part of a longer personal note for someone digesting the whole thing. Be faithful and specific in 2-4 sentences: concrete events, dates, names, feelings, and what it reveals about the author. No preamble." },
              { role: "user", content: `${focusLine}Summarize part ${k + 1} of ${chunks.length} of the note "${obj.name}":\n\n${chunks[k]}` },
            ]);
            parts.push(`Part ${k + 1}: ${s || "(no content)"}`);
          }
          return `Map-reduce digest of [${n}] ${obj.name} (${md.length} chars in ${chunks.length} part(s)${truncated ? ", capped" : ""}). ` +
            `Below are faithful per-part summaries — synthesize them into the final answer for the user and cite [${n}].\n\n` +
            parts.join("\n\n");
        };

        // Dispatch one tool call to whichever provider owns it.
        const runTool = async (name: string, args: Record<string, unknown>) => {
          try {
            for (const p of providers) {
              const out = await p.run(name, args, { userId: user.id, signal: request.signal });
              if (out) return out;
            }
          } catch (err) {
            return { kind: "message" as const, text: `Tool error: ${String(err instanceof Error ? err.message : err)}` };
          }
          return { kind: "message" as const, text: `Unknown tool: ${name}` };
        };

        try {
          // Let providers warm up (e.g. the Anytype style profile) before the
          // tool schemas are read. Failures degrade silently inside init().
          await Promise.allSettled(providers.map(p => p.init?.(request.signal)));
          const tools = providers.flatMap(p => p.tools());

          for (let iter = 0; iter < MAX_ITERS; iter++) {
            const upstream = await fetch(url, {
              method: "POST",
              headers: upstreamHeaders,
              body: JSON.stringify({ model, messages: convo, tools, stream: true, ...extra }),
              signal: request.signal,
            });
            if (!upstream.ok) {
              closeThink();
              let msg = `Upstream error ${upstream.status}`;
              try { const e = await upstream.json(); msg = e.error?.message ?? e.error ?? e.message ?? msg; } catch {}
              emit(msg);
              errored = true; // terminal: no forced-final turn on a dead upstream
              break;
            }

            // Parse this round's SSE. Stream reasoning and answer content live (like
            // the plain path) — EXCEPT when the gate is "armed": the model has searched
            // but not yet read a source, so it might answer from snippets and need to be
            // bounced. Only then do we buffer content (so the user never sees the bounced
            // text). searched/opened/nudges only change between rounds, so this is stable.
            const gateArmed = searched && opened.size === 0 && nudges < 2;
            const reader = upstream.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let assistantContent = "";
            // Tool-call deltas keyed by id when present, index otherwise: some
            // servers stream parallel calls all with index 0 but distinct ids;
            // index-only keying would concatenate their argument fragments into
            // one corrupted call.
            const calls = new Map<string, { id: string; name: string; arguments: string }>();
            let lastKey = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const t = line.trim();
                if (!t.startsWith("data:")) continue;
                const payload = t.slice(5).trim();
                if (payload === "[DONE]") continue;
                let json;
                try { json = JSON.parse(payload); } catch { continue; }
                const delta = json.choices?.[0]?.delta;
                if (!delta) continue;
                const reasoning = delta.reasoning ?? delta.reasoning_content;
                if (reasoning) { openThink(); emit(reasoning); totalTokens++; }
                if (delta.content) {
                  assistantContent += delta.content;
                  if (!gateArmed) { closeThink(); emit(delta.content); } // stream live
                  totalTokens++;
                }
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    // A chunk with an id starts/continues that call; an id-less
                    // chunk continues the call its index refers to, falling back
                    // to the last seen call (argument fragments never open one).
                    const key = tc.id ? `id:${tc.id}` : (calls.has(`ix:${tc.index ?? 0}`) ? `ix:${tc.index ?? 0}` : lastKey);
                    if (!key) continue;
                    let call = calls.get(key);
                    if (!call) { call = { id: "", name: "", arguments: "" }; calls.set(key, call); }
                    lastKey = key;
                    if (tc.id) call.id = tc.id;
                    if (tc.function?.name) call.name = tc.function.name;
                    if (tc.function?.arguments) call.arguments += tc.function.arguments;
                  }
                }
              }
            }

            const made = [...calls.values()].filter((c) => c.name);
            if (!made.length) {
              // GATE: if the model searched but never opened a result, it's about to
              // answer from search snippets. Don't allow it — bounce it back to read the
              // most relevant result first. (We buffered the content, so nothing leaked.)
              if (gateArmed) {
                nudges++;
                if (assistantContent.trim()) { openThink(); emit(assistantContent.trim() + "\n"); }
                convo.push({ role: "assistant", content: assistantContent });
                convo.push({
                  role: "user",
                  content:
                    "You searched but did not open any result, so you'd be answering from search " +
                    "snippets — that is not allowed. Open the most relevant result (get_article for a " +
                    "Kiwix url, read_anytype_object for an Anytype id), read it, then answer from its text.",
                });
                continue;
              }
              closeThink();
              // Content was already streamed live above (gate wasn't armed).
              finalAnswer = assistantContent;
              break;
            }

            // Record the assistant's tool-call turn, then run each tool.
            convo.push({
              role: "assistant",
              content: assistantContent,
              tool_calls: made.map((c, i) => ({
                id: c.id || `call_${iter}_${i}`,
                type: "function",
                function: { name: c.name, arguments: c.arguments || "{}" },
              })),
            });
            for (let i = 0; i < made.length; i++) {
              const c = made[i];
              let args: Record<string, unknown> = {};
              let argsBroken = false;
              try { args = JSON.parse(c.arguments || "{}"); } catch { argsBroken = true; }
              openThink();

              // Malformed argument JSON: tell the model instead of silently
              // running the tool with empty args (which reads as "no results").
              if (argsBroken) {
                convo.push({
                  role: "tool", tool_call_id: c.id || `call_${iter}_${i}`,
                  content: `The arguments for ${c.name} were not valid JSON. Call it again with valid JSON arguments.`,
                });
                emit(`\n(retrying ${c.name}: malformed arguments)\n`);
                continue;
              }

              // Map-reduce summarize is handled here (not in a provider) because it
              // needs the model caller and emits its own progress.
              if (c.name === "summarize_anytype_object" && anytype?.baseUrl && anytype.apiKey && anytype.spaceId) {
                let summary: string;
                try {
                  summary = await summarizeObject(String(args.id ?? ""), String(args.focus ?? "").trim());
                } catch (err) {
                  summary = `Could not summarize: ${String(err instanceof Error ? err.message : err)}`;
                  emit("  (summary failed)\n");
                }
                convo.push({ role: "tool", tool_call_id: c.id || `call_${iter}_${i}`, content: summary });
                continue;
              }

              const out = await runTool(c.name, args);

              // Turn the result into numbered, citeable text for the model and a
              // short progress note for the user.
              let toolText: string;
              if (out.kind === "search") {
                searched = true;
                const label = out.source === "anytype" ? "Anytype" : "Kiwix";
                const refLabel = out.source === "anytype" ? "id" : "url";
                emit(`\n🔎 searching ${label} for “${out.query}”\n`);
                if (!out.results.length) {
                  toolText = "No results.";
                  emit("no results\n");
                } else {
                  toolText = out.results
                    .map((r) => `[${cite(r.title, r.link)}] ${r.title}\n   ${refLabel}: ${r.ref}${r.meta ? `\n   ${r.meta}` : ""}\n   ${r.snippet}`)
                    .join("\n");
                  emit(out.results.map((r) => `[${byUrl.get(r.link)}] ${r.title}`).join("\n") + "\n");
                }
              } else if (out.kind === "article") {
                const n = cite(out.title, out.link);
                opened.add(n); // actually read → a real source regardless of inline [n]
                emit(`\n📖 reading [${n}] ${out.title}\n`);
                toolText = `[${n}] ${out.title}\n${out.meta ? out.meta + "\n\n" : ""}${out.text}`;
              } else if (out.kind === "widget") {
                // Dashboard data is the user's own; it is not a citeable source.
                emit(`\n📊 ${out.note}\n`);
                toolText = out.text;
              } else if (out.kind === "proposal") {
                emit(`\n📅 ${out.note}\n`);
                proposals.push(out.proposal);
                toolText = out.text;
              } else if (out.kind === "action") {
                emit(`\n✅ ${out.note}\n`);
                actions.push(out.action);
                toolText = out.text;
              } else {
                toolText = out.text;
                emit(out.text + "\n");
              }
              convo.push({ role: "tool", tool_call_id: c.id || `call_${iter}_${i}`, content: toolText });
            }
          }

          // The loop ended while the model was still calling tools (it hit the
          // research-round cap without concluding). Force one final, tool-free
          // turn so the user always gets an answer instead of a dangling trail —
          // unless the upstream itself failed, where a retry would answer with
          // zero research under a false premise.
          if (!finalAnswer && !errored) {
            convo.push({
              role: "user",
              content:
                "Research budget reached — do not call any more tools. Using everything you gathered above, " +
                "give your best final answer now. Cite sources with [n]. State what you found; for anything still " +
                "missing, say so briefly rather than continuing to search.",
            });
            const upstream = await fetch(url, {
              method: "POST",
              headers: upstreamHeaders,
              body: JSON.stringify({ model, messages: convo, stream: true, ...extra }),
              signal: request.signal,
            });
            if (upstream.ok && upstream.body) {
              const reader = upstream.body.getReader();
              const decoder = new TextDecoder();
              let buffer = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                  const t = line.trim();
                  if (!t.startsWith("data:")) continue;
                  const payload = t.slice(5).trim();
                  if (payload === "[DONE]") continue;
                  let json;
                  try { json = JSON.parse(payload); } catch { continue; }
                  const delta = json.choices?.[0]?.delta;
                  if (!delta) continue;
                  const reasoning = delta.reasoning ?? delta.reasoning_content;
                  if (reasoning) { openThink(); emit(reasoning); totalTokens++; }
                  if (delta.content) { closeThink(); emit(delta.content); finalAnswer += delta.content; totalTokens++; }
                }
              }
            }
          }

          closeThink();
          emitTrailer();
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            closeThink();
            emit(`\n[error] ${String(err)}`);
            // Deliver what was gathered before the failure: an approved-but-
            // undelivered proposal is worse than an error message.
            emitTrailer(String(err));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  // ── Plain path: single completion (no tools) ────────────────────────────────
  const body = JSON.stringify({ model, messages, stream, ...extra });

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "POST", headers: upstreamHeaders, body, signal: request.signal });
  } catch (err) {
    return NextResponse.json({ error: `Could not reach ${url}: ${String(err)}` }, { status: 502 });
  }

  if (!upstream.ok) {
    let msg = `Upstream error ${upstream.status}`;
    try {
      const e = await upstream.json();
      msg = e.error?.message ?? e.error ?? e.message ?? msg;
    } catch { /* non-JSON error body */ }
    return NextResponse.json({ error: msg }, { status: upstream.status });
  }

  if (!stream) {
    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ content });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let tokens = 0;
      let thinkOpen = false;
      const emit = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const delta = JSON.parse(payload).choices?.[0]?.delta;
              const reasoning = delta?.reasoning ?? delta?.reasoning_content;
              const content = delta?.content;
              if (reasoning) {
                if (!thinkOpen) { emit("<think>"); thinkOpen = true; }
                emit(reasoning);
                tokens++;
              }
              if (content) {
                if (thinkOpen) { emit("</think>\n\n"); thinkOpen = false; }
                emit(content);
                tokens++;
              }
            } catch { /* skip malformed chunks */ }
          }
        }
        if (thinkOpen) emit("</think>");
        emit("\x1e" + JSON.stringify({ tokens }));
      } catch (err) {
        // Mid-stream failure (upstream died): mark it and still send a trailer
        // so the client's parse finds its record separator.
        if ((err as Error).name !== "AbortError") {
          if (thinkOpen) emit("</think>");
          emit(`\n[error] ${String(err)}`);
          emit("\x1e" + JSON.stringify({ tokens, error: String(err) }));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
