import { NextRequest, NextResponse } from "next/server";
import { v1 } from "@/lib/apiV1";
import { getUserFromRequest } from "@/lib/session";
import { revokeDevice } from "@/lib/devices";

// POST /api/v1/auth/logout: signs this device out. Its token stops working
// at once, with the web sessions it opened.
export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.deviceId) return v1({ error: "Not signed in as a device" }, 400);
  await revokeDevice(user.id, user.deviceId);
  return v1({ ok: true });
}
