"use client";

import { useEffect, useState } from "react";

// "Show only this source" for feed widgets (a subreddit, a YouTube channel).
// Clicking the same source again, the header chip's x, or Escape clears it.
// Escape is ignored while typing in a field, so it never fights an input.
export function useFeedFilter(): [string | null, (source: string | null) => void, (source: string) => void] {
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!filter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      setFilter(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filter]);

  const toggle = (source: string) => setFilter(f => (f === source ? null : source));
  return [filter, setFilter, toggle];
}
