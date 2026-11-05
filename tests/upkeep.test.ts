import { describe, expect, it } from "vitest";
import {
  HOUR, DAY, addCheck, removeCheck, dayChecks, formatSpan, migrateDays, nextExpiry, normalizeItem,
  perfectSince, sampleScores, scoreAt, shiftDay, stateAt, summarize, type UpkeepItem,
} from "@/lib/upkeep";

// Ids without a timestamp prefix exist from the beginning of time, which keeps
// these tests independent of the clock.
const teeth: UpkeepItem = { id: "teeth", name: "teeth clean", weight: 10, hours: 12 };
const shave: UpkeepItem = { id: "shave", name: "shaven", weight: 5, hours: 72 };
const T0 = Date.UTC(2026, 10, 5, 8, 0, 0);

describe("shiftDay", () => {
  it("steps across month and year boundaries", () => {
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("normalizeItem", () => {
  it("fixes a bad weight and defaults the span to a day", () => {
    expect(normalizeItem({ id: "a", name: "a", weight: 0 })).toEqual({ id: "a", name: "a", weight: 1, hours: 24 });
  });
  it("converts the old day-based span and caps huge ones", () => {
    expect(normalizeItem({ id: "a", name: "a", weight: 4, every: 3 })).toEqual({ id: "a", name: "a", weight: 4, hours: 72 });
    expect(normalizeItem({ id: "a", name: "a", weight: 4, hours: 1e9 }).hours).toBe(24 * 365);
  });
});

describe("stateAt", () => {
  const log = addCheck({}, "teeth", T0);
  it("runs for the item's span from the check", () => {
    expect(stateAt(teeth, log, T0)).toEqual({ on: true, left: 12 * HOUR, since: T0, end: T0 + 12 * HOUR });
    expect(stateAt(teeth, log, T0 + 11 * HOUR)).toEqual({ on: true, left: HOUR, since: T0, end: T0 + 12 * HOUR });
    expect(stateAt(teeth, log, T0 + 12 * HOUR)).toEqual({ on: false, left: 0, since: T0, end: T0 + 12 * HOUR });
  });
  it("is off before the first check and after none", () => {
    expect(stateAt(teeth, log, T0 - 1).on).toBe(false);
    expect(stateAt(teeth, {}, T0)).toEqual({ on: false, left: 0, since: null, end: null });
  });
  it("a new check restarts the countdown", () => {
    const l2 = addCheck(log, "teeth", T0 + 10 * HOUR);
    expect(stateAt(teeth, l2, T0 + 20 * HOUR)).toEqual({ on: true, left: 2 * HOUR, since: T0 + 10 * HOUR, end: T0 + 22 * HOUR });
  });
});

describe("addCheck and removeCheck", () => {
  it("keeps checks sorted and removes an exact time", () => {
    let log = addCheck({}, "a", 30);
    log = addCheck(log, "a", 10);
    expect(log.a).toEqual([10, 30]);
    expect(removeCheck(log, "a", 10).a).toEqual([30]);
    expect(removeCheck(removeCheck(log, "a", 10), "a", 30)).toEqual({});
  });
});

describe("scoreAt", () => {
  const items = [teeth, shave];
  const log = addCheck(addCheck({}, "shave", T0), "teeth", T0 + 2 * HOUR);
  it("is the running weight over the possible weight", () => {
    expect(scoreAt(items, log, T0)).toEqual({ done: 5, total: 15, pct: 33 });
    expect(scoreAt(items, log, T0 + 3 * HOUR)).toEqual({ done: 15, total: 15, pct: 100 });
    expect(scoreAt(items, log, T0 + 20 * HOUR)).toEqual({ done: 5, total: 15, pct: 33 });
    expect(scoreAt(items, log, T0 + 4 * DAY)).toEqual({ done: 0, total: 15, pct: 0 });
  });
  it("only counts items that existed at the time", () => {
    const fresh: UpkeepItem = { id: `${T0 + DAY}-1`, name: "new", weight: 20, hours: 24 };
    expect(scoreAt([teeth, fresh], log, T0 + 3 * HOUR).total).toBe(10);
    expect(scoreAt([teeth, fresh], log, T0 + 2 * DAY).total).toBe(30);
    expect(scoreAt([fresh], log, T0).pct).toBeNull();
  });
});

describe("perfectSince", () => {
  const items = [teeth, shave];
  it("is null unless the score is 100", () => {
    expect(perfectSince(items, addCheck({}, "shave", T0), T0)).toBeNull();
  });
  it("starts when the last item came on, and runs back through re-arms", () => {
    let log = addCheck({}, "shave", T0);
    log = addCheck(log, "teeth", T0 + HOUR);
    log = addCheck(log, "teeth", T0 + 10 * HOUR);  // re-armed before running out
    expect(perfectSince(items, log, T0 + 15 * HOUR)).toBe(T0 + HOUR);
    log = addCheck(log, "teeth", T0 + 30 * HOUR);  // gap: ran out at T0+22h
    expect(perfectSince(items, log, T0 + 31 * HOUR)).toBe(T0 + 30 * HOUR);
  });
});

describe("nextExpiry and sampling", () => {
  const items = [teeth, shave];
  const log = addCheck(addCheck({}, "shave", T0), "teeth", T0);
  it("names the item that runs out soonest", () => {
    expect(nextExpiry(items, log, T0)?.item.id).toBe("teeth");
    expect(nextExpiry(items, log, T0 + 13 * HOUR)?.item.id).toBe("shave");
    expect(nextExpiry(items, log, T0 + 4 * DAY)).toBeNull();
  });
  it("samples and summarizes the score over a window", () => {
    const s = sampleScores(items, log, T0, T0 + 24 * HOUR, 6 * HOUR);
    expect(s.map(x => x.pct)).toEqual([100, 100, 33, 33]);
    expect(summarize(s)).toEqual({ avg: 67, perfectShare: 50 });
    expect(summarize([{ pct: null }])).toEqual({ avg: null, perfectShare: null });
  });
});

describe("dayChecks, formatSpan, migrateDays", () => {
  const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  it("lists a day's checks newest first", () => {
    const log = addCheck(addCheck(addCheck({}, "teeth", T0), "teeth", T0 + 10 * HOUR), "shave", T0 + DAY);
    expect(dayChecks([teeth, shave], log, "2026-11-05", utcDay).map(c => c.at)).toEqual([T0 + 10 * HOUR, T0]);
  });
  it("formats spans", () => {
    expect(formatSpan(2 * DAY + 4 * HOUR)).toBe("2d 4h");
    expect(formatSpan(2 * DAY)).toBe("2d");
    expect(formatSpan(3 * HOUR + 20 * 60000)).toBe("3h 20m");
    expect(formatSpan(12 * 60000)).toBe("12m");
    expect(formatSpan(-5)).toBe("0m");
  });
  it("turns day lists into noon checks, never in the future", () => {
    const noon = (d: string) => Date.parse(`${d}T12:00:00Z`);
    const now = Date.parse("2026-11-05T09:00:00Z");
    const log = migrateDays({ "2026-11-04": ["a", "b"], "2026-11-05": ["a"] }, now, noon);
    expect(log.a).toEqual([noon("2026-11-04"), now]);
    expect(log.b).toEqual([noon("2026-11-04")]);
  });
});

describe("stopCheck", () => {
  const log = addCheck({}, "teeth", T0);
  it("ends the latest check early and the item reads off from then on", async () => {
    const { stopCheck, dayChecks } = await import("@/lib/upkeep");
    const stopped = stopCheck(log, "teeth", T0 + 2 * HOUR);
    expect(stopped.teeth).toEqual([[T0, T0 + 2 * HOUR]]);
    expect(stateAt(teeth, stopped, T0 + HOUR)).toEqual({ on: true, left: HOUR, since: T0, end: T0 + 2 * HOUR });
    expect(stateAt(teeth, stopped, T0 + 3 * HOUR)).toEqual({ on: false, left: 0, since: T0, end: T0 + 2 * HOUR });
    expect(dayChecks([teeth], stopped, "2026-11-05", ms => new Date(ms).toISOString().slice(0, 10))[0].stoppedAt).toBe(T0 + 2 * HOUR);
  });
  it("is a no-op without a check, before the check, or when already stopped earlier", async () => {
    const { stopCheck } = await import("@/lib/upkeep");
    expect(stopCheck({}, "teeth", T0)).toEqual({});
    expect(stopCheck(log, "teeth", T0 - 1)).toEqual(log);
    const early = stopCheck(log, "teeth", T0 + HOUR);
    expect(stopCheck(early, "teeth", T0 + 2 * HOUR)).toEqual(early);
  });
  it("breaks a perfect stretch at the stop and a new check starts a fresh one", async () => {
    const { stopCheck } = await import("@/lib/upkeep");
    let l = addCheck(addCheck({}, "shave", T0), "teeth", T0);
    l = stopCheck(l, "teeth", T0 + HOUR);
    expect(scoreAt([teeth, shave], l, T0 + 2 * HOUR).pct).toBe(33);
    l = addCheck(l, "teeth", T0 + 3 * HOUR);
    expect(perfectSince([teeth, shave], l, T0 + 4 * HOUR)).toBe(T0 + 3 * HOUR);
  });
});

describe("unstopCheck", () => {
  it("lets a stopped check run its full span again", async () => {
    const { stopCheck, unstopCheck } = await import("@/lib/upkeep");
    const stopped = stopCheck(addCheck({}, "teeth", T0), "teeth", T0 + HOUR);
    const back = unstopCheck(stopped, "teeth", T0);
    expect(back.teeth).toEqual([T0]);
    expect(stateAt(teeth, back, T0 + 5 * HOUR).on).toBe(true);
    expect(unstopCheck({}, "teeth", T0)).toEqual({});
  });
});

describe("orderRows", () => {
  const rows = [
    { name: "a", weight: 10, on: true, left: 5 * HOUR },
    { name: "b", weight: 5, on: false, left: 0 },
    { name: "c", weight: 20, on: false, left: 0 },
    { name: "d", weight: 10, on: true, left: HOUR },
    { name: "e", weight: 5, on: false, left: 0 },
  ];
  it("keeps the custom order as is", async () => {
    const { orderRows } = await import("@/lib/upkeep");
    expect(orderRows(rows, "custom").map(r => r.name)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("by need: off items heaviest first (ties in custom order), then running items soonest to end first", async () => {
    const { orderRows } = await import("@/lib/upkeep");
    expect(orderRows(rows, "need").map(r => r.name)).toEqual(["c", "b", "e", "d", "a"]);
  });
});
