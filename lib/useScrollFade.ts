"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

// Shared scroll-fade state for widget scroll containers. Attach `ref` to the
// scrollable element and `onScroll` to its onScroll prop; render fades with
// <ScrollFades> from components/ui/WidgetChrome. Pass deps that change the
// scrollable content (e.g. [items]) so overflow is re-measured.
export function useScrollFade<T extends HTMLElement = HTMLDivElement>(deps: unknown[] = []) {
  const ref = useRef<T | null>(null);
  const [topFade, setTopFade] = useState(false);
  const [bottomFade, setBottomFade] = useState(false);

  const shown = useRef({ top: false, bottom: false });
  const check = useCallback((el: T, now = false) => {
    const overflows = el.scrollHeight > el.clientHeight + 1;
    const next = { top: overflows && el.scrollTop > 20, bottom: overflows && el.scrollHeight - el.scrollTop - el.clientHeight > 20 };
    if (next.top === shown.current.top && next.bottom === shown.current.bottom) return;
    shown.current = next;
    const apply = () => { setTopFade(next.top); setBottomFade(next.bottom); };
    // A list that just became visible (its tab opened, its card flipped back)
    // measures here, after layout and before paint: commit at once so the
    // first frame already has its fades instead of flashing without them.
    if (now) flushSync(apply); else apply();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    check(el);
    const ro = new ResizeObserver(() => check(el, true));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const onScroll = useCallback((e: React.UIEvent<T>) => check(e.currentTarget), [check]);

  return { ref, onScroll, topFade, bottomFade };
}
