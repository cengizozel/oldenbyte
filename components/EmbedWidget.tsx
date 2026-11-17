"use client";

import { useEffect, useState } from "react";
import { AppWindow } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput } from "@/components/ui/Field";
import { WidgetHeader, EmptyState, SettingsFace, SettingsField, SettingsError, SettingsNote } from "@/components/ui/WidgetChrome";

// Another web page inside a widget (docs/widgets/embed.md): a status page, a
// graph, a tool you host. The page runs sandboxed in an iframe.

type Config = { url: string; name: string };
const DEFAULT: Config = { url: "", name: "" };

// Why an address cannot be embedded, or null when it can. `here` is the
// dashboard's own origin and whether it is served over https.
// Exported for tests.
export function embedProblem(url: string, here: { origin: string; https: boolean }): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return "That is not a web address."; }
  if (!/^https?:$/.test(u.protocol)) return "The address must start with http:// or https://.";
  // A page from the dashboard's own origin could reach out of its frame and
  // script the dashboard, so the dashboard never frames itself.
  if (u.origin === here.origin) return "The dashboard cannot embed itself.";
  if (here.https && u.protocol === "http:") return "This dashboard is on https, and browsers will not show an http page inside it. Use the page's https address.";
  return null;
}

export default function EmbedWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const storageKey = `embed-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");

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

  function handleSave() {
    setError("");
    const raw = draft.url.trim();
    const url = raw && !/^[a-z]+:\/\//i.test(raw) ? `https://${raw}` : raw;
    if (url) {
      const problem = embedProblem(url, { origin: window.location.origin, https: window.location.protocol === "https:" });
      if (problem) { setError(problem); return; }
    }
    const next = { url, name: draft.name.trim() };
    setConfig(next);
    setDraft(next);
    storage.setItem(storageKey, JSON.stringify(next));
    setSettingsOpen(false);
  }

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader onSettings={() => { setDraft(config); setError(""); setSettingsOpen(true); }} c={c} icon={AppWindow} title={config.name || widget.title} />
          {!config.url ? (
            <EmptyState c={c} action={t("empty.embed")} />
          ) : (
            <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-white">
              <iframe
                // Remounts on a new address, so the old page never lingers.
                key={config.url}
                src={config.url}
                title={config.name || "Embedded page"}
                loading="lazy"
                referrerPolicy="no-referrer"
                // Scripts and forms work, so real pages do; the page cannot
                // navigate the dashboard itself (no allow-top-navigation).
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                className="w-full h-full border-0 block"
              />
            </div>
          )}
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }}>
          <SettingsField c={c} label="Page address">
            <SettingsInput type="url" value={draft.url} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} onKeyDown={e => e.key === "Enter" && handleSave()} placeholder="https://status.example.com" />
          </SettingsField>
          <SettingsField c={c} label="Name" hint="Shown as the widget's title.">
            <SettingsInput type="text" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Status page" maxLength={40} />
          </SettingsField>
          <SettingsNote c={c}>Some sites refuse to be shown inside another page; those stay blank. Pages you host yourself usually work.</SettingsNote>
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
