import { describe, expect, it } from "vitest";
import { notebookSplit, trackerFold, trackerMerge, upkeepConfigCurrent, upkeepDaysToLog, zonedNoon } from "@/lib/migrationRules";

describe("zonedNoon", () => {
  it("is noon in the zone, expressed as an instant", () => {
    expect(zonedNoon("2026-11-04", "UTC")).toBe(Date.UTC(2026, 10, 4, 12));
    expect(zonedNoon("2026-11-04", "Europe/Istanbul")).toBe(Date.UTC(2026, 10, 4, 9));
    expect(zonedNoon("2026-07-04", "America/New_York")).toBe(Date.UTC(2026, 6, 4, 16));
    expect(zonedNoon("2026-11-04", "Not/AZone")).toBe(Date.UTC(2026, 10, 4, 12));
  });
});

describe("upkeepConfigCurrent", () => {
  it("rewrites day spans as hours and leaves current configs alone", () => {
    const old = JSON.stringify({ items: [{ id: "a", name: "a", weight: 5, every: 3 }, { id: "b", name: "b", weight: 0 }] });
    expect(JSON.parse(upkeepConfigCurrent(old)!)).toEqual({ items: [{ id: "a", name: "a", weight: 5, hours: 72 }, { id: "b", name: "b", weight: 1, hours: 24 }] });
    const current = JSON.stringify({ items: [{ id: "a", name: "a", weight: 5, hours: 12 }] });
    expect(upkeepConfigCurrent(current)).toBeNull();
    expect(upkeepConfigCurrent("not json")).toBeNull();
    expect(upkeepConfigCurrent(JSON.stringify({ items: "x" }))).toBeNull();
  });
  it("drops items without an id or name", () => {
    const raw = JSON.stringify({ items: [{ id: "a", name: "a", weight: 5, hours: 1 }, { name: "ghost" }] });
    expect(JSON.parse(upkeepConfigCurrent(raw)!).items).toHaveLength(1);
  });
});

describe("upkeepDaysToLog", () => {
  it("places each day's checks at that day's noon in the user's zone, never in the future", () => {
    const now = Date.UTC(2026, 10, 5, 7);
    const log = JSON.parse(upkeepDaysToLog(JSON.stringify({ "2026-11-04": ["a", "b"], "2026-11-05": ["a"] }), now, "Europe/Istanbul")!);
    expect(log).toEqual({ a: [Date.UTC(2026, 10, 4, 9), now], b: [Date.UTC(2026, 10, 4, 9)] });
  });
  it("refuses unreadable input", () => {
    expect(upkeepDaysToLog("[]", 0, "UTC")).toBeNull();
    expect(upkeepDaysToLog(JSON.stringify({ nope: ["a"] }), 0, "UTC")).toBeNull();
    expect(upkeepDaysToLog("{", 0, "UTC")).toBeNull();
  });
});

describe("trackerFold", () => {
  it("folds every per-day key into one store and skips bad rows", () => {
    const days = trackerFold("t1", [
      { key: "tracker-day-t1-2026-10-12", value: JSON.stringify({ elapsed: { read: 120, move: 0 } }) },
      { key: "tracker-day-t1-2026-10-13", value: JSON.stringify({ elapsed: { read: 60 } }) },
      { key: "tracker-day-t1-2026-10-14", value: "garbage" },
      { key: "tracker-day-t1-nope", value: JSON.stringify({ elapsed: { read: 1 } }) },
    ]);
    expect(days).toEqual({ "2026-10-12": { read: 120 }, "2026-10-13": { read: 60 } });
  });
  it("merges leftover days into an existing store without touching dates it has", () => {
    expect(trackerMerge({ "2026-10-13": { read: 999 } }, { "2026-10-12": { read: 120 }, "2026-10-13": { read: 60 } }))
      .toEqual({ "2026-10-12": { read: 120 }, "2026-10-13": { read: 999 } });
  });
});

describe("notebookSplit", () => {
  it("lists dates in order and drops empty days", () => {
    expect(notebookSplit(JSON.stringify({ "2026-10-13": "<b>b</b>", "2026-10-11": "a", "2026-10-12": "" }))).toEqual({
      dates: ["2026-10-11", "2026-10-13"],
      days: [["2026-10-11", "a"], ["2026-10-13", "<b>b</b>"]],
    });
  });
  it("refuses anything that is not a date-to-string map", () => {
    expect(notebookSplit("[]")).toBeNull();
    expect(notebookSplit(JSON.stringify({ "2026-10-13": 5 }))).toBeNull();
    expect(notebookSplit(JSON.stringify({ today: "x" }))).toBeNull();
    expect(notebookSplit("{")).toBeNull();
  });
});
