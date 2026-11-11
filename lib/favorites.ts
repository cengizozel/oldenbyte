"use client";

import * as storage from "@/lib/storage";

// Favorites: items the user hearted in a feed. User-level, in one key, so they
// outlive the widget that showed them (delete the Feed widget, add another,
// and they are still there). Every Feed widget on the page shares one copy in
// memory, so a heart in one shows in the others at once.
//
// An item is known by its link, normalized so the same story keeps the same
// identity when it drops out of a feed and comes back, or comes back with a
// tracking parameter or a different scheme. A headline edited by the feed
// updates the saved title the next time the item is seen; the link never
// changes what it is.

export type Favorite = {
  id: string;
  title: string;
  link: string;
  source: string;      // the feed's name when it was saved
  savedAt: number;
  publishedAt?: string;
};

const KEY = "favorites";
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|cmpid$|ocid$|guccounter$|taid$)/i;

export function favoriteId(link: string, title = ""): string {
  try {
    const u = new URL(link);
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? "?" + new URLSearchParams(params).toString() : "";
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${query}`;
  } catch {
    return `title:${title.trim().toLowerCase().replace(/\s+/g, " ")}`;
  }
}

let list: Favorite[] | null = null;
let loading: Promise<Favorite[]> | null = null;
const listeners = new Set<(list: Favorite[]) => void>();

export function subscribeFavorites(fn: (list: Favorite[]) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function loadFavorites(): Promise<Favorite[]> {
  if (list) return Promise.resolve(list);
  if (!loading) {
    loading = storage.getItemResult(KEY).then(res => {
      loading = null;
      if (!res.ok) return [];
      let parsed: Favorite[] = [];
      try { const v = res.value ? JSON.parse(res.value) : []; if (Array.isArray(v)) parsed = v; } catch { /* unreadable: start empty in memory, but never save over it */ return []; }
      list = parsed;
      return list;
    });
  }
  return loading;
}

function commit(next: Favorite[]) {
  list = next;
  listeners.forEach(fn => fn(next));
  storage.setItem(KEY, JSON.stringify(next));
}

// Heart or unheart an item. Returns whether it is a favorite afterwards.
export async function toggleFavorite(item: { title: string; link: string; pubDate?: string }, source: string): Promise<boolean> {
  const current = await loadFavorites();
  if (!list) return false; // the stored list could not be read: change nothing
  const id = favoriteId(item.link, item.title);
  if (current.some(f => f.id === id)) {
    commit(current.filter(f => f.id !== id));
    return false;
  }
  commit([{ id, title: item.title, link: item.link, source, savedAt: Date.now(), ...(item.pubDate ? { publishedAt: item.pubDate } : {}) }, ...current]);
  return true;
}

// Items a feed is showing now: a saved one whose headline changed takes the
// new title (and the newest link, if only its tracking part moved).
export function refreshFavorites(items: { title: string; link: string }[]) {
  if (!list?.length) return;
  let changed = false;
  const next = list.map(f => {
    const live = items.find(it => favoriteId(it.link, it.title) === f.id);
    if (!live || (live.title === f.title && live.link === f.link)) return f;
    changed = true;
    return { ...f, title: live.title || f.title, link: live.link || f.link };
  });
  if (changed) commit(next);
}
