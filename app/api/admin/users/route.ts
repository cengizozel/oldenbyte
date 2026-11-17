import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { defaultQuotaMb, fileUsage, userQuotaMb } from "@/lib/quota";

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

  // Storage per account: what its files take, and its quota (its own, or
  // null when it follows the default; admins have none).
  const defaultMb = await defaultQuotaMb();
  const withStorage = await Promise.all(users.map(async u => ({
    ...u,
    storage: { ...(await fileUsage(u.id)), quotaMb: await userQuotaMb(u.id), unlimited: u.role === "admin" },
  })));

  return json({ users: withStorage, defaultQuotaMb: defaultMb });
}
