"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

// Visited dashboards stay mounted while hidden (and with the preload setting,
// all of them are). Widgets that do ongoing work (polling, streaming, timers)
// can read useWidgetActive() to pause while nobody can see them: it is true
// only when the widget's dashboard is the one on screen AND the browser tab is
// visible. WidgetGrid provides the value; outside a grid it defaults to true.
export const WidgetActiveContext = createContext(true);

export function useWidgetActive(): boolean {
  return useContext(WidgetActiveContext);
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

// Whether the browser tab is visible; true during server rendering.
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}
