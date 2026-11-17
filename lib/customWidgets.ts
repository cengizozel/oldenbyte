// Custom widgets (docs/custom-widgets.md): one HTML file with its manifest
// inside, written by anyone, uploaded by the user or installed from the
// community catalog. This module is the format and the sandbox; it runs in
// the browser and on the server. lib/customWidgetsServer.ts keeps the files.
//
// The widget's code is never trusted. It runs in a frame that has an origin
// of its own (no session, no dashboard) and a policy that blocks every
// request, so everything it does goes through messages to the dashboard,
// which decides by the widget's tier:
//   standard: its own storage, its settings, the theme, opening a link.
//   elevated: the powers its manifest declares, each one switched on by the
//             user for the account first (Settings > Custom widgets).

import type { WidgetColor, WidgetCategory } from "@/lib/widgets";

export const CUSTOM_FORMAT = 1;
export const MAX_WIDGET_BYTES = 512_000;
export const MAX_USER_WIDGETS = 50;

// What an elevated widget may ask for.
export const POWERS = ["network", "widgets", "files"] as const;
export type Power = (typeof POWERS)[number];
export const POWER_LABEL: Record<Power, string> = {
  network: "Network",
  widgets: "Your other widgets",
  files: "Your file library",
};
export const POWER_DETAIL: Record<Power, string> = {
  network: "It can send and receive anything, to and from any address your account can reach. For an admin account that includes the home network.",
  widgets: "It can read what your other widgets show. It cannot change them.",
  files: "It can list and read the books and documents in your library. It cannot change them.",
};

export type CustomField = {
  key: string;
  label: string;
  type: "text" | "secret" | "number" | "select" | "toggle" | "textarea";
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
};

export type CustomManifest = {
  format: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  license?: string;
  color?: WidgetColor;
  category?: WidgetCategory;
  defaultSize?: { w: number; h: number };
  icon?: string;
  settings?: CustomField[];
  powers?: Power[];
  // The widget publishes a short text of what it shows (ob.summary), which
  // the Assistant and the digest may read.
  digest?: boolean;
};

// Where a custom widget came from. The id a dashboard stores is
// "<source>/<manifest id>", so an upload can never pose as a catalog widget.
export type CustomSource = "yours" | "community";
export const extId = (source: CustomSource, id: string) => `${source}/${id}`;
export function parseExtId(ext: unknown): { source: CustomSource; id: string } | null {
  const m = typeof ext === "string" ? /^(yours|community)\/([a-z0-9][a-z0-9-]{1,39})$/.exec(ext) : null;
  return m ? { source: m[1] as CustomSource, id: m[2] } : null;
}
// The same id as a picker template id (instance ids are built from it).
export const templateIdOf = (ext: string) => ext.replace("/", "-");

export type InstalledWidget = {
  ext: string;
  source: CustomSource;
  manifest: CustomManifest;
  bytes: number;
  installedAt: number;
  // Elevated widgets run only while switched on; standard ones always are.
  enabled: boolean;
};

// The account's switches for elevated widgets. Everything is off until the
// user turns it on; `allow` is the master switch.
export const ELEVATED_KEY = "elevated-widgets";
export type ElevatedSettings = { allow: boolean } & Record<Power, boolean>;
export const ELEVATED_OFF: ElevatedSettings = { allow: false, network: false, widgets: false, files: false };
export function parseElevated(raw: string | null | undefined): ElevatedSettings {
  if (!raw) return ELEVATED_OFF;
  try {
    const v = JSON.parse(raw) as Partial<ElevatedSettings>;
    return { allow: v.allow === true, network: v.network === true, widgets: v.widgets === true, files: v.files === true };
  } catch {
    return ELEVATED_OFF;
  }
}
// The powers a widget asks for that the account's switches do not cover.
export function missingPowers(powers: Power[] | undefined, account: ElevatedSettings): Power[] {
  return (powers ?? []).filter(p => !account.allow || !account[p]);
}

const COLORS = new Set(["amber", "sky", "neutral", "rose", "teal", "orange"]);
const CATEGORIES = new Set(["feeds", "notes", "links", "time", "habits", "live", "library", "server", "media", "play", "ai"]);
const FIELD_TYPES = new Set(["text", "secret", "number", "select", "toggle", "textarea"]);
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,30}$/;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(v);

