"use client";

import { useEffect, useState } from "react";
import * as storage from "@/lib/storage";
import { TZ_EVENT } from "@/lib/timezone";

// The saved timezone preference, kept live: widgets that print a wall-clock
// time use it so a browser that hides its real zone (privacy settings often
// report UTC) still shows the hours the user lives in. Lives apart from
// lib/timezone.ts, which server code imports and which must stay hook-free.
export function useTimezone(): string {
  const [tz, setTz] = useState("");
  useEffect(() => {
    let alive = true;
    storage.getItem("timezone").then(v => { if (alive) setTz(v ?? ""); });
    const onTz = (e: Event) => setTz(String((e as CustomEvent).detail ?? ""));
    window.addEventListener(TZ_EVENT, onTz);
    return () => { alive = false; window.removeEventListener(TZ_EVENT, onTz); };
  }, []);
  return tz;
}
