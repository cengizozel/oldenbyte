"use client";

// The custom widgets installed for this account, shared by everything that
// shows them: the grid (templates), each widget (its file and whether it may
// run), the picker and Settings. One fetch, refreshed after any change.
import { useEffect, useSyncExternalStore } from "react";
import { ELEVATED_OFF, type ElevatedSettings, type InstalledWidget } from "@/lib/customWidgets";

type Snapshot = { loaded: boolean; widgets: InstalledWidget[]; elevated: ElevatedSettings };
let snapshot: Snapshot = { loaded: false, widgets: [], elevated: ELEVATED_OFF };
const EMPTY: Snapshot = snapshot;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function set(next: Snapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

export function refreshCustomWidgets(): Promise<void> {
  inFlight ??= fetch("/api/custom-widgets")
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then((d: { widgets?: InstalledWidget[]; elevated?: ElevatedSettings }) => {
      set({ loaded: true, widgets: Array.isArray(d.widgets) ? d.widgets : [], elevated: d.elevated ?? ELEVATED_OFF });
    })
    .catch(() => { set({ ...snapshot, loaded: true }); })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useCustomWidgets(): Snapshot {
  const snap = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
  useEffect(() => { if (!snapshot.loaded) refreshCustomWidgets(); }, []);
  return snap;
}

// A widget's file, fetched once per installed version.
const sources = new Map<string, Promise<string | null>>();
export function loadSource(w: InstalledWidget): Promise<string | null> {
  const key = `${w.ext}@${w.manifest.version}@${w.installedAt}`;
  let p = sources.get(key);
  if (!p) {
    p = fetch(`/api/custom-widgets/source?ext=${encodeURIComponent(w.ext)}`)
      .then(r => (r.ok ? r.text() : null))
      .catch(() => null);
    sources.set(key, p);
    p.then(v => { if (v === null) sources.delete(key); });
  }
  return p;
}

// ── Changes ──────────────────────────────────────────────────────────────────
async function send(url: string, init: RequestInit): Promise<{ ok: true; widget?: InstalledWidget } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "That did not work." };
    await refreshCustomWidgets();
    return { ok: true, widget: data.widget };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

export const uploadCustomWidget = (html: string) => send("/api/custom-widgets", { method: "POST", body: JSON.stringify({ html }) });
export const installCatalogWidget = (id: string) => send("/api/custom-widgets/catalog", { method: "POST", body: JSON.stringify({ id }) });
export const setCustomWidgetEnabled = (ext: string, enabled: boolean) => send("/api/custom-widgets", { method: "PATCH", body: JSON.stringify({ ext, enabled }) });
export const removeCustomWidget = (ext: string) => send(`/api/custom-widgets?ext=${encodeURIComponent(ext)}`, { method: "DELETE" });
