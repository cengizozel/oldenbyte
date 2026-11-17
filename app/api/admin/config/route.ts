import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, json, badRequest } from "@/lib/http";
import {
  isRegistrationEnabled,
  hasInviteCode,
  setRegistrationEnabled,
  setInviteCode,
  getFeedCacheMinutes,
  setFeedCacheMinutes,
  getTwitchApp,
  setTwitchApp,
  clearTwitchApp,
} from "@/lib/appconfig";
import { requestToken } from "@/lib/twitch";

// What the Admin page may know about the Twitch application: whether one is
// connected, where it comes from, and its client ID. Never the secret.
async function twitchState() {
  const app = await getTwitchApp();
  return { twitchConnected: !!app, twitchFromEnv: !!app?.fromEnv, twitchClientId: app?.clientId ?? "" };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  return json({
    registrationEnabled: await isRegistrationEnabled(),
    hasInvite: await hasInviteCode(),
    feedCacheMinutes: await getFeedCacheMinutes(),
    ...(await twitchState()),
  });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  let body: { registrationEnabled?: boolean; inviteCode?: string; feedCacheMinutes?: number; twitchClientId?: string; twitchClientSecret?: string; twitchDisconnect?: boolean };
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

  // Twitch: the pair is tried against Twitch first, so a typo is refused
  // here and never saved.
  if (body.twitchDisconnect === true) {
    await clearTwitchApp();
  } else if (typeof body.twitchClientId === "string" && typeof body.twitchClientSecret === "string") {
    const id = body.twitchClientId.trim(), secret = body.twitchClientSecret.trim();
    if (!id || !secret) return badRequest("Enter both the client ID and the client secret.");
    try {
      await requestToken(id, secret);
    } catch (err) {
      return badRequest(String((err as Error)?.message ?? "Twitch refused those credentials."));
    }
    await setTwitchApp(id, secret);
  }

  return json({
    ok: true,
    registrationEnabled: await isRegistrationEnabled(),
    hasInvite: await hasInviteCode(),
    feedCacheMinutes: await getFeedCacheMinutes(),
    ...(await twitchState()),
  });
}
