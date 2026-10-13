"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

// A function with a fixed identity that always calls the latest `fn`. Lets
// memoized children take handlers without re-rendering when the parent does.
// Only call it from event handlers, never during render.
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args: A) => ref.current(...args), []);
}
