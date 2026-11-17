"use client";

import { useT } from "@/lib/useT";
import { useState, useEffect, useRef } from "react";
import { Loader, Plus, X, PlaySquare, Archive, Upload } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { timeAgo, formatCount, formatClock, localDateStr } from "@/lib/format";
import { decodeEntities, parseJson } from "@/lib/text";
import { tagColor } from "@/lib/colors";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput, FOCUS_RING, HIT_AREA, Stepper } from "@/components/ui/Field";
import Toggle from "@/components/ui/Toggle";
import { WidgetHeader, Chip, SmallButton, RefreshButton, ScrollFades, LoadingState, EmptyState, ErrorState, FilterChip, DetailHead, SettingsFace, SettingsField, SettingsListRow, SettingsListControl, SettingsNote, SettingsInfo, SettingsError, ROW_ACTION, SettingsAddRow, SettingsGroup } from "@/components/ui/WidgetChrome";
import { useFeedFilter } from "@/lib/useFeedFilter";
import { useWidgetActive } from "@/lib/activeDashboard";
import { youtubeCacheKey } from "@/lib/cacheKeys";
import { addonIconMask, addonOpenUrl, addonValues, validateAddon, MAX_ADDON_BYTES, type ListedAddon } from "@/lib/addons";
import { ARCHIVE_KEY, OLD_TA_KEY, activeArchive, fromOldTa, loadAddons, parseArchive, type ArchiveConfig } from "@/lib/youtubeArchive";

type YoutubeChannel = { channelId: string; name: string; limit: number; filterMembers?: boolean; includeShorts?: boolean };
type YtView         = "list" | "thumbs" | "gallery";
type YoutubeConfig  = { channels: YoutubeChannel[]; view: YtView; archive?: ArchiveConfig };
type Video          = { title: string; link: string; published: string; channelId: string; channelName: string };
type VideoDetails   = { title: string; author: string; description: string; lengthSeconds: number; viewCount: number };

const DEFAULT: YoutubeConfig = { channels: [], view: "list" };
const VIEWS: { id: YtView; label: string }[] = [
  { id: "list", label: "List" },
  { id: "thumbs", label: "Thumbnails" },
  { id: "gallery", label: "Gallery" },
];

function videoId(link: string): string {
  const m = /[?&]v=([\w-]+)/.exec(link) ?? /\/(?:shorts|embed|live)\/([\w-]+)/.exec(link);
  return m ? m[1] : "";
}

// YouTube serves a predictable thumbnail per video id, so no extra fetch is
// needed: mqdefault is 320x180, plenty for widget-sized cards; hqdefault
// (480x360) for the detail view.
function thumbUrl(link: string, big = false): string {
  const id = videoId(link);
  return id ? `https://i.ytimg.com/vi/${id}/${big ? "hqdefault" : "mqdefault"}.jpg` : "";
}

// Pulse the placeholder square until the image paints.
function unpulse(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.classList.remove("animate-pulse");
}

