// Server side of custom widgets (lib/customWidgets.ts): where the files are
// kept, which ones may run, and the tickets their frames load media with.
// Node runtime only.
import { createHmac, timingSafeEqual } from "crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "./prisma";
import { ClientError } from "./http";
import { getSecret } from "./auth";
import {
  ELEVATED_KEY, MAX_USER_WIDGETS, extId, missingPowers, parseElevated, parseExtId, parseWidgetFile,
  type CustomSource, type ElevatedSettings, type InstalledWidget, type Power,
} from "./customWidgets";

// Uploaded and installed widget files live on the data volume, per user:
// <dir>/<user id>/<yours|community>/<widget id>.html. They count toward the
// account's storage (lib/quota.ts).
export const widgetsDir = process.env.WIDGETS_DIR ?? path.join(process.cwd(), "data", "widgets");

// Which widgets are switched on, and when each was installed: one settings row.
export const STATE_KEY = "custom-widgets";
type State = Record<string, { enabled?: boolean; installedAt?: number }>;

function fileOf(userId: string, ext: string): string | null {
  const p = parseExtId(ext);
  return p ? path.join(widgetsDir, userId, p.source, `${p.id}.html`) : null;
}

async function readState(userId: string): Promise<State> {
  const row = await prisma.setting.findUnique({ where: { userId_key: { userId, key: STATE_KEY } } });
  if (!row) return {};
  try {
    const v = JSON.parse(row.value);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as State) : {};
  } catch {
    return {};
  }
}

async function writeState(userId: string, state: State): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.setting.upsert({ where: { userId_key: { userId, key: STATE_KEY } }, create: { userId, key: STATE_KEY, value }, update: { value, version: { increment: 1 } } });
}

export async function accountElevated(userId: string): Promise<ElevatedSettings> {
  const row = await prisma.setting.findUnique({ where: { userId_key: { userId, key: ELEVATED_KEY } } });
  return parseElevated(row?.value);
}

// Every widget file this user has, valid ones only. A file that no longer
// passes validation (the format tightened, or it was edited on disk) is left
// out, never run.
export async function listInstalled(userId: string): Promise<InstalledWidget[]> {
  const state = await readState(userId);
  const out: InstalledWidget[] = [];
  for (const source of ["yours", "community"] as CustomSource[]) {
    const dir = path.join(widgetsDir, userId, source);
    let names: string[];
    try { names = (await readdir(dir)).sort(); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith(".html")) continue;
      try {
        const file = path.join(dir, name);
        const html = await readFile(file, "utf8");
        const parsed = parseWidgetFile(html);
        if (!parsed.manifest || `${parsed.manifest.id}.html` !== name) continue;
        const ext = extId(source, parsed.manifest.id);
        const st = state[ext] ?? {};
        const elevated = (parsed.manifest.powers ?? []).length > 0;
        out.push({
          ext, source, manifest: parsed.manifest,
          bytes: Buffer.byteLength(html),
          installedAt: st.installedAt ?? (await stat(file)).mtimeMs,
          enabled: elevated ? st.enabled === true : true,
        });
      } catch { /* unreadable: skipped */ }
    }
  }
  return out;
}

export async function findInstalled(userId: string, ext: string): Promise<InstalledWidget | null> {
  return (await listInstalled(userId)).find(w => w.ext === ext) ?? null;
}

export async function readSource(userId: string, ext: string): Promise<string | null> {
  const file = fileOf(userId, ext);
  if (!file) return null;
  try { return await readFile(file, "utf8"); } catch { return null; }
}

// Adds or replaces a widget file. An elevated widget starts switched on only
// when the account's switches already cover every power it asks for; the
// caller has shown the warning that names them. Replacing a file keeps it on
// only if the new version asks for nothing the old one did not.
export async function install(userId: string, source: CustomSource, html: string): Promise<InstalledWidget> {
  const parsed = parseWidgetFile(html);
  if (!parsed.manifest) throw new ClientError(`This is not a valid widget file: ${parsed.errors.join("; ")}.`, 400);
  const manifest = parsed.manifest;
  const ext = extId(source, manifest.id);
  const before = await listInstalled(userId);
  const old = before.find(w => w.ext === ext);
  if (!old && before.length >= MAX_USER_WIDGETS) throw new ClientError(`You can keep at most ${MAX_USER_WIDGETS} custom widgets. Remove one first.`, 400);

  const powers = manifest.powers ?? [];
  const account = await accountElevated(userId);
  const covered = missingPowers(powers, account).length === 0;
  const enabled = powers.length === 0 || covered;

  const file = fileOf(userId, ext)!;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");
  const state = await readState(userId);
  state[ext] = { enabled, installedAt: Date.now() };
  await writeState(userId, state);
  return { ext, source, manifest, bytes: Buffer.byteLength(html), installedAt: state[ext].installedAt!, enabled };
}

export async function remove(userId: string, ext: string): Promise<boolean> {
  const file = fileOf(userId, ext);
  if (!file) return false;
  try { await rm(file); } catch { return false; }
  const state = await readState(userId);
  delete state[ext];
  await writeState(userId, state);
  return true;
}

