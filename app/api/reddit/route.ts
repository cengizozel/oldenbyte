import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { feedTtlMs } from "@/lib/feedCache";

// Reddit blocks its JSON endpoints for non-browser clients (403), but the RSS
// feeds still serve with a browser User-Agent. RSS carries no vote counts;
// `score` stays 0 and the widget hides it.
//
// The real constraint is the rate limit: unauthenticated requests get blanket
// 429s beyond roughly one every ten seconds per IP, so a widget with many
// subreddits firing at once used to render only whichever feed won the race.
// All upstream fetches therefore go through ONE queue with generous spacing,
// results are cached in memory, and a rate-limited refresh serves the last
// good result instead of nothing (stale-while-revalidate).
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

type Post = { title: string; link: string; pubDate: string; score: number; subreddit: string; content: string };

const STALE_MS = 24 * 60 * 60 * 1000; // still better than an empty feed
const SPACING_MS = 15 * 1000;         // gap between upstream fetches
const ATTEMPTS = 3;                   // 429s requeue for another spaced try

const cache = new Map<string, { at: number; posts: Post[] }>();
const inflight = new Map<string, Promise<Post[]>>();

// One-at-a-time upstream queue: every reddit fetch waits its turn and keeps
// SPACING_MS distance from the previous one, whatever endpoint asked for it.
let queueTail: Promise<unknown> = Promise.resolve();
let lastFetchAt = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = lastFetchAt + SPACING_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastFetchAt = Date.now();
    return fn();
  });
  queueTail = run.catch(() => {});
  return run;
}

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

async function fetchSubreddit(subreddit: string, period: string, limit: number): Promise<Post[]> {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.rss?t=${encodeURIComponent(period)}&limit=${limit}`;
  // Deliberately NOT tied to the client request's abort signal: once this
  // fetch has waited out the queue, its result should land in the cache even
  // if the widget that asked navigated away.
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`Reddit ${res.status}`);

  const xml = await res.text();
  return (xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [])
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
}

// Queued fetch shared by identical concurrent requests, cached on success.
// A 429 sends the subreddit to the BACK of the queue for another spaced try:
// that lets other feeds use whatever budget exists instead of stalling the
// line, and each retry arrives with at least a full spacing of cool-down.
function refresh(key: string, subreddit: string, period: string, limit: number): Promise<Post[]> {
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const posts = await throttled(() => fetchSubreddit(subreddit, period, limit));
        cache.set(key, { at: Date.now(), posts });
        return posts;
      } catch (err) {
        lastErr = err;
        if (!String(err).includes("429")) break; // 403/404 etc: retrying won't help
      }
    }
    throw lastErr;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;

  const subreddit = request.nextUrl.searchParams.get("subreddit");
  const period    = request.nextUrl.searchParams.get("period") ?? "week";
  const limit     = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "5"), 25);

  // Restrict to a valid subreddit name so it can't manipulate the request path.
  if (!subreddit || !/^[A-Za-z0-9_]{1,50}$/.test(subreddit)) {
    return NextResponse.json({ error: "Missing or invalid subreddit" }, { status: 400 });
  }

  const force = request.nextUrl.searchParams.get("refresh") === "1";
  const key = `${subreddit.toLowerCase()}|${period}|${limit}`;
  const hit = cache.get(key);

  // Fresh enough: serve it. A bit old: serve it NOW and refresh in the
  // background, so one widget with many subreddits paints instantly instead of
  // waiting out the queue. An explicit refresh skips straight to fetching
  // (still queue-paced against the rate limit).
  if (!force && hit && Date.now() - hit.at < await feedTtlMs()) {
    return NextResponse.json(hit.posts);
  }
  if (!force && hit && Date.now() - hit.at < STALE_MS) {
    void refresh(key, subreddit, period, limit).catch(() => {});
    return NextResponse.json(hit.posts);
  }

  try {
    return NextResponse.json(await refresh(key, subreddit, period, limit));
  } catch (err) {
    // Even a forced refresh prefers yesterday's posts over an empty panel.
    if (hit && Date.now() - hit.at < STALE_MS) return NextResponse.json(hit.posts);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
