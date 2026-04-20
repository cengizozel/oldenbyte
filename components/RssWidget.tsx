"use client";

import { useState, useEffect, useRef } from "react";
import { Pencil, Check, X, RotateCcw, Loader, Rss } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

type RssItem = { title: string; link: string; pubDate: string };
type RssConfig = { url: string; limit: number; name?: string };

const DEFAULT: RssConfig = { url: "", limit: 5 };

const RSS_EXAMPLES = [
  { label: "BBC News",     url: "https://feeds.bbci.co.uk/news/rss.xml" },
  { label: "Hacker News",  url: "https://news.ycombinator.com/rss" },
  { label: "The Guardian", url: "https://www.theguardian.com/world/rss" },
];
const LIMITS = [3, 5, 7, 10];

export default function RssWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `rss-widget-${widget.id}`;
  const today = new Date().toISOString().split("T")[0];

  const [config, setConfig] = useState<RssConfig>(DEFAULT);
  const [items, setItems] = useState<RssItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showBottomFade, setShowBottomFade] = useState(false);
  const [showTopFade, setShowTopFade] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function checkFade(el: HTMLDivElement) {
    const overflows = el.scrollHeight > el.clientHeight + 1;
    setShowBottomFade(overflows && el.scrollHeight - el.scrollTop - el.clientHeight > 20);
    setShowTopFade(overflows && el.scrollTop > 20);
  }
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<RssConfig>(DEFAULT);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkFade(el);
    const ro = new ResizeObserver(() => checkFade(el));
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    storage.getItem(storageKey).then(async saved => {
      if (!saved) return;
      try {
        const parsed: RssConfig = JSON.parse(saved);
        setConfig(parsed);
        setDraft(parsed);
        if (!parsed.url) return;

        const cacheKey = `${storageKey}-${today}`;
        const cached = await storage.getItem(cacheKey);
        if (cached) {
          setItems(JSON.parse(cached));
        } else {
          fetchFeed(parsed.url, parsed.limit, cacheKey);
        }
      } catch {}
    });
  }, [storageKey]);

  async function fetchFeed(url: string, limit: number, cacheKey: string): Promise<boolean> {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}&limit=${limit}`);
      if (!res.ok) throw new Error();
      const data: RssItem[] = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error("No items found.");
      setItems(data);
      await storage.setItem(cacheKey, JSON.stringify(data));
      return true;
    } catch {
      setError("Failed to load feed. Check the URL.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setError("");
    if (!draft.url.startsWith("http")) {
      setError("Must be a valid URL starting with http.");
      return;
    }
    const cacheKey = `${storageKey}-${today}`;
    const ok = await fetchFeed(draft.url, draft.limit, cacheKey);
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
    setItems([]);
    setSettingsOpen(false);
  }

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${className}`}>

      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className={`flex items-center gap-1.5 ${c.label}`}>
          <span className="opacity-50"><Rss size={14} /></span>
          {config.name && <span className="text-xs font-medium opacity-60">{config.name}</span>}
        </div>
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

          <input
            autoFocus
            type="text"
            value={draft.name ?? ""}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Name (e.g. BBC, Reddit…)"
            className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
          />

          <input
            type="url"
            value={draft.url}
            onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder="https://feeds.bbci.co.uk/news/rss.xml"
            className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
          />

          <div className="flex flex-col gap-0.5">
            {RSS_EXAMPLES.map(ex => (
              <button
                key={ex.url}
                onClick={() => setDraft(d => ({ ...d, url: ex.url }))}
                className={`text-left px-2 py-1 rounded-lg text-xs transition-colors ${
                  draft.url === ex.url
                    ? `${c.label} font-medium opacity-100`
                    : `${c.text} opacity-50 hover:opacity-80`
                }`}
              >
                {ex.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-xs opacity-60 ${c.label}`}>Items</span>
            {LIMITS.map(n => (
              <button
                key={n}
                onClick={() => setDraft(d => ({ ...d, limit: n }))}
                className={`w-7 py-1 rounded-lg text-xs font-medium transition-colors ${
                  draft.limit === n
                    ? "bg-white text-neutral-700 shadow-sm border border-neutral-200"
                    : `${c.text} opacity-50 hover:opacity-80`
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex items-center justify-between mt-auto">
            <button onClick={handleReset} className={`${c.label} opacity-40 hover:opacity-70`} title="Reset">
              <RotateCcw size={13} />
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => { setSettingsOpen(false); setError(""); }}
                className="text-neutral-400 hover:text-neutral-600"
                title="Cancel"
              >
                <X size={14} />
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="text-neutral-600 hover:text-neutral-900 disabled:opacity-40"
                title="Save"
              >
                {loading ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
            </div>
          </div>

        </div>
      ) : (
        <div className="flex-1 min-h-0 relative">
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pr-3" onScroll={e => checkFade(e.currentTarget)}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
              </div>
            ) : items.length ? (
              <ul className="flex flex-col">
                {items.map((item, i) => (
                  <li key={i} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-sm leading-snug ${c.text} hover:opacity-70 transition-opacity`}
                    >
                      {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`text-xs opacity-45 ${c.text}`}>hover and click the pencil to add an RSS feed URL</p>
            )}
          </div>
          {showTopFade && (
            <div className={`absolute top-0 left-0 right-0 h-12 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />
          )}
          {showBottomFade && (
            <div className={`absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />
          )}
        </div>
      )}
    </div>
  );
}
