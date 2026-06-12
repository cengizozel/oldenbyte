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
import type { WidgetColor } from "@/lib/widgets";

export type BankConfigField = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  default?: string | number;
  options?: { value: string; label: string }[]; // for type "select"
  placeholder?: string;
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
  defaultSize?: { w: number; h: number };
  digestable?: boolean;          // default false for community widgets
  config?: BankConfigField[];
  fetch: {
    url: string;                 // https only; {config.key} placeholders allowed
    cacheMinutes?: number;       // client cache TTL, default 60
    headers?: Record<string, string>;
  };
  // Shorthand for the common case: a plain mapped list. Compiles to one
  // list primitive. Provide either `items` or `layout`.
  items?: Omit<BankListBlock, "component">;
  layout?: BankPrimitive[];
};

const PRIMITIVES = new Set(["label", "list", "stat-row", "progress-bar", "badge-list", "image", "divider", "sparkline"]);
const COLORS = new Set(["amber", "sky", "neutral", "rose", "teal", "orange"]);

// Validate an untrusted def. Returns error strings; empty array = valid.
export function validateDef(def: unknown): string[] {
  const errors: string[] = [];
  const d = def as Partial<BankWidgetDef>;
  if (!d || typeof d !== "object") return ["not an object"];
  if (!d.id || !/^[a-z0-9-]{2,60}$/.test(d.id)) errors.push("id must be kebab-case [a-z0-9-]");
  if (!d.title || typeof d.title !== "string" || d.title.length > 40) errors.push("title required (max 40 chars)");
  if (!d.description || typeof d.description !== "string" || d.description.length > 160) errors.push("description required (max 160 chars)");
  if (d.color && !COLORS.has(d.color)) errors.push(`unknown color "${d.color}"`);
  if (!d.fetch?.url || !/^https:\/\//.test(d.fetch.url)) errors.push("fetch.url required and must be https");
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
      if (!["text", "number", "select"].includes(f.type)) errors.push(`config[${i}].type invalid`);
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
  upper: v => String(v ?? "").toUpperCase(),
  lower: v => String(v ?? "").toLowerCase(),
};

// Resolve a value expression against data: "$.path | transform" or a literal.
// Non-string literals (numbers) pass through.
export function resolveValue(expr: unknown, data: unknown): unknown {
  if (typeof expr !== "string") return expr;
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

// "{config.key}" interpolation for fetch URLs.
export function interpolateUrl(url: string, config: Record<string, string | number>): string {
  return url.replace(/\{config\.([a-zA-Z][a-zA-Z0-9]*)\}/g, (_m, key: string) =>
    encodeURIComponent(String(config[key] ?? ""))
  );
}
