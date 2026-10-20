"use client";

import { useEffect, useRef, useState } from "react";
import * as storage from "@/lib/storage";
import { parseJson } from "@/lib/text";

// Remembers when each feed item first showed up in a widget, so a list can be
// ordered by arrival: a post that climbs into a subreddit's top list days
// after it was posted lands on top the day it appears, not deep in the list
// at its post date. Also reports the previous visit, for "new" badges.
//
// Stored per widget as `<prefix>-seen` ({ key: firstSeenMs }, the newest
// MAX_KEPT entries) and `<prefix>-visit` (ms of the last load).
const MAX_KEPT = 1500;

export function useFirstSeen<T>(
  prefix: string,
  items: T[],
  keyOf: (item: T) => string,
  dateOf: (item: T) => number,
): { firstSeen: Record<string, number>; lastVisit: number } {
  const [firstSeen, setFirstSeen] = useState<Record<string, number>>({});
  const [lastVisit, setLastVisit] = useState(0);
  // Null until the stored map has loaded; nothing is recorded or saved before
  // that, so a failed read can never overwrite the history.
  const loadedRef = useRef<Record<string, number> | null>(null);
  const keyOfRef = useRef(keyOf);
  const dateOfRef = useRef(dateOf);
  useEffect(() => { keyOfRef.current = keyOf; dateOfRef.current = dateOf; });

  useEffect(() => {
    let cancelled = false;
    Promise.all([storage.getItemResult(`${prefix}-seen`), storage.getItemResult(`${prefix}-visit`)]).then(([seen, visit]) => {
      if (cancelled || !seen.ok) return;
      const map = parseJson<Record<string, number>>(seen.value, {});
      loadedRef.current = map;
      setFirstSeen(map);
      setLastVisit(Number(visit.value) || 0);
      void storage.setItem(`${prefix}-visit`, String(Date.now()));
    });
    return () => { cancelled = true; };
  }, [prefix]);

  useEffect(() => {
    const known = loadedRef.current;
    if (!known || !items.length) return;
    // The very first run has no history: use each item's own date, so the
    // list starts out in date order instead of everything arriving "now".
    const firstRun = Object.keys(known).length === 0;
    const now = Date.now();
    let added = false;
    const next = { ...known };
    for (const item of items) {
      const k = keyOfRef.current(item);
      if (!k || k in next) continue;
      next[k] = firstRun ? dateOfRef.current(item) || now : now;
      added = true;
    }
    if (!added) return;
    const kept = Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, MAX_KEPT);
    const map = Object.fromEntries(kept);
    loadedRef.current = map;
    setFirstSeen(map);
    void storage.setItem(`${prefix}-seen`, JSON.stringify(map));
  }, [items, prefix, firstSeen]);

  return { firstSeen, lastVisit };
}
