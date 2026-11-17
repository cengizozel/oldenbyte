// Add-ons (docs/addons.md): a small JSON file that plugs a service into a
// slot of a built-in widget. No code: an add-on only says which requests to
// make to the service the user configures and how to read the answers. The
// server makes the requests. Shared by the server and the browser.
//
// The first slot is the YouTube widget's archive ("youtube.archive"): a
// place the user's videos also live, such as TubeArchivist or Invidious.
//
// What an add-on cannot do, by construction:
// - contact any host but the one the user typed (requests are a path on the
//   user's address, never a full URL);
// - send the user's values anywhere else (links must start at the user's
//   address too);
// - run code or inject markup (the icon is only ever used as a CSS mask).

export const ADDON_SLOTS = ["youtube.archive"] as const;
export type AddonSlot = (typeof ADDON_SLOTS)[number];

export type AddonField = {
  key: string;
  label: string;
  // url: an http(s) address. secret: shown as a password field.
  type: "url" | "text" | "secret";
  placeholder?: string;
  hint?: string;
  optional?: boolean;
};

// A request to the user's service: a path on its address, with optional
// headers. "{config.key}" and (where a video is involved) "{id}" are filled in.
export type AddonRequest = { path: string; headers?: Record<string, string> };

export type ArchiveAddon = {
  id: string;
  slot: "youtube.archive";
  name: string;
  description: string;
  // An SVG drawn in one color, used as the badge on videos.
  icon?: string;
  // The user's settings. A field with key "url" is required: the address the
  // browser opens. A field with key "serverUrl", when filled in, is the
  // address the server uses instead (for a service the server reaches
  // differently than the browser does).
  config: AddonField[];
  // Connection test. `ok`: a value in the JSON answer that must match;
  // `version`: where the answer says its version.
  ping?: AddonRequest & { ok?: { path: string; equals: string }; version?: string };
  // Is a video there? Asked per video. `found` and `missing` are the HTTP
  // statuses that mean yes and no (200 and 404 unless given). Left out: the
  // service has every video (a front end like Invidious).
  has?: AddonRequest & { found?: number[]; missing?: number[] };
  // Where a video opens. Must start with "{config.url}".
  open: string;
};

export type Addon = ArchiveAddon;
// Where an add-on came from: shipped with oldenbyte, or uploaded by this user.
export type ListedAddon = Addon & { source: "built-in" | "yours" };

export const MAX_ADDON_BYTES = 16_000;
export const MAX_USER_ADDONS = 20;

const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,30}$/;
const PLACEHOLDER = /\{([^{}]*)\}/g;

function templateErrors(what: string, value: unknown, keys: Set<string>, allowId: boolean): string[] {
  if (typeof value !== "string") return [`${what} must be text`];
  if (value.length > 500 || /[\u0000-\u001f]/.test(value)) return [`${what} is too long or has control characters`];
  const errors: string[] = [];
  for (const m of value.matchAll(PLACEHOLDER)) {
    const name = m[1];
    if (name === "id") { if (!allowId) errors.push(`${what}: {id} is not available here`); }
    else if (!name.startsWith("config.") || !keys.has(name.slice(7))) errors.push(`${what}: unknown placeholder {${name}}`);
  }
  return errors;
}

function requestErrors(what: string, req: unknown, keys: Set<string>, allowId: boolean): string[] {
  if (!req || typeof req !== "object") return [`${what} must be an object`];
  const r = req as AddonRequest;
  const errors = templateErrors(`${what}.path`, r.path, keys, allowId);
  // A path on the user's address. "//host" or "/\host" would be another host.
  if (typeof r.path === "string" && (!r.path.startsWith("/") || r.path.startsWith("//") || r.path.includes("\\"))) errors.push(`${what}.path must start with one "/"`);
  if (r.headers !== undefined) {
    if (!r.headers || typeof r.headers !== "object" || Array.isArray(r.headers)) errors.push(`${what}.headers must be an object`);
    else {
      const entries = Object.entries(r.headers);
      if (entries.length > 10) errors.push(`${what}.headers: at most 10`);
      for (const [name, value] of entries) {
        if (!/^[A-Za-z0-9-]{1,40}$/.test(name) || /^(host|cookie|content-length|transfer-encoding|connection)$/i.test(name)) errors.push(`${what}.headers: "${name}" is not allowed`);
        errors.push(...templateErrors(`${what}.headers.${name}`, value, keys, false));
      }
    }
  }
  return errors;
}

const statusList = (v: unknown) => v === undefined || (Array.isArray(v) && v.length > 0 && v.length <= 10 && v.every(n => Number.isInteger(n) && n >= 100 && n <= 599));

