import type { ActionChip, ChatMessage, MsgStats, Proposal, Role, Source } from "./types";

// The /api/chat streaming protocol: the reply text streams as plain chunks,
// then an optional \x1e separator and a JSON trailer (token count, cited
// sources, write proposals, executed actions).

// Only role/content go upstream. Strip prior assistant <think>...</think>
// reasoning: replaying it wastes the context window (and reasoning models
// expect history without it), which otherwise crowds out the conversation.
export function upstreamMessages(history: ChatMessage[], systemContent: string, continuing: boolean) {
  const continueNudge: { role: Role; content: string }[] = continuing
    ? [{ role: "user", content: "Continue your previous answer exactly where it left off. Do not repeat or summarize earlier text; just continue." }]
    : [];
  const cleanHistory = history.map(m => {
    const text = m.role === "assistant" ? m.content.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim() : m.content;
    // Images ride as OpenAI-style content parts; plain messages stay strings.
    if (m.images?.length) {
      return {
        role: m.role,
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...m.images.map(url => ({ type: "image_url", image_url: { url } })),
        ],
      };
    }
    return { role: m.role, content: text };
  });
  return [
    ...(systemContent ? [{ role: "system", content: systemContent }] : []),
    ...cleanHistory,
    ...continueNudge,
  ];
}

export type StreamResult = {
  body: string;
  tokens: number;
  sources?: Source[];
  proposals?: Proposal[];
  actions?: ActionChip[];
};

// POST the request and read the stream. `onBody` gets the visible reply so far
// after every chunk. Throws on an HTTP error (with the server's message) and
// rethrows AbortError when the signal fires.
export async function streamChat(request: unknown, signal: AbortSignal, onBody: (body: string) => void): Promise<StreamResult> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error ?? msg; } catch {}
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  // Visible reply is everything before the \x1e stats trailer.
  const bodyOf = (s: string) => { const i = s.indexOf("\x1e"); return i === -1 ? s : s.slice(0, i); };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    onBody(bodyOf(acc));
  }

  const result: StreamResult = { body: bodyOf(acc), tokens: 0 };
  const sep = acc.indexOf("\x1e");
  if (sep !== -1) {
    try {
      const trailer = JSON.parse(acc.slice(sep + 1));
      result.tokens = trailer.tokens ?? 0;
      if (Array.isArray(trailer.sources) && trailer.sources.length) result.sources = trailer.sources;
      if (Array.isArray(trailer.proposals) && trailer.proposals.length) {
        result.proposals = trailer.proposals.map((pr: Omit<Proposal, "status">) => ({ ...pr, status: "pending" as const }));
      }
      if (Array.isArray(trailer.actions) && trailer.actions.length) result.actions = trailer.actions;
    } catch {}
  }
  return result;
}

// Throughput stats for a finished reply (undefined when the server sent no
// token count). Times are performance.now() values.
export function replyStats(tokens: number, start: number, first: number | null, end: number): MsgStats | undefined {
  if (tokens <= 0) return undefined;
  const ttft = first ? (first - start) / 1000 : 0;
  const genS = first ? (end - first) / 1000 : (end - start) / 1000;
  return { tokens, ttft, total: (end - start) / 1000, tps: genS > 0 ? tokens / genS : 0 };
}
