import { NextRequest, NextResponse } from "next/server";
import { createSession, destroySession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";
import { checkLogin } from "@/lib/login";
import { json } from "@/lib/http";

export async function POST(request: NextRequest) {
  const checked = await checkLogin(request);
  if (checked instanceof NextResponse) return checked;
  const { token, cookie } = await createSession(checked.id);
  const res = json({ ok: true, mustChangePassword: checked.mustChangePassword });
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
