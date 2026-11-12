"use client";

import { useEffect, useState } from "react";
import { knownHosts, listModelConnections, type KnownModelServer } from "@/lib/dashboardContext";

// Model servers to offer wherever a model address is entered (the Assistant's
// settings, the digest): ones the user's Assistants already use, and ones
// found by looking on the usual ports (Ollama, LM Studio, llama.cpp) of this
// server and the hosts other widgets talk to (/api/chat?discover=1).

export type FoundServer = { url: string; kind: string; models: string[] };
export type ServerOffer = { key: string; url: string; model: string; note: string; label: string };

export function useModelServers(exceptWidgetId?: string) {
  const [known, setKnown] = useState<KnownModelServer[]>([]);
  const [found, setFound] = useState<FoundServer[] | null>(null);
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    listModelConnections(exceptWidgetId).then(setKnown).catch(() => {});
  }, [exceptWidgetId]);

  async function find() {
    setFinding(true);
    try {
      const hosts = await knownHosts();
      const res = await fetch(`/api/chat?discover=1&hosts=${encodeURIComponent(hosts.join(","))}`);
      const data = await res.json();
      setFound(Array.isArray(data.servers) ? data.servers : []);
    } catch {
      setFound([]);
    } finally {
      setFinding(false);
    }
  }

  // One-click choices, minus the connection already entered.
  function offers(currentUrl: string, currentModel: string): ServerOffer[] {
    const cur = currentUrl.trim().replace(/\/+$/, "").toLowerCase();
    const label = (url: string, model: string) => `${url.replace(/^https?:\/\//, "").replace(/\/v1$/, "")}${model ? ` · ${model}` : ""}`;
    return [
      ...known
        .filter(k => !(k.url.toLowerCase() === cur && k.model === currentModel))
        .map(k => ({ key: `k|${k.url}|${k.model}`, url: k.url, model: k.model, note: "used by an Assistant", label: label(k.url, k.model) })),
      ...(found ?? [])
        .filter(f => f.url.toLowerCase() !== cur && !known.some(k => k.url.toLowerCase() === f.url.toLowerCase()))
        .map(f => ({ key: `f|${f.url}`, url: f.url, model: f.models[0] ?? "", note: `${f.kind}, ${f.models.length} model${f.models.length === 1 ? "" : "s"}`, label: label(f.url, f.models[0] ?? "") })),
    ];
  }

  // True after a search that found nothing new.
  const nothingFound = found !== null && found.length === 0;

  return { find, finding, offers, nothingFound };
}
