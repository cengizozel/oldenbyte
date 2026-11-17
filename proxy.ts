import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, apiKeyValid, bearerAllowed, SESSION_COOKIE } from "@/lib/auth";

// An app's device token (lib/devices.ts). This gate runs at the edge and
// cannot look one up, so a request that presents something shaped like one
// is let through to the API, where every route checks it against the
// database (lib/session getUserFromRequest) and answers 401 if it is not
// real. API routes only: pages are for browsers, which sign in with a cookie.
function hasDeviceToken(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Bearer obd_")) return false;
  const n = authHeader.length - 7;
  return n >= 40 && n <= 100;
}

// Paths reachable without a session: the login page and the unauthenticated
// auth endpoints (state probe, login, logout, first-run setup, registration).
// /manifest.webmanifest: browsers fetch the web app manifest without the
// session cookie, and an install must work from the sign-in page too.
// /api/v1/server and /api/v1/auth/login: what an app needs before it has a
// token (is this an oldenbyte server, and signing in).
// /api/custom-widgets/media: a custom widget's sandboxed frame has no cookie;
// the route only answers a signed, expiring ticket the dashboard issued.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/setup", "/api/register", "/manifest.webmanifest", "/api/v1/server", "/api/v1/auth/login", "/api/custom-widgets/media"];

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

  // A device token is not a cookie: a browser never attaches it on its own,
  // so there is nothing for another site to ride on, and no origin to check.
  const device = pathname.startsWith("/api/") && hasDeviceToken(authHeader);

  // An app's sign-in sets no cookie and answers with a token in the body,
  // which another site's page cannot read, so there is nothing to forge: a
  // browser extension (its own origin) must be able to call it.
  const appLogin = pathname === "/api/v1/auth/login";

  if (pathname.startsWith("/api/") && !bearer && !device && !appLogin && crossOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }

  if (isPublic(pathname) || bearer || device) {
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