// Switches an elevated widget on or off. On is refused while the account's
// switches do not cover what it asks for.
export async function setEnabled(userId: string, ext: string, on: boolean): Promise<InstalledWidget> {
  const w = await findInstalled(userId, ext);
  if (!w) throw new ClientError("That widget is not installed.", 404);
  if (on) {
    const missing = missingPowers(w.manifest.powers, await accountElevated(userId));
    if (missing.length) throw new ClientError("Elevated widgets, or a power this widget asks for, are switched off in Settings.", 403);
  }
  const state = await readState(userId);
  state[ext] = { ...state[ext], enabled: on, installedAt: state[ext]?.installedAt ?? w.installedAt };
  await writeState(userId, state);
  return { ...w, enabled: (w.manifest.powers ?? []).length === 0 ? true : on };
}

// The gate every elevated call passes: the widget is installed, switched on,
// declares the power, and the account allows it right now. Throws otherwise.
export async function assertPower(userId: string, ext: string, power: Power): Promise<InstalledWidget> {
  const w = await findInstalled(userId, ext);
  if (!w) throw new ClientError("That widget is not installed.", 404);
  if (!(w.manifest.powers ?? []).includes(power)) throw new ClientError(`This widget did not ask for the "${power}" power.`, 403);
  if (!w.enabled) throw new ClientError("This widget is switched off.", 403);
  const account = await accountElevated(userId);
  if (!account.allow || !account[power]) throw new ClientError(`The "${power}" power is switched off in Settings.`, 403);
  return w;
}

// ── Tickets ──────────────────────────────────────────────────────────────────
// A widget's frame has no session, so it cannot use the API. For media (an
// audio stream, a cover image) and library files the dashboard asks for a
// ticket: a signed, expiring note of exactly what may be fetched, for whom.
// The frame loads /api/custom-widgets/media?t=<ticket>.
export type Ticket =
  | { k: "net"; u: string; x: string; url: string; h?: Record<string, string>; exp: number }
  | { k: "file"; u: string; x: string; path: string; exp: number };

const TICKET_MS = 12 * 60 * 60 * 1000;
const sign = (body: string) => createHmac("sha256", `custom-widget-ticket:${getSecret()}`).update(body).digest("base64url");

export function issueTicket(t: Omit<Extract<Ticket, { k: "net" }>, "exp"> | Omit<Extract<Ticket, { k: "file" }>, "exp">): string {
  const body = Buffer.from(JSON.stringify({ ...t, exp: Date.now() + TICKET_MS })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readTicket(raw: string | null): Ticket | null {
  if (!raw || raw.length > 8000) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const a = Buffer.from(raw.slice(dot + 1));
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Ticket;
    return typeof t.exp === "number" && t.exp > Date.now() ? t : null;
  } catch {
    return null;
  }
}

// Request headers a widget may set on a request the server makes for it.
export function cleanHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    if (typeof value !== "string" || value.length > 4000 || /[\r\n]/.test(value)) continue;
    if (!/^[A-Za-z0-9-]{1,40}$/.test(name) || /^(host|content-length|transfer-encoding|connection|upgrade|te|trailer|proxy-.*)$/i.test(name)) continue;
    out[name] = value;
  }
  return out;
}

// ── The file library (the "files" power) ─────────────────────────────────────
const libraryDir = process.env.LIBRARY_DIR ?? path.join(process.cwd(), "data", "library");
const LIBRARY_EXT = /\.(pdf|epub)$/i;

// The absolute path of a library path, or null when it leaves the user's folder.
export function libraryPath(userId: string, rel: string): string | null {
  const root = path.resolve(libraryDir, userId);
  const target = path.resolve(root, rel);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

export async function listLibrary(userId: string, rel: string): Promise<{ dirs: string[]; files: { name: string; size: number }[] }> {
  const target = libraryPath(userId, rel);
  if (!target) throw new ClientError("Invalid path.", 400);
  let entries;
  try { entries = await readdir(target, { withFileTypes: true }); } catch { return { dirs: [], files: [] }; }
  const dirs: string[] = [];
  const files: { name: string; size: number }[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) dirs.push(e.name);
    else if (e.isFile() && LIBRARY_EXT.test(e.name)) files.push({ name: e.name, size: (await stat(path.join(target, e.name)).catch(() => null))?.size ?? 0 });
  }
  dirs.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { dirs, files };
}

export const isLibraryFile = (p: string) => LIBRARY_EXT.test(p);

// ── The dashboards' widgets (the "widgets" power) ────────────────────────────
export async function listUserWidgets(userId: string): Promise<{ id: string; type: string; title: string; dashboard: string }[]> {
  const rows = await prisma.setting.findMany({
    where: { userId, OR: [{ key: "widget-instances" }, { key: { startsWith: "widget-instances:" } }] },
    select: { key: true, value: true },
  });
  const out: { id: string; type: string; title: string; dashboard: string }[] = [];
  for (const r of rows) {
    const dashboard = r.key.includes(":") ? r.key.slice(r.key.indexOf(":") + 1) : "default";
    try {
      const map = JSON.parse(r.value) as Record<string, { type?: string; title?: string }>;
      for (const [id, w] of Object.entries(map)) {
        if (w && typeof w.type === "string" && w.type !== "empty") out.push({ id, type: w.type, title: typeof w.title === "string" ? w.title : id, dashboard });
      }
    } catch { /* unreadable dashboard: skipped */ }
  }
  return out;
}