// Validates an untrusted manifest. Returns error strings; none means valid.
export function validateManifest(def: unknown): string[] {
  if (!def || typeof def !== "object" || Array.isArray(def)) return ["the manifest is not an object"];
  const d = def as Partial<CustomManifest>;
  const errors: string[] = [];
  if (d.format !== CUSTOM_FORMAT) errors.push(`format must be ${CUSTOM_FORMAT}`);
  if (typeof d.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(d.id)) errors.push("id must be 2 to 40 characters of a-z, 0-9 and -");
  if (!text(d.name, 40)) errors.push("name required (max 40 characters)");
  if (!text(d.description, 160)) errors.push("description required (max 160 characters)");
  if (typeof d.version !== "string" || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(d.version)) errors.push('version must look like "1.0.0"');
  if (d.author !== undefined && !text(d.author, 60)) errors.push("author must be text (max 60 characters)");
  if (d.license !== undefined && !text(d.license, 40)) errors.push("license must be text (max 40 characters)");
  if (d.homepage !== undefined && (typeof d.homepage !== "string" || d.homepage.length > 300 || !/^https:\/\/[^\s]+$/.test(d.homepage))) errors.push("homepage must be an https address");
  if (d.color !== undefined && !COLORS.has(d.color)) errors.push(`unknown color "${d.color}"`);
  if (d.category !== undefined && !CATEGORIES.has(d.category)) errors.push(`unknown category "${d.category}"`);
  if (d.defaultSize !== undefined) {
    const s = d.defaultSize;
    if (!s || !Number.isInteger(s.w) || !Number.isInteger(s.h) || s.w < 1 || s.w > 4 || s.h < 1 || s.h > 8) errors.push("defaultSize must be { w: 1 to 4, h: 1 to 8 }");
  }
  if (d.icon !== undefined && (typeof d.icon !== "string" || d.icon.length > 8000 || !/^\s*<svg[\s>]/i.test(d.icon))) errors.push("icon must be an SVG (max 8000 characters)");
  if (d.digest !== undefined && typeof d.digest !== "boolean") errors.push("digest must be true or false");
  if (d.powers !== undefined) {
    if (!Array.isArray(d.powers) || d.powers.some(p => !POWERS.includes(p)) || new Set(d.powers).size !== d.powers.length) errors.push(`powers must be a list from: ${POWERS.join(", ")}`);
  }
  if (d.settings !== undefined) {
    if (!Array.isArray(d.settings) || d.settings.length > 20) errors.push("settings must be a list of at most 20 fields");
    else {
      const keys = new Set<string>();
      for (const [i, f] of d.settings.entries()) {
        const at = `settings[${i}]`;
        if (!f || typeof f !== "object") { errors.push(`${at} must be an object`); continue; }
        if (typeof f.key !== "string" || !KEY.test(f.key) || keys.has(f.key)) errors.push(`${at}.key is invalid or repeated`);
        else keys.add(f.key);
        if (!text(f.label, 40)) errors.push(`${at}.label required (max 40 characters)`);
        if (!FIELD_TYPES.has(f.type)) errors.push(`${at}.type must be one of: ${[...FIELD_TYPES].join(", ")}`);
        for (const k of ["placeholder", "hint"] as const) if (f[k] !== undefined && (typeof f[k] !== "string" || f[k]!.length > 200)) errors.push(`${at}.${k} must be text (max 200 characters)`);
        if (f.type === "select") {
          if (!Array.isArray(f.options) || f.options.length < 2 || f.options.length > 30 || f.options.some(o => !o || typeof o.value !== "string" || o.value.length > 100 || !text(o.label, 40))) errors.push(`${at}.options must list 2 to 30 { value, label } choices`);
        }
        if (f.default !== undefined) {
          const want = f.type === "toggle" ? "boolean" : f.type === "number" ? "number" : "string";
          if (typeof f.default !== want || (typeof f.default === "string" && f.default.length > 2000)) errors.push(`${at}.default must be a ${want}`);
        }
      }
    }
  }
  return errors;
}

