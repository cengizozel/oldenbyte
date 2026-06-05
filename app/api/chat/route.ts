import { NextRequest, NextResponse } from "next/server";
import { search as kiwixSearch, articleExtract } from "@/lib/kiwix";
import { anytypeSearch, anytypeReadObject, anytypeDeepLink } from "@/lib/anytype";

// Server-side proxy to any OpenAI-compatible chat endpoint (Ollama, LM Studio,
// llama.cpp, vLLM, OpenAI itself, …). Running it server-side avoids CORS and
// mixed-content blocking when the dashboard is served over HTTPS but the model
// runs on plain http://localhost.
//
// When a `kiwix` config is supplied, the model is handed search tools and we run
// an agentic loop: the model decides when to search the offline Kiwix library,
// we execute the search against /api/kiwix, feed results back, and repeat until
// it answers. Tool progress is streamed inside <think>…</think> so the client
// shows it as a collapsible "thinking" trail.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChatMessage = { role: string; content: string } & Record<string, any>;
type Kiwix = { baseUrl: string; source: string; sourceTitle?: string };
type Anytype = { baseUrl: string; apiKey: string; spaceId: string; spaceName?: string };

// Strip trailing slashes so we can safely append "/chat/completions" etc.
function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// GET /api/chat?baseUrl=…&apiKey=… — list available models from {baseUrl}/models
export async function GET(request: NextRequest) {
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

// ── Kiwix tools ──────────────────────────────────────────────────────────────
function kiwixTools(sourceTitle?: string) {
  const where = sourceTitle ? ` (currently: ${sourceTitle})` : "";
  return [
    {
      type: "function",
      function: {
        name: "search_kiwix",
        description:
          `Full-text search the user's offline Kiwix reference library${where}. ` +
          `Use this for factual, encyclopedic, or how-to questions where you need a source. ` +
          `This is a KEYWORD index (like a library catalog), not a question-answering engine: ` +
          `search the entity or article name, e.g. "Lionel Messi" — NOT a full question or extra ` +
          `words like "born"/"birth date", which hurt the ranking. ` +
          `Returns a numbered list of articles with titles, urls, and snippets; open the most ` +
          `relevant one with get_article to read the facts.`,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Concise keywords — usually the article/entity name, no question words" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_article",
        description:
          "Fetch the lead text of a Kiwix article using a url returned by search_kiwix, " +
          "when a snippet isn't enough to answer.",
        parameters: {
          type: "object",
          properties: { url: { type: "string", description: "Article url from a search result" } },
          required: ["url"],
        },
      },
    },
  ];
}

// ── Anytype tools ─────────────────────────────────────────────────────────────
function anytypeTools(spaceName?: string) {
  const where = spaceName ? ` (space: ${spaceName})` : "";
  return [
    {
      type: "function",
      function: {
        name: "search_anytype",
        description:
          `Full-text search the user's own Anytype notes and objects${where}. ` +
          `Use this for anything about the user's personal knowledge: their notes, journals, ` +
          `trips, people, projects, bookmarks. Search by name or keyword, e.g. "Istanbul" or ` +
          `"reading list". Returns a numbered list of objects with names, ids, and snippets; ` +
          `open the most relevant one with read_anytype_object to read its full text.`,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Concise keywords — usually the note/object name or topic" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "summarize_anytype_object",
        description:
          "Digest an ENTIRE long note that's too big to read at once — use this for open-ended " +
          "questions about a whole note, e.g. \"summarize my journal\" or \"what does my 2026 journal " +
          "say about me\". It splits the note into parts, summarizes each, and returns the per-part " +
          "summaries for you to synthesize into the answer. (For a single specific fact, use " +
          "read_anytype_object with find= instead — it's much faster.)",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Object id from a search result" },
            focus: { type: "string", description: "Optional: what to focus on, e.g. 'what it reveals about the author'" },
          },
          required: ["id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_anytype_object",
        description:
          "Read the markdown body of an Anytype object using an id returned by search_anytype. " +
          "Long notes are returned in parts — the result tells you the total size and how many " +
          "parts there are. For a long note, prefer find=\"keywords\" to jump straight to the " +
          "relevant sections (e.g. find=\"Istanbul\" in a journal), or page=N to read it part by " +
          "part and summarize across parts. Omit both to read from the start.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Object id from a search result" },
            find: { type: "string", description: "Optional: jump to sections matching these keywords" },
            page: { type: "integer", description: "Optional: which part to read (1-based) when reading a long note sequentially" },
          },
          required: ["id"],
        },
      },
    },
  ];
}

