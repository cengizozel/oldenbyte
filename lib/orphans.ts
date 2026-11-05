// Leftover widget data in the database (see lib/gc.ts for the rules).
import { prisma } from "@/lib/prisma";
import { isLiveSetKey, liveIdsFrom, orphanGroups, type Orphan } from "@/lib/gc";

export async function findOrphans(userId: string): Promise<Orphan[]> {
  const rows = await prisma.setting.findMany({ where: { userId }, select: { key: true, value: true, updatedAt: true } });
  const liveSet = rows.filter(r => isLiveSetKey(r.key));
  if (!liveSet.length) return [];
  const live = liveIdsFrom(liveSet);
  if (!live) return [];
  return orphanGroups(rows.map(r => ({ key: r.key, bytes: r.value.length, updatedAt: r.updatedAt })), live);
}

// Delete one removed widget's leftover keys. The list is recomputed first, so
// only keys that are leftover at this moment can go.
export async function deleteOrphan(userId: string, instanceId: string): Promise<number> {
  const group = (await findOrphans(userId)).find(o => o.id === instanceId);
  if (!group) return 0;
  const { count } = await prisma.setting.deleteMany({ where: { userId, key: { in: group.keys.map(k => k.key) } } });
  return count;
}
