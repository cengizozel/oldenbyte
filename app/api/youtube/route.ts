import { NextRequest, NextResponse } from "next/server";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

async function resolveChannelId(input: string): Promise<{ channelId: string; name: string }> {
  const trimmed = input.trim();

  // Already a channel ID
  if (/^UC[\w-]{22}$/.test(trimmed)) {
    const rss = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${trimmed}`, { headers: { "User-Agent": UA } });
    const xml = await rss.text();
    const nameMatch = xml.match(/<author>\s*<name>([^<]+)<\/name>/);
    return { channelId: trimmed, name: nameMatch?.[1]?.trim() ?? trimmed };
  }

  // Build page URL
  let pageUrl = trimmed;
  if (!trimmed.startsWith("http")) {
    const handle = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
    pageUrl = `https://www.youtube.com/${handle}`;
  }

  const res = await fetch(pageUrl, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Page fetch failed: ${res.status}`);
  const html = await res.text();

  // Extract channel ID from page metadata
  const idMatch =
    html.match(/"channelId"\s*:\s*"(UC[\w-]{22})"/) ||
    html.match(/"externalId"\s*:\s*"(UC[\w-]{22})"/) ||
    html.match(/\/channel\/(UC[\w-]{22})/);
  if (!idMatch) throw new Error("Could not find channel ID on page");

  // Extract channel name from <title>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = titleMatch?.[1]?.replace(/ - YouTube$/i, "").trim() ?? "Unknown";

  return { channelId: idMatch[1], name };
}

export async function GET(request: NextRequest) {
  const channel   = request.nextUrl.searchParams.get("channel");
  const channelId = request.nextUrl.searchParams.get("channelId");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "5"), 15);

  if (!channel && !channelId) {
    return NextResponse.json({ error: "Missing channel or channelId" }, { status: 400 });
  }

  try {
    let resolvedId: string;
    let resolvedName: string;

    if (channelId) {
      resolvedId = channelId;
      resolvedName = ""; // name already stored in widget config
    } else {
      const resolved = await resolveChannelId(channel!);
      resolvedId = resolved.channelId;
      resolvedName = resolved.name;
    }

    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${resolvedId}`;
    const rssRes = await fetch(rssUrl, { headers: { "User-Agent": UA } });
    if (!rssRes.ok) throw new Error(`RSS fetch failed: ${rssRes.status}`);

    const xml = await rssRes.text();

    // Extract channel name from feed if not already resolved
    if (!resolvedName) {
      const nm = xml.match(/<author>\s*<name>([^<]+)<\/name>/);
      resolvedName = nm?.[1]?.trim() ?? resolvedId;
    }

    const videos: { title: string; link: string; published: string }[] = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null && videos.length < limit) {
      const block = match[1];
      const rawTitle = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
      const title = extractCdata(rawTitle);
      const linkMatch = block.match(/<link[^>]+href="([^"]+)"/i);
      const published = block.match(/<published>([^<]+)<\/published>/)?.[1] ?? "";
      if (title && linkMatch) videos.push({ title, link: linkMatch[1], published });
    }

    return NextResponse.json({ channelId: resolvedId, name: resolvedName, videos });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
