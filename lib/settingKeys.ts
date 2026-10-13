// Which Setting keys are disposable caches. One definition shared by export,
// the config API, and the startup cleanup, so they can never disagree.
//
// This is an explicit allow-list on purpose: date-stamped keys are not all
// caches. Tracker logs (`tracker-day-<id>-<date>`) and notepad days
// (`notebook-<id>-day-<date>`) are user data and must never match.
const DATED_CACHE = /^(?:f1-cache-|hf-papers-|digest-ai-sections-|(?:reddit|youtube|rss|arxiv)-widget-).*?(\d{4}-\d{2}-\d{2})/;

export function isCacheKey(key: string): boolean {
  return DATED_CACHE.test(key) || key.startsWith("epub-locs-");
}

// The day a dated cache key belongs to ("2026-10-13"), or null when the key is
// not a dated cache (including epub-locs, which never expire by date).
export function cacheKeyDate(key: string): string | null {
  return key.match(DATED_CACHE)?.[1] ?? null;
}
