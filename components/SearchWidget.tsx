"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import FlipCard from "@/components/ui/FlipCard";
import { FIELD_CLASS, SettingsInput } from "@/components/ui/Field";
import { WidgetHeader, Chip, SettingsFace, SettingsField, SettingsError } from "@/components/ui/WidgetChrome";

// A search box for the engine of your choice (docs/widgets/search.md). Enter
// opens the results; something that already is an address opens as it is.
// `%s` in an engine's URL is where the query goes.
export const SEARCH_ENGINES: { id: string; label: string; url: string }[] = [
  { id: "duckduckgo", label: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  { id: "google",     label: "Google",     url: "https://www.google.com/search?q=%s" },
  { id: "bing",       label: "Bing",       url: "https://www.bing.com/search?q=%s" },
  { id: "brave",      label: "Brave",      url: "https://search.brave.com/search?q=%s" },
  { id: "startpage",  label: "Startpage",  url: "https://www.startpage.com/do/search?q=%s" },
  { id: "kagi",       label: "Kagi",       url: "https://kagi.com/search?q=%s" },
  { id: "wikipedia",  label: "Wikipedia",  url: "https://en.wikipedia.org/w/index.php?search=%s" },
];

type Config = { engine: string; custom: string; customName: string; newTab: boolean };
const DEFAULT: Config = { engine: "duckduckgo", custom: "", customName: "", newTab: true };

// Where a query goes: an address is opened directly, anything else is sent
// to the engine. Exported for tests.
export function searchTarget(query: string, cfg: Pick<Config, "engine" | "custom">): string | null {
  const q = query.trim();
  if (!q) return null;
  if (/^https?:\/\/\S+$/i.test(q)) return q;
  const template = cfg.engine === "custom" ? cfg.custom : SEARCH_ENGINES.find(e => e.id === cfg.engine)?.url;
  if (!template || !template.includes("%s")) return null;
  return template.replace("%s", encodeURIComponent(q));
}

export default function SearchWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const storageKey = `search-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

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

  const engineName = config.engine === "custom"
    ? (config.customName.trim() || "the web")
    : SEARCH_ENGINES.find(e => e.id === config.engine)?.label ?? "the web";

  function go() {
    const url = searchTarget(query, config);
    if (!url) return;
    window.open(url, config.newTab ? "_blank" : "_self", "noopener,noreferrer");
    setQuery("");
  }

  function handleSave() {
    setError("");
    if (draft.engine === "custom" && !(/^https?:\/\//i.test(draft.custom) && draft.custom.includes("%s"))) {
      setError("The address must start with http and contain %s where the search goes.");
      return;
    }
    setConfig(draft);
    storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
  }

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader onSettings={() => { setDraft(config); setError(""); setSettingsOpen(true); }} c={c} icon={Search} title={widget.title} />
          <form
            role="search"
            onSubmit={e => { e.preventDefault(); go(); }}
            className="flex-1 min-h-0 flex items-center"
          >
            <div className="relative w-full">
              <Search size={16} aria-hidden className={`absolute left-3 top-1/2 -translate-y-1/2 opacity-70 pointer-events-none ${c.label}`} />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${engineName}`}
                aria-label={`Search ${engineName}`}
                autoComplete="off"
                enterKeyHint="search"
                className={`${FIELD_CLASS} pl-9 h-10 [&::-webkit-search-cancel-button]:appearance-none`}
              />
            </div>
          </form>
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }}>
          <SettingsField c={c} label="Search with">
            <div className="flex gap-1.5 flex-wrap">
              {SEARCH_ENGINES.map(e => (
                <Chip key={e.id} c={c} active={draft.engine === e.id} onClick={() => setDraft(d => ({ ...d, engine: e.id }))}>{e.label}</Chip>
              ))}
              <Chip c={c} active={draft.engine === "custom"} onClick={() => setDraft(d => ({ ...d, engine: "custom" }))}>Custom</Chip>
            </div>
          </SettingsField>
          {draft.engine === "custom" && (
            <SettingsField c={c} label="Address" hint="Put %s where the search goes, for example your own SearXNG.">
              <SettingsInput
                type="url"
                value={draft.custom}
                onChange={e => setDraft(d => ({ ...d, custom: e.target.value }))}
                placeholder="https://search.example.com/search?q=%s"
              />
              <SettingsInput
                type="text"
                value={draft.customName}
                onChange={e => setDraft(d => ({ ...d, customName: e.target.value }))}
                placeholder="Name, e.g. SearXNG"
                maxLength={30}
              />
            </SettingsField>
          )}
          <SettingsField c={c} label="Open results in" inline>
            <Chip c={c} active={draft.newTab} onClick={() => setDraft(d => ({ ...d, newTab: true }))}>A new tab</Chip>
            <Chip c={c} active={!draft.newTab} onClick={() => setDraft(d => ({ ...d, newTab: false }))}>This tab</Chip>
          </SettingsField>
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
