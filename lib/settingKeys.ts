// What a Setting key is: a disposable cache (stored in the Cache table with an
// expiry), a widget instance's data (dropped once the instance is gone from
// every dashboard), or global config. One definition shared by the settings
// API, export, the config API and maintenance, so they can never disagree.

const DAY = 86_400_000;

// ── Caches ───────────────────────────────────────────────────────────────────
// An explicit allow-list on purpose: date-stamped keys are not all caches.
// Tracker logs (`tracker-day-<id>-<date>`) and notepad days
// (`notebook-<id>-day-<date>`) are user data and must never match.
const DATED_CACHE = /^(?:f1-cache-|hf-papers-|digest-ai-sections-|(?:reddit|youtube|rss|arxiv)-widget-).*?(\d{4}-\d{2}-\d{2})/;
const OTHER_CACHE = /^epub-locs-|^bank-widget-.+-cache$/;

export function isCacheKey(key: string): boolean {
  return DATED_CACHE.test(key) || OTHER_CACHE.test(key);
}

// The day a dated cache key belongs to ("2026-10-13"), or null when the key is
// not a dated cache.
export function cacheKeyDate(key: string): string | null {
  return key.match(DATED_CACHE)?.[1] ?? null;
}

// Dated caches stay for the day they belong to plus two more; the rest for a
// month from their last write.
export const CACHE_KEEP_DAYS = 2;
const UNDATED_CACHE_TTL = 30 * DAY;

export function cacheExpiry(key: string, now = Date.now()): Date {
  const day = cacheKeyDate(key);
  if (day) return new Date(Date.parse(`${day}T00:00:00Z`) + (CACHE_KEEP_DAYS + 1) * DAY);
  return new Date(now + UNDATED_CACHE_TTL);
}

// ── Widget data ──────────────────────────────────────────────────────────────
// Every per-instance key family and where the instance id sits in it. Keys
// outside this list (global config, unknown families) never count as widget
// data, so the leftover-data cleanup can only ever touch keys it understands.
const WIDGET_KEYS: RegExp[] = [
  /^(?:text|rss|reddit|youtube|arxiv|hf|weather|calendar|schedule|tv|kiwix|anytype|bank)-widget-(.+?)(?:-cache)?$/,
  /^reddit-(.+?)-(?:seen|visit)$/,
  /^chat-widget-(.+)$/,
  /^chat-(?!library-)(.+?)-(?:index|conv-.+)$/, // chat-library-* is the shared chat library, global
  /^notebook-(.+?)-(?:days|dates|name|day-\d{4}-\d{2}-\d{2})$/,
  /^reader-(?:config|position)-(.+)$/,
  /^tracker-(?:config|days)-(.+)$/,
  /^tracker-day-(.+)-\d{4}-\d{2}-\d{2}$/,
  /^rhythm-(?:config|log)-(.+)$/,
  /^upkeep-(?:config|log|days)-(.+)$/,
  /^deficit-(?:config|days)-(.+)$/,
  /^bookmarks-config-(.+)$/,
  /^typing-(?:config|stats)-(.+)$/,
  /^chess-(.+)$/,
];

// The widget instance a key belongs to, or null for caches, global config and
// anything not in the list above.
export function instanceIdOf(key: string): string | null {
  if (isCacheKey(key)) return null;
  for (const re of WIDGET_KEYS) {
    const m = key.match(re);
    if (m) return m[1];
  }
  return null;
}
