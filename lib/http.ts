// Shared HTTP helpers so every route enforces auth the same way.
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, SessionUser } from "./session";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function badRequest(message = "Bad request"): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function tooMany(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

// Routes a user with mustChangePassword set is still allowed to reach, so they
// can actually rotate the temp credential. Everything else is blocked until they do.
const PW_CHANGE_ALLOWED = new Set(["/api/me", "/api/account/password"]);

function pwChangeRequired(): NextResponse {
  return NextResponse.json({ error: "password_change_required" }, { status: 403 });
}

// Usage:
//   const user = await requireUser(request);
//   if (user instanceof NextResponse) return user;
export async function requireUser(request: NextRequest): Promise<SessionUser | NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return unauthorized();
  if (user.mustChangePassword && !PW_CHANGE_ALLOWED.has(request.nextUrl.pathname)) {
    return pwChangeRequired();
  }
  return user;
}

export async function requireAdmin(request: NextRequest): Promise<SessionUser | NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();
  if (user.mustChangePassword && !PW_CHANGE_ALLOWED.has(request.nextUrl.pathname)) {
    return pwChangeRequired();
  }
  return user;
}
