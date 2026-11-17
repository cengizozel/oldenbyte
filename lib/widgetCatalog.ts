// The community catalog of custom widgets: an index file published by the
// community widgets repository (docs/custom-widgets.md). The server reads it,
// never the browser, so opening the picker tells no outside site anything
// about the person using it. Node runtime only.
import { createHash } from "crypto";
import { safeFetch, readCappedText } from "./ssrf";
import { ClientError } from "./http";
import { MAX_WIDGET_BYTES, POWERS, validateManifest, type CustomManifest, type Power } from "./customWidgets";

const DEFAULT_URL = "https://raw.githubusercontent.com/cengizozel/oldenbyte-widgets/main/catalog.json";
// WIDGET_CATALOG_URL points at another catalog; "off" turns the catalog off.
export function catalogUrl(): string | null {
  const v = process.env.WIDGET_CATALOG_URL?.trim();
  if (v && v.toLowerCase() === "off") return null;
  return v || DEFAULT_URL;
}

export type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  color?: CustomManifest["color"];
  category?: CustomManifest["category"];
  powers: Power[];
  // Someone other than the author read the code. Not a promise of safety.
  reviewed: boolean;
  file: string;   // path of the widget file, relative to the catalog
  sha256: string; // of the widget file
  bytes: number;
};

function cleanEntry(raw: unknown): CatalogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  // The same rules as a manifest for the fields the two share.
  const asManifest = { format: 1, id: e.id, name: e.name, description: e.description, version: e.version, author: e.author, homepage: e.homepage, color: e.color, category: e.category, powers: e.powers ?? [] };
  if (validateManifest(asManifest).length) return null;
  if (typeof e.file !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}\.html$/.test(e.file) || e.file.includes("..")) return null;
  if (typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256)) return null;
  const powers = (Array.isArray(e.powers) ? e.powers : []).filter((p): p is Power => POWERS.includes(p as Power));
  return {
    id: e.id as string, name: e.name as string, description: e.description as string, version: e.version as string,
    author: e.author as string | undefined, homepage: e.homepage as string | undefined,
    color: e.color as CatalogEntry["color"], category: e.category as CatalogEntry["category"],
    powers, reviewed: e.reviewed === true, file: e.file, sha256: e.sha256,
    bytes: typeof e.bytes === "number" ? e.bytes : 0,
  };
}

// Reads an untrusted catalog. Entries that do not pass are dropped.
export function parseCatalog(text: string): CatalogEntry[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const list = (raw as { widgets?: unknown })?.widgets;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const item of list.slice(0, 2000)) {
    const e = cleanEntry(item);
    if (e && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
  }
  return out;
}

let cache: { at: number; url: string; entries: CatalogEntry[] } | null = null;
const TTL = 30 * 60 * 1000;

export async function loadCatalog(force = false): Promise<{ entries: CatalogEntry[]; url: string | null }> {
  const url = catalogUrl();
  if (!url) return { entries: [], url: null };
  if (!force && cache && cache.url === url && Date.now() - cache.at < TTL) return { entries: cache.entries, url };
  const res = await safeFetch(url, { timeoutMs: 10_000 });
  if (!res.ok) throw new ClientError("The community catalog could not be loaded.", 503);
  const entries = parseCatalog(await readCappedText(res, 2 * 1024 * 1024));
  cache = { at: Date.now(), url, entries };
  return { entries, url };
}

// Downloads one catalog widget and checks it is the file the catalog lists.
export async function fetchCatalogWidget(id: string): Promise<string> {
  const { entries, url } = await loadCatalog();
  const entry = entries.find(e => e.id === id);
  if (!entry || !url) throw new ClientError("That widget is not in the catalog.", 404);
  const res = await safeFetch(new URL(entry.file, url).toString(), { timeoutMs: 15_000 });
  if (!res.ok) throw new ClientError("The widget file could not be downloaded.", 503);
  const html = await readCappedText(res, MAX_WIDGET_BYTES + 1);
  if (html.length > MAX_WIDGET_BYTES) throw new ClientError("The widget file is too large.", 400);
  if (createHash("sha256").update(html, "utf8").digest("hex") !== entry.sha256) {
    throw new ClientError("The downloaded file does not match the catalog. Try again later.", 409);
  }
  return html;
}

// True when `a` is a newer version than `b` ("1.2.0" vs "1.10.0").
export function newerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}
