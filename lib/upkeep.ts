// Upkeep scoring, shared by the widget (components/UpkeepWidget.tsx) and the
// chat's dashboard reader (lib/widgetData.ts) so both agree on the score.
//
// Each item is a countdown: checking it starts a timer of `hours`, and the
// item counts toward the score while that timer is running. There is no daily
// reset; the score at any moment is the weight of the items whose timers are
// still running over the weight of all items, times 100. Because the log keeps
// every check time, the score is derivable for any past moment too, which is
// what the history view and the "at 100 since" readout use.

import { localDateStr } from "@/lib/format";

export type UpkeepItem = { id: string; name: string; weight: number; hours: number };
// Per item, ascending by start: each check as its time (epoch ms), or as
// [time, stoppedAt] when the user turned it off before the span ran out.
export type UpkeepEntry = number | [number, number];
export type UpkeepLog = Record<string, UpkeepEntry[]>;

export function startOf(e: UpkeepEntry): number {
  return typeof e === "number" ? e : e[0];
}
export function stopOf(e: UpkeepEntry): number | null {
  return typeof e === "number" ? null : e[1];
}
// When a check stops counting: its span runs out, or it was turned off earlier.
export function endOf(e: UpkeepEntry, hours: number): number {
  const natural = startOf(e) + hours * HOUR;
  const stop = stopOf(e);
  return stop === null ? natural : Math.min(natural, stop);
}

export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const MAX_HOURS = 24 * 365;
export const DEFAULT_HOURS = 24;
// How long the undo button stays after an item is turned off.
export const UNDO_WINDOW = 30_000;
const MAX_CHECKS_PER_ITEM = 500;

// Weight below 1 counts as 1. A span comes from `hours`, or from the earlier
// day-based `every` field (days) on old configs; anything else is one day.
export function normalizeItem(raw: { id: string; name: string; weight?: number; hours?: number; every?: number }): UpkeepItem {
  const weight = Number(raw.weight) > 0 ? Number(raw.weight) : 1;
  let hours = Number(raw.hours);
  if (!(hours > 0)) {
    const every = Math.floor(Number(raw.every));
    hours = every >= 1 ? every * 24 : DEFAULT_HOURS;
  }
  return { id: raw.id, name: raw.name, weight, hours: Math.min(hours, MAX_HOURS) };
}

