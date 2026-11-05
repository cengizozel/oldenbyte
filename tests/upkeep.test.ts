import { describe, expect, it } from "vitest";
import { coverageOn, itemEvery, normalizeItem, scoreDay, shiftDay, type UpkeepItem } from "@/lib/upkeep";

// Ids without a timestamp prefix exist from the beginning of time, which keeps
// these tests independent of the clock.
const teeth: UpkeepItem = { id: "teeth", name: "teeth clean", weight: 10 };
const shave: UpkeepItem = { id: "shave", name: "shaven", weight: 5, every: 3 };

describe("shiftDay", () => {
  it("steps across month and year boundaries", () => {
    expect(shiftDay("2026-11-05", 1)).toBe("2026-11-06");
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("itemEvery and normalizeItem", () => {
  it("treats missing, zero, fractional and huge spans sensibly", () => {
    expect(itemEvery({})).toBe(1);
    expect(itemEvery({ every: 0 })).toBe(1);
    expect(itemEvery({ every: 2.7 })).toBe(2);
    expect(itemEvery({ every: 500 })).toBe(99);
  });
  it("drops a daily span and fixes a bad weight", () => {
    expect(normalizeItem({ id: "a", name: "a", weight: 0, every: 1 })).toEqual({ id: "a", name: "a", weight: 1 });
    expect(normalizeItem({ id: "a", name: "a", weight: 4, every: 3 })).toEqual({ id: "a", name: "a", weight: 4, every: 3 });
  });
});

describe("coverageOn", () => {
  it("is daily by default", () => {
    const days = { "2026-11-04": ["teeth"] };
    expect(coverageOn(teeth, days, "2026-11-04")).toEqual({ done: true, carried: false, left: 0 });
    expect(coverageOn(teeth, days, "2026-11-05")).toEqual({ done: false, carried: false, left: 0 });
  });
  it("carries a multi-day item through its span and no further", () => {
    const days = { "2026-11-03": ["shave"] };
    expect(coverageOn(shave, days, "2026-11-03")).toEqual({ done: true, carried: false, left: 2 });
    expect(coverageOn(shave, days, "2026-11-04")).toEqual({ done: false, carried: true, left: 1 });
    expect(coverageOn(shave, days, "2026-11-05")).toEqual({ done: false, carried: true, left: 0 });
    expect(coverageOn(shave, days, "2026-11-06")).toEqual({ done: false, carried: false, left: 0 });
  });
  it("does not cover days before the check", () => {
    const days = { "2026-11-05": ["shave"] };
    expect(coverageOn(shave, days, "2026-11-04").carried).toBe(false);
  });
  it("re-checking inside the span restarts it", () => {
    const days = { "2026-11-03": ["shave"], "2026-11-05": ["shave"] };
    expect(coverageOn(shave, days, "2026-11-07")).toEqual({ done: false, carried: true, left: 0 });
  });
});

describe("scoreDay", () => {
  const items = [teeth, shave];
  it("counts carried items toward the score", () => {
    const days = { "2026-11-03": ["shave"], "2026-11-04": ["teeth"] };
    expect(scoreDay(items, days, "2026-11-04")).toEqual({ done: 15, total: 15, pct: 100 });
    expect(scoreDay(items, days, "2026-11-05")).toEqual({ done: 5, total: 15, pct: 33 });
    expect(scoreDay(items, days, "2026-11-06")).toEqual({ done: 0, total: 15, pct: 0 });
  });
  it("only counts items that existed on the day", () => {
    const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const created = Date.UTC(2026, 10, 5);
    const fresh: UpkeepItem = { id: `${created}-1`, name: "new", weight: 20 };
    expect(scoreDay([teeth, fresh], {}, "2026-11-04", dayOf).total).toBe(10);
    expect(scoreDay([teeth, fresh], {}, "2026-11-05", dayOf).total).toBe(30);
    expect(scoreDay([fresh], {}, "2026-11-04", dayOf).pct).toBeNull();
  });
});
