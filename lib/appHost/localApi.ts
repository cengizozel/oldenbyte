// The oldenbyte API, answered on the device (docs/app-bundle.md).
//
// The bundled interface asks for "/api/..." exactly as it does on a server.
// When there is no server those requests come here. Most are answered by the
// server's own route code, packed into the bundle and run on stand-ins for the
// database, the session and the network (lib/appHost/device), so a device
// answers as a server would. A few that only make sense on a server (signing
// in, accounts, other devices) are answered here, and a route that is not
// packed answers 501 with a plain message, which the widget shows as its own
// error, never a made-up result.
import { NextRequest } from "next/server";
import type { Bridge } from "./bridge";
import { routes } from "./routes";
import { DEVICE_USER, setBridge } from "./runtime";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export function localApi(bridge: Bridge) {
  setBridge(bridge);

  // One request in, one answer out, like the server.
  return async function handle(input: string, init?: RequestInit): Promise<Response> {
    const url = new URL(input, window.location.origin);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/\/+$/, "");
    try {
      // The one person this device belongs to.
      if (path === "/api/me") return json({ ...DEVICE_USER, local: true, device: true });
      if (path === "/api/auth/state") return json({ needsSetup: false, registrationEnabled: false, hasInvite: false });
      if (path === "/api/v1/devices") return json({ devices: [] });

      for (const [pattern, names, load] of routes) {
        const m = pattern.exec(path);
        if (!m) continue;
        const handler = (await load())[method];
        if (!handler) return json({ error: "Method not allowed" }, 405);
        const params: Record<string, string> = {};
        names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
        const request = new NextRequest(url, { method, headers: init?.headers, body: method === "GET" || method === "HEAD" ? undefined : init?.body, signal: init?.signal ?? undefined });
        return await handler(request, { params: Promise.resolve(params) });
      }
      return json({ error: "This needs an oldenbyte server." }, 501);
    } catch (e) {
      console.error("device route failed:", path, e);
      return json({ error: String(e instanceof Error ? e.message : e) }, 500);
    }
  };
}
