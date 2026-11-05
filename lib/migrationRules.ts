// Shape migrations for stored values, as pure functions: what an old value
// becomes. lib/migrations.ts applies them on the server, on every read, so a
// widget nobody has opened since a format change still reads current. Each
// rule is a one-way conversion and is tested in tests/migrationRules.test.ts.

import { normalizeItem, migrateDays, type UpkeepItem } from "@/lib/upkeep";

// ── Time zones ───────────────────────────────────────────────────────────────

// Milliseconds the wall clock in `tz` is ahead of UTC at instant `t`.
function zoneOffsetMs(t: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

// Noon of a "YYYY-MM-DD" day in `tz`, as epoch ms. Falls back to UTC noon for
// an unknown zone.
export function zonedNoon(date: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 12);
  try {
    return guess - zoneOffsetMs(guess, tz);
  } catch {
    return guess;
  }
}

// ── Upkeep ───────────────────────────────────────────────────────────────────

// Upkeep configs from before per-item countdowns carried `every` (days)
// instead of `hours`. Returns the rewritten config, or null when nothing needs
// changing (or the value is unreadable and should be left alone).
export function upkeepConfigCurrent(raw: string): string | null {
  let cfg: { items?: Partial<UpkeepItem & { every: number }>[] };
  try { cfg = JSON.parse(raw); } catch { return null; }
  if (!cfg || typeof cfg !== "object" || !Array.isArray(cfg.items)) return null;
  const items = cfg.items.filter((i): i is UpkeepItem => !!i && typeof i.id === "string" && typeof i.name === "string");
  if (items.length === cfg.items.length && items.every(i => Number(i.hours) > 0)) return null;
  return JSON.stringify({ ...cfg, items: items.map(normalizeItem) });
}

// Upkeep once stored which items were checked per local day; a check log
// places each at noon of its day in the user's zone (or now, if earlier).
export function upkeepDaysToLog(raw: string, now: number, tz: string): string | null {
  let days: Record<string, string[]>;
  try { days = JSON.parse(raw); } catch { return null; }
  if (!days || typeof days !== "object" || Array.isArray(days)) return null;
  const clean: Record<string, string[]> = {};
  for (const [date, ids] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(ids)) return null;
    clean[date] = ids.filter((id): id is string => typeof id === "string");
  }
  return JSON.stringify(migrateDays(clean, now, date => zonedNoon(date, tz)));
}

// ── Tracker ──────────────────────────────────────────────────────────────────

// Tracker once stored one key per day (`tracker-day-<id>-<date>`, holding
// `{ elapsed: { [activityId]: seconds } }`); the consolidated days store keys
// every day by date. Unreadable days are skipped.
export function trackerFold(id: string, rows: { key: string; value: string }[]): Record<string, Record<string, number>> {
  const prefix = `tracker-day-${id}-`;
  const days: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const date = r.key.slice(prefix.length);
    if (!r.key.startsWith(prefix) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let d: { elapsed?: Record<string, unknown> };
    try { d = JSON.parse(r.value); } catch { continue; }
    if (!d?.elapsed || typeof d.elapsed !== "object") continue;
    const elapsed: Record<string, number> = {};
    for (const [act, secs] of Object.entries(d.elapsed)) if (typeof secs === "number" && secs > 0) elapsed[act] = secs;
    if (Object.keys(elapsed).length) days[date] = elapsed;
  }
  return days;
}

// When a days store already exists next to leftover day keys (the first
// version of this migration only folded the current day), the store wins for
// any date both have; the rest is added.
export function trackerMerge(existing: Record<string, Record<string, number>>, folded: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  return { ...folded, ...existing };
}

// ── Notepad ──────────────────────────────────────────────────────────────────

// Notepads once kept every day in one `notebook-<id>-dates` object; now each
// day is its own key and `notebook-<id>-days` lists the dates. Returns null
// when the blob is unreadable, so it is left untouched.
export function notebookSplit(raw: string): { dates: string[]; days: [string, string][] } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([date, html]) => typeof html !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) return null;
  const days = (entries as [string, string][]).filter(([, html]) => html !== "").sort(([a], [b]) => a.localeCompare(b));
  return { dates: days.map(([date]) => date), days };
}
