// Per-user storage limits, so one account cannot fill the server's disk.
// Admins (the operator) are unlimited; every other account gets one file
// quota across uploads, the library and custom widget files, plus caps on
// settings and cache rows.
//
// The file quota: the admin sets a default for everyone on the Admin page and
// may give one account its own. Until a default is set there, the
// USER_STORAGE_QUOTA_MB environment variable applies, else 2 GB.
import { readdir, stat } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { ClientError } from "@/lib/http";
import { getConfig, setConfig } from "@/lib/appconfig";

const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");
const libraryDir = process.env.LIBRARY_DIR ?? path.join(process.cwd(), "data", "library");
const widgetsDir = process.env.WIDGETS_DIR ?? path.join(process.cwd(), "data", "widgets");

const MB = 1024 * 1024;
const ENV_DEFAULT_MB = Number(process.env.USER_STORAGE_QUOTA_MB) || 2048;
export const QUOTA_MIN_MB = 1;
export const QUOTA_MAX_MB = 1024 * 1024; // 1 TB
const DEFAULT_KEY = "storageQuotaMb";
const userKey = (userId: string) => `storageQuotaMb:${userId}`;
const ROWS_MAX_KEYS = 2000;
const ROWS_MAX_BYTES = 50 * 1024 * 1024;

type QuotaUser = { id: string; role: string };

const validMb = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= QUOTA_MIN_MB && v <= QUOTA_MAX_MB;
const parseMb = (raw: string | null): number | null => {
  const n = raw === null ? NaN : Number(raw);
  return validMb(n) ? Math.round(n) : null;
};

// The default for accounts without a quota of their own, in MB.
export async function defaultQuotaMb(): Promise<number> {
  return parseMb(await getConfig(DEFAULT_KEY)) ?? ENV_DEFAULT_MB;
}

export async function setDefaultQuotaMb(mb: number): Promise<void> {
  if (!validMb(mb)) throw new ClientError(`The quota must be between ${QUOTA_MIN_MB} MB and ${QUOTA_MAX_MB} MB.`, 400);
  await setConfig(DEFAULT_KEY, String(Math.round(mb)));
}

// One account's own quota in MB, or null when it follows the default.
export async function userQuotaMb(userId: string): Promise<number | null> {
  return parseMb(await getConfig(userKey(userId)));
}

// null: back to the default.
export async function setUserQuotaMb(userId: string, mb: number | null): Promise<void> {
  if (mb === null) { await prisma.appConfig.deleteMany({ where: { key: userKey(userId) } }); return; }
  if (!validMb(mb)) throw new ClientError(`The quota must be between ${QUOTA_MIN_MB} MB and ${QUOTA_MAX_MB} MB.`, 400);
  await setConfig(userKey(userId), String(Math.round(mb)));
}

async function dirBytes(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirBytes(p);
    else if (e.isFile()) total += (await stat(p)).size;
  }
  return total;
}

export type FileUsage = { uploads: number; library: number; widgets: number; total: number };

// The bytes of files kept for one account, by where they are.
export async function fileUsage(userId: string): Promise<FileUsage> {
  const [uploads, library, widgets] = await Promise.all([
    dirBytes(path.join(uploadsDir, userId)),
    dirBytes(path.join(libraryDir, userId)),
    dirBytes(path.join(widgetsDir, userId)),
  ]);
  return { uploads, library, widgets, total: uploads + library + widgets };
}

// The account's file quota in bytes; null for admins, who have none.
export async function quotaBytes(user: QuotaUser): Promise<number | null> {
  if (user.role === "admin") return null;
  return ((await userQuotaMb(user.id)) ?? (await defaultQuotaMb())) * MB;
}

// Bytes this user may still upload (Infinity for admins). Throws 413 when the
// quota is already used up.
export async function fileRoomLeft(user: QuotaUser): Promise<number> {
  const limit = await quotaBytes(user);
  if (limit === null) return Infinity;
  const left = limit - (await fileUsage(user.id)).total;
  if (left <= 0) throw new ClientError("Storage quota reached. Delete some files first.", 413);
  return left;
}

// Throws 413 if writing these rows would take a non-admin account past the
// key-count or total-size cap of the table. Overwrites of existing keys count
// as the change in size, not the full new size.
async function assertRoom(table: "Setting" | "Cache", user: QuotaUser, writes: [string, string][], what: string): Promise<void> {
  if (user.role === "admin" || writes.length === 0) return;
  const keys = writes.map(([k]) => k);
  const [totals] = await prisma.$queryRawUnsafe<{ n: bigint | number; b: bigint | number }[]>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH("value")), 0) AS b FROM "${table}" WHERE "userId" = ?`,
    user.id,
  );
  const existing = await prisma.$queryRawUnsafe<{ key: string; l: bigint | number }[]>(
    `SELECT "key", LENGTH("value") AS l FROM "${table}" WHERE "userId" = ? AND "key" IN (${keys.map(() => "?").join(",")})`,
    user.id,
    ...keys,
  );
  const old = new Map(existing.map((r) => [r.key, Number(r.l)]));
  const newKeys = writes.filter(([k]) => !old.has(k)).length;
  const delta = writes.reduce((sum, [k, v]) => sum + v.length - (old.get(k) ?? 0), 0);
  if (Number(totals.n) + newKeys > ROWS_MAX_KEYS || Number(totals.b) + delta > ROWS_MAX_BYTES) {
    throw new ClientError(`${what} storage limit reached.`, 413);
  }
}

export function assertSettingsRoom(user: QuotaUser, writes: [string, string][]): Promise<void> {
  return assertRoom("Setting", user, writes, "Settings");
}

export function assertCacheRoom(user: QuotaUser, writes: [string, string][]): Promise<void> {
  return assertRoom("Cache", user, writes, "Cache");
}
