// Apps signed in to an account with a token of their own: the phone app, and
// anything else that is not a browser (docs/api-v1.md). A device sends its
// token as `Authorization: Bearer obd_...`. Node runtime only.
//
// The token is 32 random bytes, shown to the app once at sign-in. The
// database keeps only its SHA-256, so a copy of the database cannot be used
// to sign in as a device, and a device is signed out by deleting its row.
import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";

export const DEVICE_TOKEN_PREFIX = "obd_";
const MAX_DEVICES_PER_USER = 50;
const TOUCH_EVERY_MS = 60_000;

export type DeviceInfo = { id: string; name: string; createdAt: string; lastUsedAt: string };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// A name for the list in Settings: what the app says it is, trimmed to
// something sane. Exported for tests.
export function cleanDeviceName(name: unknown): string {
  const s = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return (s || "Unnamed device").slice(0, 60);
}

export function looksLikeDeviceToken(value: string | null | undefined): value is string {
  return !!value && value.startsWith(DEVICE_TOKEN_PREFIX) && value.length >= 40 && value.length <= 100;
}

export async function createDevice(userId: string, name: unknown): Promise<{ id: string; token: string; name: string }> {
  // A cap, so a script holding a password cannot fill the table: the device
  // unused the longest makes room.
  const count = await prisma.device.count({ where: { userId } });
  if (count >= MAX_DEVICES_PER_USER) {
    const oldest = await prisma.device.findMany({ where: { userId }, orderBy: { lastUsedAt: "asc" }, take: count - MAX_DEVICES_PER_USER + 1, select: { id: true } });
    for (const d of oldest) await revokeDevice(userId, d.id);
  }
  const token = DEVICE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const device = await prisma.device.create({ data: { userId, tokenHash: hashToken(token), name: cleanDeviceName(name) } });
  return { id: device.id, token, name: device.name };
}

// The device a token belongs to, or null. Notes the use, at most once a
// minute per device, so the list in Settings can say when it was last seen
// without a write on every request.
export async function deviceForToken(token: string): Promise<{ id: string; userId: string } | null> {
  if (!looksLikeDeviceToken(token)) return null;
  const device = await prisma.device.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!device) return null;
  if (Date.now() - device.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.device.updateMany({ where: { id: device.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { id: device.id, userId: device.userId };
}

export async function listDevices(userId: string): Promise<DeviceInfo[]> {
  const rows = await prisma.device.findMany({ where: { userId }, orderBy: { lastUsedAt: "desc" } });
  return rows.map(d => ({ id: d.id, name: d.name, createdAt: d.createdAt.toISOString(), lastUsedAt: d.lastUsedAt.toISOString() }));
}

// Signs a device out: its token stops working at once, and so do the web
// sessions it opened for its in-app web view. False when the user has no such
// device (someone else's id reads the same as a missing one).
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const [, removed] = await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId, deviceId } }),
    prisma.device.deleteMany({ where: { id: deviceId, userId } }),
  ]);
  return removed.count > 0;
}

export async function revokeAllDevices(userId: string): Promise<void> {
  await prisma.device.deleteMany({ where: { userId } });
}
