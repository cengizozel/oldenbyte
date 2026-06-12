"use client";

import { useCallback, useEffect, useState } from "react";
import { Puzzle, RefreshCw } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import {
  effectiveLayout, interpolateUrl, resolveText, resolveValue,
  type BankPrimitive, type BankWidgetDef,
} from "@/lib/widgetBank";
import { tagColor } from "@/lib/colors";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "./ui/FlipCard";
import { SettingsInput, SettingsSelect } from "./ui/Field";
import { PencilButton, ScrollFades, LoadingState, EmptyState, SaveCancelRow } from "./ui/WidgetChrome";

type BankConfig = Record<string, string | number>;

function defaultsFor(def: BankWidgetDef): BankConfig {
  const out: BankConfig = {};
  for (const f of def.config ?? []) out[f.key] = f.default ?? (f.type === "number" ? 0 : "");
  return out;
}

export default function BankWidget({
  widget,
  def,
  className = "",
}: {
  widget: Widget;
  def?: BankWidgetDef;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `bank-widget-${widget.id}`;
  const cacheKey = `bank-widget-${widget.id}-cache`;

  const [config, setConfig] = useState<BankConfig>({});
  const [draft, setDraft] = useState<BankConfig>({});
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([data]);

  const fetchData = useCallback(async (cfg: BankConfig, force = false) => {
    if (!def) return;
    setError("");
    const ttl = Math.max(1, def.fetch.cacheMinutes ?? 60) * 60_000;
    if (!force) {
      try {
        const cached = await storage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { at: number; data: unknown };
          if (Date.now() - parsed.at < ttl) { setData(parsed.data); return; }
          setData(parsed.data); // show stale immediately, refresh below
        }
      } catch {}
    }
    setLoading(true);
    try {
      const url = interpolateUrl(def.fetch.url, cfg);
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const json = JSON.parse(await res.text());
      setData(json);
      await storage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: json }));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [def, cacheKey]);

  useEffect(() => {
    if (!def) return;
    storage.getItem(storageKey).then(saved => {
      let cfg = defaultsFor(def);
      if (saved) {
        try { cfg = { ...cfg, ...JSON.parse(saved) }; } catch {}
      }
      setConfig(cfg);
      setDraft(cfg);
      fetchData(cfg);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id, def?.id]);

  if (!def) {
    return (
      <div className={`rounded-2xl border h-full p-5 ${c.bg} ${c.border} ${c.glow} ${className}`}>
        <p className={`text-xs opacity-45 ${c.text}`}>
          This community widget's definition is no longer in the bank.
        </p>
      </div>
    );
  }

  function renderPrimitive(p: BankPrimitive, i: number): React.ReactNode {
    switch (p.component) {
      case "label": {
        const text = resolveText(p.value, data);
        if (!text) return null;
        const size = p.size === "lg" ? "text-lg font-medium" : p.size === "xs" ? "text-[11px]" : "text-sm";
        return <p key={i} className={`${size} ${p.muted ? `opacity-60 ${c.label}` : c.text}`}>{text}</p>;
      }
      case "list": {
        const arr = resolveValue(p.path, data);
        if (!Array.isArray(arr) || !arr.length) return null;
        const limit = Math.min(Math.max(p.limit ?? 8, 1), 25);
        return (
          <ul key={i} className="flex flex-col">
            {arr.slice(0, limit).map((item, j) => {
              const title = resolveText(p.title, item);
              if (!title) return null;
              const link = p.link ? resolveText(p.link, item) : "";
              const subtitle = p.subtitle ? resolveText(p.subtitle, item) : "";
              const meta = p.meta ? resolveText(p.meta, item) : "";
              const head = link ? (
                <a href={link} target="_blank" rel="noopener noreferrer" className={`text-sm leading-snug ${c.text} hover:opacity-70 transition-opacity`}>{title}</a>
              ) : (
                <span className={`text-sm leading-snug ${c.text}`}>{title}</span>
              );
              return (
                <li key={j} className={`py-2.5 ${j > 0 ? "border-t border-black/10" : ""}`}>
                  <div className="flex items-baseline gap-2">
                    <div className="flex-1 min-w-0">{head}</div>
                    {meta && <span className={`shrink-0 text-[10px] tabular-nums opacity-50 ${c.label}`}>{meta}</span>}
                  </div>
                  {subtitle && <p className={`mt-0.5 text-xs leading-snug opacity-60 line-clamp-2 ${c.text}`}>{subtitle}</p>}
                </li>
              );
            })}
          </ul>
        );
      }
      case "stat-row": {
        const items = p.items.map(s => ({ label: s.label, value: resolveText(s.value, data) })).filter(s => s.value);
        if (!items.length) return null;
        return (
          <div key={i} className="flex flex-col gap-1">
            {items.map((s, j) => (
              <div key={j} className="flex items-baseline justify-between gap-2">
                <span className={`text-xs opacity-50 ${c.label}`}>{s.label}</span>
                <span className={`text-sm tabular-nums ${c.text}`}>{s.value}</span>
              </div>
            ))}
          </div>
        );
      }
      case "progress-bar": {
        const value = Number(resolveValue(p.value, data)) || 0;
        const max = Number(typeof p.max === "number" ? p.max : resolveValue(p.max, data)) || 1;
        const pct = Math.max(0, Math.min(100, (value / max) * 100));
        return (
          <div key={i} className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full bg-current ${c.label}`} style={{ width: `${pct}%` }} />
          </div>
        );
      }
      case "badge-list": {
        const arr = resolveValue(p.path, data);
        if (!Array.isArray(arr) || !arr.length) return null;
        const limit = Math.min(Math.max(p.limit ?? 12, 1), 30);
        return (
          <div key={i} className="flex flex-wrap gap-1">
            {arr.slice(0, limit).map((item, j) => {
              const text = resolveText(p.label, item);
              if (!text) return null;
              const tc = tagColor(text.toLowerCase());
              return (
                <span key={j} className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-widest ${tc.bg} ${tc.label}`}>
                  {text}
                </span>
              );
            })}
          </div>
        );
      }
      case "image": {
        const src = resolveText(p.src, data);
        if (!src || !/^https:\/\//.test(src)) return null;
        const caption = p.caption ? resolveText(p.caption, data) : "";
        return (
          <figure key={i} className="flex flex-col items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={caption || resolveText(p.src, data)} className="max-w-full max-h-48 object-contain rounded-lg" />
            {caption && <figcaption className={`text-[10px] text-center opacity-50 ${c.text}`}>{caption}</figcaption>}
          </figure>
        );
      }
      case "divider":
        return <div key={i} className="border-t border-black/10 dark:border-white/10" />;
      case "sparkline": {
        const arr = resolveValue(p.values, data);
        if (!Array.isArray(arr) || arr.length < 2) return null;
        const nums = arr.map(Number).filter(n => !isNaN(n));
        if (nums.length < 2) return null;
        const max = Math.max(...nums), min = Math.min(...nums);
        const span = max - min || 1;
        const points = nums.map((n, j) => `${(j / (nums.length - 1)) * 100},${28 - ((n - min) / span) * 24}`).join(" ");
        return (
          <svg key={i} viewBox="0 0 100 32" className={`w-full h-8 ${c.label}`} preserveAspectRatio="none">
            <polyline fill="none" stroke="currentColor" strokeWidth={1.5} points={points} />
          </svg>
        );
      }
      default:
        return null; // unknown components are skipped gracefully
    }
  }

  const layout = effectiveLayout(def);
  const hasContent = data != null;

  const front = (
    <>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className={`flex items-center gap-1.5 ${c.label}`}>
          <span className="opacity-50"><Puzzle size={14} /></span>
          <span className="text-xs font-medium opacity-60">{widget.title}</span>
        </div>
        <PencilButton c={c} onClick={() => { setDraft(config); setSettingsOpen(true); }} />
      </div>
      <div className="flex-1 min-h-0 relative">
        <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3 flex flex-col gap-3">
          {loading && !hasContent ? (
            <LoadingState c={c} />
          ) : error && !hasContent ? (
            <p className="text-red-400 text-xs">{error}</p>
          ) : hasContent ? (
            layout.map((p, i) => renderPrimitive(p, i))
          ) : (
            <EmptyState c={c}>nothing loaded yet</EmptyState>
          )}
        </div>
        <ScrollFades c={c} top={topFade} bottom={bottomFade} />
      </div>
    </>
  );

  const back = (
    <>
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
        {(def.config ?? []).map(f => (
          <div key={f.key}>
            <p className={`text-xs mb-1 opacity-50 ${c.label}`}>{f.label}</p>
            {f.type === "select" ? (
              <SettingsSelect
                value={String(draft[f.key] ?? "")}
                onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
              >
                {(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SettingsSelect>
            ) : (
              <SettingsInput
                type={f.type === "number" ? "number" : "text"}
                value={String(draft[f.key] ?? "")}
                placeholder={f.placeholder}
                onChange={e => setDraft(d => ({ ...d, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value }))}
              />
            )}
          </div>
        ))}
        {(def.config ?? []).length === 0 && (
          <p className={`text-xs opacity-45 ${c.text}`}>This widget has no settings.</p>
        )}
        <div className={`text-[10px] leading-relaxed opacity-50 ${c.label}`}>
          <p>{def.description}</p>
          <p className="mt-1 break-all">source: {def.fetch.url.split("?")[0]}</p>
        </div>
        <button
          onClick={() => fetchData(config, true)}
          disabled={loading}
          className={`self-start flex items-center gap-1 text-[11px] opacity-60 hover:opacity-100 disabled:opacity-30 ${c.label}`}
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          Refresh now
        </button>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
      <SaveCancelRow
        c={c}
        onSave={async () => {
          setConfig(draft);
          await storage.setItem(storageKey, JSON.stringify(draft));
          setSettingsOpen(false);
          fetchData(draft, true);
        }}
        onCancel={() => { setDraft(config); setSettingsOpen(false); }}
      />
    </>
  );

  return <FlipCard c={c} flipped={settingsOpen} className={className} front={front} back={back} />;
}
