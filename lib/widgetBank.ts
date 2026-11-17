// The declarative widget engine ("widget bank"). A bank widget is a JSON file
// in widget-bank/ that declares what to fetch and how to map it onto a small
// library of safe, themed primitives. No code execution, no HTML injection:
// contributors submit a config, not a component.
//
// Path expressions: strings starting with "$." select from the fetched JSON
// ("$.items[0].title"). An optional pipe applies a built-in transform:
// "$.stargazers_count | count". Inside `fetch.url`, "{config.key}" interpolates
// the user's per-instance settings.

import { formatCount, formatDate, timeAgo, formatClock, formatDuration } from "@/lib/format";
import type { WidgetColor, WidgetCategory } from "@/lib/widgets";

export type BankConfigField = {
  key: string;
  label: string;
  // "url": the address of the user's own service (the request then goes
  // there, see fetch.url). "secret": an API key or token. It is kept on the
  // server and never sent back to the browser.
  type: "text" | "number" | "select" | "url" | "secret";
  default?: string | number;
  options?: { value: string; label: string }[]; // for type "select"
  placeholder?: string;
  hint?: string;
};

export type BankListBlock = {
  component: "list";
  path: string;            // "$.items" — array to map over
  title: string;           // paths below are relative to each item ("$.title")
  subtitle?: string;
  link?: string;
  meta?: string;
  limit?: number;          // default 8, clamped 1-25
};

export type BankPrimitive =
  | { component: "label"; value: string; size?: "xs" | "sm" | "lg"; muted?: boolean }
  | BankListBlock
  | { component: "stat-row"; items: { label: string; value: string }[] }
  | { component: "progress-bar"; value: string; max: string | number }
  | { component: "badge-list"; path: string; label: string; limit?: number }
  | { component: "image"; src: string; caption?: string }
  | { component: "divider" }
  | { component: "sparkline"; values: string };

export type BankWidgetDef = {
  id: string;
  title: string;
  description: string;
  color?: WidgetColor;
  // The picker group it is listed under; without one it goes under More.
  category?: WidgetCategory;
  defaultSize?: { w: number; h: number };
  digestable?: boolean;          // default false for community widgets
  config?: BankConfigField[];
  fetch: {
    // Either a fixed https address, or one that starts with a "url" setting:
    // "{config.url}/api/v3/queue". Placeholders: {config.key}, {date} (today,
    // YYYY-MM-DD) and {date+7} / {date-1} (days from today).
    url: string;
    cacheMinutes?: number;       // client cache TTL, default 60
    // Request headers; values may use the same placeholders
    // ("X-Api-Key": "{config.apiKey}").
    headers?: Record<string, string>;
  };
  // Shorthand for the common case: a plain mapped list. Compiles to one
  // list primitive. Provide either `items` or `layout`.
  items?: Omit<BankListBlock, "component">;
  layout?: BankPrimitive[];
};

const PRIMITIVES = new Set(["label", "list", "stat-row", "progress-bar", "badge-list", "image", "divider", "sparkline"]);
const COLORS = new Set(["amber", "sky", "neutral", "rose", "teal", "orange"]);
const CATEGORIES = new Set(["feeds", "notes", "links", "time", "habits", "live", "library", "server", "media", "play", "ai"]);

