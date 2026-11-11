// Client-side lookups the Chat widget makes against the active dashboard: the
// roster of widgets it can read (its data-source checkboxes) and the CalDAV
// account of the first Calendar widget. The widget contents themselves are read
// server-side by lib/widgetData.ts.

import * as storage from "@/lib/storage";
import { getActiveDataKeys, instancesKey, layoutKey, type DashboardsState } from "@/lib/dashboards";
import { parseJson } from "@/lib/text";

type TabLayoutItem = { i: string; tabs?: string[] };
type WidgetInstance = { id: string; type: string; title: string };

// Widget types whose contents the chat can read (lib/widgetData.ts has a
// reader for each); reader/chat/empty have no useful text.
const ENTRY_TYPES = new Set(["notebook", "text", "f1", "weather", "calendar", "schedule", "rss", "reddit", "youtube", "arxiv", "hf", "tracker", "rhythm", "upkeep", "deficit", "bookmarks", "chess"]);

async function readJSON<T>(key: string): Promise<T | null> {
  return parseJson<T | null>(await storage.getItem(key), null);
}

// `dashboardId`/`dashboardName` say where the widget lives (set by the
// all-dashboards listing).
export type WidgetRosterItem = { id: string; title: string; type: string; dashboardId?: string; dashboardName?: string };

export type CalendarAccount = {
  baseUrl: string;
  username: string;
  password: string;
  calendars: { name: string; url: string; readOnly?: boolean; source?: string }[];
};
export type CalendarSource = { widgetId: string; account: CalendarAccount };

/**
 * The first configured Calendar widget's CalDAV account on the active
 * dashboard, so the chat can read/write the calendar without storing a second
 * copy of the credentials.
 */
export async function getCalendarAccount(): Promise<CalendarSource | null> {
  const keys = await getActiveDataKeys();
  const [layout, instances] = await Promise.all([
    readJSON<TabLayoutItem[]>(keys.layout),
    readJSON<Record<string, WidgetInstance>>(keys.instances),
  ]);
  if (!layout || !instances) return null;
  const ids: string[] = [];
  for (const item of layout) {
    ids.push(item.i);
    for (const tab of item.tabs ?? []) ids.push(tab);
  }
  for (const id of ids) {
    if (instances[id]?.type !== "calendar") continue;
    const cfg = await readJSON<CalendarAccount>(`calendar-widget-${id}`);
    if (cfg?.baseUrl && cfg.username && cfg.calendars?.length) return { widgetId: id, account: cfg };
  }
  return null;
}

/**
 * Just the roster of data-bearing widgets on the active dashboard (no content
 * fetching). Drives the chat's data-source checkbox list.
 */
export async function listDashboardWidgets(dashboardId?: string): Promise<WidgetRosterItem[]> {
  const keys = dashboardId ? { layout: layoutKey(dashboardId), instances: instancesKey(dashboardId) } : await getActiveDataKeys();
  const [layout, instances] = await Promise.all([
    readJSON<TabLayoutItem[]>(keys.layout),
    readJSON<Record<string, WidgetInstance>>(keys.instances),
  ]);
  if (!layout || !instances) return [];
  const ids: string[] = [];
  for (const item of layout) {
    ids.push(item.i);
    for (const tab of item.tabs ?? []) ids.push(tab);
  }
  return ids
    .filter(id => instances[id] && ENTRY_TYPES.has(instances[id].type))
    .map(id => ({ id, title: instances[id].title, type: instances[id].type }));
}

async function dashboardList(): Promise<{ id: string; name: string }[]> {
  const dashboards = await readJSON<DashboardsState>("dashboards");
  return dashboards?.list?.length ? dashboards.list : [{ id: "default", name: "Main" }];
}

/** Data-bearing widgets on every dashboard, each tagged with its dashboard. */
export async function listAllDashboardWidgets(): Promise<WidgetRosterItem[]> {
  const out: WidgetRosterItem[] = [];
  for (const d of await dashboardList()) {
    for (const w of await listDashboardWidgets(d.id)) out.push({ ...w, dashboardId: d.id, dashboardName: d.name });
  }
  return out;
}

/** Every widget of a type on every dashboard, with the dashboard it is on. */
export async function listWidgetsOfType(type: string): Promise<{ id: string; dashboardId: string }[]> {
  const out: { id: string; dashboardId: string }[] = [];
  for (const d of await dashboardList()) {
    const instances = await readJSON<Record<string, WidgetInstance>>(instancesKey(d.id));
    for (const w of Object.values(instances ?? {})) if (w.type === type) out.push({ id: w.id, dashboardId: d.id });
  }
  return out;
}

/**
 * The dashboard a widget is on (with preloading, a mounted widget is not
 * always on the active one). Falls back to the active dashboard.
 */
export async function dashboardOf(widgetId: string): Promise<string> {
  const list = await dashboardList();
  for (const d of list) {
    const instances = await readJSON<Record<string, WidgetInstance>>(instancesKey(d.id));
    if (instances?.[widgetId]) return d.id;
  }
  const dashboards = await readJSON<DashboardsState>("dashboards");
  return dashboards?.activeId ?? list[0].id;
}

