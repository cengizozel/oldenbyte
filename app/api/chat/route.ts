import { NextRequest, NextResponse } from "next/server";

// Server-side proxy to any OpenAI-compatible chat endpoint (Ollama, LM Studio,
// llama.cpp, vLLM, OpenAI itself, …). Running it server-side avoids CORS and
// mixed-content blocking when the dashboard is served over HTTPS but the model
// runs on plain http://localhost.

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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
    // OpenAI/LM Studio/llama.cpp return { data: [{ id }] }; Ollama's native
    // endpoint returns { models: [{ name }] } — accept both shapes.
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
  const { baseUrl, apiKey = "", model, messages, stream = true, maxTokens = 0 } = await request.json();

  if (!baseUrl || !/^https?:\/\//.test(baseUrl) || !model || !Array.isArray(messages)) {
    return NextResponse.json({ error: "Missing baseUrl, model, or messages" }, { status: 400 });
  }

  const url = `${normalizeBase(baseUrl)}/chat/completions`;
  const body = JSON.stringify({
    model,
    messages: messages as ChatMessage[],
    stream,
    // Cap the reply when the client asked for one; omit otherwise so the server
    // uses its own default. max_tokens is the OpenAI-compatible field name.
    ...(Number(maxTokens) > 0 ? { max_tokens: Math.floor(Number(maxTokens)) } : {}),
  });

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
      body,
    });
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

  // Re-emit upstream SSE token deltas as a plain-text stream the client reads
  // with a ReadableStreamDefaultReader. Buffer across reads so a JSON line that
  // straddles two chunks is never parsed half-formed.
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Count generated tokens by counting per-token deltas (exact for local
      // servers that stream one token per chunk); prefer upstream usage when the
      // server reports it.
      let tokens = 0;
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
              const obj = JSON.parse(payload);
              const delta = obj.choices?.[0]?.delta?.content;
              if (delta) { controller.enqueue(encoder.encode(delta)); tokens++; }
              const reported = obj.usage?.completion_tokens;
              if (typeof reported === "number") tokens = reported;
            } catch { /* skip malformed chunks */ }
          }
        }
        // Trailer: a record-separator (\x1e, never present in model text)
        // followed by JSON stats. The client splits it off the response body.
        controller.enqueue(encoder.encode("\x1e" + JSON.stringify({ tokens })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
