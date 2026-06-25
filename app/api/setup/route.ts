import { NextRequest } from "next/server";
import path from "path";
import { readdir, mkdir, rename } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";
import { json, badRequest, forbidden } from "@/lib/http";

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export async function POST(request: NextRequest) {
  if ((await prisma.user.count()) > 0) return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  const name = typeof username === "string" ? username.trim() : "";
  if (!USERNAME_RE.test(name)) return badRequest("Invalid username");
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return badRequest("Invalid password");
  }

  const user = await prisma.user.create({
    data: { username: name, passwordHash: await hashPassword(password), role: "admin" },
  });

  await prisma.setting.updateMany({
    where: { userId: "__legacy__" },
    data: { userId: user.id },
  });

  // Claim legacy single-tenant uploads (UUID.pdf/epub sitting at the uploads
  // root from the pre-multiuser era) into the admin's own per-user dir.
  try {
    const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");
    const adminDir = path.join(uploadsDir, user.id);
    await mkdir(adminDir, { recursive: true });
    for (const entry of await readdir(uploadsDir, { withFileTypes: true })) {
      if (entry.isFile() && /^[0-9a-f-]{36}\.(pdf|epub)$/i.test(entry.name)) {
        await rename(path.join(uploadsDir, entry.name), path.join(adminDir, entry.name)).catch(() => {});
      }
    }
  } catch {
    // best-effort; missing uploads dir is fine
  }

  const { token, cookie } = await createSession(user.id);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, cookie);
  return res;
}
