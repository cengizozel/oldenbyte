"use client";

import { useState, useEffect, useRef } from "react";
import { Library, Search, Pencil, Check, X, RotateCcw, Loader, ExternalLink, ChevronLeft, Home } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

type Result = { title: string; url: string; snippet: string };
// A "source" is a kiwix ZIM (Wikipedia, WikiHow, …). `id` is its content-route name.
type Source = { title: string; id: string };
type KiwixConfig = { baseUrl: string; source: string; sourceTitle: string; limit: number };

const DEFAULT: KiwixConfig = { baseUrl: "", source: "", sourceTitle: "", limit: 8 };
const LIMITS = [5, 8, 10, 15];

// Older saved configs used `book`/`bookTitle`; map them onto the new field names.
function migrate(raw: Record<string, unknown>): KiwixConfig {
  return {
    ...DEFAULT,
    ...raw,
    source: (raw.source ?? raw.book ?? "") as string,
    sourceTitle: (raw.sourceTitle ?? raw.bookTitle ?? "") as string,
  };
}

export default function KiwixWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `kiwix-widget-${widget.id}`;

  const [config, setConfig] = useState<KiwixConfig>(DEFAULT);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<KiwixConfig>(DEFAULT);
  const [sources, setSources] = useState<Source[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);

  // Inline article view (slides over the results list).
  const [selected, setSelected] = useState<Result | null>(null);
  const [extract, setExtract] = useState("");
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [articleError, setArticleError] = useState("");
  const articleAbort = useRef<AbortController | null>(null);

  async function openArticle(r: Result) {
    setSelected(r);
    setExtract("");
    setArticleError("");
    setLoadingArticle(true);
    articleAbort.current?.abort();
    const ctrl = new AbortController();
    articleAbort.current = ctrl;
    try {
      const res = await fetch(
        `/api/kiwix?baseUrl=${encodeURIComponent(config.baseUrl)}&article=${encodeURIComponent(r.url)}`,
        { signal: ctrl.signal }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setExtract(data.extract || "");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setArticleError(String((e as Error).message ?? e));
    } finally {
      if (articleAbort.current === ctrl) setLoadingArticle(false);
    }
  }

  useEffect(() => {
    storage.getItem(storageKey).then((saved) => {
      if (!saved) return;
      try {
        const parsed = migrate(JSON.parse(saved));
        setConfig(parsed);
        setDraft(parsed);
      } catch {}
    });
  }, [storageKey]);

  async function loadSources(baseUrl: string, preferred: string) {
    if (!baseUrl.startsWith("http")) return;
    setLoadingSources(true);
    setSources([]);
    try {
      const res = await fetch(`/api/kiwix?baseUrl=${encodeURIComponent(baseUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const list: Source[] = data.sources ?? [];
      setSources(list);
      // Keep the saved source if it's still there, otherwise pick the first.
      const keep = list.find((s) => s.id === preferred);
      const pick = keep ?? list[0];
      if (pick) setDraft((d) => ({ ...d, source: pick.id, sourceTitle: pick.title }));
    } catch (e) {
      setError(`Could not load sources: ${String((e as Error).message ?? e)}`);
    } finally {
      setLoadingSources(false);
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q || !config.source) return;
    searchAbort.current?.abort();
    const ctrl = new AbortController();
    searchAbort.current = ctrl;
    setSearching(true);
    setError("");
    setSearched(true);
    setSelected(null);
    try {
      const url = `/api/kiwix?baseUrl=${encodeURIComponent(config.baseUrl)}&source=${encodeURIComponent(
        config.source
      )}&q=${encodeURIComponent(q)}&limit=${config.limit}`;
      const res = await fetch(url, { signal: ctrl.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data.results ?? []);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(String((e as Error).message ?? e));
      setResults([]);
    } finally {
      if (searchAbort.current === ctrl) setSearching(false);
    }
  }

  // Return to the clean search view (clear query, results, and any open article).
  function goHome() {
    searchAbort.current?.abort();
    articleAbort.current?.abort();
    setSelected(null);
    setResults([]);
    setQuery("");
    setSearched(false);
    setError("");
  }

  async function handleSave() {
    setError("");
    if (!draft.baseUrl.startsWith("http")) {
      setError("Enter the Kiwix server URL (http://…).");
      return;
    }
    if (!draft.source) {
      setError("Load sources and pick one.");
      return;
    }
    // Results belong to the old source — clear them when switching.
    if (draft.source !== config.source) {
      setResults([]);
      setQuery("");
      setSearched(false);
      setSelected(null);
    }
    setConfig(draft);
    await storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
  }

  async function handleReset() {
    await storage.removeItem(storageKey);
    setConfig(DEFAULT);
    setDraft(DEFAULT);
    setSources([]);
    setResults([]);
    setQuery("");
    setSearched(false);
    setSettingsOpen(false);
  }

  function openSettings() {
    setDraft(config);
    setSettingsOpen(true);
    setError("");
    if (config.baseUrl) loadSources(config.baseUrl, config.source);
  }

  return (
    <div
      className={`rounded-2xl border h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}
      style={{ perspective: "1200px" }}
    >
      <div
        className="relative w-full h-full transition-transform duration-300 ease-in-out"
        style={{ transformStyle: "preserve-3d", WebkitTransformStyle: "preserve-3d", transform: settingsOpen ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        {/* Front */}
        <div className={`absolute inset-0 p-5 flex flex-col rounded-2xl overflow-clip ${c.bg}`} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", pointerEvents: settingsOpen ? "none" : "auto" }}>
          <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
              <span className="opacity-50 shrink-0"><Library size={14} /></span>
              {config.sourceTitle && <span className="text-xs font-medium opacity-60 truncate">{config.sourceTitle}</span>}
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              {(selected || searched || query || results.length > 0) && (
                <button
                  onClick={goHome}
                  title="Back to search home"
                  className={`opacity-60 hover:opacity-100 transition-opacity ${c.icon}`}
                >
                  <Home size={14} />
                </button>
              )}
              {!selected && (
                <button
                  onClick={openSettings}
                  className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`}
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>
          </div>

          {config.source ? (
            <div className="flex-1 min-h-0 relative overflow-hidden">
              {/* Search + results list */}
              <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${selected ? "-translate-x-full" : "translate-x-0"}`}>
                <div className="relative shrink-0 mb-3">
                  <Search size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40 ${c.text}`} />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder="Search…"
                    className={`w-full text-sm rounded-xl pl-8 pr-3 py-1.5 outline-none bg-black/5 dark:bg-white/5 border border-transparent focus:border-black/10 dark:focus:border-white/10 ${c.text} placeholder:opacity-40`}
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  {searching ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
                    </div>
                  ) : error ? (
                    <p className="text-red-400 text-xs">{error}</p>
                  ) : results.length ? (
                    <ul className="flex flex-col">
                      {results.map((r, i) => (
                        <li key={i} className={`py-2.5 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                          <div className="flex items-start gap-1 group/title">
                            <button
                              onClick={() => openArticle(r)}
                              className={`flex-1 text-left text-sm leading-snug font-medium ${c.text} hover:opacity-70 transition-opacity`}
                            >
                              {r.title}
                            </button>
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className={`shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-90 dark:group-hover/title:opacity-70 hover:!opacity-100 transition-opacity ${c.icon}`}
                            >
                              <ExternalLink size={11} />
                            </a>
                          </div>
                          {r.snippet && <p className={`text-xs mt-0.5 opacity-50 ${c.text} line-clamp-2`}>{r.snippet}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={`text-xs opacity-45 ${c.text}`}>{searched ? "No results." : "Type a query and press Enter."}</p>
                  )}
                </div>
              </div>

              {/* Article detail */}
              <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${selected ? "translate-x-0" : "translate-x-full"}`}>
                {selected && (
                  <>
                    <div className={`flex items-center gap-1.5 mb-3 shrink-0 ${c.text}`}>
                      <button onClick={() => setSelected(null)} className="shrink-0 opacity-60 hover:opacity-100">
                        <ChevronLeft size={14} />
                      </button>
                      <span className="flex-1 text-xs font-medium truncate opacity-80">{selected.title}</span>
                      <a href={selected.url} target="_blank" rel="noopener noreferrer" className="shrink-0 opacity-40 hover:opacity-80" title="Open in Kiwix">
                        <ExternalLink size={11} />
                      </a>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto pr-3">
                      {loadingArticle ? (
                        <div className="flex items-center justify-center h-full">
                          <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
                        </div>
                      ) : articleError ? (
                        <p className="text-red-400 text-xs">{articleError}</p>
                      ) : extract ? (
                        <p className={`text-xs leading-relaxed opacity-75 whitespace-pre-line ${c.text}`}>{extract}</p>
                      ) : (
                        <p className={`text-xs opacity-45 ${c.text}`}>No preview available — open in Kiwix.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center">
              <p className={`text-xs opacity-45 ${c.text}`}>hover and click the pencil to connect your Kiwix server</p>
            </div>
          )}
        </div>

        {/* Back (settings) */}
        <div className={`absolute inset-0 p-5 flex flex-col gap-3 rounded-2xl overflow-clip ${c.bg}`} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)", pointerEvents: settingsOpen ? "auto" : "none" }}>
          <input
            type="url"
            value={draft.baseUrl}
            onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
            placeholder="http://192.168.1.24:3702"
            className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadSources(draft.baseUrl, draft.source)}
              disabled={loadingSources || !draft.baseUrl.startsWith("http")}
              className="text-xs px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-800 disabled:opacity-40 shrink-0"
            >
              {loadingSources ? <Loader size={12} className="animate-spin" /> : "Load sources"}
            </button>
            {sources.length > 0 ? (
              <select
                value={draft.source}
                onChange={(e) => {
                  const s = sources.find((x) => x.id === e.target.value);
                  setDraft((d) => ({ ...d, source: e.target.value, sourceTitle: s?.title ?? "" }));
                }}
                className="flex-1 min-w-0 text-sm border border-neutral-200 rounded-xl px-2 py-2 outline-none text-neutral-700 bg-white"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-neutral-400 truncate">{draft.sourceTitle || "no source selected"}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs opacity-60 ${c.label}`}>Results</span>
            {LIMITS.map((n) => (
              <button key={n} onClick={() => setDraft((d) => ({ ...d, limit: n }))}
                className={`w-8 py-1 rounded-lg text-xs font-medium transition-colors ${draft.limit === n ? "bg-white text-neutral-700 shadow-sm border border-neutral-200" : `${c.text} opacity-50 hover:opacity-80`}`}>
                {n}
              </button>
            ))}
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex items-center justify-between mt-auto">
            <button onClick={handleReset} className={`${c.label} opacity-40 hover:opacity-70`} title="Reset"><RotateCcw size={13} /></button>
            <div className="flex gap-3">
              <button onClick={() => { setSettingsOpen(false); setError(""); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
              <button onClick={handleSave} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><Check size={14} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
