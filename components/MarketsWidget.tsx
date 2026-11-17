"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TrendingUp, X } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { useScrollFade } from "@/lib/useScrollFade";
import { useWidgetActive } from "@/lib/activeDashboard";
import FlipCard from "@/components/ui/FlipCard";
import {
  WidgetHeader, RefreshButton, EmptyState, ErrorState, LoadingState, ScrollFades, SettingsFace, SettingsField, SettingsError,
  SettingsAddRow, SettingsListRow, LIST_TITLE_INPUT, ROW_ACTION,
} from "@/components/ui/WidgetChrome";

// Stocks, indices, currencies and crypto (docs/widgets/markets.md): the last
// price, the change since the previous close and today's trend line.

type Entry = { symbol: string; label: string };
type Config = { entries: Entry[] };
type Quote = { symbol: string; name: string; currency: string; price: number; prevClose: number; change: number; changePct: number; digits?: number; points: number[] };
type Row = Quote | { symbol: string; error: string };
const DEFAULT: Config = { entries: [] };
const SYMBOL_RE = /^[A-Za-z0-9.^=\-]{1,15}$/;
const REFRESH_MS = 5 * 60 * 1000;

// The decimals the instrument is quoted in when known (2 for a stock, 4 for a
// currency pair); otherwise enough to be meaningful for small prices.
export function formatPrice(n: number, digits?: number): string {
  const abs = Math.abs(n);
  const d = digits ?? (abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6);
  return n.toLocaleString("en-US", { minimumFractionDigits: Math.min(2, d), maximumFractionDigits: d });
}

