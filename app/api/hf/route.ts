import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("https://huggingface.co/api/daily_papers", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = await res.json();
    const papers = raw.map(item => ({
      id:        item.paper?.id ?? "",
      title:     item.paper?.title ?? "",
      abstract:  item.paper?.summary ?? "",
      authors:   (item.paper?.authors ?? []).map((a: { name: string }) => a.name),
      publishedAt: item.paper?.publishedAt ?? item.submittedAt ?? "",
      link:      `https://huggingface.co/papers/${item.paper?.id ?? ""}`,
    })).filter(p => p.id);
    return NextResponse.json(papers);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
