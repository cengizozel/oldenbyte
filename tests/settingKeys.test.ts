import { describe, expect, it } from "vitest";
import { cacheKeyDate, isCacheKey } from "@/lib/settingKeys";

// The cleanup job deletes old cache keys, so a false positive here deletes
// user data. These cases are the real key shapes found in production.
describe("isCacheKey", () => {
  it.each([
    "f1-cache-2026-10-13T09",
    "hf-papers-25-2026-10-13",
    "digest-ai-sections-2026-10-13",
    "reddit-widget-reddit-ov-v3-2026-10-13-news:week:3,science:week:5",
    "youtube-widget-youtube-ov-2026-10-07-1eoakkj8tdazr",
    "rss-widget-rss-1790087846707-2026-10-12",
    "arxiv-widget-arxiv-default-2026-04-21",
    "epub-locs-somebook",
  ])("treats %s as a cache", key => {
    expect(isCacheKey(key)).toBe(true);
  });

  it.each([
    "tracker-day-tracker-1783000000000-2026-10-13",
    "notebook-notebook-home-day-2026-10-13",
    "notebook-notebook-home-days",
    "rss-widget-rss-1790087846707",
    "reddit-widget-reddit-ov",
    "widget-layout",
    "youtube-tubearchivist",
  ])("never treats user data %s as a cache", key => {
    expect(isCacheKey(key)).toBe(false);
  });
});

describe("cacheKeyDate", () => {
  it("extracts the day of dated caches only", () => {
    expect(cacheKeyDate("f1-cache-2026-10-13T09")).toBe("2026-10-13");
    expect(cacheKeyDate("epub-locs-x")).toBeNull();
    expect(cacheKeyDate("tracker-day-t-2026-10-13")).toBeNull();
  });
});
