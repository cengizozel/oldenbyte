import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { NextRequest } from "next/server";

// Device tokens against a throwaway SQLite file: the schema upgrade on an
// older database, sign-in by token, and every way a device loses access.
const dir = mkdtempSync(path.join(tmpdir(), "oldenbyte-devices-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.sqlite")}`;

type Prisma = typeof import("@/lib/prisma")["prisma"];
let prisma: Prisma;
let devices: typeof import("@/lib/devices");
let session: typeof import("@/lib/session");
let auth: typeof import("@/lib/auth");
let alice: string, bob: string;

const req = (headers: Record<string, string> = {}, url = "http://localhost/api/v1/me") => new NextRequest(url, { headers });

beforeAll(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  // An install from before devices existed: a Session table without deviceId.
  await prisma.$executeRawUnsafe(`CREATE TABLE "Session" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const { ensureSchema } = await import("@/lib/schema");
  await ensureSchema();
  await ensureSchema(); // idempotent
  devices = await import("@/lib/devices");
  session = await import("@/lib/session");
  auth = await import("@/lib/auth");
  alice = (await prisma.user.create({ data: { username: "alice", passwordHash: "x" } })).id;
  bob = (await prisma.user.create({ data: { username: "bob", passwordHash: "x", role: "admin" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("schema", () => {
  it("adds the device column to an older Session table and creates the Device table", async () => {
    const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("Session")`);
    expect(cols.map(c => c.name)).toContain("deviceId");
    const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table' AND name='Device'`);
    expect(tables).toHaveLength(1);
  });
});

describe("device tokens", () => {
  it("signs a device in and stores only the token's hash", async () => {
    const d = await devices.createDevice(alice, "  Alice's\tphone  ");
    expect(d.token.startsWith("obd_")).toBe(true);
    expect(d.name).toBe("Alice's phone");
    const row = await prisma.device.findUnique({ where: { id: d.id } });
    expect(row!.tokenHash).not.toContain(d.token.slice(4));
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const user = await session.getUserFromRequest(req({ authorization: `Bearer ${d.token}` }));
    expect(user).toMatchObject({ id: alice, username: "alice", role: "user", deviceId: d.id });
  });

  it("refuses a token that is wrong, malformed or of another kind", async () => {
    const d = await devices.createDevice(alice, "phone");
    const flipped = d.token.slice(0, -1) + (d.token.endsWith("A") ? "B" : "A");
    for (const bad of [flipped, "obd_short", d.token.slice(4), "obd_" + "a".repeat(200), ""]) {
      expect(await session.getUserFromRequest(req({ authorization: `Bearer ${bad}` }))).toBeNull();
    }
  });

  it("never falls back to a cookie when a bad token is presented", async () => {
    const s = await session.createSession(bob);
    const cookie = `${auth.SESSION_COOKIE}=${s.token}`;
    // The cookie alone is bob.
    expect(await session.getUserFromRequest(req({ cookie }))).toMatchObject({ id: bob });
    // With a bad device token beside it, the request is nobody.
    expect(await session.getUserFromRequest(req({ cookie, authorization: `Bearer obd_${"x".repeat(43)}` }))).toBeNull();
  });

  it("stops working the moment the device is signed out, with its web sessions", async () => {
    const d = await devices.createDevice(alice, "tablet");
    const web = await session.createSession(alice, d.id);
    const cookie = `${auth.SESSION_COOKIE}=${web.token}`;
    expect(await session.getUserFromRequest(req({ cookie }))).toMatchObject({ id: alice, deviceId: d.id });
    expect(await devices.revokeDevice(alice, d.id)).toBe(true);
    expect(await session.getUserFromRequest(req({ authorization: `Bearer ${d.token}` }))).toBeNull();
    expect(await session.getUserFromRequest(req({ cookie }))).toBeNull();
    expect(await devices.revokeDevice(alice, d.id)).toBe(false);
  });

  it("does not let one account sign out another's device", async () => {
    const d = await devices.createDevice(alice, "phone");
    expect(await devices.revokeDevice(bob, d.id)).toBe(false);
    expect(await session.getUserFromRequest(req({ authorization: `Bearer ${d.token}` }))).toMatchObject({ id: alice });
    expect((await devices.listDevices(bob)).some(x => x.id === d.id)).toBe(false);
  });

  it("is signed out with everything else when the password changes", async () => {
    const d = await devices.createDevice(alice, "phone");
    const s = await session.createSession(alice);
    await session.destroyAllSessions(alice);
    expect(await session.getUserFromRequest(req({ authorization: `Bearer ${d.token}` }))).toBeNull();
    expect(await session.getUserFromRequest(req({ cookie: `${auth.SESSION_COOKIE}=${s.token}` }))).toBeNull();
    expect(await devices.listDevices(alice)).toEqual([]);
  });

  it("is removed with the account", async () => {
    const carol = (await prisma.user.create({ data: { username: "carol", passwordHash: "x" } })).id;
    const d = await devices.createDevice(carol, "phone");
    await prisma.user.delete({ where: { id: carol } });
    expect(await session.getUserFromRequest(req({ authorization: `Bearer ${d.token}` }))).toBeNull();
    expect(await prisma.device.count({ where: { userId: carol } })).toBe(0);
  });

  it("keeps at most 50 devices an account, dropping the one unused longest", async () => {
    const dave = (await prisma.user.create({ data: { username: "dave", passwordHash: "x" } })).id;
    const first = await devices.createDevice(dave, "first");
    await prisma.device.update({ where: { id: first.id }, data: { lastUsedAt: new Date(Date.now() - 86_400_000) } });
    for (let i = 0; i < 50; i++) await devices.createDevice(dave, `d${i}`);
    expect(await prisma.device.count({ where: { userId: dave } })).toBe(50);
    expect(await session.getUserFromRequest(req({ authorization: `Bearer ${first.token}` }))).toBeNull();
  });

  it("names a device from whatever the app sends", () => {
    expect(devices.cleanDeviceName(undefined)).toBe("Unnamed device");
    expect(devices.cleanDeviceName("   ")).toBe("Unnamed device");
    expect(devices.cleanDeviceName("a".repeat(100))).toHaveLength(60);
    expect(devices.cleanDeviceName("Pixel\n8\u0000 Pro")).toBe("Pixel 8 Pro");
  });
});

describe("api v1 helpers", () => {
  it("only lets a web-view sign-in land on this server", async () => {
    const { safeNext } = await import("@/lib/apiV1");
    expect(safeNext("/embed/default/todo-1")).toBe("/embed/default/todo-1");
    expect(safeNext("/?x=1#y")).toBe("/?x=1#y");
    for (const bad of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "evil", "/a\nb"]) expect(safeNext(bad)).toBe("/");
  });

  it("lists widgets in reading order, a tab group's members after its first tab", async () => {
    const { orderWidgets } = await import("@/lib/apiV1");
    const inst = (id: string, type: string) => ({ id, type, title: id.toUpperCase(), color: "sky" });
    const out = orderWidgets(
      [{ i: "c", x: 0, y: 2, w: 1, h: 1 }, { i: "b", x: 1, y: 0, w: 2, h: 2, tabs: ["b2", "gone"] }, { i: "a", x: 0, y: 0, w: 1, h: 2 }],
      { a: inst("a", "todo"), b: inst("b", "rss"), b2: inst("b2", "reddit"), c: inst("c", "clock") },
    );
    expect(out.map(w => w.id)).toEqual(["a", "b", "b2", "c"]);
    expect(out[1]).toMatchObject({ type: "rss", group: null, x: 1, y: 0, w: 2, h: 2 });
    expect(out[2]).toMatchObject({ type: "reddit", group: "b" });
  });

  it("gives a new account the one default dashboard, empty", async () => {
    const { dashboardsFor } = await import("@/lib/apiV1");
    expect(await dashboardsFor(alice)).toEqual([{ id: "default", name: "Main", active: true, widgets: [] }]);
  });
});
