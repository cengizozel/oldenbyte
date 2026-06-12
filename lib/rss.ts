// Shared RSS/Atom fetching + parsing, used by /api/rss and the server-side
// widget readers (lib/widgetData.ts). Dependency-free regex parsing.

export type FeedItem = { title: string; link: string; pubDate: string; content: string };

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractCdata(str: string): string {
  const m = str.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return decodeEntities(m ? m[1].trim() : str.trim());
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? extractCdata(m[1]) : "";
}

export async function fetchFeed(url: string, limit: number, signal?: AbortSignal): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" },
    next: { revalidate: 3600 },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml = await res.text();
  const items: FeedItem[] = [];

  // Detect format: Atom uses <entry>, RSS uses <item>
  const isAtom = /<entry[\s>]/i.test(xml);
  const blockRegex = isAtom ? /<entry>([\s\S]*?)<\/entry>/g : /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = blockRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const title = extractTag(block, "title");
    // Atom: <link href="..."/>; RSS: <link>...</link> or <guid>...</guid>
    const atomLinkMatch = block.match(/<link[^>]+href="([^"]+)"/i);
    const link = atomLinkMatch
      ? atomLinkMatch[1]
      : extractTag(block, "link") || extractTag(block, "guid");
    const pubDate = extractTag(block, "pubDate") || extractTag(block, "updated");
    const content = extractTag(block, "content") || extractTag(block, "description") || extractTag(block, "summary");
    if (title) items.push({ title, link, pubDate, content });
  }

  return items;
}
