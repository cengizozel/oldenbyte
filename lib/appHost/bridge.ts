// What the bundled interface needs from wherever it runs (docs/app-bundle.md):
// a place to keep keys and values. In the phone app that is the app's own
// database, reached by messages to the native side; in a plain browser (used
// to try the bundle) it is the browser's storage.

export type Bridge = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
};

// ── The phone app ────────────────────────────────────────────────────────────
// The page posts { ob: "kv", id, op, key, value } to the app, which answers by
// calling window.__obReply(id, result).
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
  const call = (op: string, key?: string, value?: string) => new Promise<unknown>((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, [resolve, reject]);
    rn.postMessage(JSON.stringify({ ob: "kv", id, op, key, value }));
  });
  return {
    get: async key => ((await call("get", key)) as string | null) ?? null,
    set: async (key, value) => { await call("set", key, value); },
    remove: async key => { await call("remove", key); },
    keys: async () => ((await call("keys")) as string[]) ?? [],
  };
}

// ── A plain browser ──────────────────────────────────────────────────────────
const PREFIX = "ob:";
const browserBridge: Bridge = {
  get: async key => window.localStorage.getItem(PREFIX + key),
  set: async (key, value) => { window.localStorage.setItem(PREFIX + key, value); },
  remove: async key => { window.localStorage.removeItem(PREFIX + key); },
  keys: async () => Object.keys(window.localStorage).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length)),
};

export function pickBridge(): Bridge {
  const rn = (window as AppWindow).ReactNativeWebView;
  return rn ? nativeBridge(rn) : browserBridge;
}
