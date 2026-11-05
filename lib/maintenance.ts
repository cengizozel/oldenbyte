import { prisma } from "./prisma";
import { pruneExpiredSessions } from "./session";
import { cacheExpiry, isCacheKey } from "./settingKeys";
import { findOrphans } from "./orphans";

// Housekeeping the app would otherwise never do. Runs at startup and then
// every six hours:
//   - caches past their expiry (the Cache table carries one per row)
//   - expired sessions
//   - a count of leftover widget data, which is only ever removed by the user
//     from the edit shelf (lib/gc.ts)
// At startup it also moves any cache rows an earlier version left in the
// Setting table, and compacts the database file.
const EVERY_MS = 6 * 60 * 60 * 1000;
const CHUNK = 200;

// Caches used to live in Setting, told apart by key. Move them once; the key
// still decides the expiry.
export async function moveCacheRows(): Promise<number> {
  const rows = await prisma.setting.findMany({
    where: { OR: [{ key: { contains: "-20" } }, { key: { startsWith: "epub-locs-" } }, { key: { endsWith: "-cache" } }] },
    select: { userId: true, key: true, value: true },
  });
  const caches = rows.filter(r => isCacheKey(r.key));
  for (let i = 0; i < caches.length; i += CHUNK) {
    const chunk = caches.slice(i, i + CHUNK);
    await prisma.$transaction([
      ...chunk.map(r => prisma.cache.upsert({
        where: { userId_key: { userId: r.userId, key: r.key } },
        update: { value: r.value, expiresAt: cacheExpiry(r.key) },
        create: { userId: r.userId, key: r.key, value: r.value, expiresAt: cacheExpiry(r.key) },
      })),
      ...chunk.map(r => prisma.setting.delete({ where: { userId_key: { userId: r.userId, key: r.key } } })),
    ]);
  }
  return caches.length;
}

async function countOrphans(): Promise<{ widgets: number; keys: number }> {
  let widgets = 0, keys = 0;
  for (const { id } of await prisma.user.findMany({ select: { id: true } })) {
    for (const o of await findOrphans(id)) { widgets++; keys += o.keys.length; }
  }
  return { widgets, keys };
}

export async function pruneStaleData(): Promise<{ caches: number; sessions: number; orphans: { widgets: number; keys: number } }> {
  const { count: caches } = await prisma.cache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const before = await prisma.session.count();
  await pruneExpiredSessions();
  const sessions = before - (await prisma.session.count());
  const orphans = await countOrphans();
  return { caches, sessions, orphans };
}

// Reclaim the space freed by pruning: fold the write-ahead log back into the
// file and rebuild it without free pages. Done once per boot; the database is
// small and the app is not serving yet.
export async function compact(): Promise<void> {
  await prisma.$executeRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE)`);
  await prisma.$executeRawUnsafe(`VACUUM`);
}

export function scheduleMaintenance(): void {
  const run = () =>
    pruneStaleData()
      .then(r => {
        if (r.caches || r.sessions) console.log(`[maintenance] removed ${r.caches} expired cache rows, ${r.sessions} expired sessions`);
        if (r.orphans.widgets) console.log(`[maintenance] ${r.orphans.keys} keys of leftover data from ${r.orphans.widgets} removed widgets; users can clear them from the edit shelf`);
      })
      .catch(err => console.error("[maintenance]", err));
  moveCacheRows()
    .then(n => { if (n) console.log(`[maintenance] moved ${n} cache rows out of Setting`); })
    .catch(err => console.error("[maintenance] cache move", err))
    .then(run)
    .then(() => compact().catch(err => console.error("[maintenance] compact", err)));
  setInterval(run, EVERY_MS).unref();
}
