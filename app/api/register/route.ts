import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { canRegister } from "@/lib/appconfig";
import { createSession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { json, badRequest, tooMany } from "@/lib/http";

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export async function POST(request: NextRequest) {
  const rl = rateLimit(`register:${clientIp(request)}`, 10, 10 * 60 * 1000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  const { username, password, invite } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
    invite?: unknown;
  };

  if (typeof invite !== "string" || !(await canRegister(invite))) {
    return json({ error: "Registration is closed or invite code is invalid" }, 403);
  }

  const name = typeof username === "string" ? username.trim() : "";
  if (!USERNAME_RE.test(name)) return badRequest("Invalid username");
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return badRequest("Invalid password");
  }

  if (await prisma.user.findUnique({ where: { username: name } })) {
    return badRequest("Username is not available");
  }

  let user;
  try {
    user = await prisma.user.create({
      data: { username: name, passwordHash: await hashPassword(password), role: "user" },
    });
  } catch (e) {
    if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
      return badRequest("Username is not available");
    }
    throw e;
  }

  const { token, cookie } = await createSession(user.id);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, cookie);
  return res;
}
