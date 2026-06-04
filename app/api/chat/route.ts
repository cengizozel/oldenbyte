import { NextRequest, NextResponse } from "next/server";
import { search as kiwixSearch, articleExtract } from "@/lib/kiwix";

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

// Kiwix is a keyword index, so a question-shaped query ("Lionel Messi birth
// date") ranks worse than the bare entity ("Lionel Messi"). Models often add
// filler anyway, so strip the obvious temporal/question words before searching —
// like a human typing just the name. Conservative: leaves proper nouns and
// disambiguators (incl. parentheticals) intact, and bails to the original if
// nothing meaningful is left.
const FILLER = new Set([
  "when", "what", "who", "whom", "whose", "where", "why", "how", "was", "were",
  "is", "are", "did", "does", "do", "of", "in", "on", "for", "to", "the", "a", "an",
  "born", "birth", "birthday", "birthdate", "date", "dates", "dob",
  "release", "released", "launch", "launched", "founded", "founding", "established",
  "history", "biography", "bio", "info", "information", "about", "details", "detail",
  "year", "day", "month", "age", "old",
]);
function simplifyQuery(raw: string): string {
  const words = raw.replace(/[?.!,]/g, " ").split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !FILLER.has(w.toLowerCase()));
  const result = kept.join(" ").trim();
  return result.length >= 2 ? result : raw.trim();
}

// Execute a tool call by calling the Kiwix lib directly (NOT via /api/kiwix —
// that server-side fetch carries no session cookie and the auth middleware would
// redirect it to the HTML login page). Returns text the model can read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runKiwixTool(name: string, args: any, kiwix: Kiwix, signal: AbortSignal): Promise<string> {
  try {
    if (name === "search_kiwix") {
      const raw = String(args?.query ?? "").trim();
      if (!raw) return "No query provided.";
      const q = simplifyQuery(raw);
      let results = await kiwixSearch(kiwix.baseUrl, kiwix.source, q, 6, signal);
      // Fall back to the model's original wording only if the trimmed one whiffs.
      if (!results.length && q !== raw) results = await kiwixSearch(kiwix.baseUrl, kiwix.source, raw, 6, signal);
      if (!results.length) return `No results for "${q}".`;
      return results.map((r, i) => `${i + 1}. ${r.title}\n   url: ${r.url}\n   ${r.snippet}`).join("\n");
    }
    if (name === "get_article") {
      const url = String(args?.url ?? "");
      if (!url) return "No url provided.";
      return (await articleExtract(kiwix.baseUrl, url, signal)) || "No text found in that article.";
    }
  } catch (err) {
    return `Tool error: ${String(err instanceof Error ? err.message : err)}`;
  }
  return `Unknown tool: ${name}`;
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
  }: {
    baseUrl: string; apiKey?: string; model: string; messages: ChatMessage[];
    stream?: boolean; maxTokens?: number; reasoningEffort?: string; kiwix?: Kiwix | null;
  } = await request.json();

  if (!baseUrl || !/^https?:\/\//.test(baseUrl) || !model || !Array.isArray(messages)) {
    return NextResponse.json({ error: "Missing baseUrl, model, or messages" }, { status: 400 });
  }

  const url = `${normalizeBase(baseUrl)}/chat/completions`;
  const upstreamHeaders = { "Content-Type": "application/json", ...authHeaders(apiKey) };
  const extra = {
    ...(Number(maxTokens) > 0 ? { max_tokens: Math.floor(Number(maxTokens)) } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };

  // ── Agentic path: model can call Kiwix search tools ─────────────────────────
  if (kiwix && kiwix.baseUrl && kiwix.source) {
    const tools = kiwixTools(kiwix.sourceTitle);
    const encoder = new TextEncoder();
    const MAX_ITERS = 5;

    const readable = new ReadableStream({
      async start(controller) {
        const emit = (s: string) => controller.enqueue(encoder.encode(s));
        let thinkOpen = false;
        const openThink = () => { if (!thinkOpen) { emit("<think>"); thinkOpen = true; } };
        const closeThink = () => { if (thinkOpen) { emit("</think>\n\n"); thinkOpen = false; } };
        let totalTokens = 0;
        const convo: ChatMessage[] = [...messages];

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

            // Parse this round's SSE: emit content/reasoning live, buffer tool calls.
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
                if (delta.content) { closeThink(); emit(delta.content); assistantContent += delta.content; totalTokens++; }
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
            if (!made.length) break; // no tool calls → the streamed content is the answer

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
              const label =
                c.name === "search_kiwix" ? `searching Kiwix for “${simplifyQuery(String(args.query ?? ""))}”`
                : c.name === "get_article" ? `reading article…`
                : `calling ${c.name}`;
              emit(`\n🔎 ${label}\n`);
              const result = await runKiwixTool(c.name, args, kiwix, request.signal);
              emit(result.length > 600 ? result.slice(0, 600) + "…\n" : result + "\n");
              convo.push({ role: "tool", tool_call_id: c.id || `call_${iter}_${i}`, content: result });
            }
          }

          closeThink();
          emit("\x1e" + JSON.stringify({ tokens: totalTokens }));
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
