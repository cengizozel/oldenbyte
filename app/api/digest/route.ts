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
              "Transform a raw content digest into an elegant, well-written newspaper-style summary. " +
              "Write in flowing prose — no bullet points. Use ## for section headers. Be concise but substantive.",
          },
          {
            role: "user",
            content:
              "Below is today's content digest. Write a beautifully structured newspaper-style briefing from it.\n\n" +
              "Guidelines:\n" +
              "- Warm, intelligent tone — quality newspaper columnist\n" +
              "- Group related content under clear ## section headers\n" +
              "- Flowing prose, not lists\n" +
              "- Include specific titles, names, and details from the digest\n" +
              "- Keep each section to 2–4 sentences\n\n" +
              "---\n\n" +
              content,
          },
        ],
        max_tokens: 1500,
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
