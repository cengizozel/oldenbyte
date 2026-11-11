import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, requireUser } from "@/lib/http";
import { instanceIdOf, isCacheKey } from "@/lib/settingKeys";

// GET /api/settings/summary: what is stored for the signed-in user, grouped
// the way they think of it (each dashboard's widgets, things shared across
// dashboards, leftovers of removed widgets, caches), with sizes and when each
// last changed. Read-only and names only: no values leave the server.

type Group = { keys: number; bytes: number; updatedAt: number };
const empty = (): Group => ({ keys: 0, bytes: 0, updatedAt: 0 });
function add(g: Group, bytes: number, at: Date) {
  g.keys++;
  g.bytes += bytes;
  g.updatedAt = Math.max(g.updatedAt, at.getTime());
}

// User-level keys, by what they are for.
function sharedLabel(key: string): string {
  if (key === "chat-library" || key.startsWith("chat-library-conv-")) return "Assistant chats and characters";
  if (key === "favorites") return "Feed favorites";
  if (key === "dashboards" || key.startsWith("widget-layout") || key.startsWith("widget-instances")) return "Dashboards and layouts";
  if (key === "chat-last-connection") return "Assistant model connection";
  if (key === "notepad-registry") return "Notepad list";
  if (key.startsWith("youtube-")) return "YouTube and TubeArchivist";
  return "Preferences";
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const [settings, caches, account, sessions] = await Promise.all([
    prisma.setting.findMany({ where: { userId: user.id }, select: { key: true, value: true, updatedAt: true } }),
    prisma.cache.findMany({ where: { userId: user.id }, select: { value: true, updatedAt: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { username: true, createdAt: true } }),
    prisma.session.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } }),
  ]);
  const byKey = new Map(settings.map(s => [s.key, s.value]));
  const parse = <T,>(key: string): T | null => { try { const v = byKey.get(key); return v ? JSON.parse(v) as T : null; } catch { return null; } };

  // Where each widget lives.
  type Inst = { id: string; type: string; title: string };
  const dashList = parse<{ list?: { id: string; name: string }[] }>("dashboards")?.list ?? [{ id: "default", name: "Main" }];
  const home = new Map<string, { dashboardId: string; title: string; type: string }>();
  for (const d of dashList) {
    const instances = parse<Record<string, Inst>>(d.id === "default" ? "widget-instances" : `widget-instances:${d.id}`) ?? {};
    for (const w of Object.values(instances)) if (w?.id) home.set(w.id, { dashboardId: d.id, title: w.title, type: w.type });
  }

  const widgets = new Map<string, Group & { title: string; type: string; dashboardId: string }>();
  const shared = new Map<string, Group>();
  const leftovers = empty();
  const leftoverIds = new Set<string>();
  const cache = empty();
  for (const s of settings) {
    const bytes = Buffer.byteLength(s.value);
    if (isCacheKey(s.key)) { add(cache, bytes, s.updatedAt); continue; }
    const id = instanceIdOf(s.key);
    if (id) {
      const at = home.get(id);
      if (!at) { add(leftovers, bytes, s.updatedAt); leftoverIds.add(id); continue; }
      const g = widgets.get(id) ?? { ...empty(), ...at };
      add(g, bytes, s.updatedAt);
      widgets.set(id, g);
      continue;
    }
    const label = sharedLabel(s.key);
    const g = shared.get(label) ?? empty();
    add(g, bytes, s.updatedAt);
    shared.set(label, g);
  }
  for (const c of caches) add(cache, Buffer.byteLength(c.value), c.updatedAt);

  // A few counts that say more than a size.
  const lib = parse<{ conversations?: unknown[]; characters?: unknown[] }>("chat-library");
  const favs = parse<unknown[]>("favorites");
  const counts: Record<string, string> = {};
  if (lib) {
    const n = lib.conversations?.length ?? 0, m = lib.characters?.length ?? 0;
    counts["Assistant chats and characters"] = `${n} ${n === 1 ? "chat" : "chats"}, ${m} ${m === 1 ? "character" : "characters"}`;
  }
  if (Array.isArray(favs)) counts["Feed favorites"] = `${favs.length} ${favs.length === 1 ? "item" : "items"}`;
  counts["Dashboards and layouts"] = `${dashList.length} ${dashList.length === 1 ? "dashboard" : "dashboards"}`;

  return json({
    account: account ? { username: account.username, createdAt: account.createdAt.getTime(), sessions } : null,
    dashboards: dashList.map(d => ({
      id: d.id,
      name: d.name,
      widgets: [...widgets.entries()]
        .filter(([, w]) => w.dashboardId === d.id)
        .map(([id, w]) => ({ id, title: w.title, type: w.type, keys: w.keys, bytes: w.bytes, updatedAt: w.updatedAt }))
        .sort((a, b) => b.bytes - a.bytes),
    })),
    shared: [...shared.entries()].map(([label, g]) => ({ label, detail: counts[label] ?? "", ...g })).sort((a, b) => b.bytes - a.bytes),
    leftovers: { widgets: leftoverIds.size, ...leftovers },
    caches: cache,
  });
}
