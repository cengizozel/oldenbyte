// What the bundled interface needs from wherever it runs (docs/app-bundle.md):
// a place to keep keys and values, and a way out to the internet that is not
// held back by the browser's cross-origin rule. In the phone app both are the
// app's own (its database, its network), reached by messages to the native
// side; in a plain browser (used to try the bundle) they are the browser's
// storage and the browser's fetch.

// A value with the count that changes on every write, so a page can tell that
// a key moved on since it read it, as on a server.
export type Held = { value: string; version: number; updatedAt: number };
export type Row = Held & { key: string };

export type Bridge = {
  get(key: string): Promise<Held | null>;
  // Writes the value. With `expect`, only if the key is still at that
  // version; otherwise it answers ok: false with the version it is at.
  set(key: string, value: string, expect?: number): Promise<{ ok: boolean; version: number }>;
  remove(key: string): Promise<void>;
  // Every key that starts with the prefix, with its value.
  list(prefix: string): Promise<Row[]>;
  // A request made by the app itself. Absent in a plain browser.
  fetch?: (url: string, init: NetInit) => Promise<NetReply>;
};

export type NetInit = { method: string; headers: [string, string][]; body?: string; bodyBase64?: string };
// The body comes back as text, or as base64 when it is not text.
export type NetReply = { status: number; statusText: string; headers: [string, string][]; text?: string; base64?: string };

// ── The phone app ────────────────────────────────────────────────────────────
// The page posts { ob: "kv" | "fetch", id, ... } to the app, which answers by
// calling window.__obReply(id, result, error).
type RN = { postMessage: (m: string) => void };
type AppWindow = Window & { ReactNativeWebView?: RN; __obReply?: (id: number, result: unknown, error?: string) => void };

function nativeBridge(rn: RN): Bridge {
  const waiting = new Map<number, [(v: unknown) => void, (e: Error) => void]>();
  let seq = 0;
  (window as AppWindow).__obReply = (id, result, error) => {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    if (error) w[1](new Error(error)); else w[0](result);
  };
  const call = (message: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, [resolve, reject]);
    rn.postMessage(JSON.stringify({ ...message, id }));
  });
  return {
    get: async key => ((await call({ ob: "kv", op: "get", key })) as Held | null) ?? null,
    set: async (key, value, expect) => (await call({ ob: "kv", op: "set", key, value, expect })) as { ok: boolean; version: number },
    remove: async key => { await call({ ob: "kv", op: "remove", key }); },
    list: async prefix => ((await call({ ob: "kv", op: "list", key: prefix })) as Row[]) ?? [],
    fetch: async (url, init) => (await call({ ob: "fetch", url, ...init })) as NetReply,
  };
}

// ── A plain browser ──────────────────────────────────────────────────────────
// Each key is kept as { v: write count, s: value, t: when }.
const PREFIX = "ob:";
const read = (key: string): Held | null => {
  try {
    const o = JSON.parse(window.localStorage.getItem(PREFIX + key) ?? "null") as { v: number; s: string; t?: number } | null;
    return o && typeof o.s === "string" && typeof o.v === "number" ? { value: o.s, version: o.v, updatedAt: o.t ?? 0 } : null;
  } catch {
    return null;
  }
};
const browserBridge: Bridge = {
  get: async key => read(key),
  set: async (key, value, expect) => {
    const old = read(key);
    if (typeof expect === "number" && old && old.version !== expect) return { ok: false, version: old.version };
    const version = (old?.version ?? 0) + 1;
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ v: version, s: value, t: Date.now() }));
    return { ok: true, version };
  },
  remove: async key => { window.localStorage.removeItem(PREFIX + key); },
  list: async prefix => Object.keys(window.localStorage)
    .filter(k => k.startsWith(PREFIX + prefix))
    .map(k => { const key = k.slice(PREFIX.length); const held = read(key); return held ? { key, ...held } : null; })
    .filter((r): r is Row => r !== null),
};

export function pickBridge(): Bridge {
  const rn = (window as AppWindow).ReactNativeWebView;
  return rn ? nativeBridge(rn) : browserBridge;
}

// Bytes as base64 and back, for bodies that are not text.
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
