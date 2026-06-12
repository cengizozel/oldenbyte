"use client";

import { useState, useEffect } from "react";
import { Plus, ChevronLeft, ExternalLink, Flame } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { timeAgo, formatCount } from "@/lib/format";
import { tagColor } from "@/lib/colors";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput } from "@/components/ui/Field";
import { PencilButton, ScrollFades, LoadingState, EmptyState, SaveCancelRow } from "@/components/ui/WidgetChrome";

type Period = "day" | "week" | "month" | "year" | "all";
type SubEntry = { name: string; limit: number; period: Period };
type RedditConfig = { subreddits: SubEntry[] };
type Post = { title: string; link: string; subreddit: string; pubDate: string; content: string; score: number };

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
  const list   = useScrollFade<HTMLDivElement>([posts]);
  const detail = useScrollFade<HTMLDivElement>([selected]);

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

  function cacheKeyFor(cfg: RedditConfig) {
    return `${storageKey}-v3-${today}-${cfg.subreddits.map(s => `${s.name}:${s.period}:${s.limit}`).join(",")}`;
  }

  async function fetchPosts(cfg: RedditConfig, cacheKey: string): Promise<boolean> {
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(
        cfg.subreddits.map(async sub => {
          const params = new URLSearchParams({ subreddit: sub.name, period: sub.period, limit: String(sub.limit) });
          const res = await fetch(`/api/reddit?${params}`);
          if (!res.ok) throw new Error();
          const items: Post[] = await res.json();
          return items;
        })
      );
      const all: Post[] = results.flat();
      all.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
      if (!all.length) throw new Error();
      setPosts(all);
      await storage.setItem(cacheKey, JSON.stringify(all));
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

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className={`flex items-center gap-1.5 ${c.label}`}>
            <span className="opacity-50"><Flame size={14} /></span>
            <span className="text-xs font-medium opacity-60">Reddit</span>
          </div>
          <PencilButton c={c} onClick={() => { setDraft(config); setSettingsOpen(true); setError(""); }} />
        </div>

        <div className="flex-1 min-h-0 relative overflow-hidden">
          {/* Post list */}
          <div className={`absolute inset-0 transition-transform duration-300 ease-in-out ${selected ? "-translate-x-full" : "translate-x-0"}`}>
            <div ref={list.ref} className="absolute inset-0 overflow-y-auto pr-3" onScroll={list.onScroll}>
              {loading ? (
                <LoadingState c={c} />
              ) : posts.length ? (
                <ul className="flex flex-col">
                  {posts.map((post, i) => {
                    const sc = tagColor(post.subreddit.toLowerCase());
                    return (
                      <li key={i} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                        <span className="flex items-center gap-1.5 mb-1 min-w-0">
                          <span className={`inline-block min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-md ${sc.bg} ${sc.label}`}>
                            r/{post.subreddit}
                          </span>
                          {post.pubDate && (
                            <span className={`shrink-0 text-[10px] opacity-40 ${c.text}`}>{timeAgo(post.pubDate)}</span>
                          )}
                          {post.score > 0 && (
                            <span className={`shrink-0 text-[10px] opacity-40 ${c.text}`}>▲ {formatCount(post.score)}</span>
                          )}
                        </span>
                        <div className="flex items-start gap-1 group/title">
                          <button
                            onClick={() => setSelected(post)}
                            className={`flex-1 min-w-0 break-words text-left text-sm leading-snug ${c.text} hover:opacity-70 transition-opacity`}
                          >
                            {post.title}
                          </button>
                          <a
                            href={post.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className={`shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-90 dark:group-hover/title:opacity-70 hover:!opacity-100 transition-opacity ${c.icon}`}
                          >
                            <ExternalLink size={11} />
                          </a>
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
                  <button onClick={() => setSelected(null)} className="shrink-0 opacity-60 hover:opacity-100">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="flex-1 min-w-0 text-xs font-medium truncate opacity-80">{selected.title}</span>
                  <a href={selected.link} target="_blank" rel="noopener noreferrer" className="shrink-0 opacity-40 hover:opacity-80">
                    <ExternalLink size={11} />
                  </a>
                </div>
                <div ref={detail.ref} className="flex-1 min-h-0 overflow-y-auto pr-3" onScroll={detail.onScroll}>
                  {sanitizeRedditHtml(selected.content) ? (
                    <div
                      className={`text-sm leading-relaxed break-words ${c.text} opacity-80
                        [&_p]:mb-2 [&_p:last-child]:mb-0
                        [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-2
                        [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-2
                        [&_li]:mb-0.5
                        [&_hr]:my-3 [&_hr]:border-black/10
                        [&_a]:underline [&_a]:opacity-70 [&_a:hover]:opacity-100
                        [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:border-current/30 [&_blockquote]:italic [&_blockquote]:opacity-70
                        [&_code]:font-mono [&_code]:text-xs [&_code]:bg-black/5 [&_code]:px-1 [&_code]:rounded
                        [&_pre]:overflow-x-auto [&_pre]:max-w-full
                        [&_strong]:font-semibold [&_em]:italic`}
                      dangerouslySetInnerHTML={{ __html: sanitizeRedditHtml(selected.content) }}
                    />
                  ) : (
                    <p className={`text-xs opacity-40 ${c.text}`}>No text content: this is a link post.</p>
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
              autoFocus
              type="text"
              value={subInput}
              onChange={e => setSubInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSub()}
              placeholder="subreddit name"
              className="flex-1"
            />
            <button
              onClick={addSub}
              className="px-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <Plus size={14} />
            </button>
          </div>

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
        <SaveCancelRow
          c={c}
          onSave={handleSave}
          onCancel={() => { setSettingsOpen(false); setError(""); }}
          onReset={handleReset}
          saving={loading}
        />
        </>
      }
    />
  );
}
