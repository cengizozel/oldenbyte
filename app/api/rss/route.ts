import { NextRequest, NextResponse } from "next/server";

function extractCdata(str: string): string {
  const m = str.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1].trim() : str.trim();
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? extractCdata(m[1]) : "";
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "5"), 20);

  if (!url || !url.startsWith("http")) {
    return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" },
      next: { revalidate: 3600 },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    const items: { title: string; link: string; pubDate: string }[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
      const block = match[1];
      const title = extractTag(block, "title");
      const link = extractTag(block, "link") || extractTag(block, "guid");
      const pubDate = extractTag(block, "pubDate");
      if (title) items.push({ title, link, pubDate });
    }

    return NextResponse.json(items);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
