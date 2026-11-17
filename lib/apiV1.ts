// The versioned API for apps (docs/api-v1.md): the phone app, and anything
// else that is not the website. Its promise: within version 1, fields and
// routes are only ever added, never renamed or removed, so an app built
// against an older server keeps working against a newer one.
import { NextResponse } from "next/server";
import { readSetting } from "./migrations";
import { DEFAULT_DASHBOARDS, layoutKey, instancesKey, type DashboardsState } from "./dashboards";

export const API_VERSION = 1;
// The oldest app API version this server still answers. Raised only when a
// version is retired; an app older than this is told to update.
export const API_MIN_VERSION = 1;

// A v1 answer: JSON, the version it speaks in a header, and never cached.
export function v1(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "X-Oldenbyte-Api": String(API_VERSION), "Cache-Control": "no-store" } });
}

// Where a web-view sign-in may land: a path on this server, never another
// site. One leading slash, no scheme-relative "//", no backslash or control
// characters (browsers read "/\\host" as another host). Exported for tests.
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return "/";
  return next;
}

export type V1Widget = {
  id: string;
  type: string;
  title: string;
  color: string;
  // The cell this widget is a tab of, when it is not the cell's first tab.
  group: string | null;
  x: number; y: number; w: number; h: number;
};
export type V1Dashboard = { id: string; name: string; active: boolean; widgets: V1Widget[] };

async function readJSON<T>(userId: string, key: string): Promise<T | null> {
  const { value } = await readSetting(userId, key);
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

type LayoutItem = { i: string; x: number; y: number; w: number; h: number; tabs?: string[] };
type Instance = { id: string; type: string; title: string; color: string };

// One dashboard's widgets in reading order (top to bottom, then left to
// right), a tab group's members after its first tab. Exported for tests.
export function orderWidgets(layout: LayoutItem[], instances: Record<string, Instance>): V1Widget[] {
  const out: V1Widget[] = [];
  for (const item of [...layout].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))) {
    [item.i, ...(item.tabs ?? [])].forEach((id, n) => {
      const w = instances[id];
      if (!w) return;
      out.push({ id, type: String(w.type), title: String(w.title ?? ""), color: String(w.color ?? "neutral"), group: n === 0 ? null : item.i, x: item.x, y: item.y, w: item.w, h: item.h });
    });
  }
  return out;
}

// Every dashboard of a user with its widgets: what an app needs to draw its
// navigation. A user who has never opened the website has the one default
// dashboard, empty.
export async function dashboardsFor(userId: string): Promise<V1Dashboard[]> {
  const stored = await readJSON<DashboardsState>(userId, "dashboards");
  const state = stored?.list?.length && stored.list.some(d => d.id === stored.activeId) ? stored : DEFAULT_DASHBOARDS;
  return Promise.all(state.list.map(async d => {
    const [layout, instances] = await Promise.all([
      readJSON<LayoutItem[]>(userId, layoutKey(d.id)),
      readJSON<Record<string, Instance>>(userId, instancesKey(d.id)),
    ]);
    return { id: d.id, name: d.name, active: d.id === state.activeId, widgets: orderWidgets(Array.isArray(layout) ? layout : [], instances ?? {}) };
  }));
}
