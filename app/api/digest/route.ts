import { NextRequest, NextResponse } from "next/server";

const SYSTEM =
  "You are a seasoned newspaper editor crafting a personal morning briefing. " +
  "Write flowing, intelligent prose summarizing the content provided. No bullet points, no headers, no section titles — just prose. " +
  "If the content contains many papers or articles, cover at least 5 of the most significant or groundbreaking ones, " +
  "giving each 1–2 sentences. Prioritize novelty, impact, and surprise. " +
  "For smaller or single-item sources, 2–4 sentences total is fine. " +
  "Citation rules — follow these exactly: " +
  "(1) When you mention a specific item that has a reference number in the REFERENCES block, write that number in square brackets immediately after the mention, like [1] or [2]. " +
  "(2) Always write both the opening bracket, the number, and the closing bracket — never leave brackets empty like [] and never leave them unclosed like [3. " +
  "(3) Only use reference numbers that actually appear in the REFERENCES block. Do not invent numbers. " +
  "(4) If an item has no reference number, do not add brackets at all.";

const USER = (content: string) =>
  "Below is today's content from one source. Write a brief newspaper-style paragraph about it.\n\n---\n\n" + content;

function buildBody(content: string, stream: boolean) {
  return JSON.stringify({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER(content) },
    ],
    max_tokens: 2500,
    temperature: 0.7,
    stream,
  });
}

export async function POST(request: NextRequest) {
  const { key, content, stream = false } = await request.json();
  if (!key || !content) {
    return NextResponse.json({ error: "Missing key or content" }, { status: 400 });
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };

  if (stream) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: buildBody(content, true),
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json(
        { error: err.error?.message ?? `OpenAI error ${res.status}` },
        { status: res.status }
      );
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of decoder.decode(value).split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const delta = JSON.parse(data).choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch { /* skip malformed chunks */ }
            }
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

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: buildBody(content, false),
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json(
        { error: err.error?.message ?? `OpenAI error ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ summary });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
