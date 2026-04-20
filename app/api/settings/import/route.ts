import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const data: unknown = await request.json();
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return NextResponse.json({ error: "Invalid format" }, { status: 400 });
  }

  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([, v]) => typeof v === "string"
  ) as [string, string][];

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );

  return NextResponse.json({ ok: true, count: entries.length });
}