// Calendar arithmetic on "YYYY-MM-DD" strings, independent of the host timezone.
export function shiftDay(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// Ids carry their creation time as a prefix (`${Date.now()}-...`), so an item
// only counts toward the score from the moment it existed; a fresh habit never
// retroactively lowers past scores. Ids without a numeric prefix count from
// the beginning of time.
export function itemCreatedMs(id: string): number {
  const ms = parseInt(id.split("-")[0], 10);
  return Number.isFinite(ms) ? ms : 0;
}

export function addCheck(log: UpkeepLog, id: string, at: number): UpkeepLog {
  const arr = [...(log[id] ?? []), at].sort((a, b) => startOf(a) - startOf(b)).slice(-MAX_CHECKS_PER_ITEM);
  return { ...log, [id]: arr };
}

// Remove the check that started at `start`.
export function removeCheck(log: UpkeepLog, id: string, start: number): UpkeepLog {
  const arr = (log[id] ?? []).filter(e => startOf(e) !== start);
  const next = { ...log };
  if (arr.length) next[id] = arr; else delete next[id];
  return next;
}

// Turn the item off at `at`: the latest check started at or before `at` keeps
// its start and gets `at` as its end. A check already stopped earlier stays.
export function stopCheck(log: UpkeepLog, id: string, at: number): UpkeepLog {
  const arr = log[id];
  if (!arr?.length) return log;
  let i = arr.length - 1;
  while (i >= 0 && startOf(arr[i]) > at) i--;
  if (i < 0) return log;
  const stop = stopOf(arr[i]);
  if (stop !== null && stop <= at) return log;
  const next = [...arr];
  next[i] = [startOf(arr[i]), at];
  return { ...log, [id]: next };
}

// Undo a stop: the check that started at `start` runs its full span again.
export function unstopCheck(log: UpkeepLog, id: string, start: number): UpkeepLog {
  const arr = log[id];
  if (!arr?.length) return log;
  const next = arr.map(e => (startOf(e) === start ? start : e));
  return { ...log, [id]: next };
}

// The latest check started at or before `at`, or null.
export function lastCheckAt(log: UpkeepLog, id: string, at: number): UpkeepEntry | null {
  const arr = log[id];
  if (!arr?.length) return null;
  for (let i = arr.length - 1; i >= 0; i--) if (startOf(arr[i]) <= at) return arr[i];
  return null;
}

export type ItemState = {
  on: boolean;          // the countdown is running at `at`
  left: number;         // ms until it runs out (0 when off)
  since: number | null; // when the latest check started (running or not)
  end: number | null;   // when that check stops or stopped counting
};

export function stateAt(it: UpkeepItem, log: UpkeepLog, at: number): ItemState {
  const entry = lastCheckAt(log, it.id, at);
  if (entry == null) return { on: false, left: 0, since: null, end: null };
  const since = startOf(entry);
  const end = endOf(entry, it.hours);
  return end > at ? { on: true, left: end - at, since, end } : { on: false, left: 0, since, end };
}

export type Score = { done: number; total: number; pct: number | null };

// Items that existed at `at`; the score only ever counts those.
export function activeAt(items: UpkeepItem[], at: number): UpkeepItem[] {
  return items.filter(it => itemCreatedMs(it.id) <= at);
}

// Running weight over possible weight, times 100. Null before any item exists.
export function scoreAt(items: UpkeepItem[], log: UpkeepLog, at: number): Score {
  const active = activeAt(items, at);
  const total = active.reduce((a, it) => a + it.weight, 0);
  if (total <= 0) return { done: 0, total: 0, pct: null };
  const done = active.filter(it => stateAt(it, log, at).on).reduce((a, it) => a + it.weight, 0);
  return { done, total, pct: Math.round((done / total) * 100) };
}

// When the current stretch at 100 began, or null if the score is not 100 now.
// Each item's stretch runs back through checks that re-armed it before it
// stopped counting; the score's stretch began when the last of those began.
export function perfectSince(items: UpkeepItem[], log: UpkeepLog, at: number): number | null {
  if (scoreAt(items, log, at).pct !== 100) return null;
  let start = 0;
  for (const it of activeAt(items, at)) {
    const arr = log[it.id] ?? [];
    let i = arr.length - 1;
    while (i >= 0 && startOf(arr[i]) > at) i--;
    let s = startOf(arr[i]);
    for (let j = i - 1; j >= 0; j--) {
      if (endOf(arr[j], it.hours) >= startOf(arr[j + 1])) s = startOf(arr[j]); else break;
    }
    start = Math.max(start, s, itemCreatedMs(it.id));
  }
  return start;
}

// The running item that runs out soonest, for the "next up" line.
export function nextExpiry(items: UpkeepItem[], log: UpkeepLog, at: number): { item: UpkeepItem; at: number } | null {
  let best: { item: UpkeepItem; at: number } | null = null;
  for (const it of activeAt(items, at)) {
    const st = stateAt(it, log, at);
    if (st.on && (!best || at + st.left < best.at)) best = { item: it, at: at + st.left };
  }
  return best;
}

// The score sampled every `step` ms from `from` (inclusive) to `to` (exclusive),
// for charts and averages. Samples before any item existed are null.
export function sampleScores(items: UpkeepItem[], log: UpkeepLog, from: number, to: number, step: number): { t: number; pct: number | null }[] {
  const out: { t: number; pct: number | null }[] = [];
  for (let t = from; t < to; t += step) out.push({ t, pct: scoreAt(items, log, t).pct });
  return out;
}

// Mean and share-at-100 of the non-null samples, or nulls when there are none.
export function summarize(samples: { pct: number | null }[]): { avg: number | null; perfectShare: number | null } {
  const vals = samples.map(s => s.pct).filter((p): p is number => p != null);
  if (!vals.length) return { avg: null, perfectShare: null };
  return {
    avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    perfectShare: Math.round((vals.filter(v => v === 100).length / vals.length) * 100),
  };
}

// Every check that started on a local day, newest first, with its stop time
// if it was turned off early.
export function dayChecks(items: UpkeepItem[], log: UpkeepLog, date: string, dayOf: (ms: number) => string = ms => localDateStr(new Date(ms))): { item: UpkeepItem; at: number; stoppedAt: number | null }[] {
  const out: { item: UpkeepItem; at: number; stoppedAt: number | null }[] = [];
  for (const it of items) for (const e of log[it.id] ?? []) {
    const at = startOf(e);
    if (dayOf(at) === date) out.push({ item: it, at, stoppedAt: stopOf(e) });
  }
  return out.sort((a, b) => b.at - a.at);
}

// "2d 4h", "3h 20m", "12m": a span for the countdown labels.
export function formatSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
  return `${mm}m`;
}

// Convert the earlier day-keyed store ({ "YYYY-MM-DD": itemId[] }) into check
// times: each check lands at local noon of its day, or now if that is earlier.
export function migrateDays(days: Record<string, string[]>, now: number, noonOf: (date: string) => number = date => new Date(`${date}T12:00:00`).getTime()): UpkeepLog {
  let log: UpkeepLog = {};
  for (const [date, ids] of Object.entries(days)) {
    const at = Math.min(noonOf(date), now);
    for (const id of ids) log = addCheck(log, id, at);
  }
  return log;
}
