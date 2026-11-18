// The phone app's native shell (docs/mobile.md, Inside the app). The app draws
// what floats over the page with the phone's own controls (the bar at the
// bottom is Apple's on an iPhone and Google's on Android) and shows this page
// under it, one web view per tab. The app says so before the page loads by
// setting window.__obShell; the page then leaves its own bar out
// (`[data-ob-shell]` in globals.css) and talks to the app in small messages.

export type Shell = "ios" | "android" | null;

type AppWindow = Window & { __obShell?: unknown; ReactNativeWebView?: { postMessage: (m: string) => void } };

export function shellNow(): Shell {
  if (typeof window === "undefined") return null;
  const s = (window as AppWindow).__obShell;
  return s === "ios" || s === "android" ? s : null;
}

// Messages to the app: { type: "oldenbyte:<what>", ... }.
export function tellShell(message: { type: string } & Record<string, unknown>) {
  try { (window as AppWindow).ReactNativeWebView?.postMessage(JSON.stringify(message)); } catch { /* not in the app */ }
}

// Each tab is a page of its own, and a page that saves over a value another
// page changed is refused (lib/storage). So a page tells the app when it
// saved something, and the app loads the other tabs again when they are next
// shown. Many saves in a row are told once.
let told: ReturnType<typeof setTimeout> | null = null;
export function noteSaved() {
  if (!shellNow() || told) return;
  told = setTimeout(() => { told = null; tellShell({ type: "oldenbyte:changed" }); }, 250);
}

// Asked by the app (it runs this in the dashboard's page): start editing the layout.
export const SHELL_EDIT_EVENT = "oldenbyte:edit-layout";

// Asked by the app, as a CustomEvent on window with detail { do, ... }:
// "switch" (id), "fields", "manage", "edit-done", "edit-cancel" on the
// dashboard; "again" and "setup" on the digest.
export const SHELL_ASK_EVENT = "oldenbyte:shell";

// An app that also draws the title sets window.__obShellTitle, and marks the
// document with data-ob-title so the rows are hidden by CSS from the first
// paint; the pages then leave their own title rows out.
export function shellTitleNow(): boolean {
  return typeof window !== "undefined" && !!shellNow() && (window as AppWindow & { __obShellTitle?: unknown }).__obShellTitle === true;
}
