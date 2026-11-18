// The server's database, as far as its code on a device needs it
// (docs/app-bundle.md). The routes and their helpers ask Prisma for rows; here
// the same calls read and write the device's store through the bridge, so the
// server's own code runs unchanged. Only the calls that code makes are here;
// anything else fails loudly instead of pretending.
//
// The tables: `setting` is the user's data (the keys the user's devices share),
// `cache` and `appConfig` stay on this device, and there is one user.
import { CACHE_AT, CONFIG_AT, DEVICE_USER, LOCAL, device } from "@/lib/appHost/runtime";

type Row = { userId: string; key: string; value: string; version: number; updatedAt: Date; expiresAt?: Date | null };
type KeyFilter = string | { startsWith?: string; in?: string[] } | undefined;
type Where = { userId?: string; key?: KeyFilter; version?: number; userId_key?: { userId: string; key: string }; expiresAt?: unknown };
type Data = { value?: string; version?: number | { increment: number }; key?: string; userId?: string; expiresAt?: Date | null };

const started = new Date();

function table(prefix: string, own: (key: string) => boolean) {
  const at = (key: string) => prefix + key;
  const row = (key: string, h: { value: string; version: number; updatedAt: number }): Row =>
    ({ userId: DEVICE_USER.id, key, value: h.value, version: h.version, updatedAt: new Date(h.updatedAt) });
  const keyOf = (w: Where) => w.userId_key?.key ?? (typeof w.key === "string" ? w.key : undefined);

  async function one(key: string): Promise<Row | null> {
    const h = await device().get(at(key));
    return h ? row(key, h) : null;
  }
  async function many(w: Where = {}): Promise<Row[]> {
    const k = w.key;
    if (typeof k === "string") { const r = await one(k); return r ? [r] : []; }
    if (k?.in) return (await Promise.all(k.in.map(one))).filter((r): r is Row => r !== null);
    const rows = await device().list(at(k?.startsWith ?? ""));
    return rows.map(r => row(r.key.slice(prefix.length), r)).filter(r => own(r.key));
  }
  async function write(key: string, value: string): Promise<Row> {
    const done = await device().set(at(key), value);
    return { userId: DEVICE_USER.id, key, value, version: done.version, updatedAt: new Date() };
  }

  return {
    findUnique: ({ where }: { where: Where; select?: unknown }) => one(keyOf(where) as string),
    findMany: ({ where }: { where?: Where; select?: unknown; orderBy?: unknown } = {}) => many(where),
    create: ({ data }: { data: Data; select?: unknown }) => write(data.key as string, data.value as string),
    update: async ({ where, data }: { where: Where; data: Data; select?: unknown }) => {
      const key = keyOf(where) as string;
      const old = await one(key);
      if (!old) throw new Error(`No ${key} to update.`);
      return write(key, data.value ?? old.value);
    },
    upsert: async ({ where, update, create }: { where: Where; update: Data; create: Data; select?: unknown }) => {
      const key = keyOf(where) as string;
      const old = await one(key);
      return write(key, (old ? update.value ?? old.value : create.value) as string);
    },
    // Writes only where the row is still at the version given: the check
    // behind "changed in another tab".
    updateMany: async ({ where, data }: { where: Where; data: Data }) => {
      const key = keyOf(where) as string;
      const old = await one(key);
      if (!old) return { count: 0 };
      if (typeof where.version === "number") {
        const done = await device().set(at(key), data.value ?? old.value, where.version);
        return { count: done.ok ? 1 : 0 };
      }
      await write(key, data.value ?? old.value);
      return { count: 1 };
    },
    delete: async ({ where }: { where: Where }) => { const key = keyOf(where) as string; const old = await one(key); await device().remove(at(key)); return old; },
    deleteMany: async ({ where }: { where?: Where } = {}) => {
      const rows = await many(where);
      await Promise.all(rows.map(r => device().remove(at(r.key))));
      return { count: rows.length };
    },
    count: async ({ where }: { where?: Where } = {}) => (await many(where)).length,
  };
}

const user = { ...DEVICE_USER, createdAt: started, passwordHash: "" };
const none = { count: 0 };

export const prisma = {
  // The user's own keys: everything that is not kept for this device alone.
  setting: table("", key => !key.startsWith(LOCAL)),
  cache: table(CACHE_AT, () => true),
  appConfig: table(CONFIG_AT, () => true),
  user: {
    findUnique: async () => user,
    findFirst: async () => user,
    findMany: async () => [user],
    count: async () => 1,
  },
  session: { count: async () => 1, deleteMany: async () => none },
  device: { findMany: async () => [], count: async () => 0, deleteMany: async () => none },
  // Several writes asked for together. On a device they simply all happen.
  $transaction: async (work: unknown) => (typeof work === "function" ? (work as (p: unknown) => unknown)(prisma) : Promise.all(work as Promise<unknown>[])),
  $queryRawUnsafe: async () => { throw new Error("Not on a device."); },
  $executeRawUnsafe: async () => 0,
};
