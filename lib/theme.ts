import * as storage from "@/lib/storage";
import { isDemoMode } from "@/lib/demo";

// Shared theme control, usable from anywhere (the settings drawer, the global
// Shift+D hotkey). Three themes: light, dark, and grey (dark with every widget
// palette remapped to the neutral one, see app/globals.css). The theme lives
// as classes on <html> (`dark`, plus `grey`), mirrored to localStorage for the
// pre-paint script in app/layout.tsx and to the database, and a `themechange`
// event tells mounted UI (the drawer's control) to sync.

export type Theme = "light" | "dark" | "grey";

export const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "grey", label: "Grey" },
];

export const THEME_EVENT = "themechange";
export const GLOW_EVENT = "glowchange";

// The neon glow around cards, chosen per theme: off in light by default, on in
// dark and grey. Applied as the `glow` class on <html> for the current theme
// (app/globals.css keys every card glow on it), mirrored to localStorage for
// the pre-paint script and to the database.
export type GlowPrefs = Record<Theme, boolean>;
export const DEFAULT_GLOW: GlowPrefs = { light: false, dark: true, grey: true };
let glowPrefs: GlowPrefs = DEFAULT_GLOW;

export function readGlow(raw: unknown): GlowPrefs {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    const picked = v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, b]) => k in DEFAULT_GLOW && typeof b === "boolean"))
      : {};
    return { ...DEFAULT_GLOW, ...picked };
  } catch {
    return DEFAULT_GLOW;
  }
}

export function currentGlow(): GlowPrefs {
  return glowPrefs;
}

export function setGlowClass(prefs: GlowPrefs = glowPrefs) {
  glowPrefs = prefs;
  document.documentElement.classList.toggle("glow", prefs[currentTheme()]);
}

export function applyGlow(prefs: GlowPrefs) {
  setGlowClass(prefs);
  if (!isDemoMode()) {
    try { localStorage.setItem("glow", JSON.stringify(prefs)); } catch { /* private mode */ }
  }
  storage.setItem("glow", JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent(GLOW_EVENT, { detail: prefs }));
}

export function readTheme(value: unknown): Theme {
  return value === "dark" || value === "grey" ? value : "light";
}

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const cl = document.documentElement.classList;
  return cl.contains("grey") ? "grey" : cl.contains("dark") ? "dark" : "light";
}

export function isDark(): boolean {
  return currentTheme() !== "light";
}

export function setThemeClasses(theme: Theme) {
  const cl = document.documentElement.classList;
  cl.toggle("dark", theme !== "light");
  cl.toggle("grey", theme === "grey");
  cl.toggle("glow", glowPrefs[theme]);
}

export function applyTheme(next: Theme) {
  setThemeClasses(next);

  // Firefox doesn't repaint an SVG's `currentColor` when it isn't being painted
  // — our action icons sit at opacity:0 until hover, so after a theme change the
  // non-hovered ones keep the old color until something forces a redraw. Nudge
  // every lucide icon (display none → reflow → restore) so they recolor live.
  // Same synchronous turn, so the browser never paints the hidden state — no
  // flicker, and scroll positions are untouched.
  document.querySelectorAll<SVGElement>("svg.lucide").forEach(svg => {
    svg.style.display = "none";
    void svg.getBoundingClientRect();
    svg.style.display = "";
  });

  // The localStorage mirror feeds the pre-paint script, so a demo-session
  // change must not touch it: it would survive exiting demo.
  if (!isDemoMode()) {
    try { localStorage.setItem("theme", next); } catch { /* private mode */ }
  }
  storage.setItem("theme", next);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
}

// Shift+D: light, dark, grey, and round again. Reads the live DOM classes as
// the source of truth so this stays correct from a key handler bound once.
export function toggleTheme() {
  const order: Theme[] = ["light", "dark", "grey"];
  applyTheme(order[(order.indexOf(currentTheme()) + 1) % order.length]);
}
