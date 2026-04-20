"use client";

import { useState, useEffect } from "react";
import { Pencil, Check, X, RotateCcw, Loader, Plus } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

type Period = "day" | "week" | "month" | "year" | "all";
type SubEntry = { name: string; limit: number; period: Period };
type RedditConfig = { subreddits: SubEntry[] };
type Post = { title: string; link: string; subreddit: string };

const DEFAULT: RedditConfig = { subreddits: [] };
const PERIODS: { value: Period; label: string }[] = [
  { value: "day",   label: "Today" },
  { value: "week",  label: "Week" },
  { value: "month", label: "Month" },
  { value: "year",  label: "Year" },
  { value: "all",   label: "All" },
];

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
          setPosts(JSON.parse(cached));
        } else {
          fetchPosts(parsed, cacheKey);
        }
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function cacheKeyFor(cfg: RedditConfig) {
    return `${storageKey}-${today}-${cfg.subreddits.map(s => `${s.name}:${s.period}:${s.limit}`).join(",")}`;
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
          const items: { title: string; link: string }[] = await res.json();
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
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${className}`}>

      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <p className={`text-xs font-semibold tracking-widest uppercase ${c.label}`}>
          {widget.title}
        </p>
        {!settingsOpen && (
          <button
            onClick={() => { setDraft(config); setSettingsOpen(true); setError(""); }}
            className={`opacity-0 group-hover:opacity-40 hover:!opacity-80 ${c.label}`}
          >
            <Pencil size={12} />
          </button>
        )}
      </div>

      {settingsOpen ? (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
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
                    <div className="flex gap-1 flex-wrap">
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
      ) : (
        <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
              </div>
            ) : posts.length ? (
              <ul className="flex flex-col">
                {posts.map((post, i) => {
                  const sc = SUB_COLORS[subColorIndex[post.subreddit] ?? 0];
                  return (
                    <li key={i} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                      <span className={`inline-block text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-md mb-1 ${sc.bg} ${sc.label}`}>
                        r/{post.subreddit}
                      </span>
                      <a
                        href={post.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`block text-sm leading-snug ${c.text} hover:opacity-70 transition-opacity`}
                      >
                        {post.title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={`text-xs opacity-45 ${c.text}`}>
                hover and click the pencil to add subreddits
              </p>
            )}
          </div>
          {posts.length > 0 && (
            <div className={`absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />
          )}
        </div>
      )}
    </div>
  );
}
