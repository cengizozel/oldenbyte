// Tiny in-memory fixed-window rate limiter. Single-instance only (state is
// per-process), which is fine for this deployment. Used to throttle login,
// setup, registration and password changes.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistic cleanup so the map cannot grow unbounded.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }

  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }

  b.count++;
  return { ok: true, retryAfter: 0 };
}

export function clientIp(request: Request): string {
  const h = request.headers;
  const ip =
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0] ||
    "unknown";
  return ip.trim();
}

// Addresses that have logged in successfully, per username. In-memory like the
// buckets, so it resets on restart; capped so it cannot grow unbounded.
const knownLogins = new Map<string, Set<string>>();

export function rememberLogin(username: string, ip: string): void {
  if (ip === "unknown") return;
  let ips = knownLogins.get(username);
  if (!ips) {
    if (knownLogins.size >= 1000) return;
    ips = new Set();
    knownLogins.set(username, ips);
  }
  if (ips.size >= 20) ips.delete(ips.values().next().value as string);
  ips.add(ip);
}

export function isKnownLogin(username: string, ip: string): boolean {
  return knownLogins.get(username)?.has(ip) ?? false;
}
