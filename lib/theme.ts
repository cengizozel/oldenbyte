import * as storage from "@/lib/storage";

// Shared light/dark theme control, usable from anywhere (TopBar button, the
// global Shift+D hotkey). Reads/writes the `.dark` class on <html>, mirrors it
// to localStorage (for the pre-paint FOUC script) and the database, and emits a
// `themechange` event so any mounted UI (e.g. the TopBar switch) can sync.

export const THEME_EVENT = "themechange";

export function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function applyTheme(next: boolean) {
  document.documentElement.classList.toggle("dark", next);

  // Firefox doesn't repaint an SVG's `currentColor` when it isn't being painted
  // — our action icons sit at opacity:0 until hover, so after a theme toggle the
  // non-hovered ones keep the old color until something forces a redraw. Nudge
  // every lucide icon (display none → reflow → restore) so they recolor live.
  // Same synchronous turn, so the browser never paints the hidden state — no
  // flicker, and scroll positions are untouched.
  document.querySelectorAll<SVGElement>("svg.lucide").forEach(svg => {
    svg.style.display = "none";
    void svg.getBoundingClientRect();
    svg.style.display = "";
  });

  const value = next ? "dark" : "light";
  try { localStorage.setItem("theme", value); } catch { /* private mode */ }
  storage.setItem("theme", value);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
}

// Read the live DOM class as the source of truth so this stays correct even
// from a key handler bound once (no stale React state).
export function toggleTheme() {
  applyTheme(!isDark());
}
