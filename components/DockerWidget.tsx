"use client";

import { useCallback, useEffect, useState } from "react";
import { Container as ContainerIcon } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { useScrollFade } from "@/lib/useScrollFade";
import { useWidgetActive, usePageVisible } from "@/lib/activeDashboard";
import FlipCard from "@/components/ui/FlipCard";
import { WidgetHeader, Chip, EmptyState, ErrorState, LoadingState, ScrollFades, SettingsFace, SettingsField, SettingsNote } from "@/components/ui/WidgetChrome";

// The containers on the Docker host (docs/widgets/docker.md): name, a dot for
// its state and Docker's own status line. Admin only, and only once the
// operator has connected Docker to the dashboard.

type Container = { id: string; name: string; image: string; state: string; status: string };
type Config = { showStopped: boolean };
const DEFAULT: Config = { showStopped: true };
const POLL_MS = 15_000;

// Trouble first, then running, then stopped; by name within each.
// Exported for tests.
export function containerRank(c: Pick<Container, "state" | "status">): number {
  if (c.state === "restarting" || c.state === "dead" || /unhealthy/i.test(c.status)) return 0;
  if (c.state === "running") return 1;
  if (c.state === "paused") return 2;
  return 3;
}

export default function DockerWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const active = useWidgetActive();
  const visible = usePageVisible();
  const storageKey = `docker-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [list, setList] = useState<Container[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "not_connected" | "failed">("loading");
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([list?.length, config.showStopped]);

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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/docker");
      if (res.status === 403) { setState("forbidden"); return; }
      const data = await res.json();
      if (res.status === 404 && data.error === "not_connected") { setState("not_connected"); return; }
      if (!res.ok) throw new Error();
      setList(data.containers ?? []);
      setState("ok");
    } catch {
      setState(s => (s === "ok" ? "ok" : "failed"));
    }
  }, []);

  useEffect(() => {
    if (!active || !visible || state === "forbidden" || state === "not_connected") return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [active, visible, state, load]);

  const shown = (list ?? [])
    .filter(x => config.showStopped || x.state === "running" || containerRank(x) === 0)
    .sort((a, b) => containerRank(a) - containerRank(b) || a.name.localeCompare(b.name));
  const running = (list ?? []).filter(x => x.state === "running").length;
  const trouble = (list ?? []).filter(x => containerRank(x) === 0).length;

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader
            onSettings={() => { setDraft(config); setSettingsOpen(true); }}
            c={c}
            icon={ContainerIcon}
            title={widget.title}
            after={state === "ok" && list ? (
              trouble > 0
                ? <span className="text-sm font-medium text-rose-600 dark:text-rose-400">{trouble} in trouble</span>
                : <span className={`text-sm opacity-70 tabular-nums ${c.label}`}>{running} running</span>
            ) : undefined}
          />
          {state === "forbidden" ? (
            <EmptyState c={c}>only the admin can see the containers</EmptyState>
          ) : state === "not_connected" ? (
            <EmptyState c={c}>Docker is not connected. Mount the Docker socket into the dashboard, read-only, then reload.</EmptyState>
          ) : state === "failed" ? (
            <ErrorState c={c} onRetry={() => { setState("loading"); load(); }}>could not reach Docker</ErrorState>
          ) : !list ? (
            <LoadingState c={c} />
          ) : shown.length === 0 ? (
            <EmptyState c={c}>no containers</EmptyState>
          ) : (
            <div className="flex-1 min-h-0 relative">
              <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
                <ul className="flex flex-col">
                  {shown.map((x, i) => {
                    const rank = containerRank(x);
                    const dot = rank === 0 ? "bg-rose-500" : rank === 1 ? "bg-emerald-500" : rank === 2 ? "bg-amber-500" : "bg-current opacity-30";
                    return (
                      <li key={x.id} title={`${x.image}\n${x.status}`} className={`flex items-center gap-2.5 py-2 first:pt-0 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                        <span aria-hidden className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot} ${c.label}`} />
                        <span className={`flex-1 min-w-0 truncate text-sm font-medium ${c.text} ${rank === 3 ? "opacity-70" : ""}`}>{x.name}</span>
                        <span className={`shrink-0 max-w-[55%] truncate text-sm ${rank === 0 ? "text-rose-600 dark:text-rose-400 font-medium" : `opacity-70 ${c.label}`}`}>{x.status || x.state}</span>
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
        <SettingsFace
          c={c}
          onReset={() => setDraft(DEFAULT)}
          onSave={() => { setConfig(draft); storage.setItem(storageKey, JSON.stringify(draft)); setSettingsOpen(false); }}
          onCancel={() => setSettingsOpen(false)}
        >
          <SettingsField c={c} label="Stopped containers" inline>
            <Chip c={c} active={draft.showStopped} onClick={() => setDraft({ showStopped: true })}>Shown</Chip>
            <Chip c={c} active={!draft.showStopped} onClick={() => setDraft({ showStopped: false })}>Hidden</Chip>
          </SettingsField>
          <SettingsNote c={c}>Containers that keep restarting or report unhealthy are always shown, at the top.</SettingsNote>
        </SettingsFace>
      }
    />
  );
}
