"use client";

import { useState, useEffect, useRef } from "react";
import { Loader, Plus, PlaySquare, ExternalLink, ChevronLeft } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { timeAgo, formatCount, formatClock } from "@/lib/format";
import { tagColor } from "@/lib/colors";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput } from "@/components/ui/Field";
import { PencilButton, ScrollFades, LoadingState, EmptyState, SaveCancelRow } from "@/components/ui/WidgetChrome";

type YoutubeChannel = { channelId: string; name: string; limit: number; filterMembers?: boolean; includeShorts?: boolean };
type YoutubeConfig  = { channels: YoutubeChannel[] };
type Video          = { title: string; link: string; published: string; channelId: string; channelName: string };
type VideoDetails   = { title: string; author: string; description: string; lengthSeconds: number; viewCount: number };

const DEFAULT: YoutubeConfig = { channels: [] };

export default function YoutubeWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `youtube-widget-${widget.id}`;
  const today = new Date().toISOString().split("T")[0];

  const [config, setConfig]             = useState<YoutubeConfig>(DEFAULT);
  const [videos, setVideos]             = useState<Video[]>([]);
  const { ref: scrollRef, onScroll, topFade, bottomFade } = useScrollFade([videos]);
  const [loading, setLoading]           = useState(false);
  const [resolving, setResolving]       = useState(false);
  const [error, setError]               = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft]               = useState<YoutubeConfig>(DEFAULT);
  const [chInput, setChInput]           = useState("");

  // Inline video detail (slides over the list, like the arXiv widget).
  const [selected, setSelected]         = useState<Video | null>(null);
  const [details, setDetails]           = useState<VideoDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const detailsAbort                    = useRef<AbortController | null>(null);

  async function openVideo(v: Video) {
    setSelected(v);
    setDetails(null);
    setDetailsError("");
    setLoadingDetails(true);
    detailsAbort.current?.abort();
    const ctrl = new AbortController();
    detailsAbort.current = ctrl;
    try {
      const res = await fetch(`/api/youtube?video=${encodeURIComponent(v.link)}`, { signal: ctrl.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDetails(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setDetailsError(String((e as Error).message ?? e));
    } finally {
      if (detailsAbort.current === ctrl) setLoadingDetails(false);
    }
  }

  useEffect(() => {
    storage.getItem(storageKey).then(async saved => {
      if (!saved) return;
      try {
        const parsed: YoutubeConfig = JSON.parse(saved);
        // migrate old format: channels had no per-channel limit (used top-level limit)
        const oldLimit = (parsed as unknown as { limit?: number }).limit ?? 5;
        parsed.channels = parsed.channels.map(ch =>
          ch.limit == null ? { ...ch, limit: oldLimit } : ch
        );
        setConfig(parsed);
        setDraft(parsed);
        if (!parsed.channels.length) return;
        const cacheKey = cacheKeyFor(parsed);
        const cached = await storage.getItem(cacheKey);
        if (cached) setVideos(JSON.parse(cached));
        fetchVideos(parsed, cacheKey);
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function cacheKeyFor(cfg: YoutubeConfig) {
    return `${storageKey}-${today}-${cfg.channels.map(ch => `${ch.channelId}:${ch.limit}:${ch.filterMembers ? 1 : 0}:${ch.includeShorts ? 1 : 0}`).join(",")}`;
  }

  async function fetchVideos(cfg: YoutubeConfig, cacheKey: string): Promise<boolean> {
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(
        cfg.channels.map(async ch => {
          const params = new URLSearchParams({ channelId: ch.channelId, limit: String(ch.limit) });
          if (ch.filterMembers) params.set("filterMembers", "true");
          if (ch.includeShorts) params.set("includeShorts", "true");
          const res = await fetch(`/api/youtube?${params}`);
          if (!res.ok) throw new Error();
          const data: { videos: { title: string; link: string; published: string }[] } = await res.json();
          return data.videos.map(v => ({ ...v, channelId: ch.channelId, channelName: ch.name }));
        })
      );
      const interleaved: Video[] = [];
      const maxLen = Math.max(...results.map(r => r.length));
      for (let i = 0; i < maxLen; i++) {
        for (const r of results) { if (r[i]) interleaved.push(r[i]); }
      }
      interleaved.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());
      if (!interleaved.length) throw new Error();
      setVideos(interleaved);
      await storage.setItem(cacheKey, JSON.stringify(interleaved));
      return true;
    } catch {
      setError("Failed to load videos.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function addChannel() {
    const input = chInput.trim();
    if (!input) return;
    setResolving(true);
    setError("");
    try {
      const res = await fetch(`/api/youtube?channel=${encodeURIComponent(input)}&limit=1`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to resolve channel");
      const ch: YoutubeChannel = { channelId: data.channelId, name: data.name, limit: 5 };
      if (draft.channels.find(c => c.channelId === ch.channelId)) { setChInput(""); return; }
      setDraft(d => ({ ...d, channels: [...d.channels, ch] }));
      setChInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not find channel.");
    } finally {
      setResolving(false);
    }
  }

  function setChannelLimit(channelId: string, limit: number) {
    setDraft(d => ({ ...d, channels: d.channels.map(ch => ch.channelId === channelId ? { ...ch, limit } : ch) }));
  }

  async function handleSave() {
    setError("");
    if (!draft.channels.length) { setError("Add at least one channel."); return; }
    const cacheKey = cacheKeyFor(draft);
    const ok = await fetchVideos(draft, cacheKey);
    if (ok) {
      setSelected(null);
      setConfig(draft);
      await storage.setItem(storageKey, JSON.stringify(draft));
      setSettingsOpen(false);
    }
  }

  async function handleReset() {
    await storage.removeItem(storageKey);
    setConfig(DEFAULT);
    setDraft(DEFAULT);
    setVideos([]);
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
              <span className="opacity-50"><PlaySquare size={14} /></span>
              <span className="text-xs font-medium opacity-60">YouTube</span>
            </div>
            {!selected && (
              <PencilButton c={c} onClick={() => { setDraft(config); setSettingsOpen(true); setError(""); }} />
            )}
          </div>
          <div className="flex-1 min-h-0 relative overflow-hidden">
            {/* Video list */}
            <div className={`absolute inset-0 transition-transform duration-300 ease-in-out ${selected ? "-translate-x-full" : "translate-x-0"}`}>
              <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pr-3" onScroll={onScroll}>
                {loading ? (
                  <LoadingState c={c} />
                ) : videos.length ? (
                  <ul className="flex flex-col">
                    {videos.map((v, i) => {
                      const sc = tagColor(v.channelName);
                      return (
                        <li key={i} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                          <span className="flex items-center gap-1.5 mb-1 min-w-0">
                            <span className={`inline-block min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-md ${sc.bg} ${sc.label}`}>
                              {v.channelName}
                            </span>
                            {v.published && Date.now() - new Date(v.published).getTime() < 86400000 && (
                              <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-widest px-1 py-0.5 rounded ${sc.bg} ${sc.label}`}>new</span>
                            )}
                            {v.published && (
                              <span className={`shrink-0 text-[10px] opacity-40 ${c.text}`}>{timeAgo(v.published)}</span>
                            )}
                          </span>
                          <div className="flex items-start gap-1 group/title">
                            <button
                              onClick={() => openVideo(v)}
                              className={`flex-1 min-w-0 break-words text-left block text-sm leading-snug ${c.text} hover:opacity-70 transition-opacity`}
                            >
                              {v.title}
                            </button>
                            <a
                              href={v.link}
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
                  <EmptyState c={c} action="add YouTube channels" />
                )}
              </div>
              <ScrollFades c={c} top={topFade} bottom={bottomFade} />
            </div>

            {/* Video detail */}
            <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${selected ? "translate-x-0" : "translate-x-full"}`}>
              {selected && (
                <>
                  <div className={`flex items-center gap-1.5 mb-2 shrink-0 ${c.text}`}>
                    <button onClick={() => setSelected(null)} className="shrink-0 opacity-60 hover:opacity-100">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="flex-1 text-xs font-medium truncate opacity-80">{selected.title}</span>
                    <a href={selected.link} target="_blank" rel="noopener noreferrer" className="shrink-0 opacity-40 hover:opacity-80" title="Watch on YouTube">
                      <ExternalLink size={11} />
                    </a>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto pr-3">
                    {loadingDetails ? (
                      <LoadingState c={c} />
                    ) : detailsError ? (
                      <p className="text-red-400 text-xs">{detailsError}</p>
                    ) : details ? (
                      <div className="flex flex-col gap-2">
                        <p className={`text-sm font-medium leading-snug break-words ${c.text}`}>{details.title || selected.title}</p>
                        <p className={`text-[11px] opacity-50 ${c.text}`}>
                          {[
                            details.author,
                            details.viewCount ? `${formatCount(details.viewCount)} views` : "",
                            details.lengthSeconds ? formatClock(details.lengthSeconds) : "",
                          ].filter(Boolean).join(" · ")}
                        </p>
                        {details.description ? (
                          <>
                            <div className="border-t border-black/5" />
                            <p className={`text-xs leading-relaxed opacity-75 whitespace-pre-line break-words ${c.text}`}>{details.description}</p>
                          </>
                        ) : (
                          <p className={`text-xs opacity-45 ${c.text}`}>No description.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      }
      back={
        <>
          <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
            <div className="flex gap-1">
              <SettingsInput
                type="text"
                value={chInput}
                onChange={e => setChInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addChannel()}
                placeholder="@handle or channel URL"
                className="flex-1 min-w-0"
              />
              <button
                onClick={addChannel}
                disabled={resolving}
                className="px-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
              >
                {resolving ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
            </div>
            {draft.channels.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {draft.channels.map(ch => {
                  const sc = tagColor(ch.name);
                  return (
                    <div key={ch.channelId} className={`flex flex-col gap-1 px-2 py-1.5 rounded-lg text-xs font-medium ${sc.bg} ${sc.label}`}>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate">{ch.name}</span>
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={ch.limit}
                          onChange={e => setChannelLimit(ch.channelId, Math.max(1, Math.min(15, parseInt(e.target.value) || 1)))}
                          className="w-10 text-center bg-white/60 rounded-md px-1 py-0.5 outline-none border border-current/20 text-xs"
                        />
                        <span className="opacity-50 font-normal">videos</span>
                        <button
                          onClick={() => setDraft(d => ({ ...d, channels: d.channels.filter(c => c.channelId !== ch.channelId) }))}
                          className="opacity-60 hover:opacity-100 leading-none ml-1"
                        >
                          ×
                        </button>
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!ch.includeShorts}
                          onChange={e => setDraft(d => ({ ...d, channels: d.channels.map(c => c.channelId === ch.channelId ? { ...c, includeShorts: e.target.checked } : c) }))}
                          className="w-3 h-3 rounded accent-current"
                        />
                        <span className="opacity-60 font-normal">include Shorts</span>
                      </label>
                      {/* filter members-only toggle, revisit later
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!ch.filterMembers}
                          onChange={e => setDraft(d => ({ ...d, channels: d.channels.map(c => c.channelId === ch.channelId ? { ...c, filterMembers: e.target.checked } : c) }))}
                          className="w-3 h-3 rounded accent-current"
                        />
                        <span className="opacity-60 font-normal">filter members-only</span>
                      </label>
                      */}
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
