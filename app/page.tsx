"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import WidgetGrid from "@/components/WidgetGrid";
import { widgets } from "@/lib/widgets";
import { getDashboards, saveDashboards, type DashboardsState } from "@/lib/dashboards";

export default function Home() {
  const [editing, setEditing] = useState(false);
  const [dashboards, setDashboards] = useState<DashboardsState | null>(null);

  useEffect(() => {
    getDashboards().then(setDashboards);
  }, []);

  function handleDashboardsChange(next: DashboardsState) {
    setDashboards(next);
    saveDashboards(next);
  }

  return (
    <div className="min-h-screen md:h-screen bg-[var(--page-bg)] flex flex-col px-4 pt-2 pb-4 md:px-6 md:pt-3 md:pb-6 gap-4 md:gap-5 md:overflow-hidden">
      <TopBar
        editing={editing}
        onToggleEdit={() => setEditing(e => !e)}
        dashboards={dashboards}
        onDashboardsChange={handleDashboardsChange}
      />
      {dashboards && (
        <WidgetGrid
          key={dashboards.activeId}
          dashboardId={dashboards.activeId}
          widgets={widgets}
          editing={editing}
          onToggleEdit={() => setEditing(e => !e)}
        />
      )}
    </div>
  );
}
