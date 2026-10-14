"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, ChevronLeft, ExternalLink, Flame } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { timeAgo, formatCount, localDateStr } from "@/lib/format";
import { decodeEntities, parseJson } from "@/lib/text";
import { tagColor } from "@/lib/colors";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput, FOCUS_RING, HIT_AREA } from "@/components/ui/Field";
import { WidgetHeader, Chip, SmallButton, PencilButton, RefreshButton, ScrollFades, LoadingState, EmptyState, SaveCancelRow } from "@/components/ui/WidgetChrome";
import { redditCacheKey } from "@/lib/cacheKeys";

type Period = "day" | "week" | "month" | "year" | "all";
type SubEntry = { name: string; limit: number; period: Period };
type RedditConfig = { subreddits: SubEntry[]; images?: boolean };
type Post = { title: string; link: string; subreddit: string; pubDate: string; content: string; score: number; thumbnail?: string; image?: string };

function sanitizeRedditHtml(raw: string | undefined): string {
  if (!raw) return "";
  try {
    // Reddit RSS entity-encodes the HTML body, so decode it first
    const doc = new DOMParser().parseFromString(decodeEntities(raw), "text/html");
    const mdDiv = doc.querySelector(".md");
    if (!mdDiv) return "";
  const ALLOWED = new Set(["p","em","strong","b","i","ol","ul","li","hr","a","blockquote","code","pre","br"]);
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE)
      return (node.textContent ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(walk).join("");
    if (tag === "hr" || tag === "br") return `<${tag}/>`;
    if (!ALLOWED.has(tag)) return children;
    if (tag === "a") {
      // Only real web/mail links survive, resolved against reddit.com (posts
      // use relative "/r/..." links) and attribute-escaped; anything else,
      // such as javascript: URLs, keeps its text but loses the link.
      let href = "";
      try {
        const u = new URL(el.getAttribute("href") ?? "", "https://www.reddit.com");
        if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") href = u.href;
      } catch {}
      if (!href) return children;
      const safe = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${children}</a>`;
    }
    return `<${tag}>${children}</${tag}>`;
  }
    return Array.from(mdDiv.childNodes).map(walk).join("");
  } catch { return ""; }
}

// How many one-minute retries a partly loaded widget makes; matches the
// server keeping a rate-limited subreddit queued for 30 minutes.
const RETRY_MINUTES = 30;

const DEFAULT: RedditConfig = { subreddits: [] };
const PERIODS: { value: Period; label: string }[] = [
  { value: "day",   label: "Today" },
  { value: "week",  label: "Week" },
  { value: "month", label: "Month" },
  { value: "year",  label: "Year" },
  { value: "all",   label: "All" },
];

export default function RedditWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `reddit-widget-${widget.id}`;
  const today = localDateStr();

  const [config, setConfig]             = useState<RedditConfig>(DEFAULT);
  const [posts, setPosts]               = useState<Post[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The settings face is always mounted on the back of the FlipCard, so
  // `autoFocus` there would grab focus at page load (and on iOS zoom the page
  // in on it). Focus the field when the card flips to settings instead.
  const subInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (settingsOpen) subInputRef.current?.focus();
  }, [settingsOpen]);
  const [draft, setDraft]               = useState<RedditConfig>(DEFAULT);
  const [subInput, setSubInput]         = useState("");
  const [selected, setSelected]         = useState<Post | null>(null);
  const list   = useScrollFade<HTMLDivElement>([posts]);
  const detail = useScrollFade<HTMLDivElement>([selected]);
  // Self-heal: when some subreddits fail (rate-limited upstream), retry them
  // after a pause instead of waiting for the next page load. Bounded budget.
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; left: number }>({ timer: null, left: RETRY_MINUTES });
  useEffect(() => () => { if (retryRef.current.timer) clearTimeout(retryRef.current.timer); }, []);
  // Per-subreddit load state for the header counter (null = still loading).
  const [subStatus, setSubStatus] = useState<{ name: string; ok: boolean | null }[]>([]);
  const [statusOpen, setStatusOpen] = useState(false);
  // Last good posts per subreddit, kept across scans: a rescan that fails for
  // a feed keeps showing what it had instead of dropping it.
  const receivedRef = useRef<Map<string, Post[]>>(new Map());
  // Aborts the previous scan so a slow initial load can never paint over (or
  // be cached under) a newer config.
  const fetchAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    storage.getItem(storageKey).then(async saved => {
      if (!saved) return;
      try {
        const parsed: RedditConfig = JSON.parse(saved);
        // migrate old format: subreddits was string[] or had no per-sub period
        const oldPeriod: Period = (parsed as unknown as { period?: Period }).period ?? "day";
        if (parsed.subreddits.length && typeof parsed.subreddits[0] === "string") {
          parsed.subreddits = (parsed.subreddits as unknown as string[]).map(name => ({ name, limit: 5, period: oldPeriod }));
        } else {
          parsed.subreddits = parsed.subreddits.map(s => s.period ? s : { ...s, period: oldPeriod });
        }
        setConfig(parsed);
        setDraft(parsed);
        if (!parsed.subreddits.length) return;
        const cacheKey = cacheKeyFor(parsed);
        const cached = await storage.getItem(cacheKey);
        if (cached) {
          const posts = parseJson<Post[]>(cached, []);
          setPosts(posts);
          // Seed the per-feed map so the counter starts from what the day
          // cache already shows instead of 0/N.
          for (const sub of parsed.subreddits) {
            const mine = posts.filter(p => p.subreddit === sub.name);
            if (mine.length) receivedRef.current.set(`${sub.name}|${sub.period}|${sub.limit}`, mine);
          }
        }
        fetchPosts(parsed, cacheKey);
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function cacheKeyFor(cfg: RedditConfig) {
    return redditCacheKey(widget.id, today, cfg.subreddits);
  }

  async function fetchPosts(cfg: RedditConfig, cacheKey: string, force = false): Promise<boolean> {
    fetchAbort.current?.abort();
    const ctrl = new AbortController();
    fetchAbort.current = ctrl;
    // A pending self-heal retry belongs to the previous scan.
    if (retryRef.current.timer) { clearTimeout(retryRef.current.timer); retryRef.current.timer = null; }
    setLoading(true);
    setError("");
    try {
      // Fire them all at once: the server serves cached feeds instantly and
      // queues the uncached ones against Reddit's rate limit — those can take
      // a while, so each subreddit PAINTS AS IT ARRIVES instead of the whole
      // widget waiting for the slowest one.
      const keyOf = (s: SubEntry) => `${s.name}|${s.period}|${s.limit}`;
      const received = receivedRef.current;
      const valid = new Set(cfg.subreddits.map(keyOf));
      for (const k of [...received.keys()]) if (!valid.has(k)) received.delete(k);
      const combined = () => {
        const all = [...received.values()].flat();
        all.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
        return all;
      };
      const mark = (name: string, ok: boolean | null) =>
        setSubStatus(prev => prev.map(s => (s.name === name ? { ...s, ok } : s)));
      // The counter reflects which feeds HAVE posts: a rescan starts from the
      // feeds already showing (5/8 stays 5/8) and only the missing ones load.
      setSubStatus(cfg.subreddits.map(s => ({ name: s.name, ok: received.has(keyOf(s)) ? true : null })));
      // Feeds we have nothing for yet go first, so a rescan spends the rate
      // budget on the missing ones before re-fetching what already shows.
      const order = [...cfg.subreddits].sort(
        (a, b) => Number(received.has(keyOf(a))) - Number(received.has(keyOf(b)))
      );
      const results = await Promise.all(
        order.map(async sub => {
          try {
            const params = new URLSearchParams({ subreddit: sub.name, period: sub.period, limit: String(sub.limit) });
            if (force) params.set("refresh", "1");
            const res = await fetch(`/api/reddit?${params}`, { signal: ctrl.signal });
            if (res.status === 503 && (await res.clone().json().catch(() => ({}))).error === "queued") {
              // Still waiting its turn behind Reddit's rate limit: pending, not failed.
              if (!ctrl.signal.aborted) mark(sub.name, received.has(keyOf(sub)) ? true : null);
              return null;
            }
            if (!res.ok) throw new Error();
            const items: Post[] = await res.json();
            if (ctrl.signal.aborted) return null;
            received.set(keyOf(sub), items);
            const now = combined();
            if (now.length) setPosts(now);
            mark(sub.name, true);
            return items;
          } catch {
            if (ctrl.signal.aborted) return null;
            // One bad feed must not blank the others; a feed that loaded on an
            // earlier scan keeps its old posts and stays counted as loaded.
            mark(sub.name, received.has(keyOf(sub)));
            return null;
          }
        })
      );
      if (ctrl.signal.aborted) return false;
      const all = combined();
      const partial = results.some(r => r === null);
      if (partial && retryRef.current.left > 0) {
        // Missing feeds are usually still queued on the server behind
        // Reddit's rate limit (about one fetch a minute), so ask again every
        // minute until they arrive; loaded ones come back from the cache.
        retryRef.current.left--;
        if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
        retryRef.current.timer = setTimeout(() => fetchPosts(cfg, cacheKey), 60000);
      }
      if (!all.length) throw new Error();
      if (!partial) {
        retryRef.current.left = RETRY_MINUTES;
        await storage.setItem(cacheKey, JSON.stringify(all));
      }
      return true;
    } catch {
      if (ctrl.signal.aborted) return false;
      setError("Failed to load posts. Check the subreddit names.");
      return false;
    } finally {
      if (fetchAbort.current === ctrl) setLoading(false);
    }
  }

  function addSub() {
    const name = subInput.trim().replace(/^r\//i, "").toLowerCase();
    if (!name || draft.subreddits.find(s => s.name === name)) { setSubInput(""); return; }
    setDraft(d => ({ ...d, subreddits: [{ name, limit: 5, period: "week" as Period }, ...d.subreddits] }));
    setSubInput("");
  }

  function setSubLimit(name: string, limit: number) {
    setDraft(d => ({ ...d, subreddits: d.subreddits.map(s => s.name === name ? { ...s, limit } : s) }));
  }

  function setSubPeriod(name: string, period: Period) {
    setDraft(d => ({ ...d, subreddits: d.subreddits.map(s => s.name === name ? { ...s, period } : s) }));
  }

  async function handleSave() {
    setError("");
    if (!draft.subreddits.length) { setError("Add at least one subreddit."); return; }
    // Flip back right away; the front paints feeds as they arrive.
    setConfig(draft);
    await storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
    void fetchPosts(draft, cacheKeyFor(draft));
  }

  async function handleReset() {
    fetchAbort.current?.abort();
    fetchAbort.current = null;
    if (retryRef.current.timer) { clearTimeout(retryRef.current.timer); retryRef.current.timer = null; }
    setLoading(false);
    await storage.removeItem(storageKey);
    setConfig(DEFAULT);
    setDraft(DEFAULT);
    setPosts([]);
    setSettingsOpen(false);
  }

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
        <WidgetHeader
          c={c}
          icon={Flame}
          title={widget.title}
          right={
            <span className="relative flex items-center gap-2">
              {/* How many subreddits made it; tap for the per-feed breakdown. */}
              {subStatus.length > 0 && (loading || subStatus.some(s => s.ok !== true)) && (
                <button
                  onClick={() => setStatusOpen(o => !o)}
                  title="Which subreddits loaded"
                  className={`text-xs tabular-nums font-medium ${subStatus.some(s => s.ok === false) ? "text-red-500/80" : `${c.label} opacity-60`} hover:opacity-100 transition-opacity ${FOCUS_RING}`}
                >
                  {subStatus.filter(s => s.ok).length}/{subStatus.length}
                </button>
              )}
              {statusOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStatusOpen(false)} />
                  <div className={`absolute right-0 top-5 z-50 w-44 rounded-xl border ${c.border} ${c.bg} shadow-lg p-2 flex flex-col gap-1`}>
                    {subStatus.map(s => (
                      <span key={s.name} className="flex items-center justify-between gap-2 text-xs">
                        <span className={`truncate ${c.text} opacity-80`}>r/{s.name}</span>
                        <span className={`shrink-0 ${s.ok === true ? "text-emerald-600 dark:text-emerald-400" : s.ok === false ? "text-red-500" : `${c.label} opacity-60`}`}>
                          {s.ok === true ? "loaded" : s.ok === false ? "failed" : "waiting"}
                        </span>
                      </span>
                    ))}
                  </div>
                </>
              )}
              <RefreshButton c={c} busy={loading} onClick={() => fetchPosts(config, cacheKeyFor(config), true)} />
              <PencilButton c={c} onClick={() => { setDraft(config); setSettingsOpen(true); setError(""); }} />
            </span>
          }
        />

        <div className="flex-1 min-h-0 relative overflow-hidden">
          {/* Post list */}
          <div className={`absolute inset-0 transition-transform duration-300 ease-in-out ${selected ? "-translate-x-full" : "translate-x-0"}`}>
            <div ref={list.ref} className="absolute inset-0 overflow-y-auto pr-3" onScroll={list.onScroll}>
              {loading && !posts.length ? (
                <LoadingState c={c} />
              ) : posts.length ? (
                <ul className="flex flex-col">
                  {posts.map((post, i) => {
                    const sc = tagColor(post.subreddit.toLowerCase());
                    return (
                      <li key={i} className={`py-2 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                        <span className="flex items-center gap-1.5 mb-1 min-w-0">
                          <span className={`inline-block min-w-0 truncate text-[11px] font-medium px-1.5 py-0.5 rounded-md ${sc.bg} ${sc.label}`}>
                            r/{post.subreddit}
                          </span>
                          {post.pubDate && (
                            <span className={`shrink-0 text-xs opacity-60 ${c.text}`}>{timeAgo(post.pubDate)}</span>
                          )}
                          {post.score > 0 && (
                            <span className={`shrink-0 text-xs opacity-60 ${c.text}`}>▲ {formatCount(post.score)}</span>
                          )}
                        </span>
                        <div className="flex items-start gap-1 group/title">
                          <button
                            onClick={() => setSelected(post)}
                            className={`flex-1 min-w-0 break-words text-left text-sm font-medium leading-snug ${c.text} hover:opacity-70 transition-opacity ${FOCUS_RING}`}
                          >
                            {post.title}
                          </button>
                          <a
                            href={post.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            aria-label="Open on Reddit"
                            className={`shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-90 dark:group-hover/title:opacity-70 hover:!opacity-100 focus-visible:!opacity-100 transition-opacity ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
                          >
                            <ExternalLink size={12} />
                          </a>
                          {/* Some image posts come without a feed thumbnail; the
                              full image stands in for it then. */}
                          {config.images && (post.thumbnail || post.image) && (
                            <button onClick={() => setSelected(post)} aria-label="Open post" className={`shrink-0 ml-1.5 hover:opacity-80 transition-opacity rounded-lg ${FOCUS_RING}`}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={post.thumbnail || post.image}
                                alt=""
                                loading="lazy"
                                onLoad={e => e.currentTarget.classList.remove("animate-pulse")}
                                className="w-14 h-14 object-cover rounded-lg bg-black/10 dark:bg-white/10 animate-pulse"
                              />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState c={c} action="add subreddits" />
              )}
            </div>
            <ScrollFades c={c} top={list.topFade} bottom={list.bottomFade} />
          </div>

          {/* Post detail */}
          <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${selected ? "translate-x-0" : "translate-x-full"}`}>
            {selected && (
              <>
                <div className={`flex items-center gap-1.5 mb-3 shrink-0 ${c.text}`}>
                  <button onClick={() => setSelected(null)} aria-label="Back to list" className={`shrink-0 opacity-60 hover:opacity-100 ${HIT_AREA} ${FOCUS_RING}`}>
                    <ChevronLeft size={14} />
                  </button>
                  <span className="flex-1 min-w-0 text-xs font-medium truncate opacity-80">{selected.title}</span>
                  <a href={selected.link} target="_blank" rel="noopener noreferrer" aria-label="Open on Reddit" className={`shrink-0 opacity-40 hover:opacity-80 ${HIT_AREA} ${FOCUS_RING}`}>
                    <ExternalLink size={12} />
                  </a>
                </div>
                <div ref={detail.ref} className="flex-1 min-h-0 overflow-y-auto pr-3" onScroll={detail.onScroll}>
                  {/* The detail view always shows the post image when there is
                      one; the settings toggle only governs list thumbnails. */}
                  {(selected.image || selected.thumbnail) && (
                    <a href={selected.image || selected.link} target="_blank" rel="noopener noreferrer" className="block mb-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selected.image || selected.thumbnail}
                        alt=""
                        loading="lazy"
                        // A full image that fails (expired preview link) falls back to the thumbnail.
                        onError={e => { if (selected.thumbnail && e.currentTarget.src !== selected.thumbnail) e.currentTarget.src = selected.thumbnail; }}
                        className="w-full max-h-80 object-contain rounded-xl bg-black/5"
                      />
                    </a>
                  )}
                  {sanitizeRedditHtml(selected.content) ? (
                    <div
                      className={`text-sm leading-relaxed break-words ${c.text} opacity-80
                        [&_p]:mb-2 [&_p:last-child]:mb-0
                        [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-2
                        [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-2
                        [&_li]:mb-0.5
                        [&_hr]:my-3 [&_hr]:border-black/10 dark:border-white/10
                        [&_a]:underline [&_a]:opacity-80 [&_a:hover]:opacity-100
                        [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:border-current/30 [&_blockquote]:italic [&_blockquote]:opacity-70
                        [&_code]:font-mono [&_code]:text-xs [&_code]:bg-black/5 [&_code]:px-1 [&_code]:rounded-md
                        [&_pre]:overflow-x-auto [&_pre]:max-w-full
                        [&_strong]:font-semibold [&_em]:italic`}
                      dangerouslySetInnerHTML={{ __html: sanitizeRedditHtml(selected.content) }}
                    />
                  ) : (
                    <p className={`text-xs opacity-60 ${c.text}`}>No text content: this is a link post.</p>
                  )}
                </div>
                <ScrollFades c={c} top={detail.topFade} bottom={detail.bottomFade} />
              </>
            )}
          </div>
        </div>
        </>
      }
      back={
        <>
        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">

          {/* Subreddit input */}
          <div className="flex gap-1">
            <SettingsInput
              ref={subInputRef}
              type="text"
              value={subInput}
              onChange={e => setSubInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSub()}
              placeholder="subreddit name"
              className="flex-1"
            />
            <SmallButton c={c} onClick={addSub} title="Add subreddit" className="self-center">
              <Plus size={14} />
            </SmallButton>
          </div>

          {/* Post images (thumbnails in the list, full image in the detail view) */}
          <label className={`flex items-center gap-2 text-xs cursor-pointer select-none ${c.label}`}>
            <input
              type="checkbox"
              checked={!!draft.images}
              onChange={e => setDraft(d => ({ ...d, images: e.target.checked }))}
              className="w-3.5 h-3.5 rounded-md accent-current"
            />
            <span className="opacity-80">Show post images</span>
          </label>

          {/* Selected subreddits with per-sub limit and period */}
          {draft.subreddits.length > 0 && (
            <div className="flex flex-col gap-2">
              {draft.subreddits.map(sub => {
                const sc = tagColor(sub.name);
                return (
                  <div key={sub.name} className={`flex flex-col gap-1.5 px-2 py-1.5 rounded-lg ${sc.bg} ${sc.label}`}>
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <span className="flex-1 min-w-0 truncate">r/{sub.name}</span>
                      <input
                        type="number"
                        min={1}
                        max={25}
                        value={sub.limit}
                        onChange={e => setSubLimit(sub.name, Math.max(1, Math.min(25, parseInt(e.target.value) || 1)))}
                        className="w-10 text-center bg-white/60 rounded-md px-1 py-0.5 outline-none border border-current/20 text-xs"
                      />
                      <span className="opacity-60 font-normal">posts</span>
                      <button
                        onClick={() => setDraft(d => ({ ...d, subreddits: d.subreddits.filter(s => s.name !== sub.name) }))}
                        aria-label={`Remove r/${sub.name}`}
                        className={`opacity-60 hover:opacity-100 leading-none ml-1 ${HIT_AREA} ${FOCUS_RING}`}
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex gap-1 flex-wrap justify-center">
                      {PERIODS.map(p => (
                        <Chip key={p.value} c={{ ...c, label: sc.label, text: sc.label }} active={sub.period === p.value} onClick={() => setSubPeriod(sub.name, p.value)}>
                          {p.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

        </div>
        {/* Save never blocks on the background fetch: it applies the config
            and the front paints feeds as they arrive. */}
        <SaveCancelRow
          c={c}
          onSave={handleSave}
          onCancel={() => { setSettingsOpen(false); setError(""); }}
          onReset={handleReset}
        />
        </>
      }
    />
  );
}
