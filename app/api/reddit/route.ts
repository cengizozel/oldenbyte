import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { feedTtlMs } from "@/lib/feedCache";
import { decodeEntities } from "@/lib/text";
import { mkdir, readFile, writeFile, rename } from "fs/promises";
import path from "path";

// Reddit blocks its JSON endpoints for non-browser clients (403), but the RSS
// feeds still serve with a browser User-Agent. RSS carries no vote counts;
// `score` stays 0 and the widget hides it.
//
// The real constraint is the rate limit: logged-out requests get a small
// per-IP budget (about one request a minute as of October 2026), so all
// upstream fetches go through ONE queue that follows Reddit's own budget
// headers. Results are cached (in memory and on disk, see CACHE_FILE), and a
// rate-limited refresh serves the last good result instead of nothing
// (stale-while-revalidate).
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

type Post = { title: string; link: string; pubDate: string; score: number; subreddit: string; content: string; thumbnail: string; image: string };

const STALE_MS = 24 * 60 * 60 * 1000; // still better than an empty feed
const MIN_SPACING_MS = 2000;          // floor between upstream fetches
const RETRY_FOR_MS = 30 * 60 * 1000;  // keep a rate-limited subreddit queued this long
const WAIT_FOR_MS = 20 * 1000;        // longest a request waits before answering "queued"

const cache = new Map<string, { at: number; posts: Post[] }>();
const inflight = new Map<string, Promise<Post[]>>();

// The cache is written to the data volume so a restart or deploy does not
// empty it: refilling every subreddit at Reddit's pace takes many minutes.
const CACHE_FILE = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "cache", "reddit.json");
let loaded: Promise<void> | null = null;
function loadCache(): Promise<void> {
  loaded ??= readFile(CACHE_FILE, "utf8")
    .then(raw => {
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, { at: number; posts: Post[] }>)) {
        if (Date.now() - v.at < STALE_MS) cache.set(k, v);
      }
    })
    .catch(() => {});
  return loaded;
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveCacheSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await writeFile(CACHE_FILE + ".tmp", JSON.stringify(Object.fromEntries(cache)));
      await rename(CACHE_FILE + ".tmp", CACHE_FILE);
    } catch (err) {
      console.error("[reddit] cache save", err);
    }
  }, 5000);
}

// One-at-a-time upstream queue. Reddit reports its budget on every response
// (x-ratelimit-remaining / x-ratelimit-reset, in seconds); when it is used up
// the next fetch waits until the window resets instead of guessing a spacing.
// Logged-out feed requests currently get about one per minute per IP.
let queueTail: Promise<unknown> = Promise.resolve();
let nextAllowedAt = 0;
function noteBudget(res: Response) {
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset") ?? res.headers.get("retry-after"));
  const waitMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 + 500 : 60_000;
  if (res.status === 429 || (Number.isFinite(remaining) && remaining < 1)) {
    nextAllowedAt = Math.max(nextAllowedAt, Date.now() + waitMs);
  } else {
    nextAllowedAt = Math.max(nextAllowedAt, Date.now() + MIN_SPACING_MS);
  }
}
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = nextAllowedAt - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    return fn();
  });
  queueTail = run.catch(() => {});
  return run;
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
}


async function fetchSubreddit(subreddit: string, period: string, limit: number): Promise<Post[]> {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.rss?t=${encodeURIComponent(period)}&limit=${limit}`;
  // Deliberately NOT tied to the client request's abort signal: once this
  // fetch has waited out the queue, its result should land in the cache even
  // if the widget that asked navigated away.
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  noteBudget(res);
  if (!res.ok) throw new Error(`Reddit ${res.status}`);

  const xml = await res.text();
  return (xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [])
    .slice(0, limit)
    .map(entry => {
      const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
      // Atom content is HTML-escaped; one decode returns the markup the
      // widget's sanitizer expects (same shape as the old selftext_html).
      const content = decodeEntities(tag(entry, "content"));
      // Image posts carry a small media:thumbnail plus a [link] to the full
      // image inside the content HTML.
      const thumbnail = decodeEntities(entry.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] ?? "");
      // Attribute values inside the content are still entity-encoded ("&amp;"),
      // and a URL left that way 403s, so decode it like the thumbnail.
      const image = decodeEntities(
        content.match(/href="(https:\/\/(?:i\.redd\.it|preview\.redd\.it|i\.imgur\.com)\/[^"]+)"/)?.[1] ??
        content.match(/<img[^>]*src="(https:\/\/[^"]+)"/)?.[1] ?? "");
      return {
        title: decodeEntities(tag(entry, "title")),
        link: decodeEntities(link),
        pubDate: tag(entry, "updated") || tag(entry, "published"),
        score: 0,
        subreddit,
        content,
        thumbnail,
        image,
      };
    })
    .filter(p => p.title && p.link);
}

// Queued fetch shared by identical concurrent requests, cached on success.
// A 429 goes back into the queue (which now waits for Reddit's reset) and is
// retried until RETRY_FOR_MS has passed; other errors (403, 404) fail at once.
function refresh(key: string, subreddit: string, period: string, limit: number): Promise<Post[]> {
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const deadline = Date.now() + RETRY_FOR_MS;
    for (;;) {
      try {
        const posts = await throttled(() => fetchSubreddit(subreddit, period, limit));
        cache.set(key, { at: Date.now(), posts });
        saveCacheSoon();
        return posts;
      } catch (err) {
        if (!String(err).includes("429") || Date.now() > deadline) throw err;
      }
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;

  const subreddit = request.nextUrl.searchParams.get("subreddit");
  const period    = request.nextUrl.searchParams.get("period") ?? "week";
  const limit     = Math.min(Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "5") || 5), 25);

  // Restrict to a valid subreddit name so it can't manipulate the request path.
  if (!subreddit || !/^[A-Za-z0-9_]{1,50}$/.test(subreddit)) {
    return NextResponse.json({ error: "Missing or invalid subreddit" }, { status: 400 });
  }

  await loadCache();
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

  // Nothing usable cached: wait a little for the queue, then answer "queued"
  // (the fetch keeps going in the background and fills the cache) so the
  // widget can retry instead of a request hanging for many minutes.
  const job = refresh(key, subreddit, period, limit);
  job.catch(() => {});
  try {
    const posts = await Promise.race([
      job,
      new Promise<null>(r => setTimeout(() => r(null), WAIT_FOR_MS)),
    ]);
    if (posts) return NextResponse.json(posts);
    if (hit && Date.now() - hit.at < STALE_MS) return NextResponse.json(hit.posts);
    return NextResponse.json({ error: "queued", retryAfter: 60 }, { status: 503 });
  } catch (err) {
    // Even a forced refresh prefers yesterday's posts over an empty panel.
    if (hit && Date.now() - hit.at < STALE_MS) return NextResponse.json(hit.posts);
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