// Validate an untrusted def. Returns error strings; empty array = valid.
export function validateDef(def: unknown): string[] {
  const errors: string[] = [];
  const d = def as Partial<BankWidgetDef>;
  if (!d || typeof d !== "object") return ["not an object"];
  if (!d.id || !/^[a-z0-9-]{2,60}$/.test(d.id)) errors.push("id must be kebab-case [a-z0-9-]");
  if (!d.title || typeof d.title !== "string" || d.title.length > 40) errors.push("title required (max 40 chars)");
  if (!d.description || typeof d.description !== "string" || d.description.length > 160) errors.push("description required (max 160 chars)");
  if (d.color && !COLORS.has(d.color)) errors.push(`unknown color "${d.color}"`);
  if (d.category && !CATEGORIES.has(d.category)) errors.push(`unknown category "${d.category}"`);
  const fields = new Map((Array.isArray(d.config) ? d.config : []).filter(f => f && typeof f.key === "string").map(f => [f.key, f]));
  const url = d.fetch?.url;
  const own = typeof url === "string" ? OWN_URL.exec(url) : null;
  if (typeof url !== "string" || url.length > 1000) errors.push("fetch.url required");
  else if (own) {
    if (fields.get(own[1])?.type !== "url") errors.push(`fetch.url starts with {config.${own[1]}}, which must be a setting of type "url"`);
  } else if (!/^https:\/\/[^{}\s/]+(\/|$)/.test(url)) errors.push('fetch.url must be https with a fixed host, or start with a "url" setting like {config.url}/');
  const checkPlaceholders = (what: string, text: string, afterOwn: boolean) => {
    for (const m of text.matchAll(PLACEHOLDER)) {
      const name = m[1];
      if (/^date(?:[+-]\d{1,4})?$/.test(name)) continue;
      const key = name.startsWith("config.") ? name.slice(7) : "";
      const f = fields.get(key);
      if (!f) errors.push(`${what}: unknown placeholder {${name}}`);
      // An address may only stand at the very start of fetch.url.
      else if (f.type === "url" && !(afterOwn && m.index === 0)) errors.push(`${what}: {${name}} is an address and may only start fetch.url`);
    }
  };
  if (typeof url === "string") checkPlaceholders("fetch.url", url, !!own);
  if (d.fetch?.headers !== undefined) {
    const h = d.fetch.headers;
    if (!h || typeof h !== "object" || Array.isArray(h) || Object.keys(h).length > 10) errors.push("fetch.headers must be an object with at most 10 entries");
    else for (const [name, value] of Object.entries(h)) {
      if (!/^[A-Za-z0-9-]{1,40}$/.test(name) || /^(host|cookie|content-length|transfer-encoding|connection)$/i.test(name)) errors.push(`fetch.headers: "${name}" is not allowed`);
      else if (typeof value !== "string" || value.length > 500 || /[\r\n]/.test(value)) errors.push(`fetch.headers.${name} must be one line of text`);
      else checkPlaceholders(`fetch.headers.${name}`, value, false);
    }
  }
  if (!d.items && !Array.isArray(d.layout)) errors.push("provide items (list shorthand) or layout (primitives)");
  if (Array.isArray(d.layout)) {
    for (const [i, p] of d.layout.entries()) {
      if (!p || typeof p !== "object" || !PRIMITIVES.has((p as { component?: string }).component ?? "")) {
        errors.push(`layout[${i}]: unknown component "${(p as { component?: string })?.component}"`);
      }
    }
  }
  if (d.config) {
    for (const [i, f] of d.config.entries()) {
      if (!f.key || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(f.key)) errors.push(`config[${i}].key invalid`);
      if (!["text", "number", "select", "url", "secret"].includes(f.type)) errors.push(`config[${i}].type invalid`);
      if (f.type === "secret" && f.default !== undefined) errors.push(`config[${i}]: a secret cannot have a default`);
    }
  }
  return errors;
}

// The effective layout: the `items` shorthand compiles to one list primitive.
export function effectiveLayout(def: BankWidgetDef): BankPrimitive[] {
  if (def.layout?.length) return def.layout;
  if (def.items) return [{ component: "list", ...def.items }];
  return [];
}

// ── Path resolution ──────────────────────────────────────────────────────────

// "a.b[0].c" → walk; root "$" refers to the whole document.
function walkPath(obj: unknown, path: string): unknown {
  if (path === "$" || path === "") return obj;
  let cur: unknown = obj;
  for (const raw of path.split(".")) {
    if (cur == null) return undefined;
    const m = raw.match(/^([^[\]]*)((?:\[\d+\])*)$/);
    if (!m) return undefined;
    const key = m[1];
    if (key) cur = (cur as Record<string, unknown>)[key];
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(idx[1])];
    }
  }
  return cur;
}

