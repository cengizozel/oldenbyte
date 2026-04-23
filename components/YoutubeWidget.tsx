"use client";

import { useState, useEffect, useRef } from "react";
import { Pencil, Check, X, RotateCcw, Loader, Plus, PlaySquare } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

type YoutubeChannel = { channelId: string; name: string; limit: number };
type YoutubeConfig  = { channels: YoutubeChannel[] };
type Video          = { title: string; link: string; published: string; channelId: string; channelName: string };

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)    return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5)    return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12)  return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

const DEFAULT: YoutubeConfig = { channels: [] };

const CH_COLORS = [
  { label: "text-rose-600",    bg: "bg-rose-100"    },
  { label: "text-sky-700",     bg: "bg-sky-100"     },
  { label: "text-violet-700",  bg: "bg-violet-100"  },
  { label: "text-teal-700",    bg: "bg-teal-100"    },
  { label: "text-amber-700",   bg: "bg-amber-100"   },
  { label: "text-emerald-700", bg: "bg-emerald-100" },
];

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
  const [showBottomFade, setShowBottomFade] = useState(false);
  const [showTopFade, setShowTopFade]       = useState(false);
  const scrollRef                           = useRef<HTMLDivElement>(null);

  function checkFade(el: HTMLDivElement) {
    const overflows = el.scrollHeight > el.clientHeight + 1;
    setShowBottomFade(overflows && el.scrollHeight - el.scrollTop - el.clientHeight > 20);
    setShowTopFade(overflows && el.scrollTop > 20);
  }
  const [loading, setLoading]           = useState(false);
  const [resolving, setResolving]       = useState(false);
  const [error, setError]               = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft]               = useState<YoutubeConfig>(DEFAULT);
  const [chInput, setChInput]           = useState("");

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkFade(el);
    const ro = new ResizeObserver(() => checkFade(el));
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos]);

  function cacheKeyFor(cfg: YoutubeConfig) {
    return `${storageKey}-${today}-${cfg.channels.map(ch => `${ch.channelId}:${ch.limit}`).join(",")}`;
  }

  async function fetchVideos(cfg: YoutubeConfig, cacheKey: string): Promise<boolean> {
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(
        cfg.channels.map(async ch => {
          const res = await fetch(`/api/youtube?channelId=${encodeURIComponent(ch.channelId)}&limit=${ch.limit}`);
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

  const chColorIndex: Record<string, number> = {};
  config.channels.forEach((ch, i) => { chColorIndex[ch.channelId] = i % CH_COLORS.length; });

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}>

      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className={`flex items-center gap-1.5 ${c.label}`}>
          <span className="opacity-50"><PlaySquare size={14} /></span>
          <span className="text-xs font-medium opacity-60">YouTube</span>
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
        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">

          {/* Channel input */}
          <div className="flex gap-1">
            <input
              autoFocus
              type="text"
              value={chInput}
              onChange={e => setChInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addChannel()}
              placeholder="@handle or channel URL"
              className="flex-1 text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
            />
            <button
              onClick={addChannel}
              disabled={resolving}
              className="px-3 rounded-xl border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-800 disabled:opacity-40"
            >
              {resolving ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
            </button>
          </div>

          {/* Added channels with per-channel limit */}
          {draft.channels.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {draft.channels.map((ch, i) => {
                const sc = CH_COLORS[i % CH_COLORS.length];
                return (
                  <div key={ch.channelId} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-medium ${sc.bg} ${sc.label}`}>
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
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pr-3" onScroll={e => checkFade(e.currentTarget)}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
              </div>
            ) : videos.length ? (
              <ul className="flex flex-col">
                {videos.map((v, i) => {
                  const sc = CH_COLORS[chColorIndex[v.channelId] ?? 0];
                  return (
                    <li key={i} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                      <span className="flex items-center gap-1.5 mb-1">
                        <span className={`inline-block text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-md ${sc.bg} ${sc.label}`}>
                          {v.channelName}
                        </span>
                        {v.published && Date.now() - new Date(v.published).getTime() < 86400000 && (
                          <span className={`text-[9px] font-semibold uppercase tracking-widest px-1 py-0.5 rounded ${sc.bg} ${sc.label}`}>new</span>
                        )}
                        {v.published && (
                          <span className={`text-[10px] opacity-40 ${c.text}`}>{timeAgo(v.published)}</span>
                        )}
                      </span>
                      <a
                        href={v.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`block text-sm leading-snug ${c.text} hover:opacity-70 transition-opacity`}
                      >
                        {v.title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={`text-xs opacity-45 ${c.text}`}>
                hover and click the pencil to add YouTube channels
              </p>
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
