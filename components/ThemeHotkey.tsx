"use client";

import { useEffect } from "react";
import { toggleTheme } from "@/lib/theme";

// Global Shift+D theme toggle. Lives in the root layout so it works on every
// page (dashboard, /digest, /login), unlike the TopBar which only renders on the
// dashboard. Ignored while typing in a field.
export default function ThemeHotkey() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !e.shiftKey || e.code !== "KeyD") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      e.preventDefault();
      toggleTheme();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
