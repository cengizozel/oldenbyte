"use client";

import { useT } from "@/lib/useT";
import { useState, useEffect, useRef } from "react";
import { Rss, Heart } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { localDateStr } from "@/lib/format";
import { parseJson } from "@/lib/text";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput, HIT_AREA, FOCUS_RING } from "@/components/ui/Field";
import { timeAgo } from "@/lib/chat/format";
import { favoriteId, loadFavorites, refreshFavorites, subscribeFavorites, toggleFavorite, type Favorite } from "@/lib/favorites";
import { useScrollFade } from "@/lib/useScrollFade";
import { WidgetHeader, Chip, RefreshButton, ScrollFades, LoadingState, EmptyState, ErrorState, SettingsFace, SettingsField, SettingsError } from "@/components/ui/WidgetChrome";

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
  const t = useT();
  const storageKey = `rss-widget-${widget.id}`;
  const today = localDateStr();

  const [config, setConfig] = useState<RssConfig>(DEFAULT);
  const [items, setItems] = useState<RssItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { ref: scrollRef, onScroll, topFade, bottomFade } = useScrollFade([items]);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<RssConfig>(DEFAULT);
  // Aborts the previous feed request so a slow initial load can never land
  // over (or be cached under) a newer config.
  const fetchAbort = useRef<AbortController | null>(null);

  // Favorites (lib/favorites): the hearts, and the list the header heart opens.
  // Every item shows a faint heart, about as quiet as the dividers, so saving
  // never depends on hover; a saved one is solid red.
  // Unhearting in that list keeps the item there until it is closed, so a
  // slip of the finger can be undone with another tap.
  const [favs, setFavs] = useState<Favorite[]>([]);
  const [favView, setFavView] = useState<Favorite[] | null>(null);
  useEffect(() => {
    loadFavorites().then(setFavs);
    return subscribeFavorites(setFavs);
  }, []);
  const favIds = new Set(favs.map(f => f.id));
  const feedName = config.name || widget.title;
  const favList = favView
    ? [...favs, ...favView.filter(f => !favIds.has(f.id))].sort((a, b) => b.savedAt - a.savedAt)
    : [];
  const heart = (on: boolean, item: { title: string; link: string; pubDate?: string }, source: string) => (
    <button
      type="button"
      onClick={() => toggleFavorite(item, source)}
      aria-pressed={on}
      title={on ? "Remove from favorites" : "Add to favorites"}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      className={`shrink-0 mt-0.5 ${HIT_AREA} ${FOCUS_RING} transition-opacity ${on ? "text-rose-500 opacity-100" : `${c.label} opacity-30 hover:opacity-80 focus-visible:opacity-80`}`}
    >
      <Heart size={14} fill={on ? "currentColor" : "none"} />
    </button>
  );

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
    setFailed(false);
    try {
      const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}&limit=${limit}${force ? "&refresh=1" : ""}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error();
      const data: RssItem[] = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error("No items found.");
      setItems(data);
      refreshFavorites(data);
      await storage.setItem(cacheKey, JSON.stringify(data));
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      setError("Failed to load feed. Check the URL.");
      setFailed(true);
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


  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader
            onSettings={() => { setDraft(config); setSettingsOpen(true); setError(""); }}
            c={c}
            icon={Rss}
            title={feedName}
            right={
              <>
                <RefreshButton c={c} busy={loading} onClick={() => fetchFeed(config.url, config.limit, `${storageKey}-${today}`, true)} />
                <button
                  type="button"
                  onClick={() => setFavView(v => (v ? null : favs))}
                  aria-pressed={!!favView}
                  title={favView ? "Back to the feed" : "Favorites"}
                  aria-label={favView ? "Back to the feed" : "Favorites"}
                  className={`${favView ? "opacity-100 text-rose-500" : `opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 ${c.icon}`} ${HIT_AREA} ${FOCUS_RING}`}
                >
                  <Heart size={14} fill={favView ? "currentColor" : "none"} />
                </button>
              </>
            }
          />
          <div className="flex-1 min-h-0 relative">
            <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pr-3" onScroll={onScroll}>
              {favView ? (
                favList.length ? (
                  <ul className="flex flex-col">
                    <li className={`pb-1 text-sm font-medium ${c.label}`}>Favorites</li>
                    {favList.map((f, i) => (
                      <li key={f.id} className={`group/item flex items-start gap-2 py-2 first:pt-0 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                        <div className="flex-1 min-w-0">
                          <a href={f.link} target="_blank" rel="noopener noreferrer" className={`text-sm font-medium leading-snug break-words ${c.text} hover:opacity-70 transition-opacity`}>
                            {f.title}
                          </a>
                          <p className={`text-sm mt-0.5 ${c.label}`}>{f.source} · saved {timeAgo(f.savedAt)}</p>
                        </div>
                        {heart(favIds.has(f.id), { title: f.title, link: f.link, pubDate: f.publishedAt }, f.source)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState c={c}>Heart an item to keep it here. Favorites are yours, not this widget&apos;s.</EmptyState>
                )
              ) : loading && !items.length ? (
                <LoadingState c={c} />
              ) : items.length ? (
                <ul className="flex flex-col">
                  {items.map((item, i) => (
                    <li key={i} className={`group/item flex items-start gap-2 py-2 first:pt-0 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className={`flex-1 min-w-0 text-sm font-medium leading-snug break-words ${c.text} hover:opacity-70 transition-opacity`}>
                        {item.title}
                      </a>
                      {heart(favIds.has(favoriteId(item.link, item.title)), item, feedName)}
                    </li>
                  ))}
                </ul>
              ) : failed && config.url ? (
                <ErrorState c={c} busy={loading} onRetry={() => fetchFeed(config.url, config.limit, `${storageKey}-${today}`, true)}>could not load this feed</ErrorState>
              ) : (
                <EmptyState c={c} action={t("empty.rss")} />
              )}
            </div>
            <ScrollFades c={c} top={topFade} bottom={bottomFade} />
          </div>
        </>
      }
      back={
        <SettingsFace c={c} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }} onReset={() => setDraft(DEFAULT)} saving={loading}>
          <SettingsField c={c} label="Name">
            <SettingsInput
              type="text"
              value={draft.name ?? ""}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="e.g. BBC, Hacker News"
            />
          </SettingsField>
          <SettingsField c={c} label="Feed address">
            <SettingsInput
              type="url"
              value={draft.url}
              onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder="https://feeds.bbci.co.uk/news/rss.xml"
            />
            <div className="flex flex-wrap gap-1.5">
              {RSS_EXAMPLES.map(ex => (
                <Chip key={ex.url} c={c} active={draft.url === ex.url} onClick={() => setDraft(d => ({ ...d, url: ex.url }))}>
                  {ex.label}
                </Chip>
              ))}
            </div>
          </SettingsField>
          <SettingsField c={c} label="Items" inline>
            {LIMITS.map(n => (
              <Chip key={n} c={c} active={draft.limit === n} onClick={() => setDraft(d => ({ ...d, limit: n }))}>
                {n}
              </Chip>
            ))}
          </SettingsField>
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
