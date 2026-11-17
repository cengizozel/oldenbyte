import { NextRequest, NextResponse } from "next/server";
import { json, badRequest, readJsonBody, requireUser } from "@/lib/http";
import { actAs } from "@/lib/requestUser";
import { addonValues } from "@/lib/addons";
import { resolveValue } from "@/lib/widgetBank";
import { findAddon, addonFetch, addonScope, serverBase } from "@/lib/addonsServer";

// Makes an add-on's requests (docs/addons.md). Server-side, like /api/kiwix:
// the service usually lives on the home network over plain http. POST so the
// user's values (a token among them) ride in the body, never in a URL or an
// access log.
//
// { id, op: "ping", values }               -> { ok, version }
// { id, op: "has", values, ids, force? }   -> { has: string[] } (subset of ids)

const MAX_IDS = 100;
const CONCURRENCY = 6;

// Per-video answers. The two age differently on purpose: a video that is
// there stays there, but "not there" goes stale the moment a download
// finishes, so it is only trusted briefly. `force` (the widget's refresh
// button) skips the memory entirely.
const HIT_MS = 60 * 60 * 1000;
const MISS_MS = 2 * 60 * 1000;
const known = new Map<string, { at: number; has: boolean }>();

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  actAs(user);

  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string") return badRequest();
  const addon = await findAddon(user.id, body.id);
  if (!addon) return json({ error: "That add-on is not installed." }, 404);
  const values = addonValues(addon, body.values);
  if (!values) return badRequest(`Fill in the ${addon.name} settings.`);

  try {
    if (body.op === "ping") {
      if (!addon.ping) return json({ ok: true, version: "" });
      const res = await addonFetch(addon.ping, values, null, request.signal);
      if (res.status === 401 || res.status === 403) throw new Error(`${addon.name} rejected the sign-in details`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      const ok = addon.ping.ok ? String(resolveValue(addon.ping.ok.path, data) ?? "") === addon.ping.ok.equals : true;
      if (!ok) throw new Error(`That address answered, but not like ${addon.name}`);
      const version = addon.ping.version ? resolveValue(addon.ping.version, data) : "";
      return json({ ok: true, version: typeof version === "string" || typeof version === "number" ? String(version).slice(0, 40) : "" });
    }

    if (body.op === "has") {
      const list = (Array.isArray(body.ids) ? body.ids : [])
        .filter((id): id is string => typeof id === "string" && /^[\w-]{6,20}$/.test(id))
        .slice(0, MAX_IDS);
      // No question to ask: the service has every video.
      const has = addon.has;
      if (!has) return json({ has: list });
      const found = has.found ?? [200];
      const missing = has.missing ?? [404];
      const scope = addonScope(addon, values);
      const out: string[] = [];
      let next = 0;
      async function worker() {
        while (next < list.length) {
          const id = list[next++];
          const key = `${scope}|${id}`;
          const hit = known.get(key);
          let there = hit?.has ?? false;
          if (body!.force === true || !hit || Date.now() - hit.at >= (hit.has ? HIT_MS : MISS_MS)) {
            try {
              const res = await addonFetch(has!, values!, id);
              if (missing.includes(res.status)) there = false;
              else if (found.includes(res.status)) there = true;
              else throw new Error(`HTTP ${res.status}`);
              if (known.size > 5000) known.clear();
              known.set(key, { at: Date.now(), has: there });
            } catch {
              // Service unreachable: keep the last known answer.
            }
          }
          if (there) out.push(id);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
      return json({ has: out });
    }

    return badRequest("Unknown op");
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    // The usual cause: a tailscale HTTPS address works in the browser but not
    // from inside the server's container.
    const friendly = msg === "fetch failed"
      ? `Can't reach ${addon.name} at ${serverBase(values)} from the dashboard server. If that is a tailscale HTTPS address, set the server address to its LAN address.`
      : msg;
    return json({ error: friendly }, 503);
  }
}
