import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { fetchForUser } from "@/lib/ssrf";
import { assertPower, libraryPath, readTicket } from "@/lib/customWidgetsServer";

// GET ?t=<ticket> -> the media or library file the ticket names
// (lib/customWidgetsServer.ts). No session: a custom widget's frame has none,
// so the signed ticket is the permission, and it is checked again here that
// the widget may still use the power. Range requests pass through, so audio
// and video can seek.
//
// The answer is only ever media or a download: a body that a browser would
// run as a page of this site is sent as an opaque file, sandboxed.

const SAFE_TYPE = /^(?:audio\/[\w.+-]+|video\/[\w.+-]+|image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)|application\/(?:pdf|epub\+zip|ogg))$/;

function baseHeaders(): Headers {
  return new Headers({
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "attachment",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
    "Cache-Control": "private, max-age=3600",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
}

const refuse = (status: number, message: string) => new NextResponse(message, { status, headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" } });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
}

export async function GET(request: NextRequest) {
  const ticket = readTicket(request.nextUrl.searchParams.get("t"));
  if (!ticket) return refuse(403, "This link has expired.");
  const user = await prisma.user.findUnique({ where: { id: ticket.u }, select: { id: true, role: true } });
  if (!user) return refuse(403, "This link has expired.");
  try {
    await assertPower(user.id, ticket.x, ticket.k === "net" ? "network" : "files");
  } catch {
    return refuse(403, "This widget may no longer do that.");
  }
  const range = request.headers.get("range");

  if (ticket.k === "file") {
    const file = libraryPath(user.id, ticket.path);
    const info = file ? await stat(file).catch(() => null) : null;
    if (!file || !info?.isFile()) return refuse(404, "Not found");
    const headers = baseHeaders();
    headers.set("Content-Type", file.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/epub+zip");
    headers.set("Accept-Ranges", "bytes");
    let start = 0, end = info.size - 1, status = 200;
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
      else start = Math.max(0, info.size - Number(m[2]));
      if (start > end || start >= info.size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}`, "Access-Control-Allow-Origin": "*" } });
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    }
    headers.set("Content-Length", String(end - start + 1));
    return new NextResponse(Readable.toWeb(createReadStream(file, { start, end })) as unknown as BodyInit, { status, headers });
  }

  let res: Response;
  try {
    const reqHeaders: Record<string, string> = { ...(ticket.h ?? {}) };
    if (range) reqHeaders.Range = range;
    const ifRange = request.headers.get("if-range");
    if (ifRange) reqHeaders["If-Range"] = ifRange;
    res = await fetchForUser(user, ticket.url, { headers: reqHeaders, signal: request.signal, cache: "no-store" });
  } catch {
    return refuse(503, "Could not reach that address.");
  }
  if (!res.body || (!res.ok && res.status !== 206)) {
    await res.body?.cancel().catch(() => {});
    return refuse(res.status === 416 ? 416 : res.status === 404 ? 404 : 503, "The media could not be loaded.");
  }
  const headers = baseHeaders();
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  headers.set("Content-Type", SAFE_TYPE.test(type) ? type : "application/octet-stream");
  for (const h of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(res.body, { status: res.status, headers });
}
