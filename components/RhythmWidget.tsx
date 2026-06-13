"use client";

import { useEffect, useState } from "react";
import { Activity, Plus, Minus, Play, Square, History, Trash2, X, Flame, ChevronLeft } from "lucide-react";
import { colorMap, type Widget, type ColorClasses } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { tagColor } from "@/lib/colors";
import { formatClock, formatDuration, formatDate } from "@/lib/format";
import FlipCard from "./ui/FlipCard";
import { SettingsInput } from "./ui/Field";
import { PencilButton, EmptyState, SaveCancelRow } from "./ui/WidgetChrome";

// Rhythm is Tracker's sibling. Tracker answers "how long?" with a live
// stopwatch; Rhythm answers "when, and how often?" — each tap stamps a moment,
// and the insights read the pattern of those stamps (frequency, recency, and
// time-of-day clustering). Items are either single-tap "moments" (brushed
// teeth, took a vitamin) or paired "sessions" (slept -> woke), and each is a
// "build" habit you want frequent or a "reduce" one you want rare, which flips
// what the card emphasizes.

type Kind = "moment" | "session";
type Mode = "build" | "reduce";
type Item = { id: string; name: string; kind: Kind; mode: Mode; target?: number };

// Logged data, kept apart from config so a settings save never risks the
// history. Moments are tap timestamps; sessions are [start, end] pairs (epoch
// ms). Both are keyed by item id.
type Log = {
  events: Record<string, number[]>;
  sessions: Record<string, [number, number][]>;
};

function newId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Local-calendar day helpers — the day boundary is the user's midnight, matching
// Tracker, so a late-night tap belongs to the day they experienced.
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

const DAY_MS = 86400000;

function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

