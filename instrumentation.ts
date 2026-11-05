export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Fail fast rather than silently sign cookies with the public fallback
  // secret: an unset SESSION_SECRET in production means anyone can forge a
  // session. Refuse to boot so the misconfiguration is caught at deploy.
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET is not set. It signs the auth cookie; without it the dashboard is trivially forgeable. Set SESSION_SECRET to a long random value before starting in production."
    );
  }

  // A short API_KEY is ignored (see lib/auth.apiKeyValid); say so at boot.
  const apiKey = process.env.API_KEY;
  if (apiKey && apiKey.length < 32) {
    console.warn("API_KEY is shorter than 32 characters and is ignored; bearer auth is disabled.");
  }

  // Slow IPv4 hosts with an IPv6 address too (see lib/network.ts).
  (await import("./lib/network")).widenHappyEyeballs();

  // Tables and in-place upgrades (lib/schema.ts), then housekeeping: cache
  // rows left in Setting by earlier versions, expired caches and sessions,
  // orphaned widget data, and a vacuum (lib/maintenance.ts).
  await (await import("./lib/schema")).ensureSchema();
  (await import("./lib/maintenance")).scheduleMaintenance();
}
