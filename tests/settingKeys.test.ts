import { describe, expect, it } from "vitest";
import { cacheExpiry, cacheKeyDate, instanceIdOf, isCacheKey } from "@/lib/settingKeys";

// Cache keys go to the Cache table and expire; a false positive here would
// let user data expire. These cases are the real key shapes found in production.
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
    "bank-widget-xkcd-research-cache",
  ])("treats %s as a cache", key => {
    expect(isCacheKey(key)).toBe(true);
  });

  it.each([
    "tracker-day-tracker-1783000000000-2026-10-13",
    "notebook-notebook-home-day-2026-10-13",
    "notebook-notebook-home-days",
    "rss-widget-rss-1790087846707",
    "reddit-widget-reddit-ov",
    "reddit-reddit-ov-seen",
    "bank-widget-xkcd-research",
    "widget-layout",
    "youtube-tubearchivist",
  ])("never treats user data %s as a cache", key => {
    expect(isCacheKey(key)).toBe(false);
  });
});

describe("cacheKeyDate and cacheExpiry", () => {
  it("extracts the day of dated caches only", () => {
    expect(cacheKeyDate("f1-cache-2026-10-13T09")).toBe("2026-10-13");
    expect(cacheKeyDate("epub-locs-x")).toBeNull();
    expect(cacheKeyDate("tracker-day-t-2026-10-13")).toBeNull();
  });
  it("keeps a dated cache for its day plus two, and an undated one for a month", () => {
    expect(cacheExpiry("arxiv-widget-a-2026-10-13").toISOString()).toBe("2026-10-16T00:00:00.000Z");
    const now = Date.UTC(2026, 10, 5);
    expect(cacheExpiry("bank-widget-x-cache", now).getTime()).toBe(now + 30 * 86_400_000);
  });
});

// The leftover-data cleanup deletes keys by instance id, so a wrong id here
// deletes the wrong widget's data and a missed family leaves garbage behind.
describe("instanceIdOf", () => {
  it.each([
    ["rss-widget-rss-1790087846707", "rss-1790087846707"],
    ["reddit-reddit-ov-seen", "reddit-ov"],
    ["reddit-reddit-ov-visit", "reddit-ov"],
    ["bank-widget-xkcd-research", "xkcd-research"],
    ["text-widget-text-home", "text-home"],
    ["chat-widget-chat-home", "chat-home"],
    ["chat-chat-1780562143363-index", "chat-1780562143363"],
    ["chat-chat-1780562143363-conv-abc-def", "chat-1780562143363"],
    ["notebook-notebook-home-days", "notebook-home"],
    ["notebook-notebook-home-day-2026-10-13", "notebook-home"],
    ["notebook-notebook-home-dates", "notebook-home"],
    ["notebook-notebook-home-name", "notebook-home"],
    ["reader-position-ebook-1", "ebook-1"],
    ["tracker-config-tracker-home", "tracker-home"],
    ["tracker-day-tracker-home-2026-10-13", "tracker-home"],
    ["rhythm-log-rhythm-1", "rhythm-1"],
    ["upkeep-config-upkeep-1790033980013", "upkeep-1790033980013"],
    ["upkeep-days-upkeep-ov", "upkeep-ov"],
    ["bookmarks-config-bookmarks-2", "bookmarks-2"],
    ["typing-stats-typing-1", "typing-1"],
    ["chess-chess-1790000000000", "chess-1790000000000"],
  ])("%s belongs to %s", (key, id) => {
    expect(instanceIdOf(key)).toBe(id);
  });

  it.each([
    "widget-layout",
    "widget-instances:dash-1",
    "dashboards",
    "notepad-registry",
    "theme",
    "timezone",
    "topbar-phrase",
    "youtube-tubearchivist",
    "keyboard-config",
    "digest-ai-sections-2026-10-13",
    "rss-widget-rss-1-2026-10-12",
    "bank-widget-x-cache",
    "something-new-1",
  ])("leaves %s alone", key => {
    expect(instanceIdOf(key)).toBeNull();
  });
});