// Window a long object body so it never floods the model's context. With `find`,
// return the sections matching the keywords (±context, merged); otherwise return
// the requested ~READ_CAP-char page with a header saying how to read further.
const READ_CAP = 6000;
function windowMarkdown(md: string, find?: string, page?: number): { header: string; text: string } {
  const total = md.length;
  if (total <= READ_CAP && !find) return { header: "", text: md };

  if (find && find.trim()) {
    const needle = find.trim().toLowerCase();
    const hay = md.toLowerCase();
    const W = 600; // context chars on each side of a match
    const ranges: [number, number][] = [];
    let idx = hay.indexOf(needle);
    while (idx !== -1 && ranges.length < 25) {
      ranges.push([Math.max(0, idx - W), Math.min(total, idx + needle.length + W)]);
      idx = hay.indexOf(needle, idx + needle.length);
    }
    if (!ranges.length) {
      return { header: `No matches for "${find}" in this note (${total} chars). Try another keyword, or read it by page (page=1).`, text: "" };
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r);
    }
    let out = "";
    let shown = 0;
    for (const [a, b] of merged) {
      const seg = `${a > 0 ? "…" : ""}${md.slice(a, b)}${b < total ? "…" : ""}`;
      if (out.length + seg.length > READ_CAP) break;
      out += seg + "\n";
      shown++;
    }
    return { header: `${ranges.length} match(es) for "${find}" in this note (${total} chars); showing ${shown} section(s):`, text: out.trim() };
  }

  const pages = Math.max(1, Math.ceil(total / READ_CAP));
  const p = Math.min(Math.max(1, Math.floor(page || 1)), pages);
  const slice = md.slice((p - 1) * READ_CAP, p * READ_CAP);
  const more = p < pages
    ? ` — for the next part call read_anytype_object again with page=${p + 1}, or find="keyword" to jump to a section`
    : " (final part)";
  return { header: `Part ${p} of ${pages} (${total} chars total)${more}:`, text: slice };
}

// Derive a readable title from a content url, e.g. /A/Lionel_Messi → "Lionel Messi".
function titleFromUrl(url: string): string {
  try {
    const seg = decodeURIComponent(url.split("/").filter(Boolean).pop() ?? "");
    return seg.replace(/_/g, " ").trim() || url;
  } catch { return url; }
}

// A search hit, normalized across sources: `ref` is what the model passes to the
// matching read tool (a url for Kiwix, an object id for Anytype); `link` is the
// clickable source shown in citations.
type SearchHit = { title: string; ref: string; link: string; snippet: string; meta?: string };
type ToolResult =
  | { kind: "search"; source: "kiwix" | "anytype"; query: string; results: SearchHit[] }
  | { kind: "article"; title: string; link: string; text: string; meta?: string }
  | { kind: "message"; text: string };

// Execute a tool call by calling the source libs directly (NOT via /api/* — a
// server-side fetch carries no session cookie and the auth middleware would
// redirect it to the login page). Returns structured data; the loop turns it into
// numbered, citeable text for the model.
async function runTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  ctx: { kiwix?: Kiwix; anytype?: Anytype },
  signal: AbortSignal,
): Promise<ToolResult> {
  try {
    if (name === "search_kiwix" && ctx.kiwix) {
      const q = String(args?.query ?? "").trim();
      if (!q) return { kind: "message", text: "No query provided." };
      const results = await kiwixSearch(ctx.kiwix.baseUrl, ctx.kiwix.source, q, 6, signal);
      return { kind: "search", source: "kiwix", query: q, results: results.map(r => ({ title: r.title, ref: r.url, link: r.url, snippet: r.snippet })) };
    }
    if (name === "get_article" && ctx.kiwix) {
      const url = String(args?.url ?? "");
      if (!url) return { kind: "message", text: "No url provided." };
      const text = await articleExtract(ctx.kiwix.baseUrl, url, signal);
      return { kind: "article", title: titleFromUrl(url), link: url, text: text || "No text found in that article." };
    }
    if (name === "search_anytype" && ctx.anytype) {
      const q = String(args?.query ?? "").trim();
      if (!q) return { kind: "message", text: "No query provided." };
      const hits = await anytypeSearch(ctx.anytype.baseUrl, ctx.anytype.apiKey, ctx.anytype.spaceId, q, 6, signal);
      return {
        kind: "search", source: "anytype", query: q,
        results: hits.map(o => ({
          title: o.name, ref: o.id, link: anytypeDeepLink(o.spaceId, o.id), snippet: o.snippet || o.type,
          meta: [o.created && `created ${o.created}`, o.modified && `modified ${o.modified}`].filter(Boolean).join(", "),
        })),
      };
    }
    if (name === "read_anytype_object" && ctx.anytype) {
      const id = String(args?.id ?? "");
      if (!id) return { kind: "message", text: "No id provided." };
      const obj = await anytypeReadObject(ctx.anytype.baseUrl, ctx.anytype.apiKey, ctx.anytype.spaceId, id, signal);
      const meta = [
        obj.type && `Type: ${obj.type}`,
        obj.created && `Created: ${obj.created}`,
        obj.modified && `Last modified: ${obj.modified}`,
        ...obj.fields.map(f => `${f.name}: ${f.value}`),
      ].filter(Boolean).join("\n");
      // Window long notes so they don't overflow the model's context.
      const win = windowMarkdown(obj.markdown || "", args?.find ? String(args.find) : undefined, args?.page ? Number(args.page) : undefined);
      const text = (win.header ? win.header + "\n" : "") + (win.text || "(no body text)");
      return { kind: "article", title: obj.name, link: anytypeDeepLink(ctx.anytype.spaceId, id), text, meta };
    }
  } catch (err) {
    return { kind: "message", text: `Tool error: ${String(err instanceof Error ? err.message : err)}` };
  }
  return { kind: "message", text: `Unknown tool: ${name}` };
}

