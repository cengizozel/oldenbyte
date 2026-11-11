// Client-side lookups the Chat widget makes against the active dashboard: the
// roster of widgets it can read (its data-source checkboxes) and the CalDAV
// account of the first Calendar widget. The widget contents themselves are read
// server-side by lib/widgetData.ts.

import * as storage from "@/lib/storage";
import { getActiveDataKeys, instancesKey, type DashboardsState } from "@/lib/dashboards";
import { parseJson } from "@/lib/text";

type TabLayoutItem = { i: string; tabs?: string[] };
type WidgetInstance = { id: string; type: string; title: string };

// Widget types whose contents the chat can read (lib/widgetData.ts has a
// reader for each); reader/chess/chat/empty have no useful text.
const ENTRY_TYPES = new Set(["notebook", "text", "f1", "weather", "calendar", "schedule", "rss", "reddit", "youtube", "arxiv", "hf", "tracker", "rhythm", "upkeep", "deficit", "bookmarks"]);

async function readJSON<T>(key: string): Promise<T | null> {
  return parseJson<T | null>(await storage.getItem(key), null);
}

export type WidgetRosterItem = { id: string; title: string; type: string };

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
export async function listDashboardWidgets(): Promise<WidgetRosterItem[]> {
  const keys = await getActiveDataKeys();
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
