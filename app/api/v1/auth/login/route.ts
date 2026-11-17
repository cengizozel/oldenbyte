import { NextRequest, NextResponse } from "next/server";
import { v1 } from "@/lib/apiV1";
import { checkLogin } from "@/lib/login";
import { createDevice } from "@/lib/devices";

// POST /api/v1/auth/login (no sign-in) { username, password, device? }
// Signs an app in: the same check and rate limits as the website, answered
// with a token for this device instead of a cookie. `device` is the name
// shown in Settings ("Cengiz's iPhone"). The token is given once; the server
// keeps only its hash.
export async function POST(request: NextRequest) {
  const user = await checkLogin(request);
  if (user instanceof NextResponse) return user;
  const device = await createDevice(user.id, user.body.device);
  return v1({
    token: device.token,
    device: { id: device.id, name: device.name },
    user: { id: user.id, username: user.username, role: user.role, mustChangePassword: user.mustChangePassword },
  });
}