export async function POST(request: NextRequest) {
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
    ttl = 0,
  }: {
    baseUrl: string; apiKey?: string; model: string; messages: ChatMessage[];
    stream?: boolean; maxTokens?: number; reasoningEffort?: string; kiwix?: Kiwix | null;
    anytype?: Anytype | null;
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

  // ── Agentic path: model can call Kiwix and/or Anytype search tools ──────────
  const useKiwix = !!(kiwix && kiwix.baseUrl && kiwix.source);
  const useAnytype = !!(anytype && anytype.baseUrl && anytype.apiKey && anytype.spaceId);
  if (useKiwix || useAnytype) {
    const toolCtx = { kiwix: useKiwix ? kiwix! : undefined, anytype: useAnytype ? anytype! : undefined };
    const tools = [
      ...(useKiwix ? kiwixTools(kiwix!.sourceTitle) : []),
      ...(useAnytype ? anytypeTools(anytype!.spaceName) : []),
    ];
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
        // decoration. `opened` tracks articles actually READ via get_article, so a
        // correctly-read source still shows even if the model forgets to print [n].
        const sources: { n: number; title: string; url: string }[] = [];
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
        let searched = false; // model has run at least one search_kiwix
        let nudges = 0;       // times we've bounced a snippet-only answer

        // One non-streaming completion, used by the map-reduce summarizer to digest
        // each chunk of a long note. Bounded + tool-free; strips any <think> trace.
        const complete = async (msgs: ChatMessage[]): Promise<string> => {
          const res = await fetch(url, {
            method: "POST",
            headers: upstreamHeaders,
            body: JSON.stringify({ model, messages: msgs, stream: false, max_tokens: 256 }),
            signal: request.signal,
          });
          if (!res.ok) throw new Error(`summarize HTTP ${res.status}`);
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content ?? "";
          return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        };

        // Map-reduce digest of a long Anytype note: summarize each ~6k chunk on its
        // own (so nothing overflows context), return the per-part summaries for the
        // main model to synthesize. Emits progress into the thinking trail.
        const summarizeObject = async (id: string, focus: string): Promise<string> => {
          const obj = await anytypeReadObject(anytype!.baseUrl, anytype!.apiKey, anytype!.spaceId, id, request.signal);
          const n = cite(obj.name, anytypeDeepLink(anytype!.spaceId, id));
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

        try {
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
            const calls: { id: string; name: string; arguments: string }[] = [];

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
                    const idx = tc.index ?? 0;
                    calls[idx] = calls[idx] || { id: "", name: "", arguments: "" };
                    if (tc.id) calls[idx].id = tc.id;
                    if (tc.function?.name) calls[idx].name = tc.function.name;
                    if (tc.function?.arguments) calls[idx].arguments += tc.function.arguments;
                  }
                }
              }
            }

            const made = calls.filter(Boolean).filter((c) => c.name);
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
              try { args = JSON.parse(c.arguments || "{}"); } catch {}
              openThink();

              // Map-reduce summarize is handled here (not in runTool) because it
              // needs the model caller and emits its own progress.
              if (c.name === "summarize_anytype_object" && useAnytype) {
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

              const out = await runTool(c.name, args, toolCtx, request.signal);

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
              } else {
                toolText = out.text;
                emit(out.text + "\n");
              }
              convo.push({ role: "tool", tool_call_id: c.id || `call_${iter}_${i}`, content: toolText });
            }
          }

          // The loop ended while the model was still calling tools (it hit the
          // research-round cap without concluding). Force one final, tool-free
          // turn so the user always gets an answer instead of a dangling trail.
          if (!finalAnswer) {
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
          // Sources = articles actually read (opened via get_article) OR cited inline
          // with [n] (covers answering straight from a search snippet). This is the
          // durable floor: a source the model used still shows even when it forgot
          // the bracket. `cited` marks which were referenced inline.
          const usedNums = new Set<number>();
          for (const m of finalAnswer.matchAll(/\[(\d+)\]/g)) usedNums.add(Number(m[1]));
          const shownSources = sources
            .filter((s) => opened.has(s.n) || usedNums.has(s.n))
            .map((s) => ({ ...s, cited: usedNums.has(s.n) }));
          emit("\x1e" + JSON.stringify({ tokens: totalTokens, sources: shownSources }));
        } catch (err) {
          if ((err as Error).name !== "AbortError") { closeThink(); emit(`\n[error] ${String(err)}`); }
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
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
