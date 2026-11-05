import { prisma } from "./prisma";

// The database schema, created and upgraded in place at startup. There are no
// Prisma migrations: every statement here is idempotent, so a boot against a
// fresh file, an older file or an interrupted upgrade all end in the same
// state. prisma/schema.prisma describes the same tables for the client.
export async function ensureSchema(): Promise<void> {

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id"                 TEXT     PRIMARY KEY,
      "username"           TEXT     NOT NULL UNIQUE,
      "passwordHash"       TEXT     NOT NULL,
      "role"               TEXT     NOT NULL DEFAULT 'user',
      "mustChangePassword" INTEGER  NOT NULL DEFAULT 0,
      "createdAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Session" (
      "id"        TEXT     PRIMARY KEY,
      "userId"    TEXT     NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session" ("userId")`
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppConfig" (
      "key"   TEXT PRIMARY KEY,
      "value" TEXT NOT NULL
    )
  `);

  // Setting table uses a per-user composite PK. The migration from the legacy
  // single-tenant table (PK = key, no userId) is done crash-safely. States,
  // all handled idempotently:
  //   fresh       -> no Setting / Setting_legacy  -> create composite table
  //   legacy      -> Setting exists without userId -> migrate
  //   interrupted -> orphaned "Setting_legacy" from a crashed prior run -> recover
  const SETTING_DDL = `
    CREATE TABLE IF NOT EXISTS "Setting" (
      "userId"    TEXT     NOT NULL,
      "key"       TEXT     NOT NULL,
      "value"     TEXT     NOT NULL,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("userId", "key")
    )
  `;

  const tableRows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Setting','Setting_legacy')`
  );
  const names = new Set(tableRows.map((r) => r.name));

  let settingIsLegacy = false;
  if (names.has("Setting")) {
    const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("Setting")`);
    settingIsLegacy = !cols.some((c) => c.name === "userId");
  }

  if (!names.has("Setting") && !names.has("Setting_legacy")) {
    await prisma.$executeRawUnsafe(SETTING_DDL);
  } else if (settingIsLegacy || names.has("Setting_legacy")) {
    // Atomic: rename-aside (if still needed), (re)create composite, copy legacy
    // rows tagged "__legacy__", drop the legacy table. SQLite DDL is
    // transactional, so a crash rolls back to a consistent state and the next
    // boot resumes/recovers (INSERT OR IGNORE keeps the copy idempotent).
    await prisma.$transaction(async (tx) => {
      if (settingIsLegacy && !names.has("Setting_legacy")) {
        await tx.$executeRawUnsafe(`ALTER TABLE "Setting" RENAME TO "Setting_legacy"`);
      }
      await tx.$executeRawUnsafe(SETTING_DDL);
      await tx.$executeRawUnsafe(`
        INSERT OR IGNORE INTO "Setting" ("userId", "key", "value", "updatedAt")
        SELECT '__legacy__', "key", "value", "updatedAt" FROM "Setting_legacy"
      `);
      await tx.$executeRawUnsafe(`DROP TABLE "Setting_legacy"`);
    });
  }

  // Write counter for compare-and-set saves (see /api/settings). Added in
  // place on older databases; existing rows start at 0.
  const settingCols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("Setting")`);
  if (!settingCols.some((c) => c.name === "version")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Setting" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0`);
  }

  // Disposable data with its own expiry (see lib/maintenance.ts).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Cache" (
      "userId"    TEXT     NOT NULL,
      "key"       TEXT     NOT NULL,
      "value"     TEXT     NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("userId", "key")
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Cache_expiresAt_idx" ON "Cache" ("expiresAt")`
  );

}
