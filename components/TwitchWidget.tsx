"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Radio, X } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { formatCount } from "@/lib/format";
import { useScrollFade } from "@/lib/useScrollFade";
import { useWidgetActive, usePageVisible } from "@/lib/activeDashboard";
import FlipCard from "@/components/ui/FlipCard";
import { FOCUS_RING } from "@/components/ui/Field";
import {
  WidgetHeader, RefreshButton, Chip, EmptyState, ErrorState, LoadingState, ScrollFades, SettingsFace, SettingsField, SettingsError,
  SettingsAddRow, SettingsListRow, ROW_ACTION,
} from "@/components/ui/WidgetChrome";

// Twitch (docs/widgets/twitch.md). Follow channels: who is live, what they
// are streaming and to how many, live ones first. Or the most watched
// categories right now.

type Mode = "channels" | "games";
type Config = { mode: Mode; channels: string[] };
type Channel = { login: string; name: string; avatar: string; live: boolean; title: string; game: string; viewers: number; startedAt: string };
type Game = { id: string; name: string; art: string };
const DEFAULT: Config = { mode: "channels", channels: [] };

// A channel as typed: its name, or its twitch.tv address. Null when it is
// neither. Exported for tests.
export function normalizeChannel(input: string): string | null {
  const s = input.trim().replace(/^@/, "");
  const fromUrl = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([a-zA-Z0-9_]{2,25})(?:[/?#].*)?$/i);
  const login = (fromUrl ? fromUrl[1] : s).toLowerCase();
  return /^[a-z0-9_]{2,25}$/.test(login) ? login : null;
}

export default function TwitchWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const active = useWidgetActive();
  const visible = usePageVisible();
  const storageKey = `twitch-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [games, setGames] = useState<Game[] | null>(null);
  const [state, setState] = useState<"ok" | "not_connected" | "failed">("ok");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const run = useRef(0);
  const configured = config.mode === "games" || config.channels.length > 0;
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([channels, games, config.mode]);

  const load = useCallback(async (cfg: Config) => {
    if (cfg.mode === "channels" && !cfg.channels.length) return;
    const mine = ++run.current;
    setBusy(true);
    try {
      const q = cfg.mode === "games" ? "op=games" : `op=channels&logins=${encodeURIComponent(cfg.channels.join(","))}`;
      const res = await fetch(`/api/twitch?${q}`);
      const data = await res.json().catch(() => ({}));
      if (run.current !== mine) return;
      if (res.status === 404 && data.error === "not_connected") { setState("not_connected"); return; }
      if (!res.ok) throw new Error();
      if (cfg.mode === "games") setGames(data.games ?? []); else setChannels(data.channels ?? []);
      setState("ok");
    } catch {
      if (run.current === mine) setState("failed");
    } finally {
      if (run.current === mine) setBusy(false);
    }
  }, []);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (saved) {
        try {
          const parsed = { ...DEFAULT, ...JSON.parse(saved) } as Config;
          setConfig(parsed);
          setDraft(parsed);
        } catch {}
      }
      setLoaded(true);
    });
  }, [storageKey]);

  // Who is live changes by the minute; the top categories slowly.
  useEffect(() => {
    if (!active || !visible || !configured || state === "not_connected") return;
    load(config);
    const id = setInterval(() => load(config), config.mode === "games" ? 10 * 60_000 : 2 * 60_000);
    return () => clearInterval(id);
  }, [active, visible, configured, config, state, load]);

  function addChannel() {
    setError("");
    const login = normalizeChannel(input);
    if (!login) { setError("Enter a channel's name, like its twitch.tv address ends with."); return; }
    if (draft.channels.includes(login)) { setInput(""); return; }
    setDraft(d => ({ ...d, channels: [...d.channels, login] }));
    setInput("");
  }

  function handleSave() {
    setError("");
    if (draft.mode === "channels" && !draft.channels.length) { setError("Add at least one channel."); return; }
    setConfig(draft);
    setChannels(null);
    setGames(null);
    setState("ok");
    storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
  }

  const hairline = (i: number) => (i > 0 ? "border-t border-black/10 dark:border-white/10" : "");
  // Live first, by audience; then the rest by name.
  const sorted = [...(channels ?? [])].sort((a, b) => Number(b.live) - Number(a.live) || b.viewers - a.viewers || a.name.localeCompare(b.name));
  const data = config.mode === "games" ? games : channels;

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader
            onSettings={() => { setDraft(config); setError(""); setInput(""); setSettingsOpen(true); }}
            c={c}
            icon={Radio}
            title={widget.title}
            right={configured && state !== "not_connected" ? <RefreshButton c={c} busy={busy} onClick={() => load(config)} /> : undefined}
          />
          {!loaded ? null : !configured ? (
            <EmptyState c={c} action={t("empty.twitch")} />
          ) : state === "not_connected" ? (
            <EmptyState c={c}>Twitch is not connected. The admin connects it once, on the Admin page.</EmptyState>
          ) : state === "failed" && !data ? (
            <ErrorState c={c} busy={busy} onRetry={() => load(config)}>could not reach Twitch</ErrorState>
          ) : !data ? (
            <LoadingState c={c} />
          ) : (
            <div className="flex-1 min-h-0 relative">
              <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
                {config.mode === "channels" ? (
                  sorted.length === 0 ? <EmptyState c={c}>Twitch does not know those channels</EmptyState> : (
                    <ul className="flex flex-col">
                      {sorted.map((ch, i) => (
                        <li key={ch.login} className={`py-2 first:pt-0 ${hairline(i)}`}>
                          <a href={`https://www.twitch.tv/${ch.login}`} target="_blank" rel="noopener noreferrer" title={ch.live ? ch.title : undefined} className={`flex items-center gap-2.5 hover:opacity-70 transition-opacity rounded-sm ${FOCUS_RING}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ch.avatar} alt="" width={32} height={32} loading="lazy" className={`w-8 h-8 rounded-full shrink-0 bg-black/10 dark:bg-white/10 ${ch.live ? "" : "opacity-50 grayscale"}`} onError={e => { e.currentTarget.style.visibility = "hidden"; }} />
                            <span className="flex-1 min-w-0">
                              <span className={`block truncate text-sm font-medium ${c.text} ${ch.live ? "" : "opacity-70"}`}>{ch.name}</span>
                              <span className={`block truncate text-sm opacity-70 ${c.label}`}>{ch.live ? ch.game || ch.title || "live" : "offline"}</span>
                            </span>
                            {ch.live && (
                              <span className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium tabular-nums text-rose-600 dark:text-rose-400">
                                <span aria-hidden className="w-2 h-2 rounded-full bg-rose-500" />
                                {formatCount(ch.viewers)}<span className="sr-only"> watching</span>
                              </span>
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  <ol className="flex flex-col">
                    {(games ?? []).map((g, i) => (
                      <li key={g.id} className={`py-2 first:pt-0 ${hairline(i)}`}>
                        <a href={`https://www.twitch.tv/directory/category/${encodeURIComponent(g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))}`} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2.5 hover:opacity-70 transition-opacity rounded-sm ${FOCUS_RING}`}>
                          <span className={`shrink-0 w-5 text-sm tabular-nums opacity-70 ${c.label}`}>{i + 1}</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={g.art} alt="" width={26} height={36} loading="lazy" className="w-[26px] h-9 rounded shrink-0 object-cover bg-black/10 dark:bg-white/10" onError={e => { e.currentTarget.style.visibility = "hidden"; }} />
                          <span className={`flex-1 min-w-0 truncate text-sm font-medium ${c.text}`}>{g.name}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <ScrollFades c={c} top={topFade} bottom={bottomFade} />
            </div>
          )}
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }}>
          <SettingsField c={c} label="Show" inline>
            <Chip c={c} active={draft.mode === "channels"} onClick={() => setDraft(d => ({ ...d, mode: "channels" }))}>Channels</Chip>
            <Chip c={c} active={draft.mode === "games"} onClick={() => setDraft(d => ({ ...d, mode: "games" }))}>Top categories</Chip>
          </SettingsField>
          {draft.mode === "channels" && (
            <>
              <SettingsField c={c} label="Channels" hint="A channel's name, or its twitch.tv address.">
                <SettingsAddRow c={c} value={input} onChange={setInput} onAdd={addChannel} placeholder="channel name" />
              </SettingsField>
              {draft.channels.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {draft.channels.map(login => (
                    <SettingsListRow
                      key={login}
                      title={<span className={`truncate ${c.text}`}>{login}</span>}
                      actions={
                        <button type="button" onClick={() => setDraft(d => ({ ...d, channels: d.channels.filter(x => x !== login) }))} aria-label={`Remove ${login}`} title="Remove" className={`${ROW_ACTION} ${c.label}`}>
                          <X size={14} />
                        </button>
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
