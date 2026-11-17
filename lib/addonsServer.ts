// Server side of add-ons (lib/addons.ts): where they are kept, and making
// their requests. Node runtime only.
import { createHash } from "crypto";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { prisma } from "./prisma";
import { userFetch } from "./requestUser";
import { validateAddon, cleanBase, fillTemplate, MAX_USER_ADDONS, type Addon, type AddonRequest, type ListedAddon } from "./addons";

// The user's uploaded add-ons: one settings row holding the list.
export const USER_ADDONS_KEY = "addons";

let shipped: { at: number; addons: Addon[]; errors: Record<string, string[]> } | null = null;
const TTL = 5 * 60 * 1000;

// The add-ons that come with oldenbyte: every valid file in addons/. A bad
// file is skipped and reported, never fatal.
export async function shippedAddons(): Promise<{ addons: Addon[]; errors: Record<string, string[]> }> {
  if (process.env.NODE_ENV === "production" && shipped && Date.now() - shipped.at < TTL) return shipped;
  const dir = path.join(process.cwd(), "addons");
  const addons: Addon[] = [];
  const errors: Record<string, string[]> = {};
  try {
    for (const file of (await readdir(dir)).sort()) {
      if (!file.endsWith(".json")) continue;
      try {
        const def = JSON.parse(await readFile(path.join(dir, file), "utf8"));
        const errs = validateAddon(def);
        if (errs.length) errors[file] = errs;
        else if (addons.some(a => a.id === def.id)) errors[file] = [`id "${def.id}" is already used`];
        else addons.push(def as Addon);
      } catch (e) {
        errors[file] = [`unreadable: ${String(e instanceof Error ? e.message : e)}`];
      }
    }
  } catch { /* no addons directory */ }
  shipped = { at: Date.now(), addons, errors };
  return shipped;
}

export async function userAddons(userId: string): Promise<Addon[]> {
  const row = await prisma.setting.findUnique({ where: { userId_key: { userId, key: USER_ADDONS_KEY } } });
  if (!row) return [];
  try {
    const list = JSON.parse(row.value);
    // Stored ones are validated again: the format may have tightened since.
    return Array.isArray(list) ? list.filter(a => validateAddon(a).length === 0).slice(0, MAX_USER_ADDONS) : [];
  } catch {
    return [];
  }
}

export async function saveUserAddons(userId: string, addons: Addon[]): Promise<void> {
  const value = JSON.stringify(addons);
  await prisma.setting.upsert({ where: { userId_key: { userId, key: USER_ADDONS_KEY } }, create: { userId, key: USER_ADDONS_KEY, value }, update: { value } });
}

// Every add-on this user can pick. A shipped add-on wins over an upload with
// the same id, so an upload cannot pose as one.
export async function listAddons(userId: string): Promise<ListedAddon[]> {
  const [{ addons }, mine] = await Promise.all([shippedAddons(), userAddons(userId)]);
  const taken = new Set(addons.map(a => a.id));
  return [
    ...addons.map(a => ({ ...a, source: "built-in" as const })),
    ...mine.filter(a => !taken.has(a.id)).map(a => ({ ...a, source: "yours" as const })),
  ];
}

export async function findAddon(userId: string, id: string): Promise<ListedAddon | null> {
  return (await listAddons(userId)).find(a => a.id === id) ?? null;
}

// ── Requests ─────────────────────────────────────────────────────────────────

// The address the server uses: the "serverUrl" value when the add-on has one
// and it is filled in, else the address the browser opens.
export function serverBase(values: Record<string, string>): string {
  return cleanBase(values.serverUrl) || cleanBase(values.url);
}

// One request of an add-on, to the user's own address and nowhere else. Goes
// through userFetch, so only an admin account can reach the home network.
export function addonFetch(req: AddonRequest, values: Record<string, string>, id: string | null, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  for (const [name, value] of Object.entries(req.headers ?? {})) headers[name] = fillTemplate(value, values, null, false);
  return userFetch(serverBase(values) + fillTemplate(req.path, values, id, true), { headers, cache: "no-store", signal });
}

// A stable name for "this add-on with these values", for cache keys, so one
// account's answers are never served to a request made with other values.
export function addonScope(addon: Addon, values: Record<string, string>): string {
  return createHash("sha256").update(`${addon.id}|${JSON.stringify(Object.entries(values).sort())}`).digest("hex").slice(0, 16);
}
