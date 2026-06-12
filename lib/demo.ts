// Demo mode: preview the first-run experience without touching real data.
// While active, lib/storage routes every read and write to an in-memory copy
// of the first-run seed, so the demo dashboards appear fully configured and
// any edits evaporate on exit or refresh. The flag lives in sessionStorage so
// demo mode survives reloads within the tab but never leaks across sessions.

import { buildSeed, SEEDED_DASHBOARDS } from "@/lib/seed";

const FLAG = "oldenbyte-demo";

let store: Map<string, string> | null = null;

// The mode is captured once per page load. Entering and exiting both flip the
// flag and reload, so a live page must keep its original mode until teardown:
// otherwise an async write resolving between the flag flip and the navigation
// (e.g. an aborted chat stream persisting itself) would cross the sandbox
// boundary and hit the wrong store.
let mode: boolean | null = null;

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  if (mode === null) {
    try {
      mode = window.sessionStorage.getItem(FLAG) === "1";
    } catch {
      mode = false;
    }
  }
  return mode;
}

export function enterDemoMode(): void {
  try {
    window.sessionStorage.setItem(FLAG, "1");
  } catch {}
  window.location.reload();
}

export function exitDemoMode(): void {
  try {
    window.sessionStorage.removeItem(FLAG);
  } catch {}
  window.location.reload();
}

function demoStore(): Map<string, string> {
  if (!store) {
    store = new Map();
    for (const [key, value] of Object.entries(buildSeed())) {
      store.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    store.set("dashboards", JSON.stringify(SEEDED_DASHBOARDS));
  }
  return store;
}

export function demoGetItem(key: string): string | null {
  return demoStore().get(key) ?? null;
}

export function demoSetItem(key: string, value: string): void {
  demoStore().set(key, value);
}

export function demoRemoveItem(key: string): void {
  demoStore().delete(key);
}
