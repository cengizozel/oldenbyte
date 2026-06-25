import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/password";
import { createSession, destroySession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { json, badRequest, tooMany } from "@/lib/http";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  const name = typeof username === "string" ? username.trim() : "";
  if (!name || typeof password !== "string") return badRequest();

  // Per-IP limiter, plus an IP-independent per-username backstop so spoofing the
  // forwarded client IP (possible on direct LAN access) can't grant unlimited
  // guesses against a single account.
  const rl = rateLimit(`login:${clientIp(request)}:${name}`, 10, 5 * 60 * 1000);
  if (!rl.ok) return tooMany(rl.retryAfter);
  const rlUser = rateLimit(`login-user:${name}`, 20, 15 * 60 * 1000);
  if (!rlUser.ok) return tooMany(rlUser.retryAfter);

  const fail = () => json({ error: "Invalid username or password" }, 401);

  const user = await prisma.user.findUnique({ where: { username: name } });
  if (!user) {
    // Equalize work so a missing username can't be distinguished by timing.
    await hashPassword(password);
    return fail();
  }
  if (!(await verifyPassword(password, user.passwordHash))) return fail();

  const { token, cookie } = await createSession(user.id);
  const res = json({ ok: true, mustChangePassword: user.mustChangePassword });
  res.cookies.set(SESSION_COOKIE, token, cookie);
  return res;
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  await destroySession(token);
  const res = json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
