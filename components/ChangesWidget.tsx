"use client";

import { useCallback, useEffect, useState } from "react";
import { ScanEye } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { timeAgo } from "@/lib/format";
import { useScrollFade } from "@/lib/useScrollFade";
import { useWidgetActive, usePageVisible } from "@/lib/activeDashboard";
import FlipCard from "@/components/ui/FlipCard";
import { FOCUS_RING, SettingsInput } from "@/components/ui/Field";
import { WidgetHeader, EmptyState, ErrorState, LoadingState, ScrollFades, SettingsFace, SettingsField, SettingsError } from "@/components/ui/WidgetChrome";

// Pages you watch with changedetection.io (docs/widgets/changes.md): which
// changed and when, newest first. A row opens what changed.

type Watch = { id: string; title: string; url: string; changedAt: number; checkedAt: number; error: string; unseen: boolean; diff: string };
type Config = { url: string; apiKey: string };
const DEFAULT: Config = { url: "", apiKey: "" };
const POLL_MS = 5 * 60_000;

export default function ChangesWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const active = useWidgetActive();
  const visible = usePageVisible();
  const storageKey = `changes-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [failed, setFailed] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([watches?.length]);

  const ask = useCallback(async (cfg: Config): Promise<Watch[]> => {
    const res = await fetch("/api/changedetection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not read the watches.");
    return data.watches ?? [];
  }, []);

  const load = useCallback(async (cfg: Config) => {
    if (!cfg.url) return;
    try { setWatches(await ask(cfg)); setFailed(""); } catch (e) { setFailed(String((e as Error).message)); }
  }, [ask]);

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
    if (!active || !visible || !config.url) return;
    load(config);
    const id = setInterval(() => load(config), POLL_MS);
    return () => clearInterval(id);
  }, [active, visible, config, load]);

  // Save only a connection that works; a refusal is reported here.
  async function handleSave() {
    setError("");
    const url = draft.url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(url)) { setError("The address must start with http:// or https://."); return; }
    const next = { url, apiKey: draft.apiKey.trim() };
    setSaving(true);
    try {
      setWatches(await ask(next));
      setFailed("");
      setConfig(next);
      await storage.setItem(storageKey, JSON.stringify(next));
      setSettingsOpen(false);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader onSettings={() => { setDraft(config); setError(""); setSettingsOpen(true); }} c={c} icon={ScanEye} title={widget.title} />
          {!config.url ? (
            <EmptyState c={c} action={t("empty.changes")} />
          ) : failed && !watches ? (
            <ErrorState c={c} onRetry={() => load(config)}>{failed}</ErrorState>
          ) : !watches ? (
            <LoadingState c={c} />
          ) : watches.length === 0 ? (
            <EmptyState c={c}>no pages are being watched yet</EmptyState>
          ) : (
            <div className="flex-1 min-h-0 relative">
              <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
                <ul className="flex flex-col">
                  {watches.map((w, i) => (
                    <li key={w.id} className={`py-2 first:pt-0 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                      <a href={w.changedAt ? w.diff : w.url} target="_blank" rel="noopener noreferrer" title={w.url} className={`flex items-start gap-2 hover:opacity-70 transition-opacity rounded-sm ${FOCUS_RING}`}>
                        <span aria-hidden className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${w.error ? "bg-rose-500" : w.unseen ? "bg-emerald-500" : `bg-current opacity-25 ${c.label}`}`} />
                        <span className="flex-1 min-w-0">
                          <span className={`block text-sm leading-snug break-words ${c.text} ${w.unseen ? "font-medium" : ""}`}>{w.title}</span>
                          <span className={`block text-sm ${w.error ? "text-rose-600 dark:text-rose-400" : `opacity-70 ${c.label}`}`}>
                            {w.error ? `check failed: ${w.error}` : w.changedAt ? `changed ${timeAgo(w.changedAt * 1000)}${w.unseen ? ", not seen yet" : ""}` : w.checkedAt ? "no change yet" : "not checked yet"}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <ScrollFades c={c} top={topFade} bottom={bottomFade} />
            </div>
          )}
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }} saving={saving}>
          <SettingsField c={c} label="changedetection.io" hint="Its address and the API key from its Settings, API tab.">
            <SettingsInput type="url" value={draft.url} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} placeholder="http://192.168.1.2:5000" />
            <SettingsInput type="password" value={draft.apiKey} onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))} placeholder="API key" autoComplete="off" />
          </SettingsField>
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
