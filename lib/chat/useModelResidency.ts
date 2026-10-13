"use client";

import { useCallback, useEffect, useState } from "react";

// Model residency (Ollama / LM Studio). `backend` is null until we know what
// this server is: null = not a controllable backend (control hidden),
// "ollama"/"lmstudio" = supported. `models` carries residency (expiresAt is
// Ollama-only; loaded is the flag).
export type Backend = "ollama" | "lmstudio" | null;
type PowerState = { backend: Backend; models: { name: string; expiresAt: string | null; loaded: boolean }[] };
const NONE: PowerState = { backend: null, models: [] };

// Polls residency every 5s while a model is configured and `active` (the
// widget is on screen); polling pauses while hidden and resumes, with an
// immediate poll, when it is visible again.
export function useModelResidency(baseUrl: string, model: string, active: boolean) {
  const [power, setPower] = useState<PowerState>(NONE);
  const configured = Boolean(baseUrl && model);

  const poll = useCallback(async () => {
    if (!baseUrl || !model) { setPower(NONE); return; }
    try {
      const res = await fetch(`/api/model?baseUrl=${encodeURIComponent(baseUrl)}`);
      const data = await res.json();
      setPower({ backend: data.backend ?? null, models: data.models ?? [] });
    } catch {
      setPower(NONE);
    }
  }, [baseUrl, model]);

  useEffect(() => {
    if (!configured) { setPower(NONE); return; }
    if (!active) return;
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [configured, active, poll]);

  // Low-level residency change. Ollama: keep_alive ("5m" | -1 | 0). LM Studio:
  // action "pin" (manual load) | "unload".
  const post = useCallback(async (body: Record<string, unknown>) => {
    try {
      await fetch("/api/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, model, backend: power.backend, ...body }),
      });
    } catch {}
  }, [baseUrl, model, power.backend]);

  // Match the configured model to a residency entry. Servers tag names (Ollama
  // "llama3.2:latest"; LM Studio "publisher/model") so accept base/prefix matches.
  const base = (s: string) => s.split(":")[0];
  const entry = power.models.find(
    m => m.name === model || base(m.name) === base(model) || m.name.startsWith(model)
  );

  return {
    backend: power.backend,
    capable: power.backend !== null,
    isLoaded: !!entry?.loaded,
    // Only Ollama reports an unload time.
    expiresAt: entry?.expiresAt ?? null,
    poll,
    post,
  };
}

// Map a keep-alive preset to LM Studio's ttl (seconds). "-1"/"" mean no ttl.
export const ttlSeconds = (v: string) => ({ "5m": 300, "30m": 1800, "1h": 3600 } as Record<string, number>)[v] ?? 0;
