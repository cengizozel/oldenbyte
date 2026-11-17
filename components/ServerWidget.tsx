"use client";

import { useCallback, useEffect, useState } from "react";
import { Server } from "lucide-react";
import { colorMap, type ColorClasses, type Widget } from "@/lib/widgets";
import { useWidgetActive, usePageVisible } from "@/lib/activeDashboard";
import FlipCard from "@/components/ui/FlipCard";
import { WidgetHeader, EmptyState, ErrorState, LoadingState } from "@/components/ui/WidgetChrome";

// The machine the dashboard runs on (docs/widgets/server.md): processor,
// memory, the disk your data is on, uptime and temperature. Admin only.

type Stats = {
  cpu: number; cores: number; load: number[];
  mem: { used: number; total: number };
  disk: { used: number; total: number } | null;
  uptime: number; temp: number | null;
};
const POLL_MS = 5000;

// "5.1 GB", "512 MB", "1.8 TB". Exported for tests.
export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// "12 days", "5 hours", "40 minutes". Exported for tests.
export function formatUptime(seconds: number): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (seconds >= 86400) return plural(Math.floor(seconds / 86400), "day");
  if (seconds >= 3600) return plural(Math.floor(seconds / 3600), "hour");
  return plural(Math.max(1, Math.floor(seconds / 60)), "minute");
}

// One reading: its name, the value in words, and a bar. Past 90% the bar
// turns red, the one place this widget uses color for meaning.
function Meter({ c, label, value, percent, detail }: { c: ColorClasses; label: string; value: string; percent: number; detail?: string }) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm font-medium ${c.text}`}>{label}</span>
        <span className={`text-sm tabular-nums ${c.text}`}>{value}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-1.5 rounded-full bg-black/10 dark:bg-white/15 overflow-hidden"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${pct >= 90 ? "bg-rose-500" : `bg-current ${c.label}`}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {detail && <span className={`text-sm opacity-70 ${c.label}`}>{detail}</span>}
    </div>
  );
}

export default function ServerWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const active = useWidgetActive();
  const visible = usePageVisible();
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "failed">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/server-stats");
      if (res.status === 403) { setState("forbidden"); return; }
      if (!res.ok) throw new Error();
      setStats(await res.json());
      setState("ok");
    } catch {
      setState(s => (s === "ok" ? "ok" : "failed"));   // a missed reading keeps the last one on screen
    }
  }, []);

  useEffect(() => {
    if (!active || !visible || state === "forbidden") return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [active, visible, state, load]);

  return (
    <FlipCard
      c={c}
      flipped={false}
      className={className}
      front={
        <>
          <WidgetHeader c={c} icon={Server} title={widget.title} />
          {state === "forbidden" ? (
            <EmptyState c={c}>only the admin can see the server</EmptyState>
          ) : state === "failed" ? (
            <ErrorState c={c} onRetry={() => { setState("loading"); load(); }}>could not read the server</ErrorState>
          ) : !stats ? (
            <LoadingState c={c} />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-3">
              <Meter
                c={c}
                label="Processor"
                value={`${Math.round(stats.cpu)}%`}
                percent={stats.cpu}
                detail={`${stats.cores} ${stats.cores === 1 ? "thread" : "threads"} · load ${stats.load[0].toFixed(2)}`}
              />
              <Meter
                c={c}
                label="Memory"
                value={`${Math.round((stats.mem.used / stats.mem.total) * 100)}%`}
                percent={(stats.mem.used / stats.mem.total) * 100}
                detail={`${formatBytes(stats.mem.used)} of ${formatBytes(stats.mem.total)}`}
              />
              {stats.disk && (
                <Meter
                  c={c}
                  label="Disk"
                  value={`${Math.round((stats.disk.used / stats.disk.total) * 100)}%`}
                  percent={(stats.disk.used / stats.disk.total) * 100}
                  detail={`${formatBytes(stats.disk.used)} of ${formatBytes(stats.disk.total)}`}
                />
              )}
              <p className={`text-sm opacity-70 ${c.label}`}>
                up {formatUptime(stats.uptime)}{stats.temp !== null ? ` · ${Math.round(stats.temp)}°C` : ""}
              </p>
            </div>
          )}
        </>
      }
      back={null}
    />
  );
}
