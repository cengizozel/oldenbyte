"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Layers, Search, Loader, ExternalLink, Home } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput, SettingsSelect } from "@/components/ui/Field";
import { PencilButton, ScrollFades, LoadingState, EmptyState, SaveCancelRow } from "@/components/ui/WidgetChrome";

type AnytypeObject = { id: string; name: string; snippet: string; spaceId: string; type: string };
type Space = { id: string; name: string };
type AnytypeConfig = { baseUrl: string; apiKey: string; spaceId: string; spaceName: string; limit: number };

const DEFAULT: AnytypeConfig = { baseUrl: "http://127.0.0.1:31009", apiKey: "", spaceId: "", spaceName: "", limit: 25 };

// Deep-link that opens an object in the Anytype desktop app.
function deepLink(o: AnytypeObject): string {
  return `anytype://object?objectId=${encodeURIComponent(o.id)}&spaceId=${encodeURIComponent(o.spaceId)}`;
}

export default function AnytypeWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `anytype-widget-${widget.id}`;

  const [config, setConfig] = useState<AnytypeConfig>(DEFAULT);
  const [query, setQuery] = useState("");
  const [objects, setObjects] = useState<AnytypeObject[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<AnytypeConfig>(DEFAULT);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);

  // Pairing flow: idle → (Pair) → awaiting-code → (confirm) → paired.
  const [pairing, setPairing] = useState<"idle" | "awaiting-code">("idle");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [pairBusy, setPairBusy] = useState(false);

  const configured = Boolean(config.baseUrl && config.apiKey && config.spaceId);

  const { ref: scrollRef, onScroll, topFade, bottomFade } = useScrollFade([objects, searching, error]);

  useEffect(() => {
    storage.getItem(storageKey).then((saved) => {
      if (!saved) return;
      try {
        const parsed = { ...DEFAULT, ...JSON.parse(saved) } as AnytypeConfig;
        setConfig(parsed);
        setDraft(parsed);
      } catch {}
    });
  }, [storageKey]);

  // Run a search (empty query = recent objects, sorted by last-modified).
  const search = useCallback(async (q: string, cfg: AnytypeConfig, markSearched: boolean) => {
    searchAbort.current?.abort();
    const ctrl = new AbortController();
    searchAbort.current = ctrl;
    setSearching(true);
    setError("");
    if (markSearched) setSearched(true);
    try {
      const url = `/api/anytype?op=search&baseUrl=${encodeURIComponent(cfg.baseUrl)}&apiKey=${encodeURIComponent(cfg.apiKey)}&spaceId=${encodeURIComponent(cfg.spaceId)}&q=${encodeURIComponent(q)}&limit=${cfg.limit}`;
      const res = await fetch(url, { signal: ctrl.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setObjects(data.objects ?? []);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(String((e as Error).message ?? e));
      setObjects([]);
    } finally {
      if (searchAbort.current === ctrl) setSearching(false);
    }
  }, []);

  // Load recent objects whenever a configured space is ready.
  useEffect(() => {
    if (!configured) return;
    search("", config, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.apiKey, config.spaceId, configured]);

  function runSearch() {
    if (!configured) return;
    setSearched(true);
    search(query.trim(), config, true);
  }

  function goHome() {
    searchAbort.current?.abort();
    setQuery("");
    setSearched(false);
    setError("");
    if (configured) search("", config, false);
  }

  // ── Pairing ──────────────────────────────────────────────────────────────
  async function startPairing() {
    setError("");
    if (!draft.baseUrl.startsWith("http")) { setError("Enter the Anytype API URL (http://…)."); return; }
    setPairBusy(true);
    try {
      const res = await fetch("/api/anytype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "challenge", baseUrl: draft.baseUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setChallengeId(data.challengeId);
      setPairing("awaiting-code");
      setCode("");
    } catch (e) {
      setError(`Could not reach Anytype: ${String((e as Error).message ?? e)}. Is the desktop app running?`);
    } finally {
      setPairBusy(false);
    }
  }

  async function confirmCode() {
    setError("");
    if (!code.trim()) { setError("Enter the 4-digit code from Anytype."); return; }
    setPairBusy(true);
    try {
      const res = await fetch("/api/anytype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "key", baseUrl: draft.baseUrl, challengeId, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const nextDraft = { ...draft, apiKey: data.apiKey };
      setDraft(nextDraft);
      setPairing("idle");
      await loadSpaces(nextDraft.baseUrl, data.apiKey, nextDraft.spaceId);
    } catch (e) {
      setError(`Pairing failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setPairBusy(false);
    }
  }

  async function loadSpaces(baseUrl: string, apiKey: string, preferred: string) {
    if (!baseUrl.startsWith("http") || !apiKey) return;
    setLoadingSpaces(true);
    setSpaces([]);
    try {
      const res = await fetch(`/api/anytype?op=spaces&baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const list: Space[] = data.spaces ?? [];
      setSpaces(list);
      const keep = list.find((s) => s.id === preferred);
      const pick = keep ?? list[0];
      if (pick) setDraft((d) => ({ ...d, spaceId: pick.id, spaceName: pick.name }));
    } catch (e) {
      setError(`Could not load spaces: ${String((e as Error).message ?? e)}`);
    } finally {
      setLoadingSpaces(false);
    }
  }

  function openSettings() {
    setDraft(config);
    setSpaces([]);
    setPairing("idle");
    setError("");
    setSettingsOpen(true);
    if (config.baseUrl && config.apiKey) loadSpaces(config.baseUrl, config.apiKey, config.spaceId);
  }

  async function handleSave() {
    setError("");
    if (!draft.baseUrl.startsWith("http")) { setError("Enter the Anytype API URL (http://…)."); return; }
    if (!draft.apiKey) { setError("Pair with Anytype first."); return; }
    if (!draft.spaceId) { setError("Pick a space."); return; }
    if (draft.spaceId !== config.spaceId) { setObjects([]); setQuery(""); setSearched(false); }
    setConfig(draft);
    await storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
  }

  async function handleReset() {
    await storage.removeItem(storageKey);
    setConfig(DEFAULT);
    setDraft(DEFAULT);
    setSpaces([]);
    setObjects([]);
    setQuery("");
    setSearched(false);
    setPairing("idle");
    setSettingsOpen(false);
  }

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
              <span className="opacity-50 shrink-0"><Layers size={14} /></span>
              <span className="text-xs font-medium opacity-60 truncate">{config.spaceName || "Anytype"}</span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              {(searched || query) && (
                <button onClick={goHome} title="Back to recent" className={`opacity-60 hover:opacity-100 transition-opacity ${c.icon}`}>
                  <Home size={14} />
                </button>
              )}
              <PencilButton c={c} onClick={openSettings} />
            </div>
          </div>

          {configured ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="relative shrink-0 mb-3">
                <Search size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40 ${c.text}`} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  placeholder="Search your spaces…"
                  className={`w-full text-sm rounded-xl pl-8 pr-3 py-1.5 outline-none bg-black/5 dark:bg-white/5 border border-transparent focus:border-black/10 dark:focus:border-white/10 ${c.text} placeholder:opacity-40`}
                />
              </div>
              <div className="flex-1 min-h-0 relative">
                <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pr-3" onScroll={onScroll}>
                  {searching ? (
                    <LoadingState c={c} />
                  ) : error ? (
                    <p className="text-red-400 text-xs break-words">{error}</p>
                  ) : objects.length ? (
                    <ul className="flex flex-col">
                      {objects.map((o, i) => (
                        <li key={o.id} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                          <div className="flex items-start gap-1 group/title">
                            <a
                              href={deepLink(o)}
                              className={`flex-1 min-w-0 text-left text-sm leading-snug font-medium break-words ${c.text} hover:opacity-70 transition-opacity`}
                              title="Open in Anytype"
                            >
                              {o.name}
                            </a>
                            <a
                              href={deepLink(o)}
                              className={`shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-90 dark:group-hover/title:opacity-70 hover:!opacity-100 transition-opacity ${c.icon}`}
                              title="Open in Anytype"
                            >
                              <ExternalLink size={11} />
                            </a>
                          </div>
                          {o.snippet && <p className={`text-xs mt-0.5 opacity-50 ${c.text} line-clamp-2 break-words`}>{o.snippet}</p>}
                          {o.type && <span className={`text-[10px] opacity-40 ${c.label}`}>{o.type}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState c={c}>{searched ? "No objects found." : "No recent objects."}</EmptyState>
                  )}
                </div>
                <ScrollFades c={c} top={topFade} bottom={bottomFade} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center">
              <EmptyState c={c} action="connect your Anytype app" />
            </div>
          )}
        </>
      }
      back={
        <>
          <SettingsInput
            type="url"
            value={draft.baseUrl}
            onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value, apiKey: "" }))}
            placeholder="http://127.0.0.1:31009"
          />

          {/* Pairing / paired state */}
          {draft.apiKey ? (
            <div className="flex items-center gap-2">
              {loadingSpaces ? (
                <span className="flex items-center gap-1.5 text-xs text-neutral-400"><Loader size={12} className="animate-spin" /> loading spaces…</span>
              ) : spaces.length > 0 ? (
                <SettingsSelect
                  value={draft.spaceId}
                  onChange={(e) => {
                    const s = spaces.find((x) => x.id === e.target.value);
                    setDraft((d) => ({ ...d, spaceId: e.target.value, spaceName: s?.name ?? "" }));
                  }}
                  className="flex-1 min-w-0"
                >
                  {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </SettingsSelect>
              ) : (
                <span className="text-xs text-neutral-400 truncate min-w-0">{draft.spaceName || "paired ✓, no spaces loaded"}</span>
              )}
              <button
                onClick={() => loadSpaces(draft.baseUrl, draft.apiKey, draft.spaceId)}
                className="text-xs px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-800 shrink-0"
              >
                Reload
              </button>
            </div>
          ) : pairing === "awaiting-code" ? (
            <div className="flex flex-col gap-1.5">
              <p className={`text-xs opacity-60 ${c.label}`}>Enter the 4-digit code shown in Anytype:</p>
              <div className="flex items-center gap-2">
                <SettingsInput
                  autoFocus
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirmCode()}
                  placeholder="1234"
                  className="flex-1 min-w-0 tracking-widest"
                />
                <button
                  onClick={confirmCode}
                  disabled={pairBusy || !code.trim()}
                  className="text-xs px-3 py-2 rounded-lg bg-white border border-neutral-200 text-neutral-700 hover:text-neutral-900 disabled:opacity-40 shrink-0"
                >
                  {pairBusy ? <Loader size={12} className="animate-spin" /> : "Confirm"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={startPairing}
              disabled={pairBusy || !draft.baseUrl.startsWith("http")}
              className="text-xs px-3 py-2 rounded-lg bg-white border border-neutral-200 text-neutral-700 hover:text-neutral-900 disabled:opacity-40 self-start"
            >
              {pairBusy ? <span className="flex items-center gap-1.5"><Loader size={12} className="animate-spin" /> contacting Anytype…</span> : "Pair with Anytype"}
            </button>
          )}

          <div className="flex items-center gap-2">
            <span className={`text-xs opacity-60 ${c.label}`}>Results</span>
            {[10, 25, 50, 100].map((n) => (
              <button key={n} onClick={() => setDraft((d) => ({ ...d, limit: n }))}
                className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${draft.limit === n ? "bg-white text-neutral-700 shadow-sm border border-neutral-200" : `${c.text} opacity-50 hover:opacity-80`}`}>
                {n}
              </button>
            ))}
          </div>

          {error && <p className="text-red-400 text-xs break-words">{error}</p>}
          <SaveCancelRow
            c={c}
            onSave={handleSave}
            onCancel={() => { setSettingsOpen(false); setError(""); }}
            onReset={handleReset}
          />
        </>
      }
    />
  );
}
