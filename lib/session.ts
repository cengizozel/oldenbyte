// Authoritative, DB-backed session layer (Node runtime). The cookie carries a
// random session id signed by lib/auth; here we hash that id and look it up in
// the Session table so logout / password-change / admin-delete genuinely revoke
// access. Edge middleware only checks the signature; this is the real gate.
import { createHash, randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { SESSION_COOKIE, signSessionToken, verifySessionToken, apiKeyValid } from "./auth";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function hashSid(sid: string): string {
  return createHash("sha256").update(sid).digest("hex");
}

export type SessionUser = {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
};

export type NewSession = { token: string; cookie: CookieOptions };

export type CookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export function sessionCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function createSession(userId: string): Promise<NewSession> {
  const sid = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id: hashSid(sid), userId, expiresAt } });
  const token = await signSessionToken(sid, expiresAt.getTime());
  return { token, cookie: sessionCookieOptions(Math.floor(SESSION_TTL_MS / 1000)) };
}

export async function getUserFromRequest(request: NextRequest): Promise<SessionUser | null> {
  // Headless automation: a valid Bearer API_KEY acts as the first admin account,
  // so scripts (and the /api/config headless endpoint) operate on the admin's data.
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && apiKeyValid(authHeader.slice(7).trim())) {
    const admin = await prisma.user.findFirst({
      where: { role: "admin" },
      orderBy: { createdAt: "asc" },
    });
    if (admin) {
      return { id: admin.id, username: admin.username, role: "admin", mustChangePassword: false };
    }
    return null;
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const session = await prisma.session.findUnique({ where: { id: hashSid(payload.sid) } });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const payload = await verifySessionToken(token);
  if (!payload) return;
  await prisma.session.deleteMany({ where: { id: hashSid(payload.sid) } });
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

// Best-effort cleanup of expired rows; cheap and called opportunistically.
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
