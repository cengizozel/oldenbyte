import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, apiKeyValid, bearerAllowed, SESSION_COOKIE } from "@/lib/auth";

// Paths reachable without a session: the login page and the unauthenticated
// auth endpoints (state probe, login, logout, first-run setup, registration).
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/setup", "/api/register"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Next.js 16 middleware (renamed to `proxy`). Edge-runtime gate: a cheap,
// stateless check that decides "looks authenticated" vs "go to login". The
// authoritative session/user check (revocation, role) happens in the route
// handlers via lib/session. Headless callers may instead present
// Authorization: Bearer <API_KEY>.
// CSRF guard for state-changing API calls. SameSite=Lax cookies already stop
// cross-site requests, but not same-site ones (another *.esqdrive.com host), so
// browsers' Origin and Sec-Fetch-Site headers must point at this exact host.
// Clients that send neither (scripts) carry no browser cookie to abuse.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function crossOrigin(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bearer token for scripts/automation (only when API_KEY is configured, and
  // only on /api/config).
  const authHeader = request.headers.get("authorization");
  const bearer =
    bearerAllowed(pathname) &&
    !!authHeader?.startsWith("Bearer ") &&
    apiKeyValid(authHeader.slice(7).trim());

  if (pathname.startsWith("/api/") && !bearer && crossOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }

  if (isPublic(pathname) || bearer) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySessionToken(token))) {
    return NextResponse.next();
  }

  // Programmatic clients want a status code, not an HTML login page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    // Every API route always runs auth. (A blanket `*.png` exemption below must
    // not let a path like /api/files/<x>.png reach a handler unauthenticated.)
    "/api/:path*",
    // Pages: everything except Next internals and public static assets (the png
    // exemption lets the login screen's own images load before auth).
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)",
  ],
};
