import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, destroyAllSessions } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { requireUser, json, badRequest, tooMany } from "@/lib/http";
import { createDevice } from "@/lib/devices";

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const rl = rateLimit(`password:${user.id}`, 10, 5 * 60 * 1000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  const { currentPassword, newPassword } = (body ?? {}) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return badRequest();
  }

  const full = await prisma.user.findUnique({ where: { id: user.id } });
  if (!full || !(await verifyPassword(currentPassword, full.passwordHash))) {
    return badRequest("Current password is incorrect");
  }

  if (newPassword.length < 8 || newPassword.length > 200) {
    return badRequest("Invalid password");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });

  // A new password signs everything out: browsers and apps. Whoever made the
  // change stays in, with fresh credentials of the kind they came with.
  const device = user.deviceId ? await prisma.device.findUnique({ where: { id: user.deviceId }, select: { name: true } }) : null;
  await destroyAllSessions(user.id);
  if (user.deviceId && request.headers.get("authorization")?.startsWith("Bearer ")) {
    const fresh = await createDevice(user.id, device?.name ?? "Unnamed device");
    return json({ ok: true, token: fresh.token, device: { id: fresh.id, name: fresh.name } });
  }
  const { token, cookie } = await createSession(user.id);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, cookie);
  return res;
}
