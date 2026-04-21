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

type Video = { title: string; link: string; published: string };

// Convert relative YouTube time ("2 days ago") to approximate ISO string
function relToIso(rel: string): string {
  const m = rel.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/i);
  if (!m) return new Date().toISOString();
  const n = parseInt(m[1]);
  const ms: Record<string, number> = {
    second: 1e3, minute: 6e4, hour: 36e5,
    day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6,
  };
  return new Date(Date.now() - n * (ms[m[2].toLowerCase()] ?? 0)).toISOString();
}

async function fetchViaRss(channelId: string, limit: number): Promise<{ name: string; videos: Video[] }> {
  const res = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    { headers: { "User-Agent": UA } }
  );
  if (!res.ok) throw new Error(`RSS ${res.status}`);

  const xml = await res.text();
  const name = xml.match(/<author>\s*<name>([^<]+)<\/name>/)?.[1]?.trim() ?? channelId;

  const videos: Video[] = [];
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
  return { name, videos };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dig(obj: any, ...keys: string[]): any {
  return keys.reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

async function fetchViaChannelPage(channelId: string, limit: number): Promise<{ name: string; videos: Video[] }> {
  const res = await fetch(
    `https://www.youtube.com/channel/${channelId}/videos`,
    { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } }
  );
  if (!res.ok) throw new Error(`Channel page ${res.status}`);

  const html = await res.text();

  // Extract ytInitialData JSON
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("ytInitialData not found");
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf(";</script>", jsonStart);
  if (jsonEnd === -1) throw new Error("ytInitialData end not found");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = JSON.parse(html.slice(jsonStart, jsonEnd));

  const name: string =
    dig(data, "metadata", "channelMetadataRenderer", "title") ?? channelId;

  // Navigate to video grid items
  const tabs: unknown[] = dig(data, "contents", "twoColumnBrowseResultsRenderer", "tabs") ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let renderers: any[] = [];

  for (const tab of tabs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents: any[] =
      dig(tab, "tabRenderer", "content", "richGridRenderer", "contents") ??
      dig(tab, "tabRenderer", "content", "sectionListRenderer", "contents") ?? [];
    for (const item of contents) {
      const vr = dig(item, "richItemRenderer", "content", "videoRenderer");
      if (vr?.videoId) renderers.push(vr);
    }
    if (renderers.length > 0) break;
  }

  const videos: Video[] = renderers.slice(0, limit).map(vr => ({
    title: vr.title?.runs?.[0]?.text ?? vr.title?.simpleText ?? "",
    link: `https://www.youtube.com/watch?v=${vr.videoId}`,
    published: relToIso(vr.publishedTimeText?.simpleText ?? ""),
  })).filter(v => v.title);

  return { name, videos };
}

async function resolveChannelId(input: string): Promise<{ channelId: string; name: string }> {
  const trimmed = input.trim();

  if (/^UC[\w-]{22}$/.test(trimmed)) {
    return { channelId: trimmed, name: trimmed };
  }

  let pageUrl = trimmed;
  if (!trimmed.startsWith("http")) {
    const handle = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
    pageUrl = `https://www.youtube.com/${handle}`;
  }

  const res = await fetch(pageUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`Page fetch failed: ${res.status}`);
  const html = await res.text();

  const idMatch =
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
    html.match(/"externalId"\s*:\s*"(UC[\w-]{22})"/) ||
    html.match(/\/channel\/(UC[\w-]{22})/);
  if (!idMatch) throw new Error("Could not find channel ID on page");

  const name = html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(/ - YouTube$/i, "").trim() ?? "Unknown";
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
      resolvedName = "";
    } else {
      const resolved = await resolveChannelId(channel!);
      resolvedId = resolved.channelId;
      resolvedName = resolved.name;
    }

    let name: string;
    let videos: Video[];

    try {
      const result = await fetchViaRss(resolvedId, limit);
      name = result.name;
      videos = result.videos;
    } catch {
      const result = await fetchViaChannelPage(resolvedId, limit);
      name = result.name;
      videos = result.videos;
    }

    return NextResponse.json({ channelId: resolvedId, name: resolvedName || name, videos });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
