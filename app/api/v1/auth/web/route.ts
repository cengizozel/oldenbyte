import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, createSession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";
import { safeNext } from "@/lib/apiV1";

// GET /api/v1/auth/web?next=/embed/...
// Lets an app open the website in its in-app web view: called with the
// device's token, it sets a browser session cookie tied to that device and
// redirects to `next`. A web view can attach the token to this first request
// but not to the requests the page then makes itself; the cookie covers
// those. Signing the device out ends the session.

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  // Only a device may trade its token for a session: a browser that is
  // already signed in has no use for this, and must not mint device sessions.
  const bearer = request.headers.get("authorization")?.startsWith("Bearer ");
  if (!user || !user.deviceId || !bearer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token, cookie } = await createSession(user.id, user.deviceId);
  const res = new NextResponse(null, { status: 303, headers: { Location: safeNext(request.nextUrl.searchParams.get("next")), "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, token, cookie);
  return res;
}
