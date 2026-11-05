import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// The database side of storage, against a throwaway SQLite file: the startup
// schema, the on-read migrations, the Cache table, the orphan cleanup and the
// cascade on account deletion. Everything else about these is covered by the
// pure-function tests; this is the glue.
const dir = mkdtempSync(path.join(tmpdir(), "oldenbyte-db-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.sqlite")}`;

type Prisma = typeof import("@/lib/prisma")["prisma"];
let prisma: Prisma;
let readSetting: typeof import("@/lib/migrations")["readSetting"];
let maintenance: typeof import("@/lib/maintenance");
let orphans: typeof import("@/lib/orphans");
let userId: string;

const DAY = 86_400_000;
const weekAgo = new Date(Date.now() - 8 * DAY);

async function put(key: string, value: unknown, updatedAt?: Date) {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  await prisma.setting.upsert({
    where: { userId_key: { userId, key } },
    update: { value: v, ...(updatedAt ? { updatedAt } : {}) },
    create: { userId, key, value: v, ...(updatedAt ? { updatedAt } : {}) },
  });
}
async function get(key: string) {
  return (await prisma.setting.findUnique({ where: { userId_key: { userId, key } } }))?.value ?? null;
}

beforeAll(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  const { ensureSchema } = await import("@/lib/schema");
  await ensureSchema();
  await ensureSchema(); // idempotent
  ({ readSetting } = await import("@/lib/migrations"));
  maintenance = await import("@/lib/maintenance");
  orphans = await import("@/lib/orphans");
  userId = (await prisma.user.create({ data: { username: "t", passwordHash: "x" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("schema", () => {
  it("has the version column and the Cache table", async () => {
    const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("Setting")`);
    expect(cols.map(c => c.name)).toContain("version");
    const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table'`);
    expect(tables.map(t => t.name)).toContain("Cache");
  });
});

describe("readSetting", () => {
  it("returns value and version, and reads cache keys from the Cache table", async () => {
    await put("theme", "dark");
    expect(await readSetting(userId, "theme")).toEqual({ value: "dark", version: 0 });
    expect(await readSetting(userId, "missing")).toEqual({ value: null, version: null });
    await prisma.cache.create({ data: { userId, key: "arxiv-widget-a-2026-01-01", value: "old", expiresAt: new Date(Date.now() - 1000) } });
    await prisma.cache.create({ data: { userId, key: "arxiv-widget-a-2099-01-01", value: "live", expiresAt: new Date(Date.now() + DAY) } });
    expect(await readSetting(userId, "arxiv-widget-a-2026-01-01")).toEqual({ value: null, version: null });
    expect(await readSetting(userId, "arxiv-widget-a-2099-01-01")).toEqual({ value: "live", version: null });
  });

  it("rewrites an old upkeep config in hours and bumps its version", async () => {
    await put("upkeep-config-u1", { items: [{ id: "a", name: "a", weight: 5, every: 2 }] });
    const r = await readSetting(userId, "upkeep-config-u1");
    expect(JSON.parse(r.value!)).toEqual({ items: [{ id: "a", name: "a", weight: 5, hours: 48 }] });
    expect(r.version).toBe(1);
    expect((await readSetting(userId, "upkeep-config-u1")).version).toBe(1); // no second rewrite
  });

  it("builds the upkeep log from the old per-day checklist in the user's zone", async () => {
    await put("timezone", "Europe/Istanbul");
    await put("upkeep-days-u2", { "2026-11-04": ["a"] });
    const r = await readSetting(userId, "upkeep-log-u2");
    expect(JSON.parse(r.value!)).toEqual({ a: [Date.UTC(2026, 10, 4, 9)] });
    expect(await get("upkeep-days-u2")).toBeNull();
  });

  it("folds every old tracker day key into the days store", async () => {
    await put("tracker-day-t1-2026-10-12", { elapsed: { read: 120 } });
    await put("tracker-day-t1-2026-10-13", { elapsed: { read: 60 } });
    const r = await readSetting(userId, "tracker-days-t1");
    expect(JSON.parse(r.value!)).toEqual({ "2026-10-12": { read: 120 }, "2026-10-13": { read: 60 } });
    expect(await get("tracker-day-t1-2026-10-12")).toBeNull();
    expect(await get("tracker-day-t1-2026-10-13")).toBeNull();
  });

  it("merges leftover tracker day keys into an existing store, the store winning", async () => {
    await put("tracker-days-t2", { "2026-10-13": { read: 999 } });
    await put("tracker-day-t2-2026-10-12", { elapsed: { read: 120 } });
    await put("tracker-day-t2-2026-10-13", { elapsed: { read: 60 } });
    const r = await readSetting(userId, "tracker-days-t2");
    expect(JSON.parse(r.value!)).toEqual({ "2026-10-12": { read: 120 }, "2026-10-13": { read: 999 } });
    expect(r.version).toBe(1);
    expect(await get("tracker-day-t2-2026-10-12")).toBeNull();
    expect((await readSetting(userId, "tracker-days-t2")).version).toBe(1); // nothing left to fold
  });

  it("splits an old notepad blob into per-day keys and the index, atomically", async () => {
    await put("notebook-n1-dates", { "2026-10-13": "<b>b</b>", "2026-10-11": "a", "2026-10-12": "" });
    const r = await readSetting(userId, "notebook-n1-days");
    expect(JSON.parse(r.value!)).toEqual(["2026-10-11", "2026-10-13"]);
    expect(await get("notebook-n1-day-2026-10-11")).toBe("a");
    expect(await get("notebook-n1-day-2026-10-13")).toBe("<b>b</b>");
    expect(await get("notebook-n1-day-2026-10-12")).toBeNull();
    expect(await get("notebook-n1-dates")).toBeNull();
  });

  it("leaves an unreadable notepad blob untouched", async () => {
    await put("notebook-n2-dates", "{not json");
    expect(await readSetting(userId, "notebook-n2-days")).toEqual({ value: null, version: null });
    expect(await get("notebook-n2-dates")).toBe("{not json");
  });
});

