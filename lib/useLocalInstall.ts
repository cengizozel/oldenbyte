"use client";

// Whether this dashboard is the desktop app's own (one person, their own
// computer, signed in by the app): /api/me says so. Asked once per page.
import { useEffect, useState } from "react";

let asked: Promise<boolean> | null = null;

export function useLocalInstall(): boolean {
  const [local, setLocal] = useState(false);
  useEffect(() => {
    asked ??= fetch("/api/me").then(r => (r.ok ? r.json() : null)).then(d => d?.local === true).catch(() => false);
    let alive = true;
    asked.then(v => { if (alive) setLocal(v); });
    return () => { alive = false; };
  }, []);
  return local;
}
