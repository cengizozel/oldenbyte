import { NextRequest, NextResponse } from "next/server";
import { rm } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { requireAdmin, json, badRequest } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { destroyAllSessions } from "@/lib/session";
import { hashPassword } from "@/lib/password";

const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const { id: targetId } = await params;
  if (targetId === admin.id) return badRequest("You cannot delete your own account");

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) return json({ error: "Not found" }, 404);

  if (target.role === "admin" && (await prisma.user.count({ where: { role: "admin" } })) === 1) {
    return badRequest("Cannot delete the only admin");
  }

  await prisma.setting.deleteMany({ where: { userId: targetId } });
  await destroyAllSessions(targetId);
  await prisma.user.delete({ where: { id: targetId } });
  await rm(path.join(uploadsDir, targetId), { recursive: true, force: true });

  return json({ ok: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const { id: targetId } = await params;

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }

  if (body.action !== "resetPassword") return badRequest("Unknown action");

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) return json({ error: "Not found" }, 404);

  const temp = randomBytes(9).toString("base64url");
  await prisma.user.update({
    where: { id: targetId },
    data: { passwordHash: await hashPassword(temp), mustChangePassword: true },
  });
  await destroyAllSessions(targetId);

  return json({ ok: true, tempPassword: temp });
}
