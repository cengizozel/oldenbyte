"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CodeXml } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput, SettingsTextarea } from "@/components/ui/Field";
import { WidgetHeader, Chip, EmptyState, SettingsFace, SettingsField, SettingsError, SettingsNote } from "@/components/ui/WidgetChrome";

// Your own HTML, CSS and JavaScript as a widget (docs/widgets/html.md).
//
// The markup runs in an iframe sandboxed WITHOUT allow-same-origin, so it
// gets an origin of its own: its scripts run, but they cannot read the
// dashboard, its storage or the session, whatever they contain. A content
// security policy inside the frame keeps it off the network unless the
// widget's Network setting allows it.

type Config = { html: string; name: string; network: boolean };
const DEFAULT: Config = { html: "", name: "", network: false };
const MAX_CHARS = 200_000;

// The frame's document: a policy, a base look that matches the card (its text
// colors, the dashboard's font), then the user's markup. Exported for tests.
export function buildFrame(html: string, look: { text: string; muted: string; dark: boolean }, network: boolean): string {
  const csp = network
    ? "default-src 'none'; img-src data: blob: https: http:; media-src data: blob: https: http:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'unsafe-inline' https:; connect-src https: http:; frame-src https:"
    : "default-src 'none'; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
:root { color-scheme: ${look.dark ? "dark" : "light"}; --text: ${look.text}; --muted: ${look.muted}; }
html, body { margin: 0; background: transparent; }
body { font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); overflow-wrap: anywhere; }
a { color: inherit; }
</style></head><body>${html}</body></html>`;
}

export default function HtmlWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const storageKey = `html-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [look, setLook] = useState({ text: "#404040", muted: "#737373", dark: false });
  const textProbe = useRef<HTMLSpanElement>(null);
  const mutedProbe = useRef<HTMLSpanElement>(null);

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

  // The card's own text colors, read from two hidden probes, so the frame
  // matches the widget's palette and follows the theme when it changes.
  useEffect(() => {
    const read = () => {
      const text = textProbe.current, muted = mutedProbe.current;
      if (!text || !muted) return;
      const next = { text: getComputedStyle(text).color, muted: getComputedStyle(muted).color, dark: document.documentElement.classList.contains("dark") };
      setLook(prev => (prev.text === next.text && prev.muted === next.muted && prev.dark === next.dark ? prev : next));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, [widget.color]);

  const frame = useMemo(() => buildFrame(config.html, look, config.network), [config.html, config.network, look]);

  function handleSave() {
    setError("");
    if (draft.html.length > MAX_CHARS) { setError(`That is ${draft.html.length.toLocaleString("en-US")} characters; the limit is ${MAX_CHARS.toLocaleString("en-US")}.`); return; }
    const next = { ...draft, name: draft.name.trim() };
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
          <WidgetHeader onSettings={() => { setDraft(config); setError(""); setSettingsOpen(true); }} c={c} icon={CodeXml} title={config.name || widget.title} />
          <span ref={textProbe} aria-hidden className={`hidden ${c.text}`} />
          <span ref={mutedProbe} aria-hidden className={`hidden ${c.label}`} />
          {!config.html.trim() ? (
            <EmptyState c={c} action={t("empty.html")} />
          ) : (
            <iframe
              srcDoc={frame}
              title={config.name || "Custom HTML"}
              // No allow-same-origin: the frame is its own origin and cannot
              // reach the dashboard. Popups so that links open in a new tab.
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className="flex-1 min-h-0 w-full border-0 block bg-transparent"
              style={{ colorScheme: look.dark ? "dark" : "light" }}
            />
          )}
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }}>
          <SettingsField c={c} label="HTML" hint="Markup, with <style> and <script> if you like. var(--text) and var(--muted) are the card's text colors.">
            <SettingsTextarea
              value={draft.html}
              onChange={e => setDraft(d => ({ ...d, html: e.target.value }))}
              rows={6}
              spellCheck={false}
              placeholder={'<h3>Hello</h3>\n<p style="color: var(--muted)">Anything you can write in HTML.</p>'}
              className="font-mono"
            />
          </SettingsField>
          <SettingsField c={c} label="Name" hint="Shown as the widget's title.">
            <SettingsInput type="text" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Countdown" maxLength={40} />
          </SettingsField>
          <SettingsField c={c} label="Network" inline hint="Off: scripts cannot contact any server. On: they can fetch from the web and load scripts and styles from https.">
            <Chip c={c} active={!draft.network} onClick={() => setDraft(d => ({ ...d, network: false }))}>Off</Chip>
            <Chip c={c} active={draft.network} onClick={() => setDraft(d => ({ ...d, network: true }))}>On</Chip>
          </SettingsField>
          <SettingsNote c={c}>It runs in a sandbox of its own: it cannot read your dashboard, your other widgets or your sign-in.</SettingsNote>
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
