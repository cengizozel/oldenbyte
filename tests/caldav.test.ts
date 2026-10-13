import { describe, expect, it } from "vitest";
import { expandRrule, wallToEpoch } from "@/lib/caldav";

const DAY = 86_400_000;
const start = Date.UTC(2026, 9, 5, 9, 0, 0); // Monday 2026-10-05 09:00 UTC (TZ=UTC in tests)

describe("wallToEpoch", () => {
  it("converts a wall time in a fixed-offset zone", () => {
    // Istanbul is UTC+3 all year.
    expect(wallToEpoch(2026, 10, 13, 12, 0, 0, "Europe/Istanbul")).toBe(Date.UTC(2026, 9, 13, 9, 0, 0));
  });
  it("follows daylight saving time", () => {
    // New York is UTC-4 in October (EDT) and UTC-5 in January (EST).
    expect(wallToEpoch(2026, 10, 13, 12, 0, 0, "America/New_York")).toBe(Date.UTC(2026, 9, 13, 16, 0, 0));
    expect(wallToEpoch(2026, 1, 13, 12, 0, 0, "America/New_York")).toBe(Date.UTC(2026, 0, 13, 17, 0, 0));
  });
});

describe("expandRrule", () => {
  it("expands DAILY with COUNT", () => {
    expect(expandRrule("FREQ=DAILY;COUNT=3", start, start, start + 30 * DAY)).toEqual([start, start + DAY, start + 2 * DAY]);
  });
  it("applies INTERVAL", () => {
    expect(expandRrule("FREQ=DAILY;INTERVAL=2;COUNT=3", start, start, start + 30 * DAY)).toEqual([start, start + 2 * DAY, start + 4 * DAY]);
  });
  it("only returns occurrences inside the range", () => {
    const out = expandRrule("FREQ=DAILY", start, start + 10 * DAY, start + 12 * DAY);
    expect(out).toEqual([start + 10 * DAY, start + 11 * DAY]);
  });
  it("expands WEEKLY on the listed days", () => {
    const out = expandRrule("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4", start, start, start + 30 * DAY);
    expect(out).toEqual([start, start + 2 * DAY, start + 7 * DAY, start + 9 * DAY]);
  });
  it("returns nothing without a FREQ", () => {
    expect(expandRrule("COUNT=3", start, start, start + DAY)).toEqual([]);
  });
});
