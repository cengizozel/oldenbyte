// Server-side reads of Setting rows that bring old shapes up to date on the
// way out. Every reader (the settings API, the chat's widget readers) goes
// through readSetting, so a value can only ever be seen in its current form
// and the widgets carry no migration code of their own. Each conversion runs
// in one transaction and bumps the row's version like any other write.
//
// Rules live in lib/migrationRules.ts; this file is the glue to the database.

import { prisma } from "@/lib/prisma";
import { isCacheKey } from "@/lib/settingKeys";
import { notebookSplit, trackerFold, trackerMerge, upkeepConfigCurrent, upkeepDaysToLog } from "@/lib/migrationRules";

export type Stored = { value: string | null; version: number | null };
type Row = { value: string; version: number };

async function find(userId: string, key: string): Promise<Row | null> {
  return prisma.setting.findUnique({ where: { userId_key: { userId, key } }, select: { value: true, version: true } });
}

async function userTimezone(userId: string): Promise<string> {
  const tz = (await find(userId, "timezone"))?.value?.trim();
  return tz || "UTC";
}

// The migration a key may need, given what is stored under it now. Returns the
// row after migrating, or the original row when nothing applied.
async function migrated(userId: string, key: string, row: Row | null): Promise<Row | null> {
  let m: RegExpMatchArray | null;

  if (row && (m = key.match(/^upkeep-config-(.+)$/))) {
    const next = upkeepConfigCurrent(row.value);
    if (next === null) return row;
    return prisma.setting.update({
      where: { userId_key: { userId, key } },
      data: { value: next, version: { increment: 1 } },
      select: { value: true, version: true },
    });
  }

  if (!row && (m = key.match(/^upkeep-log-(.+)$/))) {
    const legacyKey = `upkeep-days-${m[1]}`;
    const legacy = await find(userId, legacyKey);
    if (!legacy) return null;
    const log = upkeepDaysToLog(legacy.value, Date.now(), await userTimezone(userId));
    if (log === null) return null;
    const [created] = await prisma.$transaction([
      prisma.setting.create({ data: { userId, key, value: log, version: 1 }, select: { value: true, version: true } }),
      prisma.setting.delete({ where: { userId_key: { userId, key: legacyKey } } }),
    ]);
    return created;
  }

  if ((m = key.match(/^tracker-days-(.+)$/))) {
    const prefix = `tracker-day-${m[1]}-`;
    const rows = (await prisma.setting.findMany({ where: { userId, key: { startsWith: prefix } }, select: { key: true, value: true } }))
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.key.slice(prefix.length)));
    if (!rows.length) return row;
    const folded = trackerFold(m[1], rows);
    let existing: Record<string, Record<string, number>> | null = null;
    if (row) {
      try { existing = JSON.parse(row.value); } catch { existing = null; }
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) return row; // unreadable store: leave both alone
    }
    const value = JSON.stringify(existing ? trackerMerge(existing, folded) : folded);
    const [written] = await prisma.$transaction([
      row
        ? prisma.setting.update({ where: { userId_key: { userId, key } }, data: { value, version: { increment: 1 } }, select: { value: true, version: true } })
        : prisma.setting.create({ data: { userId, key, value, version: 1 }, select: { value: true, version: true } }),
      prisma.setting.deleteMany({ where: { userId, key: { in: rows.map(r => r.key) } } }),
    ]);
    return written;
  }

  if (!row && (m = key.match(/^notebook-(.+)-days$/))) {
    const id = m[1];
    const legacyKey = `notebook-${id}-dates`;
    const legacy = await find(userId, legacyKey);
    if (!legacy) return null;
    const split = notebookSplit(legacy.value);
    if (split === null) return null;
    const [created] = await prisma.$transaction([
      prisma.setting.create({ data: { userId, key, value: JSON.stringify(split.dates), version: 1 }, select: { value: true, version: true } }),
      ...split.days.map(([date, html]) => prisma.setting.upsert({
        where: { userId_key: { userId, key: `notebook-${id}-day-${date}` } },
        update: { value: html, version: { increment: 1 } },
        create: { userId, key: `notebook-${id}-day-${date}`, value: html, version: 1 },
      })),
      prisma.setting.delete({ where: { userId_key: { userId, key: legacyKey } } }),
    ]);
    return created;
  }

  return row;
}

// A user's current value for a key, migrated if it was stored in an older
// shape. Cache keys read from the Cache table (expired rows read as absent)
// and carry no version.
export async function readSetting(userId: string, key: string): Promise<Stored> {
  if (isCacheKey(key)) {
    const row = await prisma.cache.findUnique({ where: { userId_key: { userId, key } }, select: { value: true, expiresAt: true } });
    return { value: row && row.expiresAt > new Date() ? row.value : null, version: null };
  }
  const row = await migrated(userId, key, await find(userId, key));
  return row ? { value: row.value, version: row.version } : { value: null, version: null };
}
