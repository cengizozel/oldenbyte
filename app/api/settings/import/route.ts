import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, badRequest, requireUser } from "@/lib/http";

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

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
