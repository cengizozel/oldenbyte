import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, badRequest, requireUser, errorResponse } from "@/lib/http";
import { assertCacheRoom, assertSettingsRoom } from "@/lib/quota";
import { cacheExpiry, isCacheKey } from "@/lib/settingKeys";
import { readSetting } from "@/lib/migrations";

// One key-value API for the dashboard. Cache keys (lib/settingKeys) live in
// the Cache table with an expiry and carry no version; everything else is a
// Setting row whose `version` counts writes.
//
// Compare-and-set: a GET returns the row's version, and a POST may send the
// version it last saw. If the row has moved on since (another tab, another
// device, the config API), the write is refused with 409 and the current
// version, so a stale page never silently overwrites a newer save. A POST
// without a version writes unconditionally, as every write did before.

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const key = request.nextUrl.searchParams.get("key");
  if (!key) return badRequest("Missing key");

  const { value, version } = await readSetting(user.id, key);
  return json(version === null ? { value } : { value, version });
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  const { key, value, version } = (body ?? {}) as { key?: unknown; value?: unknown; version?: unknown };
  if (typeof key !== "string" || key.length === 0 || key.length > 256) return badRequest("Invalid key");
  if (typeof value !== "string" || value.length > 1_000_000) return badRequest("Invalid value");
  if (version !== undefined && (typeof version !== "number" || !Number.isInteger(version) || version < 0)) return badRequest("Invalid version");

  if (isCacheKey(key)) {
    try {
      await assertCacheRoom(user, [[key, value]]);
    } catch (err) {
      return errorResponse(err, "cache");
    }
    const expiresAt = cacheExpiry(key);
    await prisma.cache.upsert({
      where: { userId_key: { userId: user.id, key } },
      update: { value, expiresAt },
      create: { userId: user.id, key, value, expiresAt },
    });
    return json({ ok: true });
  }

  try {
    await assertSettingsRoom(user, [[key, value]]);
  } catch (err) {
    return errorResponse(err, "settings");
  }

  if (typeof version === "number") {
    const r = await prisma.setting.updateMany({
      where: { userId: user.id, key, version },
      data: { value, version: { increment: 1 } },
    });
    if (r.count === 1) return json({ ok: true, version: version + 1 });
    const current = await prisma.setting.findUnique({
      where: { userId_key: { userId: user.id, key } },
      select: { version: true },
    });
    if (current) {
      return json({ error: "changed in another tab, reload to see the latest", conflict: true, version: current.version }, 409);
    }
    // The row is gone (removed elsewhere): nothing to protect, create it afresh.
  }

  const row = await prisma.setting.upsert({
    where: { userId_key: { userId: user.id, key } },
    update: { value, version: { increment: 1 } },
    create: { userId: user.id, key, value, version: 1 },
    select: { version: true },
  });
  return json({ ok: true, version: row.version });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const key = request.nextUrl.searchParams.get("key");
  if (!key) return badRequest("Missing key");

  if (isCacheKey(key)) await prisma.cache.deleteMany({ where: { userId: user.id, key } });
  else await prisma.setting.deleteMany({ where: { userId: user.id, key } });
  return json({ ok: true });
}