// Circular mean of times-of-day (minutes), so a cluster straddling midnight
// (23:50, 00:10) averages to midnight rather than noon. `spread` is the
// circular standard deviation in minutes — small spread = a consistent routine.
function circadianStats(mins: number[]): { mean: number; spread: number } | null {
  if (!mins.length) return null;
  let sx = 0, sy = 0;
  for (const m of mins) {
    const a = (m / 1440) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const n = mins.length;
  const mx = sx / n, my = sy / n;
  let mean = Math.atan2(my, mx);
  if (mean < 0) mean += 2 * Math.PI;
  const R = Math.sqrt(mx * mx + my * my);
  const sdRad = R > 1e-9 ? Math.sqrt(-2 * Math.log(R)) : Math.PI;
  return {
    mean: (mean / (2 * Math.PI)) * 1440,
    spread: Math.min(720, (sdRad / (2 * Math.PI)) * 1440),
  };
}

function fmtTimeOfDay(min: number): string {
  const total = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Compact "time since" with no unit word ("3h", "12m", "just now").
function sinceShort(deltaMs: number): string {
  const m = Math.floor(deltaMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return `${Math.floor(d / 30)}mo`;
}

// "3h ago", "2d ago", but just "just now" on its own (no trailing "ago").
function agoLabel(deltaMs: number): string {
  const s = sinceShort(deltaMs);
  return s === "just now" ? s : `${s} ago`;
}

// Average interval between successive moments, as "~13h", "~45m", "~2.1d".
function fmtGap(ms: number): string {
  const h = ms / 3600000;
  if (h < 1) return `~${Math.max(1, Math.round(ms / 60000))}m`;
  if (h < 48) return `~${Math.round(h)}h`;
  return `~${(h / 24).toFixed(1)}d`;
}

const STATS_DAYS = 30; // window for frequency and rhythm
const GRID_DAYS = 14;  // day heatmap width

const fmtDay = (date: string) => formatDate(`${date}T12:00:00`, { year: false });
const colorOf = (id: string) => tagColor(id).dot;

// ── Rhythm dial: a 24h clock with a tick per logged time-of-day ──────────────
// Midnight is at the top, time runs clockwise. Each group (e.g. bedtimes vs
// wake times) gets its own color, with a hand at its circular mean.
function RhythmDial({
  groups, size,
}: {
  groups: { color: string; mins: number[] }[];
  size: number;
}) {
  const ang = (min: number) => ((min / 1440) * 2 * Math.PI) - Math.PI / 2;
  const pt = (min: number, r: number): [number, number] => {
    const a = ang(min);
    return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];
  };
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0">
      <circle cx={50} cy={50} r={46} fill="none" className="stroke-black/[0.07] dark:stroke-white/10" strokeWidth={2} />
      {[0, 6, 12, 18].map(hr => {
        const [x1, y1] = pt(hr * 60, 42);
        const [x2, y2] = pt(hr * 60, 46);
        return <line key={hr} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-black/15 dark:stroke-white/20" strokeWidth={2} />;
      })}
      {groups.map((g, gi) => {
        const stat = circadianStats(g.mins);
        return (
          <g key={gi}>
            {g.mins.map((m, i) => {
              const [x1, y1] = pt(m, 36);
              const [x2, y2] = pt(m, 45);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={g.color} strokeWidth={1.5} strokeLinecap="round" opacity={0.55} />;
            })}
            {stat && (() => {
              const [hx, hy] = pt(stat.mean, 30);
              return <line x1={50} y1={50} x2={hx} y2={hy} stroke={g.color} strokeWidth={2.5} strokeLinecap="round" />;
            })()}
          </g>
        );
      })}
      <circle cx={50} cy={50} r={2.5} className="fill-black/30 dark:fill-white/40" />
    </svg>
  );
}

// Tiny segmented control for the per-item settings (kind, mode).
function Seg<T extends string>({
  c, value, onChange, options,
}: {
  c: ColorClasses;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-[var(--surface-border)]">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-1 text-[10px] transition-colors ${
            value === o.value ? `bg-black/10 dark:bg-white/15 ${c.text}` : `${c.label} opacity-55 hover:opacity-90`
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function RhythmWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];

  const configKey = `rhythm-config-${widget.id}`;
  const logKey = `rhythm-log-${widget.id}`;

  const [items, setItems] = useState<Item[]>([]);
  const [log, setLog] = useState<Log>({ events: {}, sessions: {} });
  const [open, setOpen] = useState<Record<string, number>>({});
  const [now, setNow] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<Item[]>([]);
  const [nameInput, setNameInput] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailDate, setDetailDate] = useState<string | null>(null);

  const today = localDateStr();

  useEffect(() => {
    Promise.all([storage.getItem(configKey), storage.getItem(logKey)]).then(([cfgRaw, logRaw]) => {
      try {
        if (cfgRaw) {
          const cfg = JSON.parse(cfgRaw) as { items?: Item[]; open?: Record<string, number> };
          const its = (cfg.items ?? []).map(i => ({ ...i, kind: i.kind ?? "moment", mode: i.mode ?? "build" }));
          setItems(its);
          setDraft(its);
          setOpen(cfg.open ?? {});
        }
        if (logRaw) {
          const parsed = JSON.parse(logRaw) as Partial<Log>;
          setLog({ events: parsed.events ?? {}, sessions: parsed.sessions ?? {} });
        }
      } catch {}
      setNow(Date.now());
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  // Tick fast while a session runs (live elapsed clock), slowly otherwise (keeps
  // "time since" and the today strip fresh, and rolls over at local midnight).
  useEffect(() => {
    const anyOpen = Object.keys(open).length > 0;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), anyOpen ? 1000 : 30000);
    return () => clearInterval(t);
  }, [open]);

  function persistConfig(nextItems: Item[], nextOpen: Record<string, number>) {
    storage.setItem(configKey, JSON.stringify({ items: nextItems, open: nextOpen }));
  }
  function persistLog(next: Log) {
    setLog(next);
    storage.setItem(logKey, JSON.stringify(next));
  }

  // ── Logging ────────────────────────────────────────────────────────────────
  function logMoment(id: string) {
    const t = Date.now();
    const events = { ...log.events, [id]: [...(log.events[id] ?? []), t].sort((a, b) => a - b) };
    persistLog({ ...log, events });
  }

  // Drop the most recent tap (events stay sorted, so it is the last element) —
  // the quick correction for an accidental tap.
  function removeLastMoment(id: string) {
    const list = log.events[id] ?? [];
    if (!list.length) return;
    persistLog({ ...log, events: { ...log.events, [id]: list.slice(0, -1) } });
  }

  function toggleSession(id: string) {
    if (open[id]) {
      const start = open[id];
      const end = Date.now();
      const nextOpen = { ...open };
      delete nextOpen[id];
      setOpen(nextOpen);
      persistConfig(items, nextOpen);
      if (end > start) {
        const pairs: [number, number][] = [...(log.sessions[id] ?? []), [start, end] as [number, number]].sort((a, b) => a[0] - b[0]);
        persistLog({ ...log, sessions: { ...log.sessions, [id]: pairs } });
      }
    } else {
      const nextOpen = { ...open, [id]: Date.now() };
      setOpen(nextOpen);
      persistConfig(items, nextOpen);
    }
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  function addItem() {
    const name = nameInput.trim();
    if (!name) return;
    setDraft(d => [...d, { id: newId(), name, kind: "moment", mode: "build" }]);
    setNameInput("");
  }

  function handleSave() {
    const validIds = new Set(draft.map(i => i.id));
    // Removing an item drops its log data — without the item the stamps are
    // meaningless (unlike Tracker, there is no "(removed)" ghost to show).
    const events = Object.fromEntries(Object.entries(log.events).filter(([k]) => validIds.has(k)));
    const sessions = Object.fromEntries(Object.entries(log.sessions).filter(([k]) => validIds.has(k)));
    const nextOpen = Object.fromEntries(Object.entries(open).filter(([k]) => validIds.has(k)));
    setItems(draft);
    setOpen(nextOpen);
    persistConfig(draft, nextOpen);
    persistLog({ events, sessions });
    setSettingsOpen(false);
  }

  function deleteEvent(id: string, kind: Kind, idx: number) {
    if (kind === "session") {
      const list = [...(log.sessions[id] ?? [])];
      list.splice(idx, 1);
      persistLog({ ...log, sessions: { ...log.sessions, [id]: list } });
    } else {
      const list = [...(log.events[id] ?? [])];
      list.splice(idx, 1);
      persistLog({ ...log, events: { ...log.events, [id]: list } });
    }
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  const itemName = new Map(items.map(it => [it.id, it.name]));

  // Count for one item on one local day (sessions counted on their start day,
  // plus an open session if it began that day).
  function dayCount(item: Item, date: string): number {
    const ds = dayStartMs(date);
    const de = ds + DAY_MS;
    if (item.kind === "session") {
      let n = (log.sessions[item.id] ?? []).filter(([s]) => s >= ds && s < de).length;
      if (open[item.id] && open[item.id] >= ds && open[item.id] < de) n++;
      return n;
    }
    return (log.events[item.id] ?? []).filter(t => t >= ds && t < de).length;
  }

  function metGoal(item: Item, count: number): boolean {
    if (item.mode === "reduce") return item.target != null ? count <= item.target : count === 0;
    return count >= (item.target || 1);
  }

  function firstMs(item: Item): number | null {
    const evs = log.events[item.id] ?? [];
    const sess = log.sessions[item.id] ?? [];
    const candidates = [...evs, ...sess.map(s => s[0]), ...(open[item.id] ? [open[item.id]] : [])];
    return candidates.length ? Math.min(...candidates) : null;
  }

  function streakFor(item: Item): number {
    // Build streaks break on any below-target day; reduce-with-target streaks
    // count consecutive "stayed under" days. Reduce-without-target has no
    // streak (its headline is time-since-last instead).
    if (item.mode === "reduce" && item.target == null) return 0;
    const met = (date: string) => metGoal(item, dayCount(item, date));
    let d = today;
    if (item.mode === "build" && !met(today)) d = shiftDay(today, -1);
    let n = 0, guard = 0;
    while (met(d) && guard++ < 370) {
      n++;
      d = shiftDay(d, -1);
    }
    // A clean run can't predate the item's first activity (else an empty past
    // would read as an endless reduce streak).
    const first = firstMs(item);
    if (item.mode === "reduce" && first != null) {
      const maxDays = Math.floor((dayStartMs(today) - dayStartMs(localDateStr(new Date(first)))) / DAY_MS) + 1;
      n = Math.min(n, maxDays);
    }
    return n;
  }

  function lastMs(item: Item): number | null {
    if (item.kind === "session") {
      const sess = log.sessions[item.id] ?? [];
      const ends = sess.map(s => s[1]);
      return ends.length ? Math.max(...ends) : null;
    }
    const evs = log.events[item.id] ?? [];
    return evs.length ? evs[evs.length - 1] : null;
  }

  // Frequency over the stats window: moments per day, and average gap.
  function freqStats(item: Item): { perDay: number; gap: number | null } {
    const windowStart = dayStartMs(shiftDay(today, -(STATS_DAYS - 1)));
    const ts = (item.kind === "session"
      ? (log.sessions[item.id] ?? []).map(s => s[0])
      : (log.events[item.id] ?? [])
    ).filter(t => t >= windowStart).sort((a, b) => a - b);
    const last7 = ts.filter(t => t >= dayStartMs(shiftDay(today, -6))).length;
    let gap: number | null = null;
    if (ts.length >= 2) {
      let sum = 0;
      for (let i = 1; i < ts.length; i++) sum += ts[i] - ts[i - 1];
      gap = sum / (ts.length - 1);
    }
    return { perDay: last7 / 7, gap };
  }

  // ── Front ────────────────────────────────────────────────────────────────
  const dayStart = dayStartMs(today);
  const dayEnd = dayStart + DAY_MS;
  const todayTicks: { frac: number; color: string; label: string }[] = [];
  for (const it of items) {
    const col = colorOf(it.id);
    if (it.kind === "session") {
      for (const [s, e] of log.sessions[it.id] ?? []) {
        if (s >= dayStart && s < dayEnd) todayTicks.push({ frac: (s - dayStart) / DAY_MS, color: col, label: `${it.name} start` });
        if (e >= dayStart && e < dayEnd) todayTicks.push({ frac: (e - dayStart) / DAY_MS, color: col, label: `${it.name} end` });
      }
      if (open[it.id] && open[it.id] >= dayStart) todayTicks.push({ frac: (open[it.id] - dayStart) / DAY_MS, color: col, label: `${it.name} start` });
    } else {
      for (const t of log.events[it.id] ?? []) {
        if (t >= dayStart && t < dayEnd) todayTicks.push({ frac: (t - dayStart) / DAY_MS, color: col, label: it.name });
      }
    }
  }
  const nowFrac = Math.min(1, Math.max(0, (now - dayStart) / DAY_MS));

  const headerIconCls = `opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`;

  const front = (
    <>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className={`flex items-center gap-1.5 ${c.label}`}>
          <span className="opacity-50"><Activity size={14} /></span>
          <span className="text-xs font-medium opacity-60">Rhythm</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setDetailDate(null); setHistoryOpen(true); }} title="History and insights" className={headerIconCls}>
            <History size={14} />
          </button>
          <PencilButton c={c} onClick={() => { setDraft(items); setSettingsOpen(true); }} title="Edit items" />
        </div>
      </div>

      {!loaded ? null : items.length === 0 ? (
        <EmptyState c={c} action="add things to log" />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* Today strip: midnight to midnight, a tick per logged moment */}
          <div className="shrink-0">
            <svg viewBox="0 0 240 18" className="w-full" preserveAspectRatio="none" height={14}>
              <line x1={2} y1={9} x2={238} y2={9} className="stroke-black/[0.08] dark:stroke-white/10" strokeWidth={1} />
              <line x1={2 + nowFrac * 236} y1={2} x2={2 + nowFrac * 236} y2={16} className="stroke-black/20 dark:stroke-white/25" strokeWidth={1} />
              {todayTicks.map((t, i) => (
                <line key={i} x1={2 + t.frac * 236} y1={3} x2={2 + t.frac * 236} y2={15} stroke={t.color} strokeWidth={2} strokeLinecap="round">
                  <title>{`${t.label} · ${fmtTimeOfDay(t.frac * 1440)}`}</title>
                </line>
              ))}
            </svg>
            <div className={`flex justify-between text-[8px] opacity-35 ${c.label} -mt-0.5`}>
              <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>
            </div>
          </div>

          <ul className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-1">
            {items.map(it => {
              const isSession = it.kind === "session";
              const isOpen = !!open[it.id];
              const count = dayCount(it, today);
              const last = lastMs(it);
              const streak = streakFor(it);
              const dot = colorOf(it.id);

              const sess = log.sessions[it.id] ?? [];
              const lastDur = sess.length ? (sess[sess.length - 1][1] - sess[sess.length - 1][0]) / 1000 : 0;
              const bed = circadianStats(sess.map(s => minutesOfDay(s[0])));
              const wake = circadianStats(sess.map(s => minutesOfDay(s[1])));

              // Secondary (under-name) and primary (right) lines depend on type.
              let secondary: React.ReactNode;
              let primary: React.ReactNode;
              if (isSession) {
                secondary = isOpen
                  ? <span>started {agoLabel(now - open[it.id])}</span>
                  : (bed && wake)
                    ? <span className="tabular-nums">{fmtTimeOfDay(bed.mean)} → {fmtTimeOfDay(wake.mean)}</span>
                    : <span>tap to start</span>;
                primary = isOpen
                  ? <span className={`text-xs tabular-nums font-medium ${c.label}`}>{formatClock((now - open[it.id]) / 1000)}</span>
                  : lastDur > 0
                    ? <span className={`text-xs tabular-nums opacity-60 ${c.text}`}>{formatDuration(lastDur)}</span>
                    : <span className={`text-xs opacity-30 ${c.text}`}>—</span>;
              } else if (it.mode === "reduce") {
                const limitHit = it.target != null && count > it.target;
                secondary = (
                  <span className={limitHit ? "text-red-500 dark:text-red-400" : ""}>
                    {count} today{it.target != null ? ` / ${it.target} max` : ""}
                  </span>
                );
                primary = last != null
                  ? <span className={`text-xs tabular-nums font-medium ${c.text}`}>{agoLabel(now - last)}</span>
                  : <span className={`text-xs opacity-30 ${c.text}`}>none yet</span>;
              } else {
                const met = metGoal(it, count);
                secondary = last != null ? <span>{agoLabel(now - last)}</span> : <span>tap to log</span>;
                primary = (
                  <span className={`text-xs tabular-nums font-medium ${met && (it.target != null || count > 0) ? "text-emerald-600 dark:text-emerald-400" : c.text}`}>
                    {count}{it.target != null ? `/${it.target}` : ""}
                  </span>
                );
              }

              return (
                <li key={it.id}>
                  <div
                    className={`group/r flex items-center rounded-lg transition-colors ${
                      isOpen ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    <button
                      onClick={() => (isSession ? toggleSession(it.id) : logMoment(it.id))}
                      className="flex-1 min-w-0 flex items-center gap-2 pl-2 py-1.5 text-left"
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dot }} />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className={`truncate text-sm ${c.text}`}>{it.name}</span>
                          {streak >= 2 && (
                            <span className={`flex items-center gap-0.5 text-[10px] tabular-nums shrink-0 ${c.label} opacity-60`} title={`${streak}-day ${it.mode === "reduce" ? "clean " : ""}streak`}>
                              <Flame size={10} />{streak}
                            </span>
                          )}
                        </span>
                        <span className={`block text-[10px] leading-tight ${c.label} opacity-55 truncate`}>{secondary}</span>
                      </span>
                      {primary}
                    </button>
                    {/* Stepper: minus removes the last tap, the action adds one
                        (sessions start/stop instead). */}
                    {!isSession && (
                      <button
                        onClick={() => removeLastMoment(it.id)}
                        disabled={count === 0}
                        title="Remove last entry"
                        className={`shrink-0 px-1.5 py-1.5 ${c.label} opacity-40 hover:!opacity-90 disabled:opacity-0 disabled:pointer-events-none`}
                      >
                        <Minus size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => (isSession ? toggleSession(it.id) : logMoment(it.id))}
                      title={isSession ? (isOpen ? "Stop" : "Start") : "Add one"}
                      className={`shrink-0 pr-2 pl-0.5 py-1.5 ${isOpen ? c.label : `opacity-40 hover:opacity-90 ${c.label}`}`}
                    >
                      {isSession ? (isOpen ? <Square size={13} /> : <Play size={13} />) : <Plus size={14} />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );

  // ── Settings (back) ────────────────────────────────────────────────────────
  const back = (
    <>
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
        <div className="flex gap-1">
          <SettingsInput
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addItem()}
            placeholder="e.g. brushed teeth, slept"
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
          <div className="flex flex-col gap-2">
            {draft.map(it => (
              <div key={it.id} className="flex flex-col gap-2 px-2 py-2 rounded-lg bg-black/5 dark:bg-white/10">
                <div className="flex items-center gap-2">
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <Seg
                    c={c}
                    value={it.kind}
                    onChange={v => setDraft(d => d.map(x => x.id === it.id ? { ...x, kind: v } : x))}
                    options={[{ value: "moment", label: "Moment" }, { value: "session", label: "Session" }]}
                  />
                  <Seg
                    c={c}
                    value={it.mode}
                    onChange={v => setDraft(d => d.map(x => x.id === it.id ? { ...x, mode: v } : x))}
                    options={[{ value: "build", label: "Build" }, { value: "reduce", label: "Reduce" }]}
                  />
                  {it.kind === "moment" && (
                    <label className={`flex items-center gap-1 text-[10px] ${c.label} opacity-70`} title={it.mode === "reduce" ? "Daily limit (optional)" : "Daily target (optional)"}>
                      <input
                        inputMode="numeric"
                        value={it.target ?? ""}
                        onChange={e => {
                          const v = e.target.value.replace(/\D/g, "");
                          setDraft(d => d.map(x => x.id === it.id ? { ...x, target: v ? parseInt(v) : undefined } : x));
                        }}
                        placeholder="–"
                        className={`w-9 text-center tabular-nums border border-[var(--surface-border)] rounded-lg px-1 py-1 outline-none bg-[var(--surface)] ${c.text}`}
                      />
                      <span>{it.mode === "reduce" ? "max/day" : "× /day"}</span>
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {draft.length === 0 && (
          <p className={`text-[11px] leading-relaxed opacity-55 ${c.text}`}>
            Add things you want to track by tapping: <b>moments</b> like brushing teeth or coffee, or <b>sessions</b> like sleep that you start and stop. Mark each <b>build</b> (do it more) or <b>reduce</b> (do it less), and set an optional daily target.
          </p>
        )}
      </div>
      <SaveCancelRow c={c} onSave={handleSave} onCancel={() => { setDraft(items); setSettingsOpen(false); }} />
    </>
  );

  // ── History overlay data ─────────────────────────────────────────────────
  const gridDates = Array.from({ length: GRID_DAYS }, (_, i) => shiftDay(today, i - (GRID_DAYS - 1)));

  // Events on a given day for the detail view, newest first, with their index
  // into the stored array so they can be deleted.
  function dayDetailRows(date: string) {
    const ds = dayStartMs(date);
    const de = ds + DAY_MS;
    const out: { id: string; kind: Kind; idx: number; name: string; color: string; at: number; dur?: number }[] = [];
    for (const it of items) {
      const col = colorOf(it.id);
      if (it.kind === "session") {
        (log.sessions[it.id] ?? []).forEach(([s, e], idx) => {
          if (s >= ds && s < de) out.push({ id: it.id, kind: "session", idx, name: it.name, color: col, at: s, dur: (e - s) / 1000 });
        });
      } else {
        (log.events[it.id] ?? []).forEach((t, idx) => {
          if (t >= ds && t < de) out.push({ id: it.id, kind: "moment", idx, name: it.name, color: col, at: t });
        });
      }
    }
    return out.sort((a, b) => b.at - a.at);
  }

  return (
    <div className="relative h-full">
      <FlipCard c={c} flipped={settingsOpen} className={className} front={front} back={back} />

      {historyOpen && (
        <div className={`absolute inset-0 z-40 p-5 flex flex-col rounded-2xl border ${c.bg} ${c.border}`}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 ${c.label}`}>
              {detailDate ? (
                <button onClick={() => setDetailDate(null)} title="Back to insights" className="opacity-60 hover:opacity-100 flex items-center gap-1">
                  <ChevronLeft size={14} />
                  <span className="text-xs font-medium">{fmtDay(detailDate)}{detailDate === today && " · today"}</span>
                </button>
              ) : (
                <>
                  <span className="opacity-50"><History size={14} /></span>
                  <span className="text-xs font-medium opacity-60">Insights</span>
                </>
              )}
            </div>
            <button onClick={() => { setHistoryOpen(false); setDetailDate(null); }} className={`opacity-50 hover:opacity-90 ${c.label}`} title="Close">
              <X size={14} />
            </button>
          </div>

          {detailDate ? (
            <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-1">
              {dayDetailRows(detailDate).length === 0 ? (
                <EmptyState c={c}>nothing logged this day</EmptyState>
              ) : (
                dayDetailRows(detailDate).map(r => (
                  <div key={`${r.id}-${r.kind}-${r.idx}`} className="group/row flex items-center gap-2 px-1 py-1 rounded-lg">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                    <span className={`flex-1 min-w-0 truncate text-xs opacity-80 ${c.text}`}>{r.name}</span>
                    <span className={`text-xs tabular-nums opacity-50 ${c.text}`}>
                      {fmtTimeOfDay(minutesOfDay(r.at))}{r.dur != null && ` · ${formatDuration(r.dur)}`}
                    </span>
                    <button
                      onClick={() => deleteEvent(r.id, r.kind, r.idx)}
                      title="Delete entry"
                      className={`opacity-0 group-hover/row:opacity-50 hover:!opacity-100 hover:text-red-500 ${c.icon}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-4">
              {items.length === 0 ? (
                <EmptyState c={c}>no items yet</EmptyState>
              ) : (
                <>
                  {/* Per-item rhythm: a dial of when it happens, plus the numbers */}
                  {items.map(it => {
                    const windowStart = dayStartMs(shiftDay(today, -(STATS_DAYS - 1)));
                    const isSession = it.kind === "session";
                    const dot = colorOf(it.id);
                    const sess = (log.sessions[it.id] ?? []).filter(s => s[0] >= windowStart);
                    const evs = (log.events[it.id] ?? []).filter(t => t >= windowStart);
                    const { perDay, gap } = freqStats(it);
                    const streak = streakFor(it);

                    const groups = isSession
                      ? [
                          { color: dot, mins: sess.map(s => minutesOfDay(s[0])) },
                          { color: "#9ca3af", mins: sess.map(s => minutesOfDay(s[1])) },
                        ]
                      : [{ color: dot, mins: evs.map(minutesOfDay) }];
                    const hasData = isSession ? sess.length > 0 : evs.length > 0;

                    const bed = isSession ? circadianStats(sess.map(s => minutesOfDay(s[0]))) : null;
                    const wake = isSession ? circadianStats(sess.map(s => minutesOfDay(s[1]))) : null;
                    const avgDur = isSession && sess.length
                      ? sess.reduce((a, s) => a + (s[1] - s[0]), 0) / sess.length / 1000
                      : 0;

                    return (
                      <div key={it.id} className="flex items-center gap-3">
                        <RhythmDial groups={groups} size={62} />
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />
                            <span className={`text-xs font-medium truncate ${c.text}`}>{it.name}</span>
                            {streak >= 2 && (
                              <span className={`flex items-center gap-0.5 text-[10px] tabular-nums ${c.label} opacity-60`}>
                                <Flame size={9} />{streak}
                              </span>
                            )}
                          </span>
                          {!hasData ? (
                            <span className={`text-[11px] opacity-50 ${c.text}`}>no taps yet</span>
                          ) : isSession ? (
                            <span className={`text-[11px] opacity-70 ${c.text} tabular-nums`}>
                              avg {formatDuration(avgDur)}
                              {bed && wake && <> · {fmtTimeOfDay(bed.mean)} → {fmtTimeOfDay(wake.mean)}</>}
                              <span className="opacity-60"> · {sess.length} in {STATS_DAYS}d</span>
                            </span>
                          ) : (
                            <span className={`text-[11px] opacity-70 ${c.text} tabular-nums`}>
                              ≈{perDay.toFixed(1)}×/day
                              {gap != null && <> · every {fmtGap(gap)}</>}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Day heatmap: items down, last 14 days across; tap a cell */}
                  <div className="shrink-0">
                    <div className="flex flex-col gap-1">
                      {items.map(it => {
                        const counts = gridDates.map(d => dayCount(it, d));
                        const max = Math.max(1, ...counts);
                        return (
                          <div key={it.id} className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(it.id) }} />
                            <div className="flex-1 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_DAYS}, 1fr)` }}>
                              {gridDates.map((d, i) => {
                                const cnt = counts[i];
                                const op = cnt > 0 ? 0.35 + 0.65 * (cnt / max) : 0;
                                return (
                                  <button
                                    key={d}
                                    onClick={() => setDetailDate(d)}
                                    title={`${fmtDay(d)}: ${cnt}`}
                                    className="h-3 rounded-sm transition-transform hover:scale-110"
                                    style={{ backgroundColor: cnt > 0 ? colorOf(it.id) : undefined, opacity: cnt > 0 ? op : 1 }}
                                  >
                                    {cnt === 0 && <span className="block w-full h-full rounded-sm bg-black/[0.06] dark:bg-white/[0.07]" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className={`flex justify-between text-[8px] opacity-40 ${c.label} mt-1 pl-2.5`}>
                      <span>{fmtDay(gridDates[0])}</span>
                      <span>{fmtDay(today)}</span>
                    </div>
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
