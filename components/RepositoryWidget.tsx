"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { formatCount, timeAgo } from "@/lib/format";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { FOCUS_RING, SettingsInput } from "@/components/ui/Field";
import { WidgetHeader, RefreshButton, Chip, EmptyState, ErrorState, LoadingState, ScrollFades, SettingsFace, SettingsField, SettingsError } from "@/components/ui/WidgetChrome";
import { normalizeRepo } from "@/components/ReleasesWidget";

// A GitHub repository at a glance (docs/widgets/repository.md): stars, forks,
// and its newest open pull requests and issues.

type Item = { number: number; title: string; url: string; at: string; user: string };
type Info = {
  name: string; description: string; url: string; stars: number; forks: number; issues: number; pulls: number;
  pushedAt: string; archived: boolean; openPulls: Item[]; openIssues: Item[];
};
type Show = "both" | "pulls" | "issues";
type Config = { repo: string; show: Show };
const DEFAULT: Config = { repo: "", show: "both" };

export default function RepositoryWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const storageKey = `repository-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const run = useRef(0);
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([info, config.show]);

  const load = useCallback(async (repo: string, force = false) => {
    if (!repo) return;
    const mine = ++run.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/repository?repo=${encodeURIComponent(repo)}${force ? "&refresh=1" : ""}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not load the repository.");
      if (run.current !== mine) return;
      setInfo(data);
      setFailed("");
    } catch (e) {
      if (run.current === mine) setFailed(String((e as Error).message));
    } finally {
      if (run.current === mine) setLoading(false);
    }
  }, []);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (!saved) return;
      try {
        const parsed = { ...DEFAULT, ...JSON.parse(saved) } as Config;
        setConfig(parsed);
        setDraft(parsed);
        load(parsed.repo);
      } catch {}
    });
  }, [storageKey, load]);

  function handleSave() {
    setError("");
    const repo = normalizeRepo(draft.repo);
    if (!repo || /^https?:/.test(repo)) { setError("Enter a GitHub repository as owner/repo, or its github.com address."); return; }
    const next = { ...draft, repo };
    setConfig(next);
    setDraft(next);
    storage.setItem(storageKey, JSON.stringify(next));
    setSettingsOpen(false);
    if (repo !== config.repo) { setInfo(null); setFailed(""); load(repo); }
  }

  const stats: { label: string; value: number }[] = info ? [
    { label: "Stars", value: info.stars },
    { label: "Forks", value: info.forks },
    { label: "Pull requests", value: info.pulls },
    { label: "Issues", value: info.issues },
  ] : [];

  const list = (heading: string, total: number, items: Item[], more: string) => (
    <div>
      <p className={`text-sm font-medium opacity-70 pb-1 ${c.label}`}>{heading} <span className="tabular-nums">{formatCount(total)}</span></p>
      {items.length === 0 ? (
        <p className={`text-sm opacity-70 ${c.label}`}>none open</p>
      ) : (
        <ul className="flex flex-col">
          {items.slice(0, 5).map((it, i) => (
            <li key={it.number} className={`py-1.5 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
              <a href={it.url} target="_blank" rel="noopener noreferrer" className={`block hover:opacity-70 transition-opacity rounded-sm ${FOCUS_RING}`}>
                <span className={`block text-sm leading-snug break-words ${c.text}`}>{it.title}</span>
                <span className={`block text-sm opacity-70 tabular-nums ${c.label}`}>#{it.number} · {timeAgo(it.at)}{it.user ? ` · ${it.user}` : ""}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {total > 5 && (
        <a href={more} target="_blank" rel="noopener noreferrer" className={`inline-block mt-1 text-sm underline underline-offset-2 opacity-70 hover:opacity-100 rounded-sm ${FOCUS_RING} ${c.label}`}>
          all {formatCount(total)}
        </a>
      )}
    </div>
  );

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader
            onSettings={() => { setDraft(config); setError(""); setSettingsOpen(true); }}
            c={c}
            icon={GitBranch}
            title={info?.name.split("/")[1] ?? (config.repo ? config.repo.split("/")[1] : widget.title)}
            right={config.repo ? <RefreshButton c={c} busy={loading} onClick={() => load(config.repo, true)} /> : undefined}
          />
          {!config.repo ? (
            <EmptyState c={c} action={t("empty.repository")} />
          ) : failed && !info ? (
            <ErrorState c={c} busy={loading} onRetry={() => load(config.repo, true)}>{failed}</ErrorState>
          ) : !info ? (
            <LoadingState c={c} />
          ) : (
            <div className="flex-1 min-h-0 relative">
              <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3 flex flex-col gap-3">
                <div>
                  <a href={info.url} target="_blank" rel="noopener noreferrer" className={`text-sm opacity-70 hover:opacity-100 rounded-sm ${FOCUS_RING} ${c.label}`}>{info.name}{info.archived ? " · archived" : ""}</a>
                  {info.description && <p className={`text-sm leading-snug ${c.text}`}>{info.description}</p>}
                </div>
                <dl className="grid grid-cols-4 gap-2">
                  {stats.map(s => (
                    <div key={s.label} className="min-w-0">
                      <dd className={`text-sm font-medium tabular-nums ${c.text}`}>{formatCount(s.value)}</dd>
                      <dt className={`text-sm opacity-70 truncate ${c.label}`} title={s.label}>{s.label === "Pull requests" ? "PRs" : s.label}</dt>
                    </div>
                  ))}
                </dl>
                {config.show !== "issues" && list("Pull requests", info.pulls, info.openPulls, `${info.url}/pulls`)}
                {config.show !== "pulls" && list("Issues", info.issues, info.openIssues, `${info.url}/issues`)}
                {info.pushedAt && <p className={`text-sm opacity-70 ${c.label}`}>last push {timeAgo(info.pushedAt)}</p>}
              </div>
              <ScrollFades c={c} top={topFade} bottom={bottomFade} />
            </div>
          )}
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }}>
          <SettingsField c={c} label="Repository" hint="A public GitHub repository.">
            <SettingsInput type="text" value={draft.repo} onChange={e => setDraft(d => ({ ...d, repo: e.target.value }))} onKeyDown={e => e.key === "Enter" && handleSave()} placeholder="owner/repo" />
          </SettingsField>
          <SettingsField c={c} label="List" inline>
            <Chip c={c} active={draft.show === "both"} onClick={() => setDraft(d => ({ ...d, show: "both" }))}>Both</Chip>
            <Chip c={c} active={draft.show === "pulls"} onClick={() => setDraft(d => ({ ...d, show: "pulls" }))}>Pull requests</Chip>
            <Chip c={c} active={draft.show === "issues"} onClick={() => setDraft(d => ({ ...d, show: "issues" }))}>Issues</Chip>
          </SettingsField>
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
