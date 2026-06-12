"use client";

import { useState, useEffect } from "react";
import { Timer, Plus, Play, Pause, History, Trash2, X, Check, Flame, ChevronLeft, Pencil } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { tagColor } from "@/lib/colors";
import { formatClock, formatDuration, formatDate } from "@/lib/format";
import FlipCard from "./ui/FlipCard";
import { SettingsInput } from "./ui/Field";
import { PencilButton, EmptyState, SaveCancelRow } from "./ui/WidgetChrome";

type Item = { id: string; name: string };
// All days of tracked time: date (YYYY-MM-DD, local) -> activity id -> seconds.
type Days = Record<string, Record<string, number>>;

function newId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Local-calendar day helpers. The day boundary is the user's midnight, not
// UTC's: a timer running at 23:59 belongs to the day the user experienced.
function localDateStr(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function dayStartMs(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}
function shiftDay(date: string, delta: number): string {
  const t = new Date(`${date}T12:00:00`);
  t.setDate(t.getDate() + delta);
  return localDateStr(t);
}

// Split a running segment [fromMs, toMs) into per-local-day parts, so time that
// crosses midnight is credited to the day it actually happened in.
function splitAcrossDays(fromMs: number, toMs: number): { date: string; secs: number }[] {
  const out: { date: string; secs: number }[] = [];
  let cur = fromMs;
  let guard = 0;
  while (cur < toMs && guard++ < 370) {
    const date = localDateStr(new Date(cur));
    const end = Math.min(toMs, dayStartMs(shiftDay(date, 1)));
    out.push({ date, secs: (end - cur) / 1000 });
    cur = end;
  }
  return out;
}

// Consecutive days with time on this activity, ending today (or yesterday if
// today has nothing yet, so an unbroken run keeps its count all day).
function streakFor(days: Days, id: string, today: string): number {
  let d = today;
  if (!((days[d]?.[id] ?? 0) > 0)) d = shiftDay(d, -1);
  let n = 0;
  while ((days[d]?.[id] ?? 0) > 0) {
    n++;
    d = shiftDay(d, -1);
  }
  return n;
}

const fmtDay = (date: string) => formatDate(`${date}T12:00:00`, { year: false });

// Small reusable donut for the main view and the history day tiles.
function Donut({
  rows, size, stroke, hovered, onHover, center,
}: {
  rows: { id: string; color: string; secs: number }[];
  size: number;
  stroke: number;
  hovered?: string | null;
  onHover?: (id: string | null) => void;
  center?: React.ReactNode;
}) {
  const R = 42;
  const CIRC = 2 * Math.PI * R;
  const total = rows.reduce((a, b) => a + b.secs, 0);
  let acc = 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx={50} cy={50} r={R} fill="none" strokeWidth={stroke} className="stroke-black/[0.07] dark:stroke-white/10" />
        {total > 0 && rows.filter(r => r.secs > 0).map(r => {
          const len = (r.secs / total) * CIRC;
          const seg = (
            <circle
              key={r.id}
              cx={50} cy={50} r={R}
              fill="none"
              stroke={r.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${CIRC - len}`}
              strokeDashoffset={-acc}
              style={{ cursor: onHover ? "pointer" : undefined, opacity: hovered && hovered !== r.id ? 0.4 : 1 }}
              onMouseEnter={onHover ? () => onHover(r.id) : undefined}
              onMouseLeave={onHover ? () => onHover(null) : undefined}
            />
          );
          acc += len;
          return seg;
        })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
          {center}
        </div>
      )}
    </div>
  );
}

export default function TrackerWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];

  const configKey = `tracker-config-${widget.id}`;
  const daysKey = `tracker-days-${widget.id}`;

  const [items, setItems] = useState<Item[]>([]);
  const [days, setDays] = useState<Days>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<Item[]>([]);
  const [nameInput, setNameInput] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Inline duration editing in the day detail view.
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [editH, setEditH] = useState("");
  const [editM, setEditM] = useState("");

  // `today` is a plain per-render value, so the whole view re-keys itself
  // within a second of local midnight (the tick below keeps renders coming).
  const today = localDateStr();

  useEffect(() => {
    const legacyDayKey = `tracker-day-${widget.id}-${localDateStr()}`;
    Promise.all([
      storage.getItem(configKey),
      storage.getItem(daysKey),
      storage.getItem(legacyDayKey),
    ]).then(([cfgRaw, daysRaw, legacyRaw]) => {
      try {
        if (cfgRaw) {
          const cfg = JSON.parse(cfgRaw) as { items?: Item[]; activeId?: string | null; since?: number | null };
          setItems(cfg.items ?? []);
          setDraft(cfg.items ?? []);
          setActiveId(cfg.activeId ?? null);
          setSince(cfg.since ?? null);
        }
        let stored: Days = {};
        if (daysRaw) {
          stored = (JSON.parse(daysRaw) as Days) ?? {};
        } else if (legacyRaw) {
          // Migrate the old one-key-per-day format (only today's key is reachable).
          const d = JSON.parse(legacyRaw) as { elapsed?: Record<string, number> };
          if (d.elapsed) stored[localDateStr()] = d.elapsed;
          storage.setItem(daysKey, JSON.stringify(stored));
        }
        setDays(stored);
      } catch {}
      setNow(Date.now());
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  // Tick once a second while a timer runs, advancing the live display (and the
  // local-midnight rollover, since `today` is recomputed every render).
  useEffect(() => {
    if (activeId == null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeId, since]);

  function persistConfig(nextItems: Item[], nextActive: string | null, nextSince: number | null) {
    storage.setItem(configKey, JSON.stringify({ items: nextItems, activeId: nextActive, since: nextSince }));
  }
  function persistDays(next: Days) {
    setDays(next);
    storage.setItem(daysKey, JSON.stringify(next));
  }

  // Committed days PLUS the live running segment, split across local days.
  // Everything (rows, history, chart, streaks) derives from this so a timer
  // crossing midnight is always shown and stored on the day it happened.
  function liveDays(): Days {
    if (activeId == null || since == null) return days;
    const next: Days = { ...days };
    for (const part of splitAcrossDays(since, now || Date.now())) {
      if (part.secs <= 0) continue;
      const day = { ...(next[part.date] ?? {}) };
      day[activeId] = (day[activeId] ?? 0) + part.secs;
      next[part.date] = day;
    }
    return next;
  }

  // Fold the running segment into committed storage (used on every transition).
  function commitDays(): Days {
    if (activeId == null || since == null) return days;
    const next: Days = { ...days };
    for (const part of splitAcrossDays(since, Date.now())) {
      if (part.secs <= 0) continue;
      const day = { ...(next[part.date] ?? {}) };
      day[activeId] = (day[activeId] ?? 0) + part.secs;
      next[part.date] = day;
    }
    return next;
  }

  // Click an item: pause it if it's already running, otherwise switch to it
  // (committing whatever was running first).
  function select(id: string) {
    const committed = commitDays();
    persistDays(committed);
    if (activeId === id) {
      setActiveId(null);
      setSince(null);
      persistConfig(items, null, null);
    } else {
      const s = Date.now();
      setActiveId(id);
      setSince(s);
      persistConfig(items, id, s);
    }
  }

  function resetTimes() {
    const next = { ...days, [today]: {} };
    const s = activeId ? Date.now() : null;
    setSince(s);
    persistDays(next);
    persistConfig(items, activeId, s);
  }

  function addItem() {
    const name = nameInput.trim();
    if (!name) return;
    setDraft(d => [...d, { id: newId(), name }]);
    setNameInput("");
  }

  function handleSave() {
    const validIds = new Set(draft.map(i => i.id));
    // Drop removed items from today only; past days keep their data (kept by id
    // so history and stats survive renames/removals).
    const todayMap = Object.fromEntries(Object.entries(days[today] ?? {}).filter(([k]) => validIds.has(k)));
    let nextActive = activeId;
    let nextSince = since;
    if (activeId && !validIds.has(activeId)) { nextActive = null; nextSince = null; }
    setItems(draft);
    setActiveId(nextActive);
    setSince(nextSince);
    persistConfig(draft, nextActive, nextSince);
    persistDays({ ...days, [today]: todayMap });
    setSettingsOpen(false);
  }

  function deleteDay(date: string) {
    const next = { ...days };
    delete next[date];
    persistDays(next);
    if (date === today && activeId) {
      const s = Date.now();
      setSince(s);
      persistConfig(items, activeId, s);
    }
    setDetailDate(null);
  }

  // Set an activity's recorded time for a day to an exact value ("I forgot to
  // stop the timer"). Editing the running activity pauses it first, so the
  // stored value is exactly what was typed.
  function saveRowEdit(date: string, id: string) {
    const secs = Math.max(0, (parseInt(editH) || 0) * 3600 + (parseInt(editM) || 0) * 60);
    let base = days;
    if (id === activeId) {
      base = commitDays();
      setActiveId(null);
      setSince(null);
      persistConfig(items, null, null);
    }
    const day = { ...(base[date] ?? {}) };
    if (secs > 0) day[id] = secs;
    else delete day[id];
    persistDays({ ...base, [date]: day });
    setEditRowId(null);
  }

  const itemName = new Map(items.map(it => [it.id, it.name]));
  const colorOf = (id: string) => tagColor(id).dot;

  const live = liveDays();
  const todayMap = live[today] ?? {};

  // Live per-item seconds, most-tracked first (reorders live while running).
  const rows = items.map(it => ({
    ...it,
    color: colorOf(it.id),
    secs: todayMap[it.id] ?? 0,
    streak: streakFor(live, it.id, today),
  }));
  const total = rows.reduce((a, b) => a + b.secs, 0);
  const sortedRows = [...rows].sort((a, b) => b.secs - a.secs);

  const hoveredRow = hovered != null ? rows.find(r => r.id === hovered) : undefined;
  const hoveredPct = hoveredRow && total > 0 ? Math.round((hoveredRow.secs / total) * 100) : 0;

  // ── History/insights derived data ────────────────────────────────────────
  function dayRows(date: string) {
    return Object.entries(live[date] ?? {})
      .filter(([, s]) => s > 0)
      .map(([id, secs]) => ({
        id,
        secs,
        name: itemName.get(id) ?? "(removed)",
        color: itemName.has(id) ? colorOf(id) : "#9ca3af",
      }))
      .sort((a, b) => b.secs - a.secs);
  }

  const historyDates = Object.keys(live)
    .filter(d => Object.values(live[d]).some(v => v > 0))
    .sort((a, b) => b.localeCompare(a));

  // 14-day chart: one line per activity (top 6 by time in the window).
  const CHART_DAYS = 14;
  const chartDates = Array.from({ length: CHART_DAYS }, (_, i) => shiftDay(today, i - (CHART_DAYS - 1)));
  const windowTotals = new Map<string, number>();
  for (const d of chartDates) {
    for (const [id, secs] of Object.entries(live[d] ?? {})) {
      windowTotals.set(id, (windowTotals.get(id) ?? 0) + secs);
    }
  }
  const chartSeries = [...windowTotals.entries()]
    .filter(([, secs]) => secs > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => ({
      id,
      name: itemName.get(id) ?? "(removed)",
      color: itemName.has(id) ? colorOf(id) : "#9ca3af",
      values: chartDates.map(d => live[d]?.[id] ?? 0),
    }));
  const chartMax = Math.max(1, ...chartSeries.flatMap(s => s.values));

  // Week-over-week: last 7 days vs the 7 before.
  const sumRange = (from: number, to: number) =>
    chartDates.slice(from, to).reduce((a, d) => a + Object.values(live[d] ?? {}).reduce((x, y) => x + y, 0), 0);
  const thisWeek = sumRange(7, 14);
  const lastWeek = sumRange(0, 7);
  const weekDelta = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;

  const bestStreaks = rows.filter(r => r.streak >= 2).sort((a, b) => b.streak - a.streak).slice(0, 3);

  const headerIconCls = `opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`;

  const front = (
    <>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className={`flex items-center gap-1.5 ${c.label}`}>
          <span className="opacity-50"><Timer size={14} /></span>
          <span className="text-xs font-medium opacity-60">Tracker</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setDetailDate(null); setHistoryOpen(true); }} title="History and insights" className={headerIconCls}>
            <History size={14} />
          </button>
          <PencilButton c={c} onClick={() => { setDraft(items); setSettingsOpen(true); }} title="Edit activities" />
        </div>
      </div>

      {!loaded ? null : items.length === 0 ? (
        <EmptyState c={c} action="add activities" />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="shrink-0 flex justify-center">
            <Donut
              rows={sortedRows}
              size={112}
              stroke={14}
              hovered={hovered}
              onHover={setHovered}
              center={hoveredRow ? (
                <>
                  <span className={`text-sm font-semibold tabular-nums ${c.text}`}>{hoveredPct}%</span>
                  <span className={`text-[10px] leading-tight line-clamp-2 ${c.label} opacity-60`}>{hoveredRow.name}</span>
                </>
              ) : (
                <>
                  <span className={`text-sm font-semibold tabular-nums ${c.text}`}>{formatClock(total)}</span>
                  <span className={`text-[10px] uppercase tracking-widest opacity-40 ${c.label}`}>total</span>
                </>
              )}
            />
          </div>

          <ul className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-1">
            {sortedRows.map(r => {
              const isActive = r.id === activeId;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => select(r.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                      isActive ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                    <span className={`flex-1 min-w-0 truncate text-sm ${c.text}`}>{r.name}</span>
                    {r.streak >= 2 && (
                      <span className={`flex items-center gap-0.5 text-[10px] tabular-nums shrink-0 ${c.label} opacity-60`} title={`${r.streak}-day streak`}>
                        <Flame size={10} />{r.streak}
                      </span>
                    )}
                    <span className={`text-xs tabular-nums ${isActive ? c.label : `opacity-50 ${c.text}`}`}>{formatClock(r.secs)}</span>
                    <span className={isActive ? c.label : `opacity-30 ${c.label}`}>
                      {isActive ? <Pause size={14} /> : <Play size={14} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );

  const back = (
    <>
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
        <div className="flex gap-1">
          <SettingsInput
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addItem()}
            placeholder="Activity name"
            className="flex-1"
          />
          <button
            onClick={addItem}
            className="px-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Plus size={14} />
          </button>
        </div>
        {draft.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {draft.map(it => (
              <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-black/5 dark:bg-white/10">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(it.id) }} />
                <input
                  value={it.name}
                  onChange={e => setDraft(d => d.map(x => x.id === it.id ? { ...x, name: e.target.value } : x))}
                  className={`flex-1 min-w-0 bg-transparent dark:!bg-transparent text-sm outline-none ${c.text}`}
                />
                <button
                  onClick={() => setDraft(d => d.filter(x => x.id !== it.id))}
                  className={`opacity-50 hover:opacity-100 leading-none ${c.label}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <SaveCancelRow
        c={c}
        onSave={handleSave}
        onCancel={() => { setDraft(items); setSettingsOpen(false); }}
        onReset={resetTimes}
      />
    </>
  );

  return (
    <div className="relative h-full">
      <FlipCard c={c} flipped={settingsOpen} className={className} front={front} back={back} />

      {/* History overlay: insights + a grid of day donuts; tap a day to drill in */}
      {historyOpen && (
        <div className={`absolute inset-0 z-40 p-5 flex flex-col rounded-2xl border ${c.bg} ${c.border}`}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 ${c.label}`}>
              {detailDate ? (
                <button onClick={() => { setDetailDate(null); setEditRowId(null); }} title="Back to history" className="opacity-60 hover:opacity-100 flex items-center gap-1">
                  <ChevronLeft size={14} />
                  <span className="text-xs font-medium">{fmtDay(detailDate)}{detailDate === today && " · today"}</span>
                </button>
              ) : (
                <>
                  <span className="opacity-50"><History size={14} /></span>
                  <span className="text-xs font-medium opacity-60">History</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {detailDate && (
                <button onClick={() => deleteDay(detailDate)} title="Delete day" className={`opacity-40 hover:opacity-100 hover:text-red-500 ${c.label}`}>
                  <Trash2 size={14} />
                </button>
              )}
              <button onClick={() => { setHistoryOpen(false); setDetailDate(null); setEditRowId(null); }} className={`opacity-50 hover:opacity-90 ${c.label}`} title="Close">
                <X size={14} />
              </button>
            </div>
          </div>

          {detailDate ? (
            /* Day detail: breakdown + per-activity time editing */
            <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-3">
              <div className="shrink-0 flex justify-center">
                <Donut
                  rows={dayRows(detailDate)}
                  size={96}
                  stroke={14}
                  center={
                    <>
                      <span className={`text-xs font-semibold tabular-nums ${c.text}`}>
                        {formatDuration(dayRows(detailDate).reduce((a, b) => a + b.secs, 0))}
                      </span>
                      <span className={`text-[9px] uppercase tracking-widest opacity-40 ${c.label}`}>total</span>
                    </>
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                {/* Every current activity is editable (even at 0, to backfill a
                    forgotten day); removed activities appear if they have time. */}
                {[...items.map(it => ({
                  id: it.id,
                  name: it.name,
                  color: colorOf(it.id),
                  secs: live[detailDate]?.[it.id] ?? 0,
                })), ...dayRows(detailDate).filter(r => !itemName.has(r.id))].map(r => {
                  const editing = editRowId === r.id;
                  return (
                    <div key={r.id} className="group/row flex items-center gap-2 px-1 py-1 rounded-lg">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      <span className={`flex-1 min-w-0 truncate text-xs opacity-80 ${c.text}`}>{r.name}</span>
                      {editing ? (
                        <span className="flex items-center gap-1">
                          <input
                            autoFocus
                            inputMode="numeric"
                            value={editH}
                            onChange={e => setEditH(e.target.value.replace(/\D/g, ""))}
                            className={`w-9 text-xs text-right tabular-nums border border-[var(--surface-border)] rounded-lg px-1.5 py-1 outline-none bg-[var(--surface)] ${c.text}`}
                          />
                          <span className={`text-[10px] opacity-50 ${c.label}`}>h</span>
                          <input
                            inputMode="numeric"
                            value={editM}
                            onChange={e => setEditM(e.target.value.replace(/\D/g, ""))}
                            onKeyDown={e => { if (e.key === "Enter") saveRowEdit(detailDate, r.id); if (e.key === "Escape") setEditRowId(null); }}
                            className={`w-9 text-xs text-right tabular-nums border border-[var(--surface-border)] rounded-lg px-1.5 py-1 outline-none bg-[var(--surface)] ${c.text}`}
                          />
                          <span className={`text-[10px] opacity-50 ${c.label}`}>m</span>
                          <button onClick={() => setEditRowId(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-1"><X size={12} /></button>
                          <button onClick={() => saveRowEdit(detailDate, r.id)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><Check size={12} /></button>
                        </span>
                      ) : (
                        <>
                          <span className={`text-xs tabular-nums opacity-50 ${c.text}`}>{formatDuration(r.secs, { seconds: false })}</span>
                          <button
                            onClick={() => {
                              setEditRowId(r.id);
                              setEditH(String(Math.floor(r.secs / 3600)));
                              setEditM(String(Math.floor((r.secs % 3600) / 60)));
                            }}
                            title="Edit time"
                            className={`opacity-0 group-hover/row:opacity-50 hover:!opacity-90 ${c.icon}`}
                          >
                            <Pencil size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Insights + day grid */
            <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-4">
              {historyDates.length === 0 ? (
                <EmptyState c={c}>no history yet</EmptyState>
              ) : (
                <>
                  {/* 14-day chart, one line per activity */}
                  {chartSeries.length > 0 && (
                    <div className="shrink-0">
                      <svg viewBox="0 0 240 72" className="w-full" preserveAspectRatio="none">
                        {chartSeries.map(s => (
                          <polyline
                            key={s.id}
                            fill="none"
                            stroke={s.color}
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            points={s.values.map((v, i) => `${(i / (CHART_DAYS - 1)) * 236 + 2},${68 - (v / chartMax) * 60}`).join(" ")}
                          />
                        ))}
                      </svg>
                      <div className={`flex justify-between text-[9px] opacity-40 ${c.label}`}>
                        <span>{fmtDay(chartDates[0])}</span>
                        <span>{fmtDay(today)}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                        {chartSeries.map(s => (
                          <span key={s.id} className={`flex items-center gap-1 text-[10px] opacity-70 ${c.text}`}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Minimal insights */}
                  <div className={`shrink-0 flex flex-col gap-1 text-[11px] ${c.text} opacity-75`}>
                    <span>
                      last 7 days: <span className="tabular-nums font-medium">{formatDuration(thisWeek)}</span>
                      {weekDelta !== null && (
                        <span className={weekDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}>
                          {" "}{weekDelta >= 0 ? "+" : ""}{weekDelta}% vs prior
                        </span>
                      )}
                    </span>
                    {bestStreaks.length > 0 && (
                      <span className="flex items-center gap-2 flex-wrap">
                        {bestStreaks.map(r => (
                          <span key={r.id} className="flex items-center gap-0.5">
                            <Flame size={10} className={c.label} />
                            <span className="tabular-nums">{r.streak}d</span>
                            <span className="opacity-60">{r.name}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </div>

                  {/* Day grid: a mini donut per day, tap to drill in */}
                  <div className="grid grid-cols-3 gap-2">
                    {historyDates.map(date => {
                      const rows = dayRows(date);
                      const dayTotal = rows.reduce((a, b) => a + b.secs, 0);
                      return (
                        <button
                          key={date}
                          onClick={() => { setDetailDate(date); setEditRowId(null); }}
                          className="flex flex-col items-center gap-1 p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                          title={`${fmtDay(date)}: ${formatDuration(dayTotal)}`}
                        >
                          <Donut rows={rows} size={48} stroke={16} />
                          <span className={`text-[9px] leading-none ${c.label} ${date === today ? "font-semibold" : "opacity-60"}`}>{fmtDay(date)}</span>
                          <span className={`text-[9px] leading-none tabular-nums opacity-45 ${c.text}`}>{formatDuration(dayTotal)}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
