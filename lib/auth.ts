const SESSION_COOKIE = "session";
const ALGO = "SHA-256";

async function hmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: ALGO }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Buffer.from(sig).toString("hex");
}

export async function createSessionToken(): Promise<string> {
  const secret = process.env.SESSION_SECRET ?? "fallback-secret";
  const payload = "authenticated";
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET ?? "fallback-secret";
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] !== "authenticated") return false;
  const expected = await hmac(secret, parts[0]);
  return parts[1] === expected;
}

export { SESSION_COOKIE };
