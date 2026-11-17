// The oldenbyte API, answered on the device (docs/app-bundle.md).
//
// The bundled interface asks for "/api/..." exactly as it does on a server.
// When there is no server those requests come here, and the answers have the
// same shape, built from what is kept on the device. This file grows route by
// route; a route that is not here yet answers 501 with a plain message, which
// the widget shows as its own error, never a made-up result.
import type { Bridge } from "./bridge";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// Every key is stored as { v: write count, s: value }, so the page's
// "has this changed since I read it" check works as on a server.
type Stored = { v: number; s: string };
const parse = (raw: string | null): Stored | null => {
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw) as Stored;
    return typeof o?.s === "string" && typeof o.v === "number" ? o : null;
  } catch {
    return null;
  }
};

export function localApi(bridge: Bridge) {
  async function settings(method: string, url: URL, body: unknown): Promise<Response> {
    const tail = url.pathname.slice("/api/settings".length);
    if (tail === "/export" && method === "GET") {
      const out: Record<string, string> = {};
      for (const key of await bridge.keys()) { const s = parse(await bridge.get(key)); if (s) out[key] = s.s; }
      return json(out);
    }
    if (tail === "/import" && method === "POST") {
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid format" }, 400);
      let n = 0;
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (typeof value !== "string" || !key || key.length > 256) continue;
        const old = parse(await bridge.get(key));
        await bridge.set(key, JSON.stringify({ v: (old?.v ?? 0) + 1, s: value }));
        n++;
      }
      return json({ ok: true, imported: n });
    }
    if (tail === "/orphans") return json({ orphans: [] });
    if (tail !== "") return json({ error: "Not available on this device yet." }, 501);

    if (method === "GET") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "Missing key" }, 400);
      const s = parse(await bridge.get(key));
      return json(s ? { value: s.s, version: s.v } : { value: null });
    }
    if (method === "POST") {
      const { key, value, version } = (body ?? {}) as { key?: unknown; value?: unknown; version?: unknown };
      if (typeof key !== "string" || !key || key.length > 256) return json({ error: "Invalid key" }, 400);
      if (typeof value !== "string" || value.length > 1_000_000) return json({ error: "Invalid value" }, 400);
      const old = parse(await bridge.get(key));
      if (typeof version === "number" && old && old.v !== version) {
        return json({ error: "changed in another tab, reload to see the latest", conflict: true, version: old.v }, 409);
      }
      const v = (old?.v ?? 0) + 1;
      await bridge.set(key, JSON.stringify({ v, s: value }));
      return json({ ok: true, version: v });
    }
    if (method === "DELETE") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "Missing key" }, 400);
      await bridge.remove(key);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  // One request in, one answer out, like the server.
  return async function handle(input: string, init?: RequestInit): Promise<Response> {
    const url = new URL(input, "http://device.local");
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === "string") { try { body = JSON.parse(init.body); } catch { body = undefined; } }
    const path = url.pathname;
    try {
      if (path === "/api/settings" || path.startsWith("/api/settings/")) return await settings(method, url, body);
      // The one person this device belongs to.
      if (path === "/api/me") return json({ id: "device", username: "you", role: "admin", mustChangePassword: false, local: true });
      if (path === "/api/auth/state") return json({ needsSetup: false, registrationEnabled: false, hasInvite: false });
      // Nothing installed from outside on a device yet.
      if (path === "/api/widget-bank") return json({ widgets: [], errors: {} });
      if (path === "/api/addons") return json({ addons: [], errors: {} });
      if (path === "/api/custom-widgets") return json({ widgets: [], elevated: { allow: false, network: false, widgets: false, files: false } });
      if (path === "/api/custom-widgets/catalog") return json({ widgets: [], off: true });
      if (path === "/api/v1/devices") return json({ devices: [] });
      return json({ error: "This needs an oldenbyte server for now." }, 501);
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 500);
    }
  };
}
