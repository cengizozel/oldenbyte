import * as storage from "@/lib/storage";

// Multiple named dashboards. The original single dashboard keeps the legacy
// storage keys (widget-layout / widget-instances) under the reserved id
// "default", so existing data needs no migration; additional dashboards use
// namespaced keys. Per-widget config keys are instance-id scoped and globally
// unique, so they need no namespacing: they follow their instances.

export type DashboardMeta = { id: string; name: string };
export type DashboardsState = { list: DashboardMeta[]; activeId: string };

export const DEFAULT_DASHBOARDS: DashboardsState = {
  list: [{ id: "default", name: "Main" }],
  activeId: "default",
};

export function layoutKey(dashboardId: string): string {
  return dashboardId === "default" ? "widget-layout" : `widget-layout:${dashboardId}`;
}

export function instancesKey(dashboardId: string): string {
  return dashboardId === "default" ? "widget-instances" : `widget-instances:${dashboardId}`;
}

export async function getDashboards(): Promise<DashboardsState> {
  try {
    const raw = await storage.getItem("dashboards");
    if (raw) {
      const parsed = JSON.parse(raw) as DashboardsState;
      if (parsed?.list?.length && parsed.list.some(d => d.id === parsed.activeId)) return parsed;
    }
  } catch { /* fall through to default */ }
  return DEFAULT_DASHBOARDS;
}

export async function saveDashboards(state: DashboardsState): Promise<void> {
  await storage.setItem("dashboards", JSON.stringify(state));
}

// Storage keys of the currently displayed dashboard, for consumers that read
// the grid outside WidgetGrid itself (digest, chat dashboard context).
export async function getActiveDataKeys(): Promise<{ layout: string; instances: string }> {
  const d = await getDashboards();
  return { layout: layoutKey(d.activeId), instances: instancesKey(d.activeId) };
}
