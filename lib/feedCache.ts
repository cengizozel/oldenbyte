// Server-side feed cache with stale-while-revalidate, shared by the feed API
// routes (rss/arxiv, youtube, hf, reddit). Page loads used to refetch every
// feed from upstream; now the server owns freshness: a fresh entry is served
// as-is, a stale one is served instantly while a background refresh runs, and
// upstream is hit at most once per TTL per feed. The TTL is an admin setting
// (feedCacheMinutes); widgets carry a refresh button that forces a real fetch
// with ?refresh=1.

import { getConfig } from "./appconfig";

const STALE_MS = 24 * 60 * 60 * 1000; // upstream down: old beats empty
export const DEFAULT_FEED_TTL_MIN = 60;

const store = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export async function feedTtlMs(): Promise<number> {
  const v = Number(await getConfig("feedCacheMinutes").catch(() => null));
  return (Number.isFinite(v) && v >= 1 ? v : DEFAULT_FEED_TTL_MIN) * 60 * 1000;
}

function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const going = inflight.get(key);
  if (going) return going as Promise<T>;
  const p = fn()
    .then(value => {
      store.set(key, { at: Date.now(), value });
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
