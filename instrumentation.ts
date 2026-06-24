export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast rather than silently sign cookies with the public fallback
    // secret: an unset SESSION_SECRET in production means anyone can forge a
    // session. Refuse to boot so the misconfiguration is caught at deploy.
    if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
      throw new Error(
        "SESSION_SECRET is not set. It signs the auth cookie; without it the dashboard is trivially forgeable. Set SESSION_SECRET to a long random value before starting in production."
      );
    }

    const { prisma } = await import("./lib/prisma");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Setting" (
        "key"       TEXT     PRIMARY KEY,
        "value"     TEXT     NOT NULL,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
}
