import { NextRequest, NextResponse } from "next/server";
import { v1 } from "@/lib/apiV1";
import { requireUser } from "@/lib/http";
import { listDevices } from "@/lib/devices";

// GET /api/v1/devices: the apps signed in to this account, most recently
// used first. `current` marks the one asking.
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const devices = await listDevices(user.id);
  return v1({ devices: devices.map(d => ({ ...d, current: d.id === user.deviceId })) });
}
