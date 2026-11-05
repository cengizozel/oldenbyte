// Leftover widget data: keys that belong to a widget instance which no longer
// exists on any dashboard. Pure decisions here; lib/orphans.ts reads and
// deletes, the edit shelf shows the list, and maintenance only reports.
//
// What counts as live: every instance id in every dashboard's instances map,
// plus every id in the notepad registry (other notepads read those for their
// history views, so a removed notepad's notes stay reachable on purpose).
// What counts as leftover: keys whose family and instance id lib/settingKeys
// knows and whose instance is not live. Nothing is ever removed on its own:
// the data of a removed widget (notes, chats, logs) is still the user's, so
// they review the list and delete per widget. An unparsable instances map or
// registry makes the whole list empty rather than wrong.

import { instanceIdOf } from "@/lib/settingKeys";

export const REGISTRY_KEY = "notepad-registry";

export function isLiveSetKey(key: string): boolean {
  return key === "widget-instances" || key.startsWith("widget-instances:") || key === REGISTRY_KEY;
}

// The ids the dashboards and registry refer to, or null when any of them is
// unreadable (then nothing may be considered leftover).
export function liveIdsFrom(rows: { key: string; value: string }[]): Set<string> | null {
  const live = new Set<string>();
  for (const r of rows) {
    let parsed: unknown;
    try { parsed = JSON.parse(r.value); } catch { return null; }
    if (r.key === REGISTRY_KEY) {
      if (!Array.isArray(parsed)) return null;
      for (const id of parsed) if (typeof id === "string") live.add(id);
    } else {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      for (const id of Object.keys(parsed)) live.add(id);
    }
  }
  return live;
}

export type OrphanRow = { key: string; bytes: number; updatedAt: Date };
export type Orphan = { id: string; keys: OrphanRow[]; bytes: number; lastWrite: Date };

// Leftover keys grouped by the instance they belonged to, largest first.
export function orphanGroups(rows: OrphanRow[], live: Set<string>): Orphan[] {
  const byId = new Map<string, Orphan>();
  for (const r of rows) {
    const id = instanceIdOf(r.key);
    if (id === null || live.has(id)) continue;
    const g = byId.get(id) ?? { id, keys: [], bytes: 0, lastWrite: r.updatedAt };
    g.keys.push(r);
    g.bytes += r.bytes;
    if (r.updatedAt > g.lastWrite) g.lastWrite = r.updatedAt;
    byId.set(id, g);
  }
  return [...byId.values()].sort((a, b) => b.bytes - a.bytes);
}
