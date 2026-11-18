"use client";

import { useEffect, useState } from "react";
import { shellNow, shellTitleNow, type Shell } from "@/lib/shell";

// Whether the page is inside the phone app's native shell (lib/shell.ts).
// Also marks the document, in case the app's own mark ran too early.
export function useShell(): Shell {
  const [shell, setShell] = useState<Shell>(null);
  useEffect(() => {
    const s = shellNow();
    setShell(s);
    if (s) document.documentElement.setAttribute("data-ob-shell", s);
  }, []);
  return shell;
}

// Whether the app draws the page's title itself (lib/shell.ts).
export function useShellTitle(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(shellTitleNow()); }, []);
  return on;
}
