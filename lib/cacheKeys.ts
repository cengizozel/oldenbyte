import { localDateStr } from "./format";

// Day-cache keys shared by the feed widgets and the digest page, so the digest
// can reuse what a widget already fetched today. One definition per widget.
// (lib/settingKeys.ts decides which keys are caches; keep the prefixes in sync.)

// Short stable hash: the settings API caps keys at 256 chars, and a raw
// signature of every channel id outgrows that past a handful of channels.
export function hashSig(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ s.charCodeAt(s.length - 1 - i), 0x01000193);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

type YoutubeChannel = { channelId: string; limit: number; filterMembers?: boolean; includeShorts?: boolean };
export function youtubeCacheKey(widgetId: string, day: string, channels: YoutubeChannel[]): string {
  const sig = channels.map(ch => `${ch.channelId}:${ch.limit}:${ch.filterMembers ? 1 : 0}:${ch.includeShorts ? 1 : 0}`).join(",");
  return `youtube-widget-${widgetId}-${day}-${hashSig(sig)}`;
}

type RedditSub = { name: string; period: string; limit: number };
export function redditCacheKey(widgetId: string, day: string, subreddits: RedditSub[]): string {
  return `reddit-widget-${widgetId}-v3-${day}-${subreddits.map(s => `${s.name}:${s.period}:${s.limit}`).join(",")}`;
}

// F1 data changes during a race weekend, so it is cached per local hour.
export function f1CacheKey(now = new Date()): string {
  return `f1-cache-${localDateStr(now)}T${String(now.getHours()).padStart(2, "0")}`;
}
