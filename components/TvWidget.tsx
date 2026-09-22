"use client";

import { useState, useEffect, useRef } from "react";
import { Tv, Play, Loader, List, Square } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput } from "@/components/ui/Field";
import { PencilButton, EmptyState, SaveCancelRow } from "@/components/ui/WidgetChrome";

type Channel = { name: string; url: string };
type TvConfig = { playlistUrl: string; channels: Channel[]; channelUrl: string; channelName: string };

const DEFAULT: TvConfig = { playlistUrl: "", channels: [], channelUrl: "", channelName: "" };

// Two stream kinds: .m3u8 is HLS (hls.js or native Safari); anything else is
// treated as a live MPEG-TS stream (what ErsatzTV serves by default), played
// through mpegts.js over MSE.
function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url);
}

export default function TvWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `tv-widget-${widget.id}`;

  const [config, setConfig] = useState<TvConfig>(DEFAULT);
  const [playing, setPlaying] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Either an hls.js or an mpegts.js player; both expose destroy().
  const playerRef = useRef<{ destroy: () => void } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const playingRef = useRef(false);
  playingRef.current = playing;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<TvConfig>(DEFAULT);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (!saved) return;
      try {
        const parsed = { ...DEFAULT, ...JSON.parse(saved) } as TvConfig;
        setConfig(parsed);
        setDraft(parsed);
      } catch {}
    });
  }, [storageKey]);

  function destroyPlayer() {
    try { playerRef.current?.destroy(); } catch {}
    playerRef.current = null;
  }

  function stop() {
    destroyPlayer();
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
    setPlaying(false);
  }

  // Attach the stream when playback starts or the channel changes. All
  // traffic rides through /api/tv (the LAN server is http, the page https).
  useEffect(() => {
    if (!playing || !config.channelUrl) return;
    const video = videoRef.current;
    if (!video) return;
    setVideoError("");
    let cancelled = false;
    if (isHlsUrl(config.channelUrl)) {
      const src = `/api/tv?op=playlist&url=${encodeURIComponent(config.channelUrl)}`;
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.play().catch(() => {});
      } else {
        import("hls.js").then(({ default: Hls }) => {
          if (cancelled || !videoRef.current) return;
          if (!Hls.isSupported()) {
            setVideoError("This browser cannot play HLS streams.");
            return;
          }
          const hls = new Hls();
          playerRef.current = hls;
          hls.loadSource(src);
          hls.attachMedia(videoRef.current);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          hls.on(Hls.Events.ERROR, (_e: unknown, data: any) => {
            if (data?.fatal) setVideoError("Stream error. Is the channel live?");
          });
          videoRef.current.play().catch(() => {});
        });
      }
    } else {
      const src = `/api/tv?op=seg&url=${encodeURIComponent(config.channelUrl)}`;
      import("mpegts.js").then(({ default: mpegts }) => {
        if (cancelled || !videoRef.current) return;
        if (!mpegts.getFeatureList().mseLivePlayback) {
          setVideoError("This browser cannot play live TS streams.");
          return;
        }
        const player = mpegts.createPlayer({ type: "mpegts", isLive: true, url: src });
        playerRef.current = player;
        player.attachMediaElement(videoRef.current);
        player.load();
        player.on(mpegts.Events.ERROR, () => setVideoError("Stream error. Is the channel live?"));
        void player.play()?.catch?.(() => {});
      });
    }
    return () => {
      cancelled = true;
      destroyPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, config.channelUrl]);

  // Hard-stop when the widget is hidden (dashboard switched away, edit shelf
  // covering, etc.): a hidden video would keep the server transcoding.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0] && !entries[0].isIntersecting && playingRef.current) stop();
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadChannels() {
    const url = draft.playlistUrl.trim();
    if (!/^https?:\/\//.test(url)) { setError("Enter the playlist URL (http://...)."); return; }
    setLoadingChannels(true);
    setError("");
    try {
      const res = await fetch(`/api/tv?op=channels&url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const channels: Channel[] = (data.channels ?? []).map((ch: Channel) => ({ name: ch.name, url: ch.url }));
      if (!channels.length) throw new Error("No channels found in the playlist.");
      setDraft(d => ({
        ...d,
        channels,
        channelUrl: channels.find(ch => ch.url === d.channelUrl)?.url ?? channels[0].url,
        channelName: channels.find(ch => ch.url === d.channelUrl)?.name ?? channels[0].name,
      }));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoadingChannels(false);
    }
  }

  function pickChannel(ch: Channel) {
    const next = { ...config, channelUrl: ch.url, channelName: ch.name };
    setConfig(next);
    storage.setItem(storageKey, JSON.stringify(next));
    setPickerOpen(false);
  }

  async function handleSave() {
    setError("");
    const playlistUrl = draft.playlistUrl.trim();
    let next = { ...draft, playlistUrl };
    // A direct stream URL works without a channel list.
    if (!next.channelUrl && /\.m3u8(\?|$)/i.test(playlistUrl)) {
      next = { ...next, channelUrl: playlistUrl, channelName: next.channelName || "Stream" };
    }
    if (!next.channelUrl) { setError("Load the playlist and pick a channel, or paste a direct .m3u8 URL."); return; }
    stop();
    setConfig(next);
    await storage.setItem(storageKey, JSON.stringify(next));
    setSettingsOpen(false);
  }

  async function handleReset() {
    stop();
    await storage.removeItem(storageKey);
    setConfig(DEFAULT);
    setDraft(DEFAULT);
    setSettingsOpen(false);
  }

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <div ref={rootRef} className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
              <span className="opacity-50 shrink-0"><Tv size={14} /></span>
              <span className="text-xs font-medium opacity-60 truncate">{config.channelName || "TV"}</span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              {playing && (
                <button onClick={stop} title="Stop" className={`opacity-60 hover:opacity-100 transition-opacity ${c.icon}`}>
                  <Square size={12} />
                </button>
              )}
              {config.channels.length > 1 && (
                <button onClick={() => setPickerOpen(o => !o)} title="Channels" className={`opacity-60 hover:opacity-100 transition-opacity ${c.icon}`}>
                  <List size={14} />
                </button>
              )}
              <PencilButton c={c} onClick={() => { setDraft(config); setError(""); setSettingsOpen(true); }} />
            </div>
          </div>

          <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden bg-black/90">
            {config.channelUrl ? (
              playing ? (
                <video
                  ref={videoRef}
                  controls
                  playsInline
                  className="absolute inset-0 w-full h-full object-contain"
                />
              ) : (
                <button
                  onClick={() => setPlaying(true)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70 hover:text-white transition-colors"
                >
                  <Play size={28} />
                  <span className="text-xs">{config.channelName}</span>
                </button>
              )
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <EmptyState c={c} action="add a channel" />
              </div>
            )}
            {videoError && (
              <p className="absolute bottom-2 inset-x-2 text-center text-red-400 text-xs">{videoError}</p>
            )}
            {pickerOpen && config.channels.length > 0 && (
              <div className="absolute inset-0 z-10 overflow-y-auto bg-[var(--surface)]">
                <ul className="flex flex-col py-1">
                  {config.channels.map(ch => (
                    <li key={ch.url}>
                      <button
                        onClick={() => pickChannel(ch)}
                        className={`w-full text-left text-xs py-1.5 px-2 text-[var(--text-primary)] ${ch.url === config.channelUrl ? "font-semibold" : "opacity-70 hover:opacity-100"}`}
                      >
                        {ch.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      }
      back={
        <>
          <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
            <div className="flex gap-1">
              <SettingsInput
                type="url"
                value={draft.playlistUrl}
                onChange={e => setDraft(d => ({ ...d, playlistUrl: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && loadChannels()}
                placeholder="Playlist (.m3u) or stream (.m3u8) URL"
                className="flex-1 min-w-0"
              />
              <button
                onClick={loadChannels}
                disabled={loadingChannels}
                className="px-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 text-xs"
              >
                {loadingChannels ? <Loader size={14} className="animate-spin" /> : "Load"}
              </button>
            </div>
            {draft.channels.length > 0 && (
              <div className="flex flex-col gap-1">
                {draft.channels.map(ch => (
                  <button
                    key={ch.url}
                    onClick={() => setDraft(d => ({ ...d, channelUrl: ch.url, channelName: ch.name }))}
                    className={`text-left text-xs px-2 py-1.5 rounded-lg transition-colors ${
                      draft.channelUrl === ch.url
                        ? "bg-white text-neutral-700 shadow-sm border border-neutral-200"
                        : `${c.text} opacity-60 hover:opacity-90`
                    }`}
                  >
                    {ch.name}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="text-red-400 text-xs break-words">{error}</p>}
          </div>
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
