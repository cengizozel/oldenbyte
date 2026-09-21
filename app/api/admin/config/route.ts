import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, json, badRequest } from "@/lib/http";
import {
  isRegistrationEnabled,
  hasInviteCode,
  setRegistrationEnabled,
  setInviteCode,
  getFeedCacheMinutes,
  setFeedCacheMinutes,
} from "@/lib/appconfig";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  return json({
    registrationEnabled: await isRegistrationEnabled(),
    hasInvite: await hasInviteCode(),
    feedCacheMinutes: await getFeedCacheMinutes(),
  });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  let body: { registrationEnabled?: boolean; inviteCode?: string; feedCacheMinutes?: number };
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  if (typeof body !== "object" || body === null) return badRequest();

  if (typeof body.registrationEnabled === "boolean") {
    await setRegistrationEnabled(body.registrationEnabled);
  }
  if (typeof body.inviteCode === "string" && body.inviteCode.trim()) {
    await setInviteCode(body.inviteCode.trim());
  }
  if (typeof body.feedCacheMinutes === "number" && Number.isFinite(body.feedCacheMinutes)) {
    await setFeedCacheMinutes(body.feedCacheMinutes);
  }

  return json({
    ok: true,
    registrationEnabled: await isRegistrationEnabled(),
    hasInvite: await hasInviteCode(),
    feedCacheMinutes: await getFeedCacheMinutes(),
  });
}
