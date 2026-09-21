"use client";

import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import WidgetGrid from "@/components/WidgetGrid";
import { widgets } from "@/lib/widgets";
import { getDashboards, saveDashboards, type DashboardsState } from "@/lib/dashboards";
import { maybeSeedFirstRun } from "@/lib/seed";

export default function Home() {
  const [editing, setEditing] = useState(false);
  const [dashboards, setDashboards] = useState<DashboardsState | null>(null);
  // Dashboards stay mounted once visited (hidden when inactive) so switching
  // between them keeps widget state instead of reloading everything.
  const [visited, setVisited] = useState<string[]>([]);
  const editControls = useRef<Record<string, { cancel: () => void }>>({});

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
  }, [dashboards]);

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
