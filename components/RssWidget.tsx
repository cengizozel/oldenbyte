"use client";

import { useState, useEffect, useRef } from "react";
import { Rss } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { localDateStr } from "@/lib/format";
import { parseJson } from "@/lib/text";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput } from "@/components/ui/Field";
import { useScrollFade } from "@/lib/useScrollFade";
import { WidgetHeader, Chip, PencilButton, RefreshButton, ScrollFades, LoadingState, EmptyState, SaveCancelRow } from "@/components/ui/WidgetChrome";

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
  const today = localDateStr();

  const [config, setConfig] = useState<RssConfig>(DEFAULT);
  const [items, setItems] = useState<RssItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { ref: scrollRef, onScroll, topFade, bottomFade } = useScrollFade([items]);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<RssConfig>(DEFAULT);
  // Aborts the previous feed request so a slow initial load can never land
  // over (or be cached under) a newer config.
  const fetchAbort = useRef<AbortController | null>(null);

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
        if (cached) setItems(parseJson<RssItem[]>(cached, []));
        fetchFeed(parsed.url, parsed.limit, cacheKey);
      } catch {}
    });
  }, [storageKey, today]); // `today` changes at midnight: load that day's cache and refetch

  async function fetchFeed(url: string, limit: number, cacheKey: string, force = false): Promise<boolean> {
    fetchAbort.current?.abort();
    const ctrl = new AbortController();
    fetchAbort.current = ctrl;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}&limit=${limit}${force ? "&refresh=1" : ""}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error();
      const data: RssItem[] = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error("No items found.");
      setItems(data);
      await storage.setItem(cacheKey, JSON.stringify(data));
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      setError("Failed to load feed. Check the URL.");
      return false;
    } finally {
      if (fetchAbort.current === ctrl) setLoading(false);
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
    fetchAbort.current?.abort();
    fetchAbort.current = null;
    setLoading(false);
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
          <WidgetHeader
            c={c}
            icon={Rss}
            title={config.name || widget.title}
            right={
              <>
                <RefreshButton c={c} busy={loading} onClick={() => fetchFeed(config.url, config.limit, `${storageKey}-${today}`, true)} />
                <PencilButton c={c} onClick={() => { setDraft(config); setSettingsOpen(true); setError(""); }} />
              </>
            }
          />
          <div className="flex-1 min-h-0 relative">
            <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pr-3" onScroll={onScroll}>
              {loading && !items.length ? (
                <LoadingState c={c} />
              ) : items.length ? (
                <ul className="flex flex-col">
                  {items.map((item, i) => (
                    <li key={i} className={`py-2 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className={`text-sm font-medium leading-snug break-words ${c.text} hover:opacity-70 transition-opacity`}>
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
              <Chip key={ex.url} c={c} active={draft.url === ex.url} onClick={() => setDraft(d => ({ ...d, url: ex.url }))} className="self-start">
                {ex.label}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs opacity-60 ${c.label}`}>Items</span>
            {LIMITS.map(n => (
              <Chip key={n} c={c} active={draft.limit === n} onClick={() => setDraft(d => ({ ...d, limit: n }))}>
                {n}
              </Chip>
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
