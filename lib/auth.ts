const SESSION_COOKIE = "session";
const ALGO = "SHA-256";

// The session cookie is an HMAC over a fixed payload. In production the signing
// secret MUST be set: with no secret the code would fall back to a constant,
// and since this repo is public anyone could forge a valid cookie. Dev keeps a
// throwaway fallback so a local checkout runs without configuration.
function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production (it signs the auth cookie).");
  }
  return "dev-only-insecure-secret";
}

async function hmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: ALGO }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Buffer.from(sig).toString("hex");
}

export async function createSessionToken(): Promise<string> {
  const payload = "authenticated";
  const sig = await hmac(sessionSecret(), payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] !== "authenticated") return false;
  const expected = await hmac(sessionSecret(), parts[0]);
  return parts[1] === expected;
}

// Length-independent compare for the API key (the key is high-entropy, so the
// length check leaks nothing meaningful while keeping the body constant-time).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Headless/automation auth: a request may present `Authorization: Bearer <key>`
// matching the API_KEY env var. Disabled (always false) when API_KEY is unset,
// so the token path can't be used unless the operator opts in.
export function apiKeyValid(provided: string | null | undefined): boolean {
  const key = process.env.API_KEY;
  if (!key || !provided) return false;
  return safeEqual(provided, key);
}

export { SESSION_COOKIE };
