// Upkeep scoring, shared by the widget (components/UpkeepWidget.tsx) and the
// chat's dashboard reader (lib/widgetData.ts) so both agree on what a day scored.
//
// An item is normally daily: checked today or not. An item can instead last
// several days (`every`): one check covers that day and the following
// `every - 1` days, so "shaved" set to 3 stays covered for three days and
// counts toward each of those days' scores without being re-checked.

import { localDateStr } from "@/lib/format";

export type UpkeepItem = { id: string; name: string; weight: number; every?: number };
// Per local day: the ids that were checked off that day. Scores are derived,
// never stored, so they always reflect the current items, weights and spans.
export type UpkeepDays = Record<string, string[]>;

export const MAX_EVERY = 99;

export function itemEvery(it: Pick<UpkeepItem, "every">): number {
  const n = Math.floor(Number(it.every));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_EVERY) : 1;
}

// Weight below 1 counts as 1, span below 1 (or absent) as daily.
export function normalizeItem(it: UpkeepItem): UpkeepItem {
  const every = itemEvery(it);
  const out: UpkeepItem = { id: it.id, name: it.name, weight: it.weight > 0 ? it.weight : 1 };
  if (every > 1) out.every = every;
  return out;
}

// Calendar arithmetic on "YYYY-MM-DD" strings, independent of the host timezone.
export function shiftDay(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// Ids carry their creation time as a prefix (`${Date.now()}-...`), so a day only
// counts an item toward its score if the item already existed then. This keeps
// a fresh habit from retroactively breaking past perfect days. Ids without a
// numeric prefix (older items, seeds) count from the beginning of time.
export function itemCreatedDay(id: string, dayOf: (ms: number) => string = ms => localDateStr(new Date(ms))): string {
  const ms = parseInt(id.split("-")[0], 10);
  return Number.isFinite(ms) ? dayOf(ms) : "1970-01-01";
}

export type Coverage = {
  done: boolean;     // checked on this very day
  carried: boolean;  // not checked this day, but covered by a check on an earlier day
  left: number;      // days of coverage remaining after this day (0 when none)
};

// Whether an item counts on a day: checked that day, or checked within the last
// `every - 1` days. `left` is how many more days the latest check still covers.
export function coverageOn(it: UpkeepItem, days: UpkeepDays, date: string): Coverage {
  const every = itemEvery(it);
  const done = (days[date] ?? []).includes(it.id);
  let latest: string | null = done ? date : null;
  if (!latest) {
    for (let back = 1; back < every; back++) {
      const d = shiftDay(date, -back);
      if ((days[d] ?? []).includes(it.id)) { latest = d; break; }
    }
  }
  if (!latest) return { done: false, carried: false, left: 0 };
  const end = shiftDay(latest, every - 1);
  const left = Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000));
  return { done, carried: !done, left };
}

export type DayScore = { done: number; total: number; pct: number | null };

// A day's score is the covered points over the points that were possible that
// day, times 100. "Possible" counts only items that existed on the day, so
// everything covered is always exactly 100. Days before any item exists score null.
export function scoreDay(
  items: UpkeepItem[],
  days: UpkeepDays,
  date: string,
  dayOf?: (ms: number) => string,
): DayScore {
  const active = items.filter(it => itemCreatedDay(it.id, dayOf) <= date);
  const total = active.reduce((a, it) => a + it.weight, 0);
  if (total <= 0) return { done: 0, total: 0, pct: null };
  const done = active
    .filter(it => { const c = coverageOn(it, days, date); return c.done || c.carried; })
    .reduce((a, it) => a + it.weight, 0);
  return { done, total, pct: Math.round((done / total) * 100) };
}
