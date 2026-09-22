import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";

// Proxy for the TV widget. IPTV servers (e.g. ErsatzTV) usually live on plain
// http inside the LAN while the dashboard is served over https, so the browser
// cannot fetch the streams directly (mixed content). Server-side, like
// /api/kiwix and /api/anytype: auth required, URL supplied by the widget.
//
// ?op=channels&url=<.m3u>      -> parsed channel list [{name, url, logo}]
// ?op=playlist&url=<.m3u8>     -> HLS playlist with every URI rewritten back
//                                 through this proxy (sub-playlists + segments)
// ?op=seg&url=<segment>        -> raw segment bytes, streamed through

function valid(url: string | null): url is string {
  return !!url && /^https?:\/\//.test(url);
}

function proxied(op: string, abs: string): string {
  return `/api/tv?op=${op}&url=${encodeURIComponent(abs)}`;
}

// Rewrite an HLS playlist so every reference resolves through the proxy.
// Nested playlists (variants, live windows) go back through op=playlist,
// media segments through op=seg; URI="..." attributes (keys, maps) too.
function rewritePlaylist(text: string, baseUrl: string): string {
  const abs = (u: string) => new URL(u, baseUrl).toString();
  const isPlaylist = (u: string) => /\.m3u8?(\?|$)/i.test(u);
  return text
    .split("\n")
    .map(line => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, u) =>
          `URI="${proxied(isPlaylist(u) ? "playlist" : "seg", abs(u))}"`);
      }
      return proxied(isPlaylist(t) ? "playlist" : "seg", abs(t));
    })
    .join("\n");
}

// Parse an M3U channel list: #EXTINF:-1 tvg-logo="..." ... ,Channel Name
function parseChannels(text: string, baseUrl: string): { name: string; url: string; logo: string }[] {
  const lines = text.split("\n");
  const out: { name: string; url: string; logo: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF")) continue;
    const name = line.split(",").pop()?.trim() || "Channel";
    const logo = /tvg-logo="([^"]+)"/.exec(line)?.[1] ?? "";
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || lines[j].trim().startsWith("#"))) j++;
    const url = lines[j]?.trim();
    if (url) out.push({ name, url: new URL(url, baseUrl).toString(), logo: logo ? new URL(logo, baseUrl).toString() : "" });
    i = j;
  }
  return out;
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const sp = request.nextUrl.searchParams;
  const op = sp.get("op");
  const url = sp.get("url");
  if (!valid(url)) return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });

  try {
    if (op === "channels") {
      const res = await fetch(url, { signal: request.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return NextResponse.json({ channels: parseChannels(await res.text(), url) });
    }
    if (op === "playlist") {
      const res = await fetch(url, { signal: request.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new NextResponse(rewritePlaylist(await res.text(), url), {
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
      });
    }
    if (op === "seg") {
      const res = await fetch(url, { signal: request.signal, cache: "no-store" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      return new NextResponse(res.body, {
        headers: {
          "Content-Type": res.headers.get("content-type") ?? "video/mp2t",
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