// The manifest sits in the file as
//   <script type="application/json" id="oldenbyte-widget"> { ... } </script>
const MANIFEST_TAG = /<script\b(?=[^>]*\bid\s*=\s*["']oldenbyte-widget["'])(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/i;

export type ParsedWidget = { manifest: CustomManifest; errors: string[] } | { manifest: null; errors: string[] };

// Reads and validates the manifest of a widget file.
export function parseWidgetFile(html: unknown): ParsedWidget {
  if (typeof html !== "string" || !html.trim()) return { manifest: null, errors: ["the file is empty"] };
  if (html.length > MAX_WIDGET_BYTES) return { manifest: null, errors: [`the file is larger than ${Math.round(MAX_WIDGET_BYTES / 1000)} KB`] };
  const m = MANIFEST_TAG.exec(html);
  if (!m) return { manifest: null, errors: ['no manifest found: the file needs a <script type="application/json" id="oldenbyte-widget"> block'] };
  let def: unknown;
  try { def = JSON.parse(m[1]); } catch { return { manifest: null, errors: ["the manifest is not valid JSON"] }; }
  const errors = validateManifest(def);
  return errors.length ? { manifest: null, errors } : { manifest: def as CustomManifest, errors: [] };
}

// The icon as a CSS mask image. Only ever painted as a mask, so nothing in
// the SVG can run or load.
export function iconMask(manifest: CustomManifest | undefined): string | null {
  return manifest?.icon ? `url("data:image/svg+xml,${encodeURIComponent(manifest.icon)}")` : null;
}

// A setting's value as the widget receives it: what the user saved, else the
// field's default, in the field's type.
export function settingValues(manifest: CustomManifest, saved: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of manifest.settings ?? []) {
    const v = saved?.[f.key];
    if (f.type === "toggle") out[f.key] = typeof v === "boolean" ? v : f.default === true;
    else if (f.type === "number") out[f.key] = typeof v === "number" && Number.isFinite(v) ? v : typeof f.default === "number" ? f.default : 0;
    else if (f.type === "select") {
      const allowed = (f.options ?? []).map(o => o.value);
      out[f.key] = typeof v === "string" && allowed.includes(v) ? v : typeof f.default === "string" && allowed.includes(f.default) ? f.default : allowed[0] ?? "";
    } else out[f.key] = typeof v === "string" ? v.slice(0, 4000) : typeof f.default === "string" ? f.default : "";
  }
  return out;
}

// ── Storage keys ─────────────────────────────────────────────────────────────
// Per instance: its settings and the list of data keys it wrote, each data
// key, and its published summary (lib/settingKeys.ts knows these families).
export const configKey = (instanceId: string) => `ext-widget-${instanceId}`;
export const dataKey = (instanceId: string, key: string) => `ext-data-${instanceId}:${key}`;
export const summaryKey = (instanceId: string) => `ext-summary-${instanceId}`;
export const DATA_KEY = /^[A-Za-z0-9._-]{1,64}$/;
export const MAX_DATA_KEYS = 100;
export const MAX_DATA_VALUE = 256_000;
export const MAX_SUMMARY = 4000;

// ── The sandbox ──────────────────────────────────────────────────────────────

// The only address a widget's frame may load from: oldenbyte's ticket route,
// which serves a media file or a library file the dashboard issued a ticket
// for (and nothing else, so it is no way to send data out).
export const MEDIA_PATH = "/api/custom-widgets/media";

export function framePolicy(origin: string): string {
  const media = `${origin}${MEDIA_PATH}`;
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src data: blob: ${media}`,
    `media-src data: blob: ${media}`,
    "font-src data:",
    `connect-src ${media}`,
    // The widget cannot frame anything, and (because this policy belongs to
    // the outer frame too) cannot navigate itself to another site.
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

export type FrameLook = { dark: boolean; text: string; muted: string; bg: string; border: string };
export type FrameInit = {
  instance: { id: string; title: string };
  widget: { id: string; name: string; version: string };
  settings: Record<string, string | number | boolean>;
  powers: Power[];
  theme: FrameLook;
  visible: boolean;
};

const inScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// The script every widget starts with: the `ob` object. It only posts
// messages to the dashboard and waits for replies; it holds no secret.
function sdk(init: FrameInit): string {
  return `(function(){
var init=${inScript(init)},pending={},seq=0,handlers={};
function call(op,args){return new Promise(function(res,rej){var id=++seq;pending[id]=[res,rej];parent.postMessage({ob:1,id:id,op:op,args:args===undefined?null:args},"*")})}
function emit(name,value){(handlers[name]||[]).slice().forEach(function(fn){try{fn(value)}catch(e){setTimeout(function(){throw e})}})}
function paint(t){var s=document.documentElement.style;s.setProperty("--text",t.text);s.setProperty("--muted",t.muted);s.setProperty("--bg",t.bg);s.setProperty("--border",t.border);s.colorScheme=t.dark?"dark":"light";document.documentElement.classList.toggle("dark",!!t.dark)}
addEventListener("message",function(e){
  if(e.source!==parent)return;var d=e.data;if(!d||d.ob!==1)return;
  if(d.reply){var p=pending[d.reply];delete pending[d.reply];if(p){if(d.error)p[1](new Error(d.error));else p[0](d.result)}return}
  if(d.event==="theme"){ob.theme=d.value;paint(d.value)}
  else if(d.event==="settings"){ob.settings=d.value}
  else if(d.event==="visible"){ob.visible=!!d.value}
  else if(d.event==="title"){ob.instance.title=String(d.value)}
  if(d.event)emit(d.event,d.value);
});
var ob={
  version:1,
  instance:init.instance,widget:init.widget,settings:init.settings,powers:init.powers,theme:init.theme,visible:init.visible,
  on:function(name,fn){(handlers[name]=handlers[name]||[]).push(fn);call("listen",name).catch(function(){});return function(){handlers[name]=(handlers[name]||[]).filter(function(f){return f!==fn})}},
  storage:{
    get:function(key){return call("storage.get",{key:key})},
    set:function(key,value){return call("storage.set",{key:key,value:value})},
    remove:function(key){return call("storage.remove",{key:key})},
    keys:function(){return call("storage.keys")}
  },
  open:function(url){return call("open",{url:String(url)})},
  badge:function(text){return call("badge",{text:text==null?"":String(text)})},
  summary:function(text){return call("summary",{text:text==null?"":String(text)})},
  net:{
    fetch:function(url,options){return call("net.fetch",{url:String(url),options:options||{}})},
    mediaUrl:function(url,options){return call("net.media",{url:String(url),options:options||{}})}
  },
  widgets:{
    list:function(){return call("widgets.list")},
    read:function(id){return call("widgets.read",{id:String(id)})}
  },
  files:{
    list:function(path){return call("files.list",{path:path==null?"":String(path)})},
    url:function(path){return call("files.url",{path:String(path)})}
  }
};
Object.defineProperty(window,"ob",{value:ob});
paint(init.theme);
})();`;
}

const BASE_STYLE = `html,body{margin:0;background:transparent}
body{font:14px/1.5 Arial,Helvetica,sans-serif;color:var(--text);overflow-wrap:anywhere}
a{color:inherit}
button,input,select,textarea{font:inherit;color:inherit}`;

// The widget's own document: the base look, the `ob` object, then the file.
export function innerDocument(html: string, init: FrameInit): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLE}</style><script>${sdk(init)}</script></head><body>${html}</body></html>`;
}

// What the dashboard puts in its iframe: an outer frame that carries the
// policy and only passes messages along, with the widget in a frame inside
// it. Two frames because a frame may always navigate itself: here the
// widget's frame answers to the outer frame's policy, which forbids it, and
// the outer frame runs none of the widget's code.
export function frameDocument(html: string, init: FrameInit, origin: string): string {
  const inner = innerDocument(html, init);
  return `<!doctype html><html style="color-scheme:${init.theme.dark ? "dark" : "light"}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${framePolicy(origin)}">
<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%;background:transparent}</style></head><body><script>
(function(){
var f=document.createElement("iframe");
f.setAttribute("sandbox","allow-scripts");
f.setAttribute("title","widget");
f.setAttribute("allow","autoplay");
f.style.colorScheme=${inScript(init.theme.dark ? "dark" : "light")};
f.srcdoc=${inScript(inner)};
document.body.appendChild(f);
addEventListener("message",function(e){
  if(e.source===f.contentWindow)parent.postMessage(e.data,"*");
  else if(e.source===parent){
    var d=e.data;
    if(d&&d.ob===1&&d.event==="theme"){var s=d.value&&d.value.dark?"dark":"light";document.documentElement.style.colorScheme=s;f.style.colorScheme=s}
    if(f.contentWindow)f.contentWindow.postMessage(d,"*");
  }
});
})();
</script></body></html>`;
}

// The outer iframe's sandbox attribute. No allow-same-origin (an origin of
// its own), no popups, no forms, no top navigation.
export const FRAME_SANDBOX = "allow-scripts";