const TRANSFORMS: Record<string, (v: unknown) => string> = {
  count: v => formatCount(Number(v) || 0),
  date: v => formatDate(v as string | number),
  dateShort: v => formatDate(v as string | number, { year: false }),
  timeAgo: v => timeAgo(v as string | number),
  clock: v => formatClock(Number(v) || 0),
  duration: v => formatDuration(Number(v) || 0),
  // 1536 -> "1.5 KB"; for sizes a service reports in bytes.
  bytes: v => {
    let n = Number(v);
    if (!Number.isFinite(n) || n < 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${i === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
  },
  // 99.52 -> "99.5%"
  percent: v => (Number.isFinite(Number(v)) && v !== null && v !== "" ? `${Math.round(Number(v) * 10) / 10}%` : ""),
  // 0 stays "0" (count drops it), for totals where zero is an answer.
  number: v => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v).toLocaleString("en-US") : ""),
  upper: v => String(v ?? "").toUpperCase(),
  lower: v => String(v ?? "").toLowerCase(),
};

// Resolve a value expression against data: "$.path | transform" or a literal.
// Non-string literals (numbers) pass through. "a || b" takes the first
// alternative that is not empty, so a missing field can fall back to another
// ("$.url || $.comments_url") or to a literal ("$.name || unnamed").
export function resolveValue(expr: unknown, data: unknown): unknown {
  if (typeof expr !== "string") return expr;
  if (!expr.includes("||")) return resolveOne(expr, data);
  const alternatives = expr.split("||").map(s => s.trim());
  for (const alt of alternatives) {
    const v = resolveOne(alt, data);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function resolveOne(expr: string, data: unknown): unknown {
  const [head, ...pipes] = expr.split("|").map(s => s.trim());
  let value: unknown;
  if (head.startsWith("$.")) value = walkPath(data, head.slice(2));
  else if (head === "$") value = data;
  else return expr; // plain literal string
  for (const p of pipes) {
    const t = TRANSFORMS[p];
    if (t) value = t(value);
  }
  return value;
}

export function resolveText(expr: unknown, data: unknown): string {
  const v = resolveValue(expr, data);
  if (v == null) return "";
  if (typeof v === "object") return "";
  return String(v);
}

// ── Requests ─────────────────────────────────────────────────────────────────
const PLACEHOLDER = /\{([^{}]*)\}/g;
// fetch.url that starts with one of the user's own addresses.
const OWN_URL = /^\{config\.([a-zA-Z][a-zA-Z0-9]*)\}(?=\/|$)/;

export const secretKeys = (def: BankWidgetDef): string[] => (def.config ?? []).filter(f => f.type === "secret").map(f => f.key);
// True when the def needs the server to hold something or reach the user's
// own service (the request then cannot be cached or replayed by others).
export const usesOwnService = (def: BankWidgetDef): boolean => OWN_URL.test(def.fetch.url);

function shiftDate(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Fills {config.key} and {date}, {date+N}, {date-N}. `encode`: values are
// escaped for use inside a URL (headers are filled as they are, on one line).
export function fillPlaceholders(template: string, config: Record<string, string | number>, today: string, encode: boolean): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const date = /^date(?:([+-])(\d{1,4}))?$/.exec(name);
    let raw: string;
    if (date) raw = shiftDate(today, date[1] ? (date[1] === "-" ? -1 : 1) * Number(date[2]) : 0);
    else if (name.startsWith("config.")) raw = String(config[name.slice(7)] ?? "");
    else return whole;
    return encode ? encodeURIComponent(raw) : raw.replace(/[\r\n]/g, "");
  });
}

// The request a def makes with these settings. `own` is true when it goes to
// an address the user typed (their own service), which the server may reach
// on the home network for admin accounts; a fixed address is always a public
// one. Returns an error string when a needed setting is missing.
export function buildRequest(def: BankWidgetDef, config: Record<string, string | number>, today: string): { url: string; headers: Record<string, string>; own: boolean } | { error: string } {
  for (const f of def.config ?? []) {
    if ((f.type === "url" || f.type === "secret") && !String(config[f.key] ?? "").trim()) return { error: `Fill in "${f.label}" in the settings.` };
  }
  const own = OWN_URL.exec(def.fetch.url);
  let url: string;
  if (own) {
    const base = String(config[own[1]] ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s/?#]+/i.test(base)) return { error: "The address must start with http:// or https://." };
    url = base + fillPlaceholders(def.fetch.url.slice(own[0].length), config, today, true);
  } else {
    url = fillPlaceholders(def.fetch.url, config, today, true);
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(def.fetch.headers ?? {})) headers[name] = fillPlaceholders(value, config, today, false);
  return { url, headers, own: !!own };
}