// The day's trend as a line, with the previous close as a dashed level so up
// and down read against it. Drawn in the row's own up or down color.
function Sparkline({ points, base, up }: { points: number[]; base: number; up: boolean }) {
  if (points.length < 2) return <span className="w-16 shrink-0" />;
  const W = 64, H = 24;
  const min = Math.min(base, ...points), max = Math.max(base, ...points);
  const span = max - min || 1;
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
  const d = points.map((v, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * W).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className={`shrink-0 ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
      <line x1="0" x2={W} y1={y(base)} y2={y(base)} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function MarketsWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const active = useWidgetActive();
  const storageKey = `markets-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([rows.length]);

  const load = useCallback(async (cfg: Config, force = false) => {
    if (!cfg.entries.length) { setRows([]); return; }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/markets?symbols=${encodeURIComponent(cfg.entries.map(e => e.symbol).join(","))}${force ? "&refresh=1" : ""}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error();
      setRows(await res.json());
    } catch (e) {
      if ((e as Error).name !== "AbortError") setFailed(true);
    } finally {
      if (abort.current === ctrl) setLoading(false);
    }
  }, []);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (!saved) return;
      try {
        const parsed = { ...DEFAULT, ...JSON.parse(saved) } as Config;
        setConfig(parsed);
        setDraft(parsed);
        load(parsed);
      } catch {}
    });
  }, [storageKey, load]);

  // Prices move: refresh every five minutes while the dashboard is showing.
  useEffect(() => {
    if (!active || !config.entries.length) return;
    const id = setInterval(() => load(config), REFRESH_MS);
    return () => clearInterval(id);
  }, [active, config, load]);

  function addSymbol() {
    setError("");
    const symbol = input.trim().toUpperCase();
    if (!SYMBOL_RE.test(symbol)) { setError("A symbol looks like AAPL, BTC-USD, ^GSPC or EURUSD=X."); return; }
    if (draft.entries.some(e => e.symbol === symbol)) { setInput(""); return; }
    setDraft(d => ({ entries: [...d.entries, { symbol, label: "" }] }));
    setInput("");
  }

  function handleSave() {
    setConfig(draft);
    storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
    setRows([]);
    load(draft);
  }

  const labelOf = (symbol: string) => config.entries.find(e => e.symbol === symbol)?.label.trim() || "";

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader
            onSettings={() => { setDraft(config); setError(""); setInput(""); setSettingsOpen(true); }}
            c={c}
            icon={TrendingUp}
            title={widget.title}
            right={config.entries.length > 0 ? <RefreshButton c={c} busy={loading} onClick={() => load(config, true)} /> : undefined}
          />
          {config.entries.length === 0 ? (
            <EmptyState c={c} action={t("empty.markets")} />
          ) : loading && !rows.length ? (
            <LoadingState c={c} />
          ) : failed && !rows.length ? (
            <ErrorState c={c} busy={loading} onRetry={() => load(config, true)}>could not load prices</ErrorState>
          ) : (
            <div className="flex-1 min-h-0 relative">
              <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
                <ul className="flex flex-col">
                  {rows.map((row, i) => {
                    const border = i > 0 ? "border-t border-black/10 dark:border-white/10" : "";
                    if ("error" in row) {
                      return (
                        <li key={row.symbol} className={`flex items-center justify-between gap-3 py-2 first:pt-0 ${border}`}>
                          <p className={`text-sm font-medium truncate ${c.text}`}>{labelOf(row.symbol) || row.symbol}</p>
                          <p className={`text-sm opacity-70 ${c.label}`}>{/unknown/i.test(row.error) ? "unknown symbol" : "no price"}</p>
                        </li>
                      );
                    }
                    const up = row.change >= 0;
                    // The user's own name first; under it the instrument's name, or
                    // its symbol when that would only repeat the line above.
                    const label = labelOf(row.symbol);
                    const sub = !label ? row.name : row.name.toLowerCase() === label.toLowerCase() ? row.symbol : row.name;
                    const tone = up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
                    return (
                      <li key={row.symbol} className={`flex items-center gap-3 py-2 first:pt-0 ${border}`} title={`${row.name} (${row.symbol})${row.currency ? `, ${row.currency}` : ""}`}>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${c.text}`}>{label || row.symbol}</p>
                          <p className={`text-sm opacity-70 truncate ${c.label}`}>{sub}</p>
                        </div>
                        <Sparkline points={row.points} base={row.prevClose} up={up} />
                        <div className="shrink-0 text-right">
                          <p className={`text-sm font-medium tabular-nums ${c.text}`}>{formatPrice(row.price, row.digits)}</p>
                          <p className={`text-sm tabular-nums ${tone}`}>{up ? "+" : ""}{row.changePct.toFixed(2)}%</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <ScrollFades c={c} top={topFade} bottom={bottomFade} />
            </div>
          )}
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }}>
          <SettingsField c={c} label="Symbols" hint="As on Yahoo Finance: AAPL for a stock, BTC-USD for crypto, ^GSPC for an index, EURUSD=X for a currency pair.">
            <SettingsAddRow c={c} value={input} onChange={setInput} onAdd={addSymbol} placeholder="AAPL" />
          </SettingsField>
          {error && <SettingsError>{error}</SettingsError>}
          {draft.entries.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {draft.entries.map(e => (
                <SettingsListRow
                  key={e.symbol}
                  leading={<span className={`text-sm font-medium tabular-nums shrink-0 ${c.label}`}>{e.symbol}</span>}
                  title={
                    <input
                      value={e.label}
                      onChange={ev => setDraft(d => ({ entries: d.entries.map(x => x.symbol === e.symbol ? { ...x, label: ev.target.value } : x) }))}
                      placeholder="Name to show (optional)"
                      aria-label={`Name for ${e.symbol}`}
                      maxLength={30}
                      className={`${LIST_TITLE_INPUT} !font-normal ${c.text}`}
                    />
                  }
                  actions={
                    <button type="button" onClick={() => setDraft(d => ({ entries: d.entries.filter(x => x.symbol !== e.symbol) }))} aria-label={`Remove ${e.symbol}`} title="Remove" className={`${ROW_ACTION} ${c.label}`}>
                      <X size={14} />
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </SettingsFace>
      }
    />
  );
}
