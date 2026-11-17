"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tag, X } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { timeAgo } from "@/lib/format";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { FOCUS_RING } from "@/components/ui/Field";
import {
  WidgetHeader, RefreshButton, EmptyState, ErrorState, LoadingState, ScrollFades, SettingsFace, SettingsField, SettingsError,
  SettingsAddRow, SettingsListRow, ROW_ACTION,
} from "@/components/ui/WidgetChrome";

// The latest release of the projects you follow (docs/widgets/releases.md),
// newest first. Read from each repository's releases feed, so no API key and
// no rate limit to manage.

type Config = { repos: string[] };
type Release = { repo: string; version: string; link: string; date: string };
type Row = Release | { repo: string; error: true };
const DEFAULT: Config = { repos: [] };

// What the user typed to a canonical entry: "owner/repo" for GitHub, or a
// repository URL on another forge. Null when it is neither. Exported for tests.
export function normalizeRepo(input: string): string | null {
  const s = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    if (u.hostname === "github.com" || u.hostname === "www.github.com") return `${parts[0]}/${parts[1]}`;
    return `${u.origin}/${parts.join("/")}`;
  } catch { return null; }
}

// The releases feed of an entry. GitHub and Gitea/Forgejo/Codeberg serve
// /releases.atom; GitLab keeps it under /-/. Exported for tests.
export function releasesFeed(repo: string): string {
  if (!/^https?:\/\//.test(repo)) return `https://github.com/${repo}/releases.atom`;
  return /(^|\.)gitlab\./.test(new URL(repo).hostname) ? `${repo}/-/releases.atom` : `${repo}/releases.atom`;
}

// "owner/repo" for display, whatever the forge.
export function repoName(repo: string): string {
  if (!/^https?:\/\//.test(repo)) return repo;
  return new URL(repo).pathname.split("/").filter(Boolean).slice(-2).join("/");
}

export default function ReleasesWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const storageKey = `releases-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([rows.length]);

  const load = useCallback(async (cfg: Config, force = false) => {
    if (!cfg.repos.length) { setRows([]); return; }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoading(true);
    const got = await Promise.all(cfg.repos.map(async (repo): Promise<Row> => {
      try {
        const res = await fetch(`/api/rss?url=${encodeURIComponent(releasesFeed(repo))}&limit=1${force ? "&refresh=1" : ""}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error();
        const items: { title: string; link: string; pubDate?: string }[] = await res.json();
        const it = items[0];
        if (!it) throw new Error();
        // The tag is the version; the feed title is the release's name, which
        // is often the same and sometimes a sentence.
        const tag = it.link.includes("/releases/tag/") ? decodeURIComponent(it.link.split("/releases/tag/")[1].split(/[?#]/)[0]) : "";
        return { repo, version: tag || it.title, link: it.link, date: it.pubDate ?? "" };
      } catch {
        return { repo, error: true };
      }
    }));
    if (ctrl.signal.aborted) return;
    const time = (r: Row) => ("error" in r ? -1 : Date.parse(r.date) || 0);
    setRows(got.sort((a, b) => time(b) - time(a)));
    if (abort.current === ctrl) setLoading(false);
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

  function addRepo() {
    setError("");
    const repo = normalizeRepo(input);
    if (!repo) { setError("Enter owner/repo for GitHub, or a repository address."); return; }
    if (draft.repos.includes(repo)) { setInput(""); return; }
    setDraft(d => ({ repos: [...d.repos, repo] }));
    setInput("");
  }

  function handleSave() {
    setConfig(draft);
    storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
    setRows([]);
    load(draft);
  }

  const allFailed = rows.length > 0 && rows.every(r => "error" in r);

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
            icon={Tag}
            title={widget.title}
            right={config.repos.length > 0 ? <RefreshButton c={c} busy={loading} onClick={() => load(config, true)} /> : undefined}
          />
          {config.repos.length === 0 ? (
            <EmptyState c={c} action={t("empty.releases")} />
          ) : loading && !rows.length ? (
            <LoadingState c={c} />
          ) : allFailed ? (
            <ErrorState c={c} busy={loading} onRetry={() => load(config, true)}>could not load releases</ErrorState>
          ) : (
            <div className="flex-1 min-h-0 relative">
              <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
                <ul className="flex flex-col">
                  {rows.map((row, i) => {
                    const border = i > 0 ? "border-t border-black/10 dark:border-white/10" : "";
                    const [owner, name] = repoName(row.repo).split("/");
                    const title = <p className={`text-sm truncate ${c.text}`}><span className={`opacity-70 ${c.label}`}>{owner}/</span><span className="font-medium">{name}</span></p>;
                    if ("error" in row) {
                      return (
                        <li key={row.repo} className={`flex items-center justify-between gap-3 py-2 first:pt-0 ${border}`}>
                          <div className="min-w-0">{title}</div>
                          <p className={`shrink-0 text-sm opacity-70 ${c.label}`}>no releases found</p>
                        </li>
                      );
                    }
                    return (
                      <li key={row.repo} className={`py-2 first:pt-0 ${border}`}>
                        <a href={row.link} target="_blank" rel="noopener noreferrer" className={`flex items-center justify-between gap-3 hover:opacity-70 transition-opacity rounded-sm ${FOCUS_RING}`}>
                          <div className="min-w-0">
                            {title}
                            <p className={`text-sm opacity-70 truncate ${c.label}`}>{row.date ? timeAgo(row.date) : ""}</p>
                          </div>
                          <span className={`shrink-0 max-w-[50%] truncate text-sm font-medium tabular-nums px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 ${c.text}`}>{row.version}</span>
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
          <SettingsField c={c} label="Projects" hint="owner/repo for GitHub, or the address of a repository on GitLab, Codeberg or a public Gitea.">
            <SettingsAddRow c={c} value={input} onChange={setInput} onAdd={addRepo} placeholder="immich-app/immich" />
          </SettingsField>
          {error && <SettingsError>{error}</SettingsError>}
          {draft.repos.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {draft.repos.map(repo => (
                <SettingsListRow
                  key={repo}
                  title={<span className={`truncate ${c.text}`} title={repo}>{repoName(repo)}</span>}
                  actions={
                    <button type="button" onClick={() => setDraft(d => ({ repos: d.repos.filter(x => x !== repo) }))} aria-label={`Remove ${repoName(repo)}`} title="Remove" className={`${ROW_ACTION} ${c.label}`}>
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
