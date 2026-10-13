"use client";

import { useEffect, useState } from "react";
import { fmtRemaining } from "@/lib/chat/format";
import type { Backend } from "@/lib/chat/useModelResidency";

// Live timers own their intervals so a tick re-renders only the few
// characters it changes, never the whole chat. Both stop while `active` is
// false (widget off screen) and catch up on the next tick when it returns.

// Seconds since `start` (a performance.now() value), ticking every 150ms.
export function ElapsedSeconds({ start, active }: { start: number; active: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(performance.now());
    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [active]);
  const secs = now ? Math.max(0, now - start) / 1000 : 0;
  return <>{secs.toFixed(1)}s</>;
}

// The residency pill text: "asleep", "ready", "ready · ∞" or a live countdown
// to Ollama's unload ("ready · 4m"), ticking once a second.
export function ResidencyLabel({ backend, isLoaded, expiresAt, keepAlive, active }: {
  backend: Backend;
  isLoaded: boolean;
  expiresAt: string | null;
  keepAlive: string;
  active: boolean;
}) {
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!active || backend === null) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, backend]);
  const remainingMs = expiresAt ? new Date(expiresAt).getTime() - (nowMs || Date.now()) : 0;
  // Only Ollama reports an unload time, so the countdown is Ollama-only.
  const hasCountdown = backend === "ollama" && isLoaded && remainingMs > 0;
  // keep_alive -1 pushes expires_at far into the future: treat >30 days as pinned.
  const pinned = (backend === "ollama" && remainingMs > 1000 * 60 * 60 * 24 * 30)
    || (backend === "lmstudio" && keepAlive === "-1" && isLoaded);
  return <>{isLoaded ? (pinned ? "ready · ∞" : hasCountdown ? `ready · ${fmtRemaining(remainingMs)}` : "ready") : "asleep"}</>;
}
