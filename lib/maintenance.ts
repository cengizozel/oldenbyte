import { prisma } from "./prisma";
import { pruneExpiredSessions } from "./session";
import { cacheKeyDate } from "./settingKeys";

// Housekeeping the app would otherwise never do: widgets write a fresh cache
// row per day (F1 per hour) and sessions expire without being deleted, so both
// tables grew forever. Runs at startup and then every six hours.
const KEEP_CACHE_DAYS = 2;
const EVERY_MS = 6 * 60 * 60 * 1000;

export async function pruneStaleData(): Promise<{ caches: number; sessions: number }> {
  const cutoff = new Date(Date.now() - KEEP_CACHE_DAYS * 86_400_000).toISOString().slice(0, 10);
  // Every dated cache key contains "-20YY-"; the exact allow-list check
  // happens in cacheKeyDate, so user data with dates in its key is never hit.
  const candidates = await prisma.setting.findMany({
    where: { key: { contains: "-20" } },
    select: { userId: true, key: true },
  });
  const stale = candidates.filter(r => {
    const day = cacheKeyDate(r.key);
    return day !== null && day < cutoff;
  });
  for (let i = 0; i < stale.length; i += 200) {
    await prisma.$transaction(
      stale.slice(i, i + 200).map(r => prisma.setting.delete({ where: { userId_key: { userId: r.userId, key: r.key } } }))
    );
  }
  const before = await prisma.session.count();
  await pruneExpiredSessions();
  const sessions = before - (await prisma.session.count());
  return { caches: stale.length, sessions };
}

export function scheduleMaintenance(): void {
  const run = () =>
    pruneStaleData()
      .then(r => { if (r.caches || r.sessions) console.log(`[maintenance] removed ${r.caches} old cache rows, ${r.sessions} expired sessions`); })
      .catch(err => console.error("[maintenance]", err));
  run();
  setInterval(run, EVERY_MS).unref();
}
