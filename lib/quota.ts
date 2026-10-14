// Per-user storage limits, so one account cannot fill the server's disk.
// Admins (the operator) are unlimited; every other account gets a shared file
// quota across uploads and the library, plus caps on settings rows.
import { readdir, stat } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { ClientError } from "@/lib/http";

const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");
const libraryDir = process.env.LIBRARY_DIR ?? path.join(process.cwd(), "data", "library");

// Uploads + library, per non-admin account. USER_STORAGE_QUOTA_MB overrides.
const FILE_QUOTA_BYTES = (Number(process.env.USER_STORAGE_QUOTA_MB) || 2048) * 1024 * 1024;
const SETTINGS_MAX_KEYS = 2000;
const SETTINGS_MAX_BYTES = 50 * 1024 * 1024;

type QuotaUser = { id: string; role: string };

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

// Bytes this user may still upload (Infinity for admins). Throws 413 when the
// quota is already used up.
export async function fileRoomLeft(user: QuotaUser): Promise<number> {
  if (user.role === "admin") return Infinity;
  const used = (await dirBytes(path.join(uploadsDir, user.id))) + (await dirBytes(path.join(libraryDir, user.id)));
  const left = FILE_QUOTA_BYTES - used;
  if (left <= 0) throw new ClientError("Storage quota reached. Delete some files first.", 413);
  return left;
}

// Throws 413 if writing these settings would take a non-admin account past the
// key-count or total-size cap. Overwrites of existing keys count as the change
// in size, not the full new size.
export async function assertSettingsRoom(user: QuotaUser, writes: [string, string][]): Promise<void> {
  if (user.role === "admin" || writes.length === 0) return;
  const keys = writes.map(([k]) => k);
  const [totals] = await prisma.$queryRaw<{ n: bigint | number; b: bigint | number }[]>`
    SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH("value")), 0) AS b FROM "Setting" WHERE "userId" = ${user.id}`;
  const existing = await prisma.$queryRawUnsafe<{ key: string; l: bigint | number }[]>(
    `SELECT "key", LENGTH("value") AS l FROM "Setting" WHERE "userId" = ? AND "key" IN (${keys.map(() => "?").join(",")})`,
    user.id,
    ...keys,
  );
  const old = new Map(existing.map((r) => [r.key, Number(r.l)]));
  const newKeys = writes.filter(([k]) => !old.has(k)).length;
  const delta = writes.reduce((sum, [k, v]) => sum + v.length - (old.get(k) ?? 0), 0);
  if (Number(totals.n) + newKeys > SETTINGS_MAX_KEYS || Number(totals.b) + delta > SETTINGS_MAX_BYTES) {
    throw new ClientError("Settings storage limit reached.", 413);
  }
}
