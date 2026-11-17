"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { formatCount } from "@/lib/format";
import { useWidgetActive, usePageVisible } from "@/lib/activeDashboard";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput } from "@/components/ui/Field";
import { WidgetHeader, Chip, EmptyState, ErrorState, LoadingState, SettingsFace, SettingsField, SettingsError } from "@/components/ui/WidgetChrome";

// What your DNS blocker has done today (docs/widgets/dns.md): queries, how
// many were blocked and what share. AdGuard Home or Pi-hole.

type Kind = "adguard" | "pihole";
type Config = { kind: Kind; url: string; username: string; password: string };
type Stats = { queries: number; blocked: number; percent: number; avgMs: number | null; blocklist: number | null };
const DEFAULT: Config = { kind: "adguard", url: "", username: "", password: "" };
const POLL_MS = 60_000;

export default function DnsWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const active = useWidgetActive();
  const visible = usePageVisible();
  const storageKey = `dns-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const ask = useCallback(async (cfg: Config): Promise<Stats> => {
    const res = await fetch("/api/dns-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not read the statistics.");
    return data;
  }, []);

  const load = useCallback(async (cfg: Config) => {
    if (!cfg.url) return;
    try {
      setStats(await ask(cfg));
      setFailed("");
    } catch (e) {
      setFailed(String((e as Error).message));
    }
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

  // Save only what works: the connection is tried first, and a refusal is
  // shown here instead of on the front.
  async function handleSave() {
    setError("");
    const url = draft.url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(url)) { setError("The address must start with http:// or https://."); return; }
    const next = { ...draft, url };
    setSaving(true);
    try {
      const got = await ask(next);
      setStats(got);
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

  const tiles: { label: string; value: string }[] = stats ? [
    { label: "Queries", value: formatCount(stats.queries) },
    { label: "Blocked", value: formatCount(stats.blocked) },
    { label: "Blocked share", value: `${stats.percent.toFixed(1)}%` },
    stats.avgMs !== null
      ? { label: "Average answer", value: `${stats.avgMs < 10 ? stats.avgMs.toFixed(1) : Math.round(stats.avgMs)} ms` }
      : { label: "On blocklists", value: stats.blocklist !== null ? formatCount(stats.blocklist) : "unknown" },
  ] : [];

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader onSettings={() => { setDraft(config); setError(""); setSettingsOpen(true); }} c={c} icon={ShieldCheck} title={widget.title} />
          {!config.url ? (
            <EmptyState c={c} action={t("empty.dns")} />
          ) : failed && !stats ? (
            <ErrorState c={c} onRetry={() => load(config)}>{failed}</ErrorState>
          ) : !stats ? (
            <LoadingState c={c} />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto pr-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {tiles.map(tile => (
                  <div key={tile.label} className="min-w-0">
                    <dd className={`text-lg font-medium tabular-nums truncate ${c.text}`}>{tile.value}</dd>
                    <dt className={`text-sm opacity-70 truncate ${c.label}`}>{tile.label}</dt>
                  </div>
                ))}
              </dl>
              <p className={`text-sm opacity-70 mt-3 ${c.label}`}>{config.kind === "adguard" ? "AdGuard Home" : "Pi-hole"}, {config.kind === "adguard" ? "its statistics period" : "today"}</p>
            </div>
          )}
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }} saving={saving}>
          <SettingsField c={c} label="Blocker" inline>
            <Chip c={c} active={draft.kind === "adguard"} onClick={() => setDraft(d => ({ ...d, kind: "adguard" }))}>AdGuard Home</Chip>
            <Chip c={c} active={draft.kind === "pihole"} onClick={() => setDraft(d => ({ ...d, kind: "pihole" }))}>Pi-hole</Chip>
          </SettingsField>
          <SettingsField c={c} label="Address" hint={draft.kind === "adguard" ? "Where you open AdGuard Home, with its username and password." : "Where you open Pi-hole, without /admin. The password you sign in with; on version 5, the API token from its settings."}>
            <SettingsInput type="url" value={draft.url} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} placeholder="http://192.168.1.2" />
            <div className="flex gap-1.5">
              {draft.kind === "adguard" && (
                <SettingsInput type="text" value={draft.username} onChange={e => setDraft(d => ({ ...d, username: e.target.value }))} placeholder="Username" className="flex-1" autoComplete="off" />
              )}
              <SettingsInput type="password" value={draft.password} onChange={e => setDraft(d => ({ ...d, password: e.target.value }))} placeholder={draft.kind === "adguard" ? "Password" : "Password or API token"} className="flex-1" autoComplete="off" />
            </div>
          </SettingsField>
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
