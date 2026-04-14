import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const setting = await prisma.setting.findUnique({ where: { key } });
  return NextResponse.json({ value: setting?.value ?? null });
}

export async function POST(request: NextRequest) {
  const { key, value } = await request.json();
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  await prisma.setting.deleteMany({ where: { key } });
  return NextResponse.json({ ok: true });
}
