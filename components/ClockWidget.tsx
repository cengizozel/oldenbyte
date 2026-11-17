"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Clock, X } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import {
  WidgetHeader, Chip, EmptyState, ScrollFades, SettingsFace, SettingsField, SettingsError,
  SettingsAddRow, SettingsListRow, LIST_TITLE_INPUT, ROW_ACTION,
} from "@/components/ui/WidgetChrome";

// The time in other places (docs/widgets/clock.md): one row per time zone,
// with how far ahead or behind it is and the day when it differs from yours.

type Zone = { id: string; tz: string; label: string };
type Config = { zones: Zone[]; hour12: boolean };
const DEFAULT: Config = { zones: [], hour12: false };

const newId = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// "America/Argentina/Buenos_Aires" -> "Buenos Aires".
export const cityOf = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");

function allZones(): string[] {
  try { return Intl.supportedValuesOf("timeZone"); } catch { return []; }
}

// A typed entry to a zone id: the id itself, or a city name ("tokyo"). Null
// when it is neither. Exported for tests.
export function resolveZone(input: string, zones: string[] = allZones()): string | null {
  const q = input.trim();
  if (!q) return null;
  const lower = q.toLowerCase().replace(/\s+/g, "_");
  const hit = zones.find(z => z.toLowerCase() === lower) ?? zones.find(z => cityOf(z).toLowerCase() === q.toLowerCase());
  if (hit) return hit;
  try { new Intl.DateTimeFormat("en-US", { timeZone: q }); return q; } catch { return null; }
}

// What the wall clock reads in a zone, as if it were UTC: the difference
// between two of these is the difference between the zones. Exported for tests.
export function wallClock(tz: string | undefined, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

// "3h ahead", "5h 30m behind", "same time". Exported for tests.
export function offsetText(minutes: number): string {
  if (minutes === 0) return "same time";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60), m = abs % 60;
  return `${h ? `${h}h` : ""}${h && m ? " " : ""}${m ? `${m}m` : ""} ${minutes > 0 ? "ahead" : "behind"}`;
}

export default function ClockWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const listId = useId();
  const storageKey = `clock-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const zones = useMemo(allZones, []);
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([config.zones.length]);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (!saved) return;
      try {
        const parsed = { ...DEFAULT, ...JSON.parse(saved) } as Config;
        setConfig(parsed);
        setDraft(parsed);
      } catch {}
    });
  }, [storageKey]);

  // Re-render when the minute turns, not every second.
  useEffect(() => {
    setNow(new Date());
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(timer);
  }, []);

  function addZone() {
    setError("");
    const tz = resolveZone(input, zones);
    if (!tz) { setError("No time zone by that name. Try a city, like Tokyo, or an id, like Europe/Istanbul."); return; }
    if (draft.zones.some(z => z.tz === tz)) { setInput(""); return; }
    setDraft(d => ({ ...d, zones: [...d.zones, { id: newId(), tz, label: cityOf(tz) }] }));
    setInput("");
  }

  function handleSave() {
    setConfig(draft);
    storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
  }

  const here = now ? wallClock(undefined, now) : 0;

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader onSettings={() => { setDraft(config); setError(""); setInput(""); setSettingsOpen(true); }} c={c} icon={Clock} title={widget.title} />
          {config.zones.length === 0 ? (
            <EmptyState c={c} action={t("empty.clock")} />
          ) : (
            <div className="flex-1 min-h-0 relative">
              <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
                <ul className="flex flex-col">
                  {now && config.zones.map((z, i) => {
                    let time = "", meta = "";
                    try {
                      time = new Intl.DateTimeFormat(undefined, { timeZone: z.tz, hour: "numeric", minute: "2-digit", hour12: config.hour12 }).format(now);
                      const there = wallClock(z.tz, now);
                      const dayDiff = Math.round((Date.UTC(new Date(there).getUTCFullYear(), new Date(there).getUTCMonth(), new Date(there).getUTCDate())
                        - Date.UTC(new Date(here).getUTCFullYear(), new Date(here).getUTCMonth(), new Date(here).getUTCDate())) / 86_400_000);
                      const day = dayDiff === 0 ? "" : dayDiff === 1 ? "tomorrow" : dayDiff === -1 ? "yesterday" : "";
                      meta = [offsetText(Math.round((there - here) / 60_000)), day].filter(Boolean).join(" · ");
                    } catch { meta = "unknown time zone"; }
                    return (
                      <li key={z.id} className={`flex items-center justify-between gap-3 py-2 first:pt-0 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                        <div className="min-w-0">
                          <p className={`text-sm font-medium truncate ${c.text}`}>{z.label || cityOf(z.tz)}</p>
                          <p className={`text-sm opacity-70 truncate ${c.label}`}>{meta}</p>
                        </div>
                        <p className={`shrink-0 text-lg font-medium tabular-nums ${c.text}`}>{time}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <ScrollFades c={c} top={topFade} bottom={bottomFade} />
            </div>
          )}
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }}>
          <SettingsField c={c} label="Places" hint="A city or a time zone id.">
            <SettingsAddRow c={c} value={input} onChange={setInput} onAdd={addZone} placeholder="Tokyo, or Europe/Istanbul" list={listId} />
            <datalist id={listId}>
              {zones.map(z => <option key={z} value={z} />)}
            </datalist>
          </SettingsField>
          {error && <SettingsError>{error}</SettingsError>}
          {draft.zones.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {draft.zones.map(z => (
                <SettingsListRow
                  key={z.id}
                  title={
                    <input
                      value={z.label}
                      onChange={e => setDraft(d => ({ ...d, zones: d.zones.map(x => x.id === z.id ? { ...x, label: e.target.value } : x) }))}
                      aria-label="Name"
                      title={z.tz}
                      maxLength={40}
                      className={`${LIST_TITLE_INPUT} ${c.text}`}
                    />
                  }
                  actions={
                    <button type="button" onClick={() => setDraft(d => ({ ...d, zones: d.zones.filter(x => x.id !== z.id) }))} aria-label={`Remove ${z.label}`} title="Remove" className={`${ROW_ACTION} ${c.label}`}>
                      <X size={14} />
                    </button>
                  }
                />
              ))}
            </div>
          )}
          <SettingsField c={c} label="Format" inline>
            <Chip c={c} active={!draft.hour12} onClick={() => setDraft(d => ({ ...d, hour12: false }))}>24 hour</Chip>
            <Chip c={c} active={draft.hour12} onClick={() => setDraft(d => ({ ...d, hour12: true }))}>12 hour</Chip>
          </SettingsField>
        </SettingsFace>
      }
    />
  );
}
