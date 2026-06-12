"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader, Plug } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { formatDate } from "@/lib/format";
import { tagColor } from "@/lib/colors";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "./ui/FlipCard";
import { SettingsInput } from "./ui/Field";
import { PencilButton, ScrollFades, EmptyState, LoadingState, SaveCancelRow } from "./ui/WidgetChrome";

type Calendar = { name: string; url: string; readOnly?: boolean };
type CalEvent = {
  uid: string; calendar: string; title: string;
  start: string; end: string; allDay: boolean; location?: string;
};
type CalendarConfig = {
  baseUrl: string;
  username: string;
  password: string;
  calendars: Calendar[]; // the selected (displayed) calendars
  days: number;          // agenda window
};

const DEFAULT: CalendarConfig = { baseUrl: "", username: "", password: "", calendars: [], days: 7 };

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayHeading(date: string, today: string, tomorrow: string): string {
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function CalendarWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `calendar-widget-${widget.id}`;

  const [config, setConfig] = useState<CalendarConfig>(DEFAULT);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<CalendarConfig>(DEFAULT);
  const [available, setAvailable] = useState<Calendar[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([events]);

  const configured = (cfg: CalendarConfig) => !!(cfg.baseUrl && cfg.username && cfg.calendars.length);

  const fetchEvents = useCallback(async (cfg: CalendarConfig) => {
    if (!configured(cfg)) return;
    setLoading(true);
    setError("");
    try {
      const start = new Date();
      const end = new Date(start.getTime() + (cfg.days || 7) * 86400000);
      const res = await fetch("/api/caldav", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "events",
          baseUrl: cfg.baseUrl, username: cfg.username, password: cfg.password,
          calendars: cfg.calendars,
          start: localDate(start), end: localDate(end),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load events.");
      setEvents(data.events ?? []);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (saved) {
        try {
          const parsed: CalendarConfig = { ...DEFAULT, ...JSON.parse(saved) };
          setConfig(parsed);
          setDraft(parsed);
          fetchEvents(parsed);
        } catch {}
      }
      setLoaded(true);
    });
  }, [storageKey, fetchEvents]);

  // Refresh every 15 minutes while configured.
  useEffect(() => {
    if (!configured(config)) return;
    const id = setInterval(() => fetchEvents(config), 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [config, fetchEvents]);

  async function connect() {
    setConnectError("");
    if (!/^https?:\/\//.test(draft.baseUrl) || !draft.username) {
      setConnectError("Enter the server URL and username first.");
      return;
    }
    setConnecting(true);
    setAvailable([]);
    try {
      const res = await fetch("/api/caldav", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "calendars", baseUrl: draft.baseUrl, username: draft.username, password: draft.password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not list calendars.");
      const found: Calendar[] = data.calendars ?? [];
      setAvailable(found);
      if (!found.length) setConnectError("Connected, but no calendars found.");
      // Preselect previously chosen calendars that still exist.
      setDraft(d => ({
        ...d,
        calendars: d.calendars.filter(sel => found.some(f => f.url === sel.url)),
      }));
    } catch (e) {
      setConnectError(String(e instanceof Error ? e.message : e));
    } finally {
      setConnecting(false);
    }
  }

  async function handleSave() {
    if (!draft.calendars.length) {
      setConnectError("Connect and pick at least one calendar.");
      return;
    }
    setConfig(draft);
    await storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
    fetchEvents(draft);
  }

  async function handleReset() {
    await storage.removeItem(storageKey);
    setConfig(DEFAULT);
    setDraft(DEFAULT);
    setEvents([]);
    setAvailable([]);
    setSettingsOpen(false);
  }

  const today = localDate(new Date());
  const tomorrow = localDate(new Date(Date.now() + 86400000));
  const byDay = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const day = ev.start.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(ev);
    byDay.set(day, list);
  }

  const front = (
    <>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className={`flex items-center gap-1.5 ${c.label}`}>
          <span className="opacity-50"><CalendarDays size={14} /></span>
          <span className="text-xs font-medium opacity-60">Calendar</span>
        </div>
        <PencilButton c={c} onClick={() => { setDraft(config); setAvailable([]); setConnectError(""); setSettingsOpen(true); }} />
      </div>

      {!loaded ? null : !configured(config) ? (
        <EmptyState c={c} action="connect a CalDAV calendar" />
      ) : loading && !events.length ? (
        <LoadingState c={c} />
      ) : error && !events.length ? (
        <p className="text-red-400 text-xs">{error}</p>
      ) : (
        <div className="flex-1 min-h-0 relative">
          <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3 flex flex-col gap-3">
            {byDay.size === 0 ? (
              <p className={`text-xs opacity-45 ${c.text}`}>nothing scheduled in the next {config.days} days</p>
            ) : (
              [...byDay.entries()].map(([day, list]) => (
                <div key={day} className="flex flex-col gap-1">
                  <span className={`text-xs font-medium ${c.label} ${day === today ? "" : "opacity-60"}`}>
                    {dayHeading(day, today, tomorrow)}
                  </span>
                  {list.map(ev => (
                    <div key={`${ev.uid}-${ev.start}`} className="flex items-start gap-2 pl-1" title={`${ev.calendar}${ev.location ? ` · ${ev.location}` : ""}`}>
                      <span className="w-2 h-2 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: tagColor(ev.calendar).dot }} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-snug truncate ${c.text}`}>{ev.title}</p>
                        {ev.location && <p className={`text-[10px] opacity-50 truncate ${c.label}`}>{ev.location}</p>}
                      </div>
                      <span className={`shrink-0 text-xs tabular-nums opacity-50 ${c.text}`}>
                        {ev.allDay ? "all day" : ev.start.slice(11, 16)}
                      </span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
          <ScrollFades c={c} top={topFade} bottom={bottomFade} />
        </div>
      )}
    </>
  );

  const back = (
    <>
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
        <SettingsInput
          type="url"
          value={draft.baseUrl}
          onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))}
          placeholder="https://cloud.example.com/remote.php/dav"
        />
        <div className="flex gap-1">
          <SettingsInput
            type="text"
            value={draft.username}
            onChange={e => setDraft(d => ({ ...d, username: e.target.value }))}
            placeholder="Username"
            className="flex-1"
          />
          <SettingsInput
            type="password"
            value={draft.password}
            onChange={e => setDraft(d => ({ ...d, password: e.target.value }))}
            placeholder="App password"
            className="flex-1"
          />
        </div>
        <button
          onClick={connect}
          disabled={connecting}
          className="self-start flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-primary)] hover:border-[var(--surface-border-focus)] disabled:opacity-40"
        >
          {connecting ? <Loader size={12} className="animate-spin" /> : <Plug size={12} />}
          {connecting ? "connecting…" : "Connect"}
        </button>
        {available.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className={`text-xs opacity-50 ${c.label}`}>Calendars to show</p>
            {available.map(cal => {
              const on = draft.calendars.some(s => s.url === cal.url);
              return (
                <label key={cal.url} className={`flex items-center gap-2 text-xs cursor-pointer ${c.text} ${on ? "opacity-85" : "opacity-45"}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setDraft(d => ({
                        ...d,
                        calendars: on ? d.calendars.filter(s => s.url !== cal.url) : [...d.calendars, cal],
                      }))
                    }
                    className="accent-current"
                  />
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagColor(cal.name).dot }} />
                  <span className="truncate">{cal.name}</span>
                  {cal.readOnly && <span className={`text-[9px] uppercase tracking-widest opacity-50 ${c.label}`}>read-only</span>}
                </label>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className={`text-xs opacity-60 ${c.label}`}>Days ahead</span>
          {[7, 14, 30].map(n => (
            <button
              key={n}
              onClick={() => setDraft(d => ({ ...d, days: n }))}
              className={`w-8 py-1 rounded-lg text-xs font-medium transition-colors ${
                draft.days === n
                  ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--surface-border)]"
                  : `${c.text} opacity-50 hover:opacity-80`
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {connectError && <p className="text-red-400 text-xs">{connectError}</p>}
        <p className="text-[10px] text-[var(--text-muted)]">
          Works with Nextcloud, Radicale, and other CalDAV servers. For Nextcloud use an app password (Settings, Security) and the URL ending in /remote.php/dav.
        </p>
      </div>
      <SaveCancelRow
        c={c}
        onSave={handleSave}
        onCancel={() => { setSettingsOpen(false); setConnectError(""); }}
        onReset={handleReset}
        saving={loading}
      />
    </>
  );

  return <FlipCard c={c} flipped={settingsOpen} className={className} front={front} back={back} />;
}
