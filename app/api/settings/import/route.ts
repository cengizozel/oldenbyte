import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, badRequest, requireUser, bodyTooLarge, errorResponse } from "@/lib/http";
import { assertSettingsRoom } from "@/lib/quota";

// A whole dashboard config is well under 1 MB; this only stops abuse.
const MAX_BODY = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  if (bodyTooLarge(request, MAX_BODY)) {
    return NextResponse.json({ error: "Body too large (max 25 MB)" }, { status: 413 });
  }

  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return badRequest();
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return badRequest("Invalid format");
  }

  const entries = (Object.entries(data as Record<string, unknown>).filter(
    ([k, v]) => typeof v === "string" && v.length <= 1_000_000 && k.length > 0 && k.length <= 256
  ) as [string, string][]).slice(0, 2000);
  try {
    await assertSettingsRoom(user, entries);
  } catch (err) {
    return errorResponse(err, "settings import");
  }

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { userId_key: { userId: user.id, key } },
        update: { value },
        create: { userId: user.id, key, value },
      })
    )
  );

  return json({ ok: true, count: entries.length });
}
