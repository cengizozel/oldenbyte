import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, requireUser } from "@/lib/http";
import { isCacheKey } from "@/lib/settingKeys";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const all = await prisma.setting.findMany({ where: { userId: user.id } });
  const data: Record<string, string> = {};
  for (const { key, value } of all) {
    if (!isCacheKey(key)) data[key] = value;
  }
  return json(data);
}
