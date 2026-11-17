import { NextRequest, NextResponse } from "next/server";
import { json, badRequest, readJsonBody, requireUser, errorResponse, tooMany, ClientError } from "@/lib/http";
import { actAs, userFetch } from "@/lib/requestUser";
import { rateLimit } from "@/lib/ratelimit";
import { MEDIA_PATH } from "@/lib/customWidgets";
import { assertPower, cleanHeaders, isLibraryFile, issueTicket, libraryPath, listLibrary, listUserWidgets } from "@/lib/customWidgetsServer";
import { readWidgetData } from "@/lib/widgetData";

// What an elevated custom widget asks the server to do (docs/custom-widgets.md).
// The dashboard calls this for the widget's frame, which has no session of
// its own. Every op checks its power first: installed, switched on, declared
// in the manifest, and allowed by the account right now.
//
// POST { ext, op, args }
//   net.fetch    { url, options: { method, headers, body, as } } -> { ok, status, headers, body }
//   net.media    { url, options: { headers } }                   -> { url } (a ticket address for <audio>, <video>, <img>)
//   widgets.list                                                 -> { widgets }
//   widgets.read { id }                                          -> { text }
//   files.list   { path }                                        -> { dirs, files }
//   files.url    { path }                                        -> { url }

const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_BODY = 256 * 1024;
const TIMEOUT_MS = 20_000;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const PASS_HEADERS = ["content-type", "content-length", "etag", "last-modified", "link", "retry-after", "x-total-count"];

const httpUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > 4000) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

async function readCapped(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_RESPONSE) {
      await reader.cancel().catch(() => {});
      throw new ClientError(`The response is larger than ${MAX_RESPONSE / 1024 / 1024} MB. Use ob.net.mediaUrl for media.`, 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  actAs(user);
  const limit = rateLimit(`custom-widget:${user.id}`, 600, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);

  const body = await readJsonBody(request);
  if (!body || typeof body.ext !== "string" || typeof body.op !== "string") return badRequest();
  const ext = body.ext;
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  const options = (args.options && typeof args.options === "object" ? args.options : {}) as Record<string, unknown>;

  try {
    switch (body.op) {
      case "net.fetch": {
        await assertPower(user.id, ext, "network");
        const url = httpUrl(args.url);
        if (!url) return badRequest("The address must start with http:// or https://.");
        const method = typeof options.method === "string" ? options.method.toUpperCase() : "GET";
        if (!METHODS.has(method)) return badRequest("That request method is not allowed.");
        const reqBody = typeof options.body === "string" ? options.body : undefined;
        if (reqBody && reqBody.length > MAX_BODY) return json({ error: "The request body is too large." }, 413);
        let res: Response;
        try {
          res = await userFetch(url, {
            method,
            headers: cleanHeaders(options.headers),
            body: method === "GET" || method === "HEAD" ? undefined : reqBody,
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: "no-store",
          });
        } catch (e) {
          // Not an oldenbyte failure: the widget gets it as a failed request.
          return json({ ok: false, status: 0, headers: {}, body: "", error: String(e instanceof Error ? e.message : e) });
        }
        const bytes = method === "HEAD" ? new Uint8Array() : await readCapped(res);
        const headers: Record<string, string> = {};
        for (const h of PASS_HEADERS) { const v = res.headers.get(h); if (v) headers[h] = v; }
        const as = options.as === "base64" ? "base64" : "text";
        return json({
          ok: res.ok, status: res.status, headers,
          body: as === "base64" ? Buffer.from(bytes).toString("base64") : new TextDecoder().decode(bytes),
        });
      }
      case "net.media": {
        await assertPower(user.id, ext, "network");
        const url = httpUrl(args.url);
        if (!url) return badRequest("The address must start with http:// or https://.");
        const t = issueTicket({ k: "net", u: user.id, x: ext, url, h: cleanHeaders(options.headers) });
        return json({ url: `${MEDIA_PATH}?t=${t}` });
      }
      case "widgets.list": {
        await assertPower(user.id, ext, "widgets");
        return json({ widgets: await listUserWidgets(user.id) });
      }
      case "widgets.read": {
        await assertPower(user.id, ext, "widgets");
        const w = (await listUserWidgets(user.id)).find(x => x.id === args.id);
        if (!w) return json({ error: "No such widget." }, 404);
        const today = typeof args.today === "string" ? args.today : undefined;
        const timezone = typeof args.timezone === "string" ? args.timezone : undefined;
        return json({ text: await readWidgetData(user.id, w.id, w.type, w.title, { today, timezone }) });
      }
      case "files.list": {
        await assertPower(user.id, ext, "files");
        return json(await listLibrary(user.id, typeof args.path === "string" ? args.path : ""));
      }
      case "files.url": {
        await assertPower(user.id, ext, "files");
        const rel = typeof args.path === "string" ? args.path : "";
        if (!rel || !libraryPath(user.id, rel) || !isLibraryFile(rel)) return badRequest("No such file.");
        return json({ url: `${MEDIA_PATH}?t=${issueTicket({ k: "file", u: user.id, x: ext, path: rel })}` });
      }
      default:
        return badRequest("Unknown op.");
    }
  } catch (e) {
    return errorResponse(e, "custom-widgets/call");
  }
}
