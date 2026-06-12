"use client";

import { useState, useEffect } from "react";
import { Rss } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput } from "@/components/ui/Field";
import { useScrollFade } from "@/lib/useScrollFade";
import { PencilButton, ScrollFades, LoadingState, EmptyState, SaveCancelRow } from "@/components/ui/WidgetChrome";

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
  const { ref: scrollRef, onScroll, topFade, bottomFade } = useScrollFade([items]);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<RssConfig>(DEFAULT);

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
        if (cached) setItems(JSON.parse(cached));
        fetchFeed(parsed.url, parsed.limit, cacheKey);
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
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
              <span className="opacity-50 shrink-0"><Rss size={14} /></span>
              {config.name && <span className="text-xs font-medium opacity-60 truncate">{config.name}</span>}
            </div>
            <PencilButton c={c} onClick={() => { setDraft(config); setSettingsOpen(true); setError(""); }} />
          </div>
          <div className="flex-1 min-h-0 relative">
            <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pr-3" onScroll={onScroll}>
              {loading ? (
                <LoadingState c={c} />
              ) : items.length ? (
                <ul className="flex flex-col">
                  {items.map((item, i) => (
                    <li key={i} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className={`text-sm leading-snug break-words ${c.text} hover:opacity-70 transition-opacity`}>
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState c={c} action="add an RSS feed URL" />
              )}
            </div>
            <ScrollFades c={c} top={topFade} bottom={bottomFade} />
          </div>
        </>
      }
      back={
        <>
          <SettingsInput
            type="text"
            value={draft.name ?? ""}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Name (e.g. BBC, Reddit…)"
          />
          <SettingsInput
            type="url"
            value={draft.url}
            onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder="https://feeds.bbci.co.uk/news/rss.xml"
          />
          <div className="flex flex-col gap-0.5">
            {RSS_EXAMPLES.map(ex => (
              <button key={ex.url} onClick={() => setDraft(d => ({ ...d, url: ex.url }))}
                className={`text-left px-2 py-1 rounded-lg text-xs transition-colors ${draft.url === ex.url ? `${c.label} font-medium opacity-100` : `${c.text} opacity-50 hover:opacity-80`}`}>
                {ex.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs opacity-60 ${c.label}`}>Items</span>
            {LIMITS.map(n => (
              <button key={n} onClick={() => setDraft(d => ({ ...d, limit: n }))}
                className={`w-7 py-1 rounded-lg text-xs font-medium transition-colors ${draft.limit === n ? "bg-white text-neutral-700 shadow-sm border border-neutral-200" : `${c.text} opacity-50 hover:opacity-80`}`}>
                {n}
              </button>
            ))}
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
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
