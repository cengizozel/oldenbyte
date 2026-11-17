"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, X } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { useScrollFade } from "@/lib/useScrollFade";
import { useWidgetActive, usePageVisible } from "@/lib/activeDashboard";
import FlipCard from "@/components/ui/FlipCard";
import { FOCUS_RING } from "@/components/ui/Field";
import {
  WidgetHeader, RefreshButton, EmptyState, ScrollFades, SettingsFace, SettingsField, SettingsError,
  SettingsAddRow, SettingsListRow, LIST_TITLE_INPUT, ROW_ACTION,
} from "@/components/ui/WidgetChrome";

// Are your sites and services answering (docs/widgets/monitor.md): one row
// each, a dot for up or down and the response time. Checked from the
// dashboard's server once a minute while the dashboard is showing.

type Site = { id: string; name: string; url: string };
type Config = { sites: Site[] };
type Check = { up: boolean; status: number | null; ms: number | null; error?: string };
const DEFAULT: Config = { sites: [] };
const POLL_MS = 60_000;
const newId = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// An address as typed to one that can be checked: https:// is assumed.
// Null when it is not an address. Exported for tests.
export function normalizeSite(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") || u.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ? u.toString() : null;
  } catch { return null; }
}

export default function MonitorWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const active = useWidgetActive();
  const visible = usePageVisible();
  const storageKey = `monitor-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const run = useRef(0);
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([config.sites.length]);

  const check = useCallback(async (cfg: Config) => {
    if (!cfg.sites.length) return;
    const mine = ++run.current;
    setBusy(true);
    // Each site paints as its own answer arrives; a slow one holds nobody up.
    await Promise.all(cfg.sites.map(async site => {
      let result: Check;
      try {
        const res = await fetch(`/api/monitor?url=${encodeURIComponent(site.url)}`);
        result = res.ok ? await res.json() : { up: false, status: null, ms: null, error: "check failed" };
      } catch {
        result = { up: false, status: null, ms: null, error: "check failed" };
      }
      if (run.current === mine) setChecks(prev => ({ ...prev, [site.id]: result }));
    }));
    if (run.current === mine) setBusy(false);
  }, []);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (!saved) return;
      try {
        const parsed = { ...DEFAULT, ...JSON.parse(saved) } as Config;
        setConfig(parsed);
        setDraft(parsed);
      } catch {}
    });
  }, [storageKey]);

  useEffect(() => {
    if (!active || !visible || !config.sites.length) return;
    check(config);
    const id = setInterval(() => check(config), POLL_MS);
    return () => clearInterval(id);
  }, [active, visible, config, check]);

  function addSite() {
    setError("");
    const url = normalizeSite(input);
    if (!url) { setError("Enter an address, like example.com or http://192.168.1.10:8080."); return; }
    if (draft.sites.some(s => s.url === url)) { setInput(""); return; }
    setDraft(d => ({ sites: [...d.sites, { id: newId(), name: new URL(url).host, url }] }));
    setInput("");
  }

  function handleSave() {
    setConfig(draft);
    storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
  }

  const down = config.sites.filter(s => checks[s.id] && !checks[s.id].up).length;

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
            icon={Activity}
            title={widget.title}
            after={down > 0 ? <span className="text-sm font-medium text-rose-600 dark:text-rose-400">{down} down</span> : undefined}
            right={config.sites.length > 0 ? <RefreshButton c={c} busy={busy} onClick={() => check(config)} /> : undefined}
          />
          {config.sites.length === 0 ? (
            <EmptyState c={c} action={t("empty.monitor")} />
          ) : (
            <div className="flex-1 min-h-0 relative">
              <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
                <ul className="flex flex-col">
                  {config.sites.map((site, i) => {
                    const r = checks[site.id];
                    const dot = !r ? "bg-current opacity-30" : r.up ? "bg-emerald-500" : "bg-rose-500";
                    const state = !r ? "checking" : r.up ? "up" : "down";
                    return (
                      <li key={site.id} className={`py-2 first:pt-0 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                        <a href={site.url} target="_blank" rel="noopener noreferrer" title={site.url} className={`flex items-center gap-2.5 hover:opacity-70 transition-opacity rounded-sm ${FOCUS_RING}`}>
                          <span aria-hidden className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot} ${c.label}`} />
                          <span className={`flex-1 min-w-0 truncate text-sm font-medium ${c.text}`}>{site.name}<span className="sr-only">, {state}</span></span>
                          <span className={`shrink-0 text-sm tabular-nums ${r && !r.up ? "text-rose-600 dark:text-rose-400 font-medium" : `opacity-70 ${c.label}`}`}>
                            {!r ? "checking" : r.up ? `${r.ms} ms` : r.status ? `down (${r.status})` : `down, ${r.error ?? "no answer"}`}
                          </span>
                        </a>
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
          <SettingsField c={c} label="Sites" hint="Checked from the dashboard's server, so addresses on your own network work for the admin. A page asking you to sign in counts as up.">
            <SettingsAddRow c={c} value={input} onChange={setInput} onAdd={addSite} placeholder="example.com" />
          </SettingsField>
          {error && <SettingsError>{error}</SettingsError>}
          {draft.sites.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {draft.sites.map(s => (
                <SettingsListRow
                  key={s.id}
                  title={
                    <input
                      value={s.name}
                      onChange={e => setDraft(d => ({ sites: d.sites.map(x => x.id === s.id ? { ...x, name: e.target.value } : x) }))}
                      aria-label="Name"
                      title={s.url}
                      maxLength={40}
                      className={`${LIST_TITLE_INPUT} ${c.text}`}
                    />
                  }
                  actions={
                    <button type="button" onClick={() => setDraft(d => ({ sites: d.sites.filter(x => x.id !== s.id) }))} aria-label={`Remove ${s.name}`} title="Remove" className={`${ROW_ACTION} ${c.label}`}>
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
