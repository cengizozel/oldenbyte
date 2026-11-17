import { NextRequest, NextResponse } from "next/server";
import { requireUser, json } from "@/lib/http";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  return json({
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    // The desktop app runs this server for one person on their own computer
    // and signs them in by itself: signing out or changing the password has
    // no meaning there, so the settings leave those out.
    ...(process.env.OLDENBYTE_LOCAL === "1" ? { local: true } : {}),
  });
}
