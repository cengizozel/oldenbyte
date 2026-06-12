"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared scroll-fade state for widget scroll containers. Attach `ref` to the
// scrollable element and `onScroll` to its onScroll prop; render fades with
// <ScrollFades> from components/ui/WidgetChrome. Pass deps that change the
// scrollable content (e.g. [items]) so overflow is re-measured.
export function useScrollFade<T extends HTMLElement = HTMLDivElement>(deps: unknown[] = []) {
  const ref = useRef<T | null>(null);
  const [topFade, setTopFade] = useState(false);
  const [bottomFade, setBottomFade] = useState(false);

  const check = useCallback((el: T) => {
    const overflows = el.scrollHeight > el.clientHeight + 1;
    setBottomFade(overflows && el.scrollHeight - el.scrollTop - el.clientHeight > 20);
    setTopFade(overflows && el.scrollTop > 20);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    check(el);
    const ro = new ResizeObserver(() => check(el));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const onScroll = useCallback((e: React.UIEvent<T>) => check(e.currentTarget), [check]);

  return { ref, onScroll, topFade, bottomFade };
}
