"use client";

import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import WidgetGrid from "@/components/WidgetGrid";
import { widgets } from "@/lib/widgets";
import { getDashboards, saveDashboards, PRELOAD_KEY, PRELOAD_EVENT, type DashboardsState } from "@/lib/dashboards";
import { maybeSeedFirstRun } from "@/lib/seed";
import * as storage from "@/lib/storage";

const localDay = () => new Date().toDateString();

export default function Home() {
  const [editing, setEditing] = useState(false);
  const [dashboards, setDashboards] = useState<DashboardsState | null>(null);
  // Dashboards stay mounted once visited (hidden when inactive) so switching
  // between them keeps widget state instead of reloading everything.
  const [visited, setVisited] = useState<string[]>([]);
  const editControls = useRef<Record<string, { cancel: () => void }>>({});
  // Settings > Performance: mount every dashboard at load, not just on first visit.
  const [preload, setPreload] = useState(false);

  useEffect(() => {
    storage.getItem(PRELOAD_KEY).then(v => setPreload(v === "1"));
    const onChange = (e: Event) => setPreload(!!(e as CustomEvent).detail);
    window.addEventListener(PRELOAD_EVENT, onChange);
    return () => window.removeEventListener(PRELOAD_EVENT, onChange);
  }, []);

  // Widgets fetch their day's data once, so a tab left open overnight shows
  // yesterday everywhere. Coming back to the tab on a new day reloads it.
  useEffect(() => {
    const loadedOn = localDay();
    const onVisible = () => {
      if (document.visibilityState === "visible" && localDay() !== loadedOn) location.reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    // A true first run gets the seeded demo dashboards; everyone else loads
    // whatever they already have.
    maybeSeedFirstRun()
      .then(seeded => (seeded ? setDashboards(seeded) : getDashboards().then(setDashboards)))
      .catch(() => getDashboards().then(setDashboards));
  }, []);

  useEffect(() => {
    if (!dashboards) return;
    const ids = new Set(dashboards.list.map(d => d.id));
    setVisited(prev => {
      const kept = prev.filter(id => ids.has(id));
      return kept.includes(dashboards.activeId) ? kept : [...kept, dashboards.activeId];
    });
    if (!preload) return;
    // The active dashboard renders first; the rest mount a moment later so
    // their fetches do not compete with what is on screen.
    const t = setTimeout(() => {
      setVisited(prev => [...prev, ...dashboards.list.map(d => d.id).filter(id => !prev.includes(id))]);
    }, 1500);
    return () => clearTimeout(t);
  }, [dashboards, preload]);

  function handleDashboardsChange(next: DashboardsState) {
    setDashboards(next);
    saveDashboards(next);
  }

  return (
    <div className="min-h-screen md:h-screen bg-[var(--page-bg)] flex flex-col px-4 pt-2 pb-4 md:px-6 md:pt-3 md:pb-6 gap-4 md:gap-5 md:overflow-hidden">
      <TopBar
        editing={editing}
        onToggleEdit={() => setEditing(e => !e)}
        onCancelEdit={() => { if (dashboards) editControls.current[dashboards.activeId]?.cancel(); setEditing(false); }}
        dashboards={dashboards}
        onDashboardsChange={handleDashboardsChange}
      />
      {dashboards && visited.map(id => {
        const active = id === dashboards.activeId;
        return (
          <div key={id} className={active ? "flex flex-col gap-4 md:gap-5 flex-1 min-h-0" : "hidden"}>
            <WidgetGrid
              dashboardId={id}
              widgets={widgets}
              editing={editing && active}
              onToggleEdit={() => setEditing(e => !e)}
              onRegisterEditControls={c => { editControls.current[id] = c; }}
            />
          </div>
        );
      })}
    </div>
  );
}
