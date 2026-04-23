"use client";

import { useState, useEffect, useRef } from "react";
import { Pencil, Check, X, RotateCcw, Loader, Plus, ChevronLeft, ExternalLink, Flame } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

type Period = "day" | "week" | "month" | "year" | "all";
type SubEntry = { name: string; limit: number; period: Period };
type RedditConfig = { subreddits: SubEntry[] };
type Post = { title: string; link: string; subreddit: string; pubDate: string; content: string };

function sanitizeRedditHtml(raw: string | undefined): string {
  if (!raw) return "";
  try {
    // Reddit RSS entity-encodes the HTML body — decode it first
    const ta = document.createElement("textarea");
    ta.innerHTML = raw;
    const decoded = ta.value;
    const doc = new DOMParser().parseFromString(decoded, "text/html");
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
      const href = el.getAttribute("href") ?? "";
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${children}</a>`;
    }
    return `<${tag}>${children}</${tag}>`;
  }
    return Array.from(mdDiv.childNodes).map(walk).join("");
  } catch { return ""; }
}

const DEFAULT: RedditConfig = { subreddits: [] };
const PERIODS: { value: Period; label: string }[] = [
  { value: "day",   label: "Today" },
  { value: "week",  label: "Week" },
  { value: "month", label: "Month" },
  { value: "year",  label: "Year" },
  { value: "all",   label: "All" },
];

function SubredditBadge({ post, rank, total, period, sc }: {
  post: Post;
  rank: number;
  total: number;
  period: string;
  sc: { label: string; bg: string };
}) {
  const [flip, setFlip] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);

  function handleMouseEnter() {
    if (!badgeRef.current) return;
    const rect = badgeRef.current.getBoundingClientRect();
    setFlip(rect.right + 140 > window.innerWidth);
  }

  return (
    <span ref={badgeRef} className="relative inline-block group/badge mb-1" onMouseEnter={handleMouseEnter}>
      <span className={`inline-block text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-md ${sc.bg} ${sc.label}`}>
        r/{post.subreddit}
      </span>
      <span className={`absolute top-0 ${flip ? "right-full mr-1" : "left-full ml-1"} hidden group-hover/badge:flex items-center gap-1.5 bg-white border border-neutral-200 rounded-lg px-2 py-1 text-[10px] text-neutral-500 shadow-sm whitespace-nowrap z-10`}>
        <span>{rank}/{total}</span>
        <span className="opacity-30">·</span>
        <span>{period}</span>
        {post.pubDate && <>
          <span className="opacity-30">·</span>
          <span>{new Date(post.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
        </>}
      </span>
    </span>
  );
}

const SUB_COLORS = [
  { label: "text-sky-700",     bg: "bg-sky-100"     },
  { label: "text-teal-700",    bg: "bg-teal-100"    },
  { label: "text-violet-700",  bg: "bg-violet-100"  },
  { label: "text-rose-600",    bg: "bg-rose-100"    },
  { label: "text-amber-700",   bg: "bg-amber-100"   },
  { label: "text-emerald-700", bg: "bg-emerald-100" },
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
  const today = new Date().toISOString().split("T")[0];

  const [config, setConfig]             = useState<RedditConfig>(DEFAULT);
  const [posts, setPosts]               = useState<Post[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft]               = useState<RedditConfig>(DEFAULT);
  const [subInput, setSubInput]         = useState("");
  const [selected, setSelected]         = useState<Post | null>(null);
  const [listShowFade, setListShowFade]           = useState(false);
  const [listShowTopFade, setListShowTopFade]     = useState(false);
  const [detailShowFade, setDetailShowFade]       = useState(false);
  const [detailShowTopFade, setDetailShowTopFade] = useState(false);
  const listScrollRef   = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);

  function checkFade(el: HTMLDivElement, setBottom: (v: boolean) => void, setTop: (v: boolean) => void) {
    const overflows = el.scrollHeight > el.clientHeight + 1;
    setBottom(overflows && el.scrollHeight - el.scrollTop - el.clientHeight > 20);
    setTop(overflows && el.scrollTop > 20);
  }

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
        if (cached) setPosts(JSON.parse(cached));
        fetchPosts(parsed, cacheKey);
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    checkFade(el, setListShowFade, setListShowTopFade);
    const ro = new ResizeObserver(() => checkFade(el, setListShowFade, setListShowTopFade));
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  useEffect(() => {
    const el = detailScrollRef.current;
    if (!el) return;
    checkFade(el, setDetailShowFade, setDetailShowTopFade);
    const ro = new ResizeObserver(() => checkFade(el, setDetailShowFade, setDetailShowTopFade));
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function cacheKeyFor(cfg: RedditConfig) {
    return `${storageKey}-v2-${today}-${cfg.subreddits.map(s => `${s.name}:${s.period}:${s.limit}`).join(",")}`;
  }

  async function fetchPosts(cfg: RedditConfig, cacheKey: string): Promise<boolean> {
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(
        cfg.subreddits.map(async sub => {
          const url = `https://www.reddit.com/r/${sub.name}/top.rss?t=${sub.period}&limit=${sub.limit}`;
          const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}&limit=${sub.limit}`);
          if (!res.ok) throw new Error();
          const items: { title: string; link: string; pubDate: string; content: string }[] = await res.json();
          return items.map(item => ({ ...item, subreddit: sub.name }));
        })
      );
      const interleaved: Post[] = [];
      const maxLen = Math.max(...results.map(r => r.length));
      for (let i = 0; i < maxLen; i++) {
        for (const r of results) { if (r[i]) interleaved.push(r[i]); }
      }
      if (!interleaved.length) throw new Error();
      setPosts(interleaved);
      await storage.setItem(cacheKey, JSON.stringify(interleaved));
      return true;
    } catch {
      setError("Failed to load posts. Check the subreddit names.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  function addSub() {
    const name = subInput.trim().replace(/^r\//i, "").toLowerCase();
    if (!name || draft.subreddits.find(s => s.name === name)) { setSubInput(""); return; }
    setDraft(d => ({ ...d, subreddits: [...d.subreddits, { name, limit: 5, period: "week" as Period }] }));
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
    const cacheKey = cacheKeyFor(draft);
    const ok = await fetchPosts(draft, cacheKey);
    if (ok) {
      setConfig(draft);
      await storage.setItem(storageKey, JSON.stringify(draft));
      setSettingsOpen(false);
    }
  }

  async function handleReset() {
    await storage.removeItem(storageKey);
    setConfig(DEFAULT);
    setDraft(DEFAULT);
    setPosts([]);
    setSettingsOpen(false);
  }

  const subColorIndex: Record<string, number> = {};
  config.subreddits.forEach((s, i) => { subColorIndex[s.name] = i % SUB_COLORS.length; });

  return (
    <div
      className={`rounded-2xl border h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}
      style={{ perspective: "1200px" }}
    >
      {/* Flipper */}
      <div
        className="relative w-full h-full transition-transform duration-300 ease-in-out"
        style={{ transformStyle: "preserve-3d", WebkitTransformStyle: "preserve-3d", transform: settingsOpen ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >

      {/* Front face */}
      <div className={`absolute inset-0 p-5 flex flex-col rounded-2xl overflow-hidden ${c.bg}`} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className={`flex items-center gap-1.5 ${c.label}`}>
            <span className="opacity-50"><Flame size={14} /></span>
            <span className="text-xs font-medium opacity-60">Reddit</span>
          </div>
          <button
            onClick={() => { setDraft(config); setSettingsOpen(true); setError(""); }}
            className={`opacity-0 group-hover:opacity-40 [@media(hover:none)]:!opacity-40 hover:!opacity-80 ${c.label}`}
          >
            <Pencil size={12} />
          </button>
        </div>

        <div className="flex-1 min-h-0 relative overflow-hidden">
          {/* Post list */}
          <div className={`absolute inset-0 transition-transform duration-300 ease-in-out ${selected ? "-translate-x-full" : "translate-x-0"}`}>
            <div ref={listScrollRef} className="absolute inset-0 overflow-y-auto pr-3" onScroll={e => checkFade(e.currentTarget, setListShowFade, setListShowTopFade)}>
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
                </div>
              ) : posts.length ? (
                <ul className="flex flex-col">
                  {(() => {
                    const subTotal: Record<string, number> = {};
                    posts.forEach(p => { subTotal[p.subreddit] = (subTotal[p.subreddit] || 0) + 1; });
                    const subCount: Record<string, number> = {};
                    const subPeriodLabel: Record<string, string> = {};
                    config.subreddits.forEach(s => {
                      subPeriodLabel[s.name] = PERIODS.find(p => p.value === s.period)?.label ?? s.period;
                    });
                    return posts.map((post, i) => {
                      subCount[post.subreddit] = (subCount[post.subreddit] || 0) + 1;
                      const sc = SUB_COLORS[subColorIndex[post.subreddit] ?? 0];
                      return (
                        <li key={i} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                          <SubredditBadge post={post} rank={subCount[post.subreddit]} total={subTotal[post.subreddit]} period={subPeriodLabel[post.subreddit] ?? ""} sc={sc} />
                          <div className="flex items-start gap-1 group/title">
                            <button
                              onClick={() => setSelected(post)}
                              className={`flex-1 text-left text-sm leading-snug ${c.text} hover:opacity-70 transition-opacity`}
                            >
                              {post.title}
                            </button>
                            <a
                              href={post.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className={`shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-40 hover:!opacity-80 transition-opacity ${c.label}`}
                            >
                              <ExternalLink size={11} />
                            </a>
                          </div>
                        </li>
                      );
                    });
                  })()}
                </ul>
              ) : (
                <p className={`text-xs opacity-45 ${c.text}`}>
                  hover and click the pencil to add subreddits
                </p>
              )}
            </div>
            {listShowTopFade && <div className={`absolute top-0 left-0 right-0 h-12 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />}
            {listShowFade && <div className={`absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />}
          </div>

          {/* Post detail */}
          <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${selected ? "translate-x-0" : "translate-x-full"}`}>
            {selected && (
              <>
                <div className={`flex items-center gap-1.5 mb-3 shrink-0 ${c.text}`}>
                  <button onClick={() => setSelected(null)} className="shrink-0 opacity-60 hover:opacity-100">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="flex-1 text-xs font-medium truncate opacity-80">{selected.title}</span>
                  <a href={selected.link} target="_blank" rel="noopener noreferrer" className="shrink-0 opacity-40 hover:opacity-80">
                    <ExternalLink size={11} />
                  </a>
                </div>
                <div ref={detailScrollRef} className="flex-1 min-h-0 overflow-y-auto pr-3" onScroll={e => checkFade(e.currentTarget, setDetailShowFade, setDetailShowTopFade)}>
                  {sanitizeRedditHtml(selected.content) ? (
                    <div
                      className={`text-sm leading-relaxed ${c.text} opacity-80
                        [&_p]:mb-2 [&_p:last-child]:mb-0
                        [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-2
                        [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-2
                        [&_li]:mb-0.5
                        [&_hr]:my-3 [&_hr]:border-black/10
                        [&_a]:underline [&_a]:opacity-70 [&_a:hover]:opacity-100
                        [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:border-current/30 [&_blockquote]:italic [&_blockquote]:opacity-70
                        [&_code]:font-mono [&_code]:text-xs [&_code]:bg-black/5 [&_code]:px-1 [&_code]:rounded
                        [&_strong]:font-semibold [&_em]:italic`}
                      dangerouslySetInnerHTML={{ __html: sanitizeRedditHtml(selected.content) }}
                    />
                  ) : (
                    <p className={`text-xs opacity-40 ${c.text}`}>No text content — this is a link post.</p>
                  )}
                </div>
                {detailShowTopFade && <div className={`absolute top-0 left-0 right-0 h-12 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />}
                {detailShowFade && <div className={`absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Back face (settings) */}
      <div
        className={`absolute inset-0 p-5 flex flex-col gap-3 rounded-2xl overflow-hidden ${c.bg}`}
        style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
      >
        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">

          {/* Subreddit input */}
          <div className="flex gap-1">
            <input
              autoFocus
              type="text"
              value={subInput}
              onChange={e => setSubInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSub()}
              placeholder="subreddit name"
              className="flex-1 text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
            />
            <button
              onClick={addSub}
              className="px-3 rounded-xl border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-800"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Selected subreddits with per-sub limit and period */}
          {draft.subreddits.length > 0 && (
            <div className="flex flex-col gap-2">
              {draft.subreddits.map((sub, i) => {
                const sc = SUB_COLORS[i % SUB_COLORS.length];
                return (
                  <div key={sub.name} className={`flex flex-col gap-1.5 px-2 py-1.5 rounded-lg ${sc.bg} ${sc.label}`}>
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <span className="flex-1">r/{sub.name}</span>
                      <input
                        type="number"
                        min={1}
                        max={25}
                        value={sub.limit}
                        onChange={e => setSubLimit(sub.name, Math.max(1, Math.min(25, parseInt(e.target.value) || 1)))}
                        className="w-10 text-center bg-white/60 rounded-md px-1 py-0.5 outline-none border border-current/20 text-xs"
                      />
                      <span className="opacity-50 font-normal">posts</span>
                      <button
                        onClick={() => setDraft(d => ({ ...d, subreddits: d.subreddits.filter(s => s.name !== sub.name) }))}
                        className="opacity-60 hover:opacity-100 leading-none ml-1"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex gap-1 flex-wrap justify-center">
                      {PERIODS.map(p => (
                        <button
                          key={p.value}
                          onClick={() => setSubPeriod(sub.name, p.value)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                            sub.period === p.value
                              ? "bg-white/80 shadow-sm"
                              : "opacity-40 hover:opacity-70"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

        </div>
          <div className="flex items-center justify-between shrink-0 pt-1">
            <button onClick={handleReset} className={`${c.label} opacity-40 hover:opacity-70`} title="Reset">
              <RotateCcw size={13} />
            </button>
            <div className="flex gap-3">
              <button onClick={() => { setSettingsOpen(false); setError(""); }} className="text-neutral-400 hover:text-neutral-600">
                <X size={14} />
              </button>
              <button onClick={handleSave} disabled={loading} className="text-neutral-600 hover:text-neutral-900 disabled:opacity-40">
                {loading ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
