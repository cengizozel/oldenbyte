// Edge-safe session token signing/verification (Web Crypto only — no Node APIs,
// no DB). The middleware (proxy.ts, Edge runtime) and Node route handlers both
// use this. The token is a stateless, signed bearer of a random session id; the
// authoritative existence/revocation check happens in lib/session.ts (Node).

const SESSION_COOKIE = "session";
const ALGO = "SHA-256";

// The signing secret MUST be a strong value in production (it signs the auth
// cookie; with no secret anyone could forge a session, and this repo is public).
// Dev keeps a throwaway fallback so a local checkout runs without configuration.
function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set or too short (need >= 16 chars) in production");
  }
  return "dev-only-insecure-secret-do-not-use";
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: ALGO },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

// Constant-time string comparison (length-independent on content).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SessionTokenPayload = { sid: string; exp: number };

export async function signSessionToken(sid: string, exp: number): Promise<string> {
  const payload = `${sid}.${exp}`;
  const sig = await hmacHex(getSecret(), payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string): Promise<SessionTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sid, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!sid || !Number.isFinite(exp)) return null;
  const expected = await hmacHex(getSecret(), `${sid}.${expStr}`);
  if (!timingSafeEqual(sig, expected)) return null;
  if (Date.now() > exp) return null;
  return { sid, exp };
}

// Headless/automation auth: a request may present `Authorization: Bearer <key>`
// matching the API_KEY env var. Disabled (always false) when API_KEY is unset,
// so the token path can't be used unless the operator opts in. Bearer requests
// are resolved to the admin account by lib/session.getUserFromRequest.
export function apiKeyValid(provided: string | null | undefined): boolean {
  const key = process.env.API_KEY;
  if (!key || !provided) return false;
  return timingSafeEqual(provided, key);
}

export { SESSION_COOKIE };
