import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { key, content } = await request.json();
  if (!key || !content) {
    return NextResponse.json({ error: "Missing key or content" }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a seasoned newspaper editor crafting a personal morning briefing. " +
              "Write flowing, intelligent prose summarizing the content provided. No bullet points, no headers, no section titles — just prose. " +
              "If the content contains many papers or articles, cover at least 5 of the most significant or groundbreaking ones, " +
              "giving each 1–2 sentences. Prioritize novelty, impact, and surprise. " +
              "For smaller or single-item sources, 2–4 sentences total is fine. " +
              "When you mention a specific item that has a reference number like [1] in the content, " +
              "include that number in brackets immediately after. " +
              "Only cite items that appear in the REFERENCES section.",
          },
          {
            role: "user",
            content:
              "Below is today's content from one source. Write a brief newspaper-style paragraph about it.\n\n" +
              "---\n\n" +
              content,
          },
        ],
        max_tokens: 2500,
        temperature: 0.7,
      }),
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
