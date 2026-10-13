// Server-side feed cache with stale-while-revalidate, shared by the feed API
// routes (rss/arxiv, youtube, hf, reddit). Page loads used to refetch every
// feed from upstream; now the server owns freshness: a fresh entry is served
// as-is, a stale one is served instantly while a background refresh runs, and
// upstream is hit at most once per TTL per feed. The TTL is an admin setting
// (feedCacheMinutes); widgets carry a refresh button that forces a real fetch
// with ?refresh=1.

import { getFeedCacheMinutes } from "./appconfig";

const STALE_MS = 24 * 60 * 60 * 1000; // upstream down: old beats empty
// Keys include user-supplied URLs, so the map is capped: past this many
// entries the oldest are dropped (Map keeps insertion order, and set() below
// re-inserts on refresh, so the front of the map is the least recently stored).
const MAX_ENTRIES = 2000;

const store = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

// The admin TTL setting, re-read at most once a minute instead of a database
// query on every feed request.
let ttlCache = { at: 0, ms: 60 * 60 * 1000 };

export async function feedTtlMs(): Promise<number> {
  if (Date.now() - ttlCache.at < 60_000) return ttlCache.ms;
  const minutes = await getFeedCacheMinutes().catch(() => 60);
  ttlCache = { at: Date.now(), ms: minutes * 60 * 1000 };
  return ttlCache.ms;
}

function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const going = inflight.get(key);
  if (going) return going as Promise<T>;
  const p = fn()
    .then(value => {
      store.delete(key);
      store.set(key, { at: Date.now(), value });
      while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function cachedFeed<T>(key: string, fn: () => Promise<T>, force = false): Promise<T> {
  const hit = store.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (!force) {
    const ttl = await feedTtlMs();
    if (hit && age < ttl) return hit.value as T;
    if (hit && age < STALE_MS) {
      void run(key, fn).catch(() => {});
      return hit.value as T;
    }
  }
  try {
    return await run(key, fn);
  } catch (err) {
    if (hit && age < STALE_MS) return hit.value as T;
    throw err;
  }
}
