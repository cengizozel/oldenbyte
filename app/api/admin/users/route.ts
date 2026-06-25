import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, json } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      username: true,
      role: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });

  return json({ users });
}