// Validates an untrusted add-on. Returns error strings; none means valid.
export function validateAddon(def: unknown): string[] {
  if (!def || typeof def !== "object" || Array.isArray(def)) return ["not an object"];
  const d = def as Partial<ArchiveAddon>;
  const errors: string[] = [];
  if (typeof d.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(d.id)) errors.push("id must be 2 to 40 characters of a-z, 0-9 and -");
  if (!ADDON_SLOTS.includes(d.slot as AddonSlot)) errors.push(`slot must be one of: ${ADDON_SLOTS.join(", ")}`);
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > 30) errors.push("name required (max 30 characters)");
  if (typeof d.description !== "string" || !d.description.trim() || d.description.length > 200) errors.push("description required (max 200 characters)");
  if (d.icon !== undefined && (typeof d.icon !== "string" || d.icon.length > 8000 || !/^\s*<svg[\s>]/i.test(d.icon))) errors.push("icon must be an SVG (max 8000 characters)");

  const keys = new Set<string>();
  if (!Array.isArray(d.config) || d.config.length === 0 || d.config.length > 8) errors.push("config must list 1 to 8 fields");
  else {
    for (const [i, f] of d.config.entries()) {
      if (!f || typeof f !== "object") { errors.push(`config[${i}] must be an object`); continue; }
      if (typeof f.key !== "string" || !KEY.test(f.key) || keys.has(f.key)) errors.push(`config[${i}].key is invalid or repeated`);
      else keys.add(f.key);
      if (typeof f.label !== "string" || !f.label.trim() || f.label.length > 40) errors.push(`config[${i}].label required (max 40 characters)`);
      if (!["url", "text", "secret"].includes(f.type)) errors.push(`config[${i}].type must be url, text or secret`);
      for (const k of ["placeholder", "hint"] as const) if (f[k] !== undefined && (typeof f[k] !== "string" || f[k]!.length > 200)) errors.push(`config[${i}].${k} must be text (max 200 characters)`);
    }
    const url = d.config.find(f => f?.key === "url");
    if (!url || url.type !== "url" || url.optional) errors.push('config needs a required field with key "url" and type "url"');
    const server = d.config.find(f => f?.key === "serverUrl");
    if (server && server.type !== "url") errors.push('the "serverUrl" field must have type "url"');
  }

  if (d.ping !== undefined) {
    errors.push(...requestErrors("ping", d.ping, keys, false));
    const ok = d.ping?.ok;
    if (ok !== undefined && (!ok || typeof ok.path !== "string" || !ok.path.startsWith("$") || typeof ok.equals !== "string")) errors.push('ping.ok must be { "path": "$.field", "equals": "text" }');
    if (d.ping?.version !== undefined && (typeof d.ping.version !== "string" || !d.ping.version.startsWith("$"))) errors.push('ping.version must be a path like "$.version"');
  }
  if (d.has !== undefined) {
    errors.push(...requestErrors("has", d.has, keys, true));
    if (typeof d.has?.path === "string" && !d.has.path.includes("{id}")) errors.push("has.path must contain {id}");
    if (!statusList(d.has?.found) || !statusList(d.has?.missing)) errors.push("has.found and has.missing must be lists of HTTP statuses");
  }
  errors.push(...templateErrors("open", d.open, keys, true));
  if (typeof d.open === "string" && (!d.open.startsWith("{config.url}/") || !d.open.includes("{id}"))) errors.push('open must start with "{config.url}/" and contain {id}');
  return errors;
}

// The address without a trailing slash, or "" when it is not an http(s) one.
export function cleanBase(url: unknown): string {
  const s = typeof url === "string" ? url.trim().replace(/\/+$/, "") : "";
  return /^https?:\/\/[^\s/?#]+/i.test(s) ? s : "";
}

// Fills a template. `encode`: values are escaped for use inside a URL path or
// query (headers are filled as they are).
export function fillTemplate(template: string, values: Record<string, string>, id: string | null, encode: boolean): string {
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    const raw = name === "id" ? id ?? "" : values[name.slice(7)] ?? "";
    return encode ? encodeURIComponent(raw) : raw.replace(/[\r\n]/g, "");
  });
}

// Where a video opens in the browser.
export function addonOpenUrl(addon: Addon, values: Record<string, string>, id: string): string {
  const base = cleanBase(values.url);
  if (!base) return "";
  return base + fillTemplate(addon.open.slice("{config.url}".length), values, id, true);
}

// The values an add-on needs, trimmed; null when a required one is missing or
// an address is not one.
export function addonValues(addon: Addon, raw: unknown): Record<string, string> | null {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const f of addon.config) {
    const v = typeof input[f.key] === "string" ? (input[f.key] as string).trim().slice(0, 2000) : "";
    if (!v) { if (!f.optional) return null; continue; }
    if (f.type === "url" && !cleanBase(v)) return null;
    out[f.key] = f.type === "url" ? cleanBase(v) : v;
  }
  return out;
}

// The icon as a CSS mask image. Only ever painted as a mask, so nothing in
// the SVG can run or load.
export function addonIconMask(addon: Addon | undefined): string | null {
  return addon?.icon ? `url("data:image/svg+xml,${encodeURIComponent(addon.icon)}")` : null;
}
