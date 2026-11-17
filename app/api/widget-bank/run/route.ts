import { NextRequest, NextResponse } from "next/server";
import { json, badRequest, readJsonBody, requireUser, tooMany } from "@/lib/http";
import { actAs, userFetch } from "@/lib/requestUser";
import { safeFetch, readCappedText } from "@/lib/ssrf";
import { rateLimit } from "@/lib/ratelimit";
import { buildRequest } from "@/lib/widgetBank";
import { findDef, readSecrets, validInstance } from "@/lib/widgetBankServer";

// Makes a widget file's request (docs/widget-bank.md).
// POST { bankId, instance, config, today } -> { data } (the parsed JSON)
//
// The server builds the request from the definition, the settings the
// browser sends, and the secrets it holds itself, so an API key never passes
// through the browser again after it was saved. A fixed address is fetched as
// a public one only. An address the user typed (their own service) is fetched
// like every other integration: the home network for admin accounts only.

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  actAs(user);
  const limit = rateLimit(`widget-bank:${user.id}`, 300, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);

  const body = await readJsonBody(request);
  const def = await findDef(body?.bankId);
  if (!body || !def) return json({ error: "That widget file is not installed." }, 404);
  if (!validInstance(body.instance)) return badRequest();

  // Settings from the browser, never its idea of a secret.
  const config: Record<string, string | number> = {};
  const sent = (body.config && typeof body.config === "object" ? body.config : {}) as Record<string, unknown>;
  for (const f of def.config ?? []) {
    if (f.type === "secret") continue;
    const v = sent[f.key];
    config[f.key] = typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? v.slice(0, 2000) : f.default ?? "";
  }
  Object.assign(config, await readSecrets(user.id, body.instance));

  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const req = buildRequest(def, config, today);
  if ("error" in req) return json({ error: req.error, setup: true }, 400);

  try {
    const res = req.own
      ? await userFetch(req.url, { headers: { Accept: "application/json", ...req.headers }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" })
      : await safeFetch(req.url, { headers: { "User-Agent": "curl/7.68.0", Accept: "application/json", ...req.headers }, timeoutMs: TIMEOUT_MS });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      return json({ error: "The service refused the key or sign-in. Check the settings." }, 503);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return json({ error: `The service answered ${res.status}.` }, 503);
    }
    const text = await readCappedText(res, MAX_BYTES);
    try {
      return json({ data: JSON.parse(text) });
    } catch {
      return json({ error: "The answer was not JSON. Check the address." }, 503);
    }
  } catch (err) {
    // The message of a failed fetch never contains the request's headers.
    const message = String(err instanceof Error ? err.message : err);
    return json({ error: /private address/i.test(message) ? "Only an admin account can reach an address on the home network." : "Could not reach the service." }, 503);
  }
}