describe("maintenance", () => {
  it("moves cache rows out of Setting, keeping their expiry rule", async () => {
    await put("rss-widget-r1-2099-01-01", "feed");
    await put("rss-widget-r1", "config");
    expect(await maintenance.moveCacheRows()).toBe(1);
    expect(await get("rss-widget-r1-2099-01-01")).toBeNull();
    expect(await get("rss-widget-r1")).toBe("config");
    const row = await prisma.cache.findUnique({ where: { userId_key: { userId, key: "rss-widget-r1-2099-01-01" } } });
    expect(row?.value).toBe("feed");
    expect(row?.expiresAt.toISOString()).toBe("2099-01-04T00:00:00.000Z");
  });

  it("drops expired caches and only counts leftover widget data", async () => {
    await put("widget-instances", { "text-home": {} }, weekAgo);
    await put("notepad-registry", ["notebook-n1"], weekAgo);
    await put("text-widget-text-home", "live", weekAgo);
    await put("text-widget-text-gone", "leftover", weekAgo);
    await put("chess-chess-gone", "leftover too");
    await put("mystery-1", "unknown family", weekAgo);
    const r = await maintenance.pruneStaleData();
    expect(r.caches).toBe(1); // the expired arxiv row from above
    expect(r.orphans.widgets).toBeGreaterThanOrEqual(2);
    expect(await get("text-widget-text-gone")).toBe("leftover");
    expect(await get("chess-chess-gone")).toBe("leftover too");
  });

  it("lists leftover data per removed widget and deletes one widget's keys on request", async () => {
    const list = await orphans.findOrphans(userId);
    const ids = list.map(o => o.id);
    expect(ids).toContain("text-gone");
    expect(ids).toContain("chess-gone");
    expect(ids).not.toContain("text-home");   // live
    expect(ids).not.toContain("notebook-n1"); // registered notepad
    expect(ids.some(id => id.startsWith("mystery"))).toBe(false);
    expect(await orphans.deleteOrphan(userId, "text-gone")).toBe(1);
    expect(await get("text-widget-text-gone")).toBeNull();
    expect(await orphans.deleteOrphan(userId, "text-home")).toBe(0); // never a live widget
    expect(await get("text-widget-text-home")).toBe("live");
  });

  it("lists nothing when a dashboard's instances map is unreadable", async () => {
    await put("widget-instances:broken", "{not json");
    expect(await orphans.findOrphans(userId)).toEqual([]);
    await prisma.setting.delete({ where: { userId_key: { userId, key: "widget-instances:broken" } } });
  });

  it("compacts without error", async () => {
    await expect(maintenance.compact()).resolves.toBeUndefined();
  });
});

describe("account deletion", () => {
  it("cascades to the user's sessions, settings and caches", async () => {
    const other = await prisma.user.create({ data: { username: "o", passwordHash: "x" } });
    await prisma.setting.create({ data: { userId: other.id, key: "theme", value: "light" } });
    await prisma.cache.create({ data: { userId: other.id, key: "f1-cache-2099-01-01T00", value: "x", expiresAt: new Date(Date.now() + DAY) } });
    await prisma.session.create({ data: { id: "s1", userId: other.id, expiresAt: new Date(Date.now() + DAY) } });
    await prisma.user.delete({ where: { id: other.id } });
    expect(await prisma.setting.count({ where: { userId: other.id } })).toBe(0);
    expect(await prisma.cache.count({ where: { userId: other.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: other.id } })).toBe(0);
  });
});
