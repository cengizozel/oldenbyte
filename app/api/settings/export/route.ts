import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, requireUser } from "@/lib/http";

// Cache keys are date-stamped or epub location caches — exclude them from export
function isCache(key: string): boolean {
  return /\d{4}-\d{2}-\d{2}/.test(key) || key.startsWith("epub-locs-");
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const all = await prisma.setting.findMany({ where: { userId: user.id } });
  const data: Record<string, string> = {};
  for (const { key, value } of all) {
    if (!isCache(key)) data[key] = value;
  }
  return json(data);
}
