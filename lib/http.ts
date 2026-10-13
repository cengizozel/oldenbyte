// Shared HTTP helpers so every route enforces auth the same way.
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, SessionUser } from "./session";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function badRequest(message = "Bad request"): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

// True when the declared body size is over the limit, so a route can refuse it
// (413) before parsing. Bodies without a Content-Length are left to the
// framework-wide cap in next.config.ts.
export function bodyTooLarge(request: NextRequest, maxBytes: number): boolean {
  const len = Number(request.headers.get("content-length") ?? 0);
  return Number.isFinite(len) && len > maxBytes;
}

// The request body as a JSON object, or null when it is missing, malformed,
// or not an object. Lets a route answer 400 instead of the framework's HTML 500.
export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

// An error caused by the request itself (bad file type, too large, missing
// part). Routes return its message with its status; anything else is a 500
// with a generic message, the details only in the server log.
export class ClientError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function errorResponse(err: unknown, tag: string, fallback = "Request failed."): NextResponse {
  if (err instanceof ClientError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

// Upstream integrations that are down answer 503, never 502 or 504: behind
// Cloudflare those two are replaced by Cloudflare's own HTML error page, so
// the widget would get no JSON error to show.

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