/**
 * The Kiwix servers the user's Kiwix widgets already point at, across every
 * dashboard, so another feature (the Assistant's lookup) can offer them
 * instead of asking for the address again. Widgets on the same server are
 * merged into one entry (addresses compared without case or a trailing
 * slash); different servers give several entries, most used first.
 */
export type KnownKiwixServer = { url: string; widgets: number; sources: string[] };
export async function listKiwixServers(): Promise<KnownKiwixServer[]> {
  const dashboards = await readJSON<DashboardsState>("dashboards");
  const ids = dashboards?.list?.length ? dashboards.list.map(d => d.id) : ["default"];
  const byUrl = new Map<string, KnownKiwixServer>();
  for (const dashId of ids) {
    const instances = await readJSON<Record<string, WidgetInstance>>(instancesKey(dashId));
    for (const w of Object.values(instances ?? {})) {
      if (w.type !== "kiwix") continue;
      const cfg = await readJSON<{ baseUrl?: string; sourceTitle?: string }>(`kiwix-widget-${w.id}`);
      const url = (cfg?.baseUrl ?? "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(url)) continue;
      const key = url.toLowerCase();
      const entry = byUrl.get(key) ?? { url, widgets: 0, sources: [] };
      entry.widgets++;
      if (cfg?.sourceTitle && !entry.sources.includes(cfg.sourceTitle)) entry.sources.push(cfg.sourceTitle);
      byUrl.set(key, entry);
    }
  }
  return [...byUrl.values()].sort((a, b) => b.widgets - a.widgets);
}

/**
 * The Anytype connections the user's Anytype widgets already hold (address,
 * key and space), across every dashboard, so the Assistant can reuse one
 * instead of pairing again. Same address and space is one entry; a widget
 * that is not connected yet (no key) is skipped.
 */
export type KnownAnytype = { url: string; apiKey: string; spaceId: string; spaceName: string; widgets: number };
export async function listAnytypeConnections(): Promise<KnownAnytype[]> {
  const dashboards = await readJSON<DashboardsState>("dashboards");
  const ids = dashboards?.list?.length ? dashboards.list.map(d => d.id) : ["default"];
  const byKey = new Map<string, KnownAnytype>();
  for (const dashId of ids) {
    const instances = await readJSON<Record<string, WidgetInstance>>(instancesKey(dashId));
    for (const w of Object.values(instances ?? {})) {
      if (w.type !== "anytype") continue;
      const cfg = await readJSON<{ baseUrl?: string; apiKey?: string; spaceId?: string; spaceName?: string }>(`anytype-widget-${w.id}`);
      const url = (cfg?.baseUrl ?? "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(url) || !cfg?.apiKey) continue;
      const key = `${url.toLowerCase()}|${cfg.spaceId ?? ""}`;
      const entry = byKey.get(key) ?? { url, apiKey: cfg.apiKey, spaceId: cfg.spaceId ?? "", spaceName: cfg.spaceName ?? "", widgets: 0 };
      entry.widgets++;
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => b.widgets - a.widgets);
}

/**
 * Model connections the user's other Assistant widgets already use (address
 * and model), newest first, so a new one can offer them instead of asking
 * again. Same address and model is one entry.
 */
export type KnownModelServer = { url: string; model: string };
export async function listModelConnections(exceptWidgetId?: string): Promise<KnownModelServer[]> {
  const dashboards = await readJSON<DashboardsState>("dashboards");
  const ids = dashboards?.list?.length ? dashboards.list.map(d => d.id) : ["default"];
  const out: (KnownModelServer & { at: number })[] = [];
  const seen = new Set<string>();
  for (const dashId of ids) {
    const instances = await readJSON<Record<string, WidgetInstance>>(instancesKey(dashId));
    for (const w of Object.values(instances ?? {})) {
      if (w.type !== "chat" || w.id === exceptWidgetId) continue;
      const idx = await readJSON<{ config?: { baseUrl?: string; model?: string }; conversations?: { updatedAt?: number }[] }>(`chat-${w.id}-index`);
      const url = (idx?.config?.baseUrl ?? "").trim().replace(/\/+$/, "");
      const model = (idx?.config?.model ?? "").trim();
      if (!/^https?:\/\//i.test(url) || !model) continue;
      const key = `${url.toLowerCase()}|${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url, model, at: Math.max(0, ...(idx?.conversations ?? []).map(c => c.updatedAt ?? 0)) });
    }
  }
  return out.sort((a, b) => b.at - a.at).map(({ url, model }) => ({ url, model }));
}

/** Hosts the user's widgets already talk to, for model-server discovery. */
export async function knownHosts(): Promise<string[]> {
  const hosts = new Set<string>();
  const add = (u?: string) => { try { if (u) hosts.add(new URL(u).hostname.toLowerCase()); } catch { /* not a URL */ } };
  for (const k of await listKiwixServers()) add(k.url);
  for (const a of await listAnytypeConnections()) add(a.url);
  for (const m of await listModelConnections()) add(m.url);
  return [...hosts].slice(0, 8);
}
