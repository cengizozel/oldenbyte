import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, badRequest, requireUser } from "@/lib/http";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const key = request.nextUrl.searchParams.get("key");
  if (!key) return badRequest("Missing key");

  const setting = await prisma.setting.findUnique({
    where: { userId_key: { userId: user.id, key } },
  });
  return json({ value: setting?.value ?? null });
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
  const { key, value } = (body ?? {}) as { key?: unknown; value?: unknown };
  if (typeof key !== "string" || key.length === 0 || key.length > 256) return badRequest("Invalid key");
  if (typeof value !== "string" || value.length > 1_000_000) return badRequest("Invalid value");

  await prisma.setting.upsert({
    where: { userId_key: { userId: user.id, key } },
    update: { value },
    create: { userId: user.id, key, value },
  });
  return json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const key = request.nextUrl.searchParams.get("key");
  if (!key) return badRequest("Missing key");

  await prisma.setting.deleteMany({ where: { userId: user.id, key } });
  return json({ ok: true });
}
