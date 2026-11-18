// Node's files, for a device (docs/app-bundle.md). The server keeps some
// things in files: widget files it ships with, widgets a user uploaded, a
// cache or two. On a device:
//   - a file the code writes is kept in the device's store, under "device:file:",
//     as base64, so it holds anything;
//   - a file that ships with oldenbyte (the widget files, the add-ons) is read
//     from the app's own bundle, under /_device/, which also carries a list of
//     what is there (/_device/index.json) for directory listings.
import { Buffer } from "buffer";
import { FILE_AT, device } from "@/lib/appHost/runtime";
import { normalize } from "./path";

class Missing extends Error {
  code = "ENOENT";
  constructor(p: string) { super(`ENOENT: no such file or directory, '${p}'`); }
}

const at = (p: string) => FILE_AT + normalize(p.startsWith("/") ? p : `/${p}`);
const shippedUrl = (p: string) => `/_device${normalize(p.startsWith("/") ? p : `/${p}`)}`;

let shippedList: Promise<string[]> | null = null;
const shipped = (): Promise<string[]> =>
  (shippedList ??= fetch("/_device/index.json").then(r => (r.ok ? r.json() : [])).catch(() => []));

async function bytesOf(p: string): Promise<Uint8Array> {
  const held = await device().get(at(p));
  if (held) return Buffer.from(held.value, "base64");
  const list = await shipped();
  const rel = normalize(p.startsWith("/") ? p : `/${p}`);
  if (!list.includes(rel)) throw new Missing(p);
  const res = await fetch(shippedUrl(p));
  if (!res.ok) throw new Missing(p);
  return new Uint8Array(await res.arrayBuffer());
}

type Enc = BufferEncoding | { encoding?: BufferEncoding | null } | null | undefined;
export async function readFile(p: string, enc?: Enc): Promise<string & Buffer> {
  const bytes = Buffer.from(await bytesOf(p));
  const encoding = typeof enc === "string" ? enc : enc?.encoding;
  return (encoding ? bytes.toString(encoding) : bytes) as string & Buffer;
}

export async function writeFile(p: string, data: string | Uint8Array): Promise<void> {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  await device().set(at(p), bytes.toString("base64"));
}

// Folders are only names here; making one is always fine.
export async function mkdir(): Promise<void> {}

export async function unlink(p: string): Promise<void> {
  if (!(await device().get(at(p)))) throw new Missing(p);
  await device().remove(at(p));
}

export async function rm(p: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
  const rows = await device().list(at(p));
  const own = rows.filter(r => r.key === at(p) || r.key.startsWith(`${at(p)}/`));
  if (!own.length && !opts?.force) throw new Missing(p);
  await Promise.all(own.map(r => device().remove(r.key)));
}

export async function rename(from: string, to: string): Promise<void> {
  const rows = (await device().list(at(from))).filter(r => r.key === at(from) || r.key.startsWith(`${at(from)}/`));
  if (!rows.length) throw new Missing(from);
  for (const r of rows) {
    await device().set(at(to) + r.key.slice(at(from).length), r.value);
    await device().remove(r.key);
  }
}

type Entry = { name: string; isFile: () => boolean; isDirectory: () => boolean };
// The names directly inside a folder: what was written on the device and what
// ships with the app.
async function entries(p: string): Promise<Entry[]> {
  const dir = normalize(p.startsWith("/") ? p : `/${p}`);
  const under = dir === "/" ? "/" : `${dir}/`;
  const kept = (await device().list(FILE_AT + under)).map(r => r.key.slice(FILE_AT.length));
  const all = [...kept, ...(await shipped()).filter(f => f.startsWith(under))];
  const seen = new Map<string, boolean>(); // name -> is a folder
  for (const full of all) {
    const rest = full.slice(under.length);
    const i = rest.indexOf("/");
    const name = i < 0 ? rest : rest.slice(0, i);
    if (name) seen.set(name, (seen.get(name) ?? false) || i >= 0);
  }
  if (!seen.size) throw new Missing(p);
  return [...seen].map(([name, folder]) => ({ name, isFile: () => !folder, isDirectory: () => folder }));
}

export async function readdir(p: string, opts?: { withFileTypes?: boolean }): Promise<string[] & Entry[]> {
  const list = await entries(p);
  return (opts?.withFileTypes ? list : list.map(e => e.name)) as string[] & Entry[];
}

export async function stat(p: string): Promise<{ size: number; mtime: Date; mtimeMs: number; isFile: () => boolean; isDirectory: () => boolean }> {
  const held = await device().get(at(p));
  if (held) {
    const size = Buffer.from(held.value, "base64").length;
    return { size, mtime: new Date(held.updatedAt), mtimeMs: held.updatedAt, isFile: () => true, isDirectory: () => false };
  }
  try {
    const bytes = await bytesOf(p);
    return { size: bytes.length, mtime: new Date(0), mtimeMs: 0, isFile: () => true, isDirectory: () => false };
  } catch {
    await entries(p); // throws when there is no such folder either
    return { size: 0, mtime: new Date(0), mtimeMs: 0, isFile: () => false, isDirectory: () => true };
  }
}

// The room on the disk is the phone's business, not something a page can ask.
export async function statfs(): Promise<never> { throw new Error("Not on a device."); }
