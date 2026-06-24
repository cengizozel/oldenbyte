import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, apiKeyValid, SESSION_COOKIE } from "@/lib/auth";

// Next.js 16 middleware (renamed to `proxy`). Gates every matched route behind
// either a valid session cookie (the browser login) or, for headless callers,
// an `Authorization: Bearer <API_KEY>` token. Unauthenticated API calls get a
// 401 JSON response; page requests redirect to the login screen.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Login page and the auth endpoint are always reachable.
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Bearer token for scripts/automation (only when API_KEY is configured).
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && apiKeyValid(authHeader.slice(7).trim())) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && await verifySessionToken(token)) {
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
