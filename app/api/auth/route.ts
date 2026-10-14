import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword, needsRehash } from "@/lib/password";
import { createSession, destroySession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";
import { rateLimit, clientIp, isKnownLogin, rememberLogin } from "@/lib/ratelimit";
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
  // Length caps before any hashing: usernames are at most 32 and passwords at
  // most 200 everywhere they are created, so nothing longer can be valid.
  if (!name || name.length > 64 || typeof password !== "string" || password.length > 200) {
    return badRequest();
  }

  const ip = clientIp(request);
  // An address that has already logged in as this user skips the shared
  // buckets below, so a third party hammering them cannot lock the owner out.
  const known = isKnownLogin(name, ip);

  // Per-IP+username and per-IP limits stop guessing from one address, even
  // when it rotates usernames.
  const rl = rateLimit(`login:${ip}:${name}`, 10, 5 * 60 * 1000);
  if (!rl.ok) return tooMany(rl.retryAfter);
  const rlIp = rateLimit(`login-ip:${ip}`, 30, 15 * 60 * 1000);
  if (!rlIp.ok) return tooMany(rlIp.retryAfter);
  if (!known) {
    // IP-independent per-username backstop, since the forwarded client IP is
    // spoofable on direct LAN access.
    const rlUser = rateLimit(`login-user:${name}`, 20, 15 * 60 * 1000);
    if (!rlUser.ok) return tooMany(rlUser.retryAfter);
    // Global budget: every attempt costs a scrypt hash, so cap the total rate
    // across all addresses and usernames.
    const rlAll = rateLimit("login-all", 60, 60 * 1000);
    if (!rlAll.ok) return tooMany(rlAll.retryAfter);
  }

  const fail = () => json({ error: "Invalid username or password" }, 401);

  const user = await prisma.user.findUnique({ where: { username: name } });
  if (!user) {
    // Equalize work so a missing username can't be distinguished by timing.
    await hashPassword(password);
    return fail();
  }
  if (!(await verifyPassword(password, user.passwordHash))) return fail();

  rememberLogin(name, ip);
  // Upgrade hashes made with older, weaker scrypt parameters.
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  }
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
