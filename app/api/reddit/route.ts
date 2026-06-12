import { NextRequest, NextResponse } from "next/server";

// Reddit blocks its JSON endpoints for non-browser clients (403), but the RSS
// feeds still serve with a browser User-Agent, so posts come from top.rss.
// RSS carries no vote counts; `score` stays 0 and the widget hides it.
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

export async function GET(request: NextRequest) {
  const subreddit = request.nextUrl.searchParams.get("subreddit");
  const period    = request.nextUrl.searchParams.get("period") ?? "week";
  const limit     = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "5"), 25);

  if (!subreddit) return NextResponse.json({ error: "Missing subreddit" }, { status: 400 });

  try {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.rss?t=${encodeURIComponent(period)}&limit=${limit}`;
    const opts = { headers: { "User-Agent": UA }, signal: request.signal, next: { revalidate: 900 } };
    let res = await fetch(url, opts);
    if (res.status === 429) {
      // Rate-limited burst; one spaced retry usually clears it.
      await new Promise(r => setTimeout(r, 1500));
      res = await fetch(url, opts);
    }
    if (!res.ok) throw new Error(`Reddit ${res.status}`);

    const xml = await res.text();
    const posts = (xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [])
      .slice(0, limit)
      .map(entry => {
        const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
        // Atom content is HTML-escaped; one decode returns the markup the
        // widget's sanitizer expects (same shape as the old selftext_html).
        const content = decodeEntities(tag(entry, "content"));
        return {
          title: decodeEntities(tag(entry, "title")),
          link: decodeEntities(link),
          pubDate: tag(entry, "updated") || tag(entry, "published"),
          score: 0,
          subreddit,
          content,
        };
      })
      .filter(p => p.title && p.link);

    return NextResponse.json(posts);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
