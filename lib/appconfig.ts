// App-wide configuration stored in the AppConfig table. Holds the registration
// toggle and the (hashed) invite code. Node runtime only.
import { prisma } from "./prisma";
import { hashPassword, verifyPassword } from "./password";

const INVITE_HASH = "inviteCodeHash";
const REG_ENABLED = "registrationEnabled";

export async function getConfig(key: string): Promise<string | null> {
  const row = await prisma.appConfig.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await prisma.appConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

// How long the server-side feed cache serves a feed before refetching it
// (lib/feedCache). Minutes; clamped to something sane.
const FEED_TTL = "feedCacheMinutes";

export async function getFeedCacheMinutes(): Promise<number> {
  const v = Number(await getConfig(FEED_TTL));
  return Number.isFinite(v) && v >= 1 ? v : 60;
}

export async function setFeedCacheMinutes(minutes: number): Promise<void> {
  await setConfig(FEED_TTL, String(Math.min(1440, Math.max(1, Math.floor(minutes)))));
}

// The Twitch application the Twitch widget signs in with (dev.twitch.tv,
// free). The server's environment wins (TWITCH_CLIENT_ID and
// TWITCH_CLIENT_SECRET); otherwise the pair saved from the Admin page. The
// secret stays on the server: it is never sent to a browser, the admin's
// included.
const TWITCH_ID = "twitchClientId";
const TWITCH_SECRET = "twitchClientSecret";

export async function getTwitchApp(): Promise<{ clientId: string; clientSecret: string; fromEnv: boolean } | null> {
  const envId = process.env.TWITCH_CLIENT_ID, envSecret = process.env.TWITCH_CLIENT_SECRET;
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret, fromEnv: true };
  const [clientId, clientSecret] = await Promise.all([getConfig(TWITCH_ID), getConfig(TWITCH_SECRET)]);
  return clientId && clientSecret ? { clientId, clientSecret, fromEnv: false } : null;
}

export async function setTwitchApp(clientId: string, clientSecret: string): Promise<void> {
  await setConfig(TWITCH_ID, clientId);
  await setConfig(TWITCH_SECRET, clientSecret);
}

export async function clearTwitchApp(): Promise<void> {
  await prisma.appConfig.deleteMany({ where: { key: { in: [TWITCH_ID, TWITCH_SECRET] } } });
}

export async function isRegistrationEnabled(): Promise<boolean> {
  return (await getConfig(REG_ENABLED)) === "true";
}

export async function setRegistrationEnabled(on: boolean): Promise<void> {
  await setConfig(REG_ENABLED, on ? "true" : "false");
}

export async function hasInviteCode(): Promise<boolean> {
  return Boolean(await getConfig(INVITE_HASH));
}

export async function setInviteCode(code: string): Promise<void> {
  await setConfig(INVITE_HASH, await hashPassword(code));
}

export async function verifyInviteCode(code: string): Promise<boolean> {
  const stored = await getConfig(INVITE_HASH);
  if (!stored) return false;
  return verifyPassword(code, stored);
}

// Registration is allowed only when explicitly enabled AND a valid invite code
// is presented. With no invite code set, registration is effectively closed —
// a deliberately safe default for a public deployment.
export async function canRegister(code: string): Promise<boolean> {
  if (!(await isRegistrationEnabled())) return false;
  return verifyInviteCode(code);
}
