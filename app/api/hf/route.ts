import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "50"), 50);

  try {
    const res = await fetch(
      "https://huggingface.co/api/daily_papers",
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        cache: "no-store",
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = await res.json();
    const papers = raw
      .map(p => ({
        id:          p.paper?.id ?? "",
        title:       p.paper?.title ?? "",
        abstract:    p.paper?.summary ?? "",
        authors:     (p.paper?.authors ?? []).map((a: { name: string }) => a.name),
        publishedAt: p.paper?.publishedAt ?? p.submittedAt ?? "",
        upvotes:     p.paper?.upvotes ?? 0,
        link:        `https://huggingface.co/papers/${p.paper?.id ?? ""}`,
      }))
      .filter(p => p.id)
      .sort((a, b) => b.upvotes - a.upvotes)
      .slice(0, limit);
    return NextResponse.json(papers);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
