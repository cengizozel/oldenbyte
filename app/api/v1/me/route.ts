import { NextRequest, NextResponse } from "next/server";
import { v1 } from "@/lib/apiV1";
import { getUserFromRequest } from "@/lib/session";

// GET /api/v1/me: who is signed in. Answers even when a password change is
// due, so an app can tell the user why nothing else works.
export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return v1({ id: user.id, username: user.username, role: user.role, mustChangePassword: user.mustChangePassword, device: user.deviceId ?? null });
}