export default function YoutubeWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const t = useT();
  const storageKey = `youtube-widget-${widget.id}`;
  const today = localDateStr();

  const [config, setConfig]             = useState<YoutubeConfig>(DEFAULT);
  const [videos, setVideos]             = useState<Video[]>([]);
  // Clicking a channel name shows only that channel (lib/useFeedFilter).
  const [filter, setFilter, toggleFilter] = useFeedFilter();
  // "Only archived" waits for the archive list, so the feed never flashes
  // everything first.
  const [addons, setAddons] = useState<ListedAddon[]>([]);
  useEffect(() => { loadAddons().then(setAddons); }, []);
  // The archive in use: its add-on and the user's values, when videos are set
  // to open there.
  const live = activeArchive(config.archive, addons);
  const onlyArchived = !!live && !!live.cfg.only;
  const shown = (filter ? videos.filter(v => v.channelId === filter) : videos)
    .filter(v => !onlyArchived || (archivedLoaded && archived.has(videoId(v.link))));
  // The badge beside the time: the archive's mark on the videos it has, or
  // YouTube's on the ones it does not, by the mark setting; none when only
  // archived videos show. On a thumbnail it sits in the bottom right corner on
  // a solid dark chip; in the plain list (no thumbnail) it stays inline beside
  // the time.
  const badgeFor = (v: Video, onThumb = false) => {
    if (!live || live.cfg.only) return null;
    const on = archived.has(videoId(v.link));
    const mark = live.cfg.mark ?? "archive";
    if (mark === "archive" ? !on : on) return null;
    const wrap = (icon: React.ReactNode) => onThumb
      ? <span className="absolute bottom-1 right-1 flex items-center justify-center w-5 h-5 rounded-md bg-black/85 text-white">{icon}</span>
      : icon;
    const tone = `shrink-0 w-3.5 h-3.5 ${onThumb ? "" : `opacity-80 ${c.label}`}`;
    const name = live.addon.name;
    if (mark === "archive") {
      // The service's own mark, in the label color, instead of a text badge.
      const mask = addonIconMask(live.addon);
      return wrap(mask
        ? <span role="img" aria-label={`In ${name}`} title={`Opens on ${name}`} className={`${tone} bg-current`} style={{ maskImage: mask, WebkitMaskImage: mask, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }} />
        : <span role="img" aria-label={`In ${name}`} title={`Opens on ${name}`} className="inline-flex"><Archive className={tone} /></span>);
    }
    return wrap(
      <svg role="img" aria-label={`Not in ${name}`} viewBox="0 0 24 24" className={tone} fill="currentColor">
        <title>{`Not in ${name}; opens on YouTube`}</title>
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.930.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.930 24 12 24 12s0-3.930-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  };
  const filterName = filter ? videos.find(v => v.channelId === filter)?.channelName ?? "" : "";
  const { ref: scrollRef, onScroll, topFade, bottomFade } = useScrollFade([videos, filter]);
  const [loading, setLoading]           = useState(false);
  const [resolving, setResolving]       = useState(false);
  const [error, setError]               = useState("");
  const [failed, setFailed]             = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft]               = useState<YoutubeConfig>(DEFAULT);
  const [chInput, setChInput]           = useState("");
  // Aborts the previous feed load so a slow initial fetch can never land over
  // (or be cached under) a newer channel list.
  const fetchAbort                      = useRef<AbortController | null>(null);

  // The archive: which feed videos it has, and the settings
  // face's connection test.
  const [archived, setArchived]         = useState<Set<string>>(new Set());
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  // Set by the refresh button so the next archive check skips the server's
  // short "not archived" memory.
  const forceTaRef                      = useRef(false);
  const [taStatus, setTaStatus]         = useState<{ state: "idle" | "testing" | "ok" | "error"; msg: string }>({ state: "idle", msg: "" });

  function hrefFor(v: Video): string {
    const id = videoId(v.link);
    if (live && id && archived.has(id)) return addonOpenUrl(live.addon, live.values, id) || v.link;
    return v.link;
  }
  const onTa = (v: Video) => !!live && archived.has(videoId(v.link));

  // An archive downloads on a schedule (TubeArchivist hourly), so a video that was not archived when the
  // list loaded may be by now. Re-check every 10 minutes while this widget is
  // on screen, and right away when it becomes visible again.
  const active = useWidgetActive();
  const [taTick, setTaTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    setTaTick(t => t + 1);
    const id = setInterval(() => setTaTick(t => t + 1), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [active]);

  // What the check depends on, as one string, so a re-render with an equal
  // connection does not ask again.
  const liveKey = live ? JSON.stringify([live.addon.id, live.values]) : "";
  useEffect(() => {
    if (!live || !videos.length) { setArchived(new Set()); setArchivedLoaded(false); return; }
    const ids = [...new Set(videos.map(v => videoId(v.link)).filter(Boolean))];
    const ctrl = new AbortController();
    fetch("/api/addons/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: live.addon.id, op: "has", values: live.values, ids, force: forceTaRef.current }),
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(d => { forceTaRef.current = false; setArchived(new Set(d.has ?? [])); setArchivedLoaded(true); })
      .catch(() => {});
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, liveKey, taTick]);

  const draftAddon = addons.find(a => a.id === draft.archive?.addon);
  const setArchive = (patch: Partial<ArchiveConfig>) => {
    setTaStatus({ state: "idle", msg: "" });
    setDraft(d => ({ ...d, archive: { addon: "", values: {}, open: "youtube", ...d.archive, ...patch } }));
  };

  async function testTa() {
    const values = draftAddon ? addonValues(draftAddon, draft.archive?.values) : null;
    if (!draftAddon || !values) {
      setTaStatus({ state: "error", msg: `Fill in the ${draftAddon?.name ?? "archive"} settings.` });
      return;
    }
    setTaStatus({ state: "testing", msg: "" });
    try {
      const res = await fetch("/api/addons/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftAddon.id, op: "ping", values }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `No response from ${draftAddon.name}`);
      setTaStatus({ state: "ok", msg: data.version ? `Connected, ${draftAddon.name} ${data.version}` : "Connected" });
    } catch (e) {
      setTaStatus({ state: "error", msg: String((e as Error).message ?? e) });
    }
  }

  // Adding an add-on from a file: checked here for a clear message, then by
  // the server, which is the one that counts.
  const addonFile = useRef<HTMLInputElement>(null);
  async function uploadAddon(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_ADDON_BYTES) throw new Error("That file is too large for an add-on.");
      let def: unknown;
      try { def = JSON.parse(await file.text()); } catch { throw new Error("That file is not JSON."); }
      const errors = validateAddon(def);
      if (errors.length) throw new Error(`Not a valid add-on: ${errors[0]}.`);
      const res = await fetch("/api/addons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addon: def }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errors?.[0] ? `${data.error} ${data.errors[0]}.` : data.error || "Could not add that add-on.");
      setAddons(await loadAddons(true));
      setDraft(d => ({ ...d, archive: { addon: data.addon.id, values: {}, open: "youtube" } }));
      setTaStatus({ state: "idle", msg: "" });
    } catch (e) {
      setTaStatus({ state: "error", msg: String((e as Error).message ?? e) });
    } finally {
      if (addonFile.current) addonFile.current.value = "";
    }
  }
  async function removeAddon(id: string) {
    await fetch(`/api/addons?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setAddons(await loadAddons(true));
    setDraft(d => (d.archive?.addon === id ? { ...d, archive: undefined } : d));
  }

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
    Promise.all([storage.getItem(storageKey), storage.getItem(ARCHIVE_KEY), storage.getItem(OLD_TA_KEY)]).then(async ([saved, sharedRaw, oldRaw]) => {
      let shared = parseArchive(sharedRaw);
      // A connection from when TubeArchivist was built in becomes the
      // TubeArchivist add-on's, once.
      const adopt = (old: unknown) => {
        const moved = fromOldTa(old);
        if (!moved) return;
        shared = moved;
        storage.setItem(ARCHIVE_KEY, JSON.stringify(moved));
        storage.removeItem(OLD_TA_KEY);
      };
      if (!shared && oldRaw) { try { adopt(JSON.parse(oldRaw)); } catch {} }
      if (!saved) {
        if (shared) { setConfig(c => ({ ...c, archive: shared })); setDraft(d => ({ ...d, archive: shared })); }
        return;
      }
      try {
        const parsed: YoutubeConfig = { ...DEFAULT, ...JSON.parse(saved) };
        // migrate old format: channels had no per-channel limit (used top-level limit)
        const oldLimit = (parsed as unknown as { limit?: number }).limit ?? 5;
        // Names saved before the API decoded them can hold entities ("&#39;").
        parsed.channels = parsed.channels.map(ch => ({
          ...ch,
          name: decodeEntities(ch.name ?? ""),
          limit: ch.limit ?? oldLimit,
        }));
        // A connection saved on this widget before it became shared seeds the
        // shared one.
        const own = (parsed as unknown as { ta?: unknown }).ta;
        if (!shared && own) adopt(own);
        delete (parsed as unknown as { ta?: unknown }).ta;
        parsed.archive = shared;
        setConfig(parsed);
        setDraft(parsed);
        if (!parsed.channels.length) return;
        const cacheKey = cacheKeyFor(parsed);
        const cached = await storage.getItem(cacheKey);
        if (cached) setVideos(parseJson<Video[]>(cached, []));
        fetchVideos(parsed, cacheKey);
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function cacheKeyFor(cfg: YoutubeConfig) {
    return youtubeCacheKey(widget.id, today, cfg.channels);
  }

  async function fetchVideos(cfg: YoutubeConfig, cacheKey: string, force = false): Promise<boolean> {
    if (force) forceTaRef.current = true;
    fetchAbort.current?.abort();
    const ctrl = new AbortController();
    fetchAbort.current = ctrl;
    setLoading(true);
    setError("");
    setFailed(false);
    try {
      const results = await Promise.all(
        cfg.channels.map(async ch => {
          const params = new URLSearchParams({ channelId: ch.channelId, limit: String(ch.limit) });
          if (ch.filterMembers) params.set("filterMembers", "true");
          if (ch.includeShorts) params.set("includeShorts", "true");
          if (force) params.set("refresh", "1");
          const res = await fetch(`/api/youtube?${params}`, { signal: ctrl.signal });
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
      // A missing date means a live stream or premiere: the channel's newest
      // item, so it sorts to the top rather than poisoning the sort with NaN.
      const ts = (p: string) => {
        const t = new Date(p).getTime();
        return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
      };
      interleaved.sort((a, b) => ts(b.published) - ts(a.published));
      if (!interleaved.length) throw new Error();
      if (ctrl.signal.aborted) return false;
      setVideos(interleaved);
      await storage.setItem(cacheKey, JSON.stringify(interleaved));
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError" || ctrl.signal.aborted) return false;
      setError("Failed to load videos.");
      setFailed(true);
      return false;
    } finally {
      if (fetchAbort.current === ctrl) setLoading(false);
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
      // Newest first, so the fresh channel is right there to configure
      // instead of at the bottom of a long list.
      setDraft(d => ({ ...d, channels: [ch, ...d.channels] }));
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
    // Kept only when its add-on is still there and its fields are filled in.
    const chosen = addons.find(a => a.id === draft.archive?.addon);
    const values = chosen ? addonValues(chosen, draft.archive?.values) : null;
    const archive: ArchiveConfig | undefined = chosen && values && draft.archive
      ? { addon: chosen.id, values, open: draft.archive.open, ...(draft.archive.mark ? { mark: draft.archive.mark } : {}), ...(draft.archive.only ? { only: true } : {}) }
      : undefined;
    const next: YoutubeConfig = { ...draft, archive };
    const cacheKey = cacheKeyFor(next);
    const ok = await fetchVideos(next, cacheKey);
    if (ok) {
      setSelected(null);
      setConfig(next);
      // The connection lives in the shared slot, not in this widget's config.
      const { archive: _shared, ...own } = next;
      void _shared;
      await storage.setItem(storageKey, JSON.stringify(own));
      if (archive) await storage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
      else await storage.removeItem(ARCHIVE_KEY);
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
            onSettings={() => { setDraft(config); setSettingsOpen(true); setError(""); setTaStatus({ state: "idle", msg: "" }); }}
            c={c}
            icon={PlaySquare}
            title={widget.title}
            after={filter && filterName ? <FilterChip c={c} label={filterName} onClear={() => setFilter(null)} /> : undefined}
            right={!selected && (
              <>
                <RefreshButton c={c} busy={loading} onClick={() => fetchVideos(config, cacheKeyFor(config), true)} />
              </>
            )}
          />
          <div className="flex-1 min-h-0 relative overflow-hidden">
            {/* Video list */}
            <div className={`absolute inset-0 transition-transform duration-300 ease-in-out ${selected ? "-translate-x-full" : "translate-x-0"}`}>
              <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pr-3" onScroll={onScroll}>
                {loading && !videos.length ? (
                  <LoadingState c={c} />
                ) : shown.length ? (
                  config.view === "gallery" ? (
                    <div className="grid gap-2 py-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                      {shown.map((v, i) => {
                        const sc = tagColor(v.channelName);
                        const thumb = thumbUrl(v.link);
                        return (
                          <div key={i} className="flex flex-col gap-1">
                            <button onClick={() => openVideo(v)} aria-label="Open video" className={`relative block w-full aspect-video rounded-lg overflow-hidden bg-black/10 hover:opacity-80 transition-opacity ${FOCUS_RING}`}>
                              {thumb && (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={thumb} alt="" loading="lazy" onLoad={unpulse} className="absolute inset-0 w-full h-full object-cover bg-black/10 dark:bg-white/10 animate-pulse" />
                              )}
                              {badgeFor(v, true)}
                            </button>
                            <span className="flex items-center gap-1.5 min-w-0">
                              <button
                                type="button"
                                onClick={() => toggleFilter(v.channelId)}
                                title={filter ? "Show everything" : `Show only ${v.channelName}`}
                                className={`inline-block min-w-0 truncate text-sm font-medium px-1 py-0.5 rounded-md hover:opacity-80 transition-opacity ${sc.bg} ${sc.label} ${FOCUS_RING}`}
                              >
                                {v.channelName}
                              </button>
                              {v.published && (
                                <span className={`shrink-0 text-sm opacity-70 ${c.text}`}>{timeAgo(v.published)}</span>
                              )}
                              
                            </span>
                            <div className="flex items-start gap-1 group/title">
                              <button
                                onClick={() => openVideo(v)}
                                className={`flex-1 min-w-0 break-words text-left text-sm font-medium leading-snug line-clamp-2 ${c.text} hover:opacity-70 transition-opacity ${FOCUS_RING}`}
                              >
                                {v.title}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                  <ul className="flex flex-col @container">
                    {shown.map((v, i) => {
                      const sc = tagColor(v.channelName);
                      const thumb = config.view === "thumbs" ? thumbUrl(v.link) : "";
                      // With a thumbnail the row is a two-column grid: thumbnail
                      // left, channel line and title right. In a narrow card
                      // (under 18rem of content) the channel line moves above
                      // the thumbnail so it never squeezes next to it.
                      return (
                        <li key={i} className={`py-2 first:pt-0 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                          <div className={thumb ? "grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center" : "flex flex-col gap-1"}>
                            {thumb && (
                              <button onClick={() => openVideo(v)} aria-label="Open video" className={`relative row-span-2 @max-[18rem]:row-span-1 @max-[18rem]:row-start-2 self-center hover:opacity-80 transition-opacity rounded-lg ${FOCUS_RING}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={thumb} alt="" loading="lazy" onLoad={unpulse} className="w-24 aspect-video object-cover rounded-lg bg-black/10 dark:bg-white/10 animate-pulse" />
                                {badgeFor(v, true)}
                              </button>
                            )}
                          <span className={`flex items-center gap-1.5 min-w-0 ${thumb ? "col-start-2 @max-[18rem]:col-span-2 @max-[18rem]:col-start-1" : ""}`}>
                            <button
                              type="button"
                              onClick={() => toggleFilter(v.channelId)}
                              title={filter ? "Show everything" : `Show only ${v.channelName}`}
                              className={`inline-block min-w-0 truncate text-sm font-medium px-1.5 py-0.5 rounded-md hover:opacity-80 transition-opacity ${sc.bg} ${sc.label} ${FOCUS_RING}`}
                            >
                              {v.channelName}
                            </button>
                            {v.published && (
                              <span className={`shrink-0 text-sm opacity-70 ${c.text}`}>{timeAgo(v.published)}</span>
                            )}
                            {!thumb && badgeFor(v)}
                          </span>
                          <div className={`flex items-start gap-1 group/title min-w-0 ${thumb ? "col-start-2 self-center" : ""}`}>
                            <button
                              onClick={() => openVideo(v)}
                              className={`flex-1 min-w-0 break-words text-left block text-sm font-medium leading-snug ${c.text} hover:opacity-70 transition-opacity ${FOCUS_RING}`}
                            >
                              {v.title}
                            </button>
                          </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  )
                ) : videos.length ? (
                  <EmptyState c={c}>nothing from {filterName || "this channel"} right now</EmptyState>
                ) : failed && config.channels.length ? (
                  <ErrorState c={c} busy={loading} onRetry={() => fetchVideos(config, cacheKeyFor(config), true)}>could not load videos</ErrorState>
                ) : (
                  <EmptyState c={c} action={t("empty.youtube")} />
                )}
              </div>
              <ScrollFades c={c} top={topFade} bottom={bottomFade} />
            </div>

            {/* Video detail */}
            <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${selected ? "translate-x-0" : "translate-x-full"}`}>
              {selected && (
                <>
                  <div className="flex-1 min-h-0 overflow-y-auto pr-3">
                    <DetailHead
                      c={c}
                      onBack={() => setSelected(null)}
                      href={hrefFor(selected)}
                      title={details?.title || selected.title}
                      image={thumbUrl(selected.link, true) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrl(selected.link, true)} alt="" onLoad={unpulse} className="w-full aspect-video object-cover rounded-xl bg-black/10 dark:bg-white/10 animate-pulse" />
                      ) : undefined}
                    />
                    {loadingDetails ? (
                      <LoadingState c={c} />
                    ) : detailsError ? (
                      <p className="text-red-400 text-sm">{detailsError}</p>
                    ) : details ? (
                      <div className="flex flex-col gap-2">
                        <p className={`text-sm opacity-70 ${c.text}`}>
                          {[
                            details.author,
                            details.viewCount ? `${formatCount(details.viewCount)} views` : "",
                            details.lengthSeconds ? formatClock(details.lengthSeconds) : "",
                          ].filter(Boolean).join(" · ")}
                        </p>
                        {details.description ? (
                          <>
                            <div className="border-t border-black/5" />
                            <p className={`text-sm leading-relaxed opacity-80 whitespace-pre-line break-words ${c.text}`}>{details.description}</p>
                          </>
                        ) : (
                          <p className={`text-sm opacity-70 ${c.text}`}>No description.</p>
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
        <SettingsFace c={c} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }} onReset={() => setDraft(DEFAULT)} saving={loading}>
          <SettingsField c={c} label="View" inline>
            {VIEWS.map(v => (
              <Chip key={v.id} c={c} active={draft.view === v.id} onClick={() => setDraft(d => ({ ...d, view: v.id }))}>
                {v.label}
              </Chip>
            ))}
          </SettingsField>
          <SettingsGroup
            c={c}
            label="Archive"
            summary={draftAddon ? (draft.archive?.open === "archive" ? `Videos open on ${draftAddon.name}` : draftAddon.name) : "Not set up"}
            hint="Shared by all YouTube widgets. A place your videos also live, such as TubeArchivist: videos it has can open there instead of on YouTube."
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip c={c} active={!draftAddon} onClick={() => { setTaStatus({ state: "idle", msg: "" }); setDraft(d => ({ ...d, archive: undefined })); }}>None</Chip>
              {addons.filter(a => a.slot === "youtube.archive").map(a => (
                <Chip key={a.id} c={c} active={draftAddon?.id === a.id} onClick={() => { if (draftAddon?.id !== a.id) setArchive({ addon: a.id, values: {}, open: "youtube", mark: undefined, only: undefined }); }}>
                  {a.name}
                </Chip>
              ))}
              <SmallButton c={c} onClick={() => addonFile.current?.click()} title="Add an add-on from a file">
                <Upload size={14} />
              </SmallButton>
              <input ref={addonFile} type="file" accept="application/json,.json" className="hidden" onChange={e => uploadAddon(e.target.files?.[0])} />
            </div>
            {draftAddon && (
              <>
                <p className={`text-sm opacity-70 ${c.label}`}>{draftAddon.description}</p>
                {draftAddon.source === "yours" && (
                  <div className="flex items-center justify-between gap-3 min-h-7">
                    <span className={`text-sm opacity-70 ${c.label}`}>Added by you from a file</span>
                    <SmallButton c={c} onClick={() => removeAddon(draftAddon.id)}>Remove</SmallButton>
                  </div>
                )}
                {draftAddon.config.map((f, i) => {
                  const last = i === draftAddon.config.length - 1;
                  const input = (
                    <SettingsInput
                      key={f.key}
                      type={f.type === "secret" ? "password" : f.type}
                      autoComplete="off"
                      aria-label={f.label}
                      value={draft.archive?.values[f.key] ?? ""}
                      onChange={e => setArchive({ values: { ...draft.archive?.values, [f.key]: e.target.value } })}
                      placeholder={f.placeholder ?? f.label}
                      title={f.hint}
                      className={last ? "flex-1 min-w-0" : undefined}
                    />
                  );
                  if (!last) return input;
                  return (
                    <div key={f.key} className="flex gap-1.5">
                      {input}
                      <SmallButton c={c} onClick={testTa} disabled={taStatus.state === "testing"} title="Test connection" className="self-center">
                        {taStatus.state === "testing" ? <Loader size={14} className="animate-spin" /> : "Test"}
                      </SmallButton>
                    </div>
                  );
                })}
              </>
            )}
            {taStatus.msg && (
              <p className={`text-sm ${taStatus.state === "ok" ? `opacity-70 ${c.label}` : "text-red-400"}`}>{taStatus.msg}</p>
            )}
            {draftAddon && (taStatus.state === "ok" || config.archive?.addon === draftAddon.id) && (
              <div className="flex items-center justify-between gap-3 min-h-7">
                <span className={`text-sm opacity-70 ${c.label}`}>Open on</span>
                <div className="flex items-center gap-1.5">
                  {([["youtube", "YouTube"], ["archive", draftAddon.name]] as const).map(([id, label]) => (
                    <Chip key={id} c={c} active={(draft.archive?.open ?? "youtube") === id} onClick={() => setDraft(d => (d.archive ? { ...d, archive: { ...d.archive, open: id } } : d))}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            {draftAddon && draft.archive?.open === "archive" && draftAddon.has && (
              <>
                <div className="flex items-center justify-between gap-3 min-h-7">
                  <span className={`text-sm opacity-70 ${c.label}`}>Only archived videos</span>
                  <Toggle checked={!!draft.archive.only} onChange={() => setDraft(d => (d.archive ? { ...d, archive: { ...d.archive, only: !d.archive.only } } : d))} label={`Show only videos that are in ${draftAddon.name}`} />
                </div>
                {!draft.archive.only && (
                  <div className="flex items-center justify-between gap-3 min-h-7">
                    <span className={`text-sm opacity-70 ${c.label}`}>Badge on</span>
                    <div className="flex items-center gap-1.5">
                      {([["archive", "Archived"], ["youtube", "Not archived"]] as const).map(([id, label]) => (
                        <Chip key={id} c={c} active={(draft.archive?.mark ?? "archive") === id} onClick={() => setDraft(d => (d.archive ? { ...d, archive: { ...d.archive, mark: id } } : d))}>
                          {label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
                {live && live.addon.id === draftAddon.id && videos.length > 0 && archivedLoaded && (() => {
                  const missing = videos.filter(v => !archived.has(videoId(v.link)));
                  if (missing.length === 0) return <SettingsInfo c={c} title={`All ${videos.length} videos here are archived`} />;
                  const shown = missing.slice(0, 6);
                  return (
                    <SettingsInfo
                      c={c}
                      title={`${missing.length} of ${videos.length} not in ${draftAddon.name}`}
                      items={shown.map(v => (
                        <a key={v.link} href={v.link} target="_blank" rel="noopener noreferrer" className={`hover:underline underline-offset-2 ${FOCUS_RING}`}>
                          <span className="opacity-70">{v.channelName}</span> - <span className={c.text}>{v.title}</span>
                        </a>
                      ))}
                      more={missing.length > shown.length ? `and ${missing.length - shown.length} more` : undefined}
                    />
                  );
                })()}
              </>
            )}
          </SettingsGroup>
          <SettingsAddRow c={c} value={chInput} onChange={setChInput} onAdd={addChannel} placeholder="@handle or channel URL" busy={resolving} />
          {draft.channels.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {draft.channels.map(ch => (
                <SettingsListRow
                  key={ch.channelId}
                  title={<span className={`truncate font-medium ${c.text}`}>{ch.name}</span>}
                  actions={
                    <button
                      onClick={() => setDraft(d => ({ ...d, channels: d.channels.filter(c => c.channelId !== ch.channelId) }))}
                      aria-label={`Remove ${ch.name}`}
                      title="Remove"
                      className={`${ROW_ACTION} ${c.label}`}
                    >
                      <X size={14} />
                    </button>
                  }
                >
                  <SettingsListControl c={c} label="Videos">
                    <Stepper label={`videos from ${ch.name}`} value={ch.limit} min={1} max={15} onChange={v => setChannelLimit(ch.channelId, v)} />
                  </SettingsListControl>
                  <SettingsListControl c={c} label="Include Shorts">
                    <Toggle
                      checked={!!ch.includeShorts}
                      onChange={() => setDraft(d => ({ ...d, channels: d.channels.map(c => c.channelId === ch.channelId ? { ...c, includeShorts: !c.includeShorts } : c) }))}
                      label={`Include Shorts from ${ch.name}`}
                    />
                  </SettingsListControl>
                </SettingsListRow>
              ))}
            </div>
          )}
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
