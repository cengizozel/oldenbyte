import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "fs";
import { mkdir, readdir, stat, unlink, readFile } from "fs/promises";
import path from "path";
import busboy from "busboy";
import { Readable } from "stream";
import { requireUser, ClientError, errorResponse, readJsonBody } from "@/lib/http";
import { fileRoomLeft } from "@/lib/quota";

// Per-user reader library: a real folder of PDFs and EPUBs (with subfolders)
// that the reader widget browses, uploads into, and reads from. Files keep
// their names, unlike /api/upload's uuid blobs, so the folder can also be
// filled from outside (rsync, docker cp) and just show up.
const libraryDir = process.env.LIBRARY_DIR ?? path.join(process.cwd(), "data", "library");

const EXT = /\.(pdf|epub)$/i;

// Resolve a user-supplied relative path inside the user's library root, or null
// when it tries to escape (.. segments, absolute paths).
function resolveSafe(userRoot: string, rel: string): string | null {
  const target = path.resolve(userRoot, rel);
  return target === userRoot || target.startsWith(userRoot + path.sep) ? target : null;
}

function cleanName(name: string): string {
  return path.basename(name).replace(/[\\/:*?"<>|\0]/g, "_").trim();
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const sp = request.nextUrl.searchParams;
  const op = sp.get("op") ?? "list";
  const rel = sp.get("path") ?? "";
  const userRoot = path.resolve(libraryDir, user.id);
  const target = resolveSafe(userRoot, rel);
  if (!target) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  if (op === "list") {
    let entries;
    try {
      entries = await readdir(target, { withFileTypes: true });
    } catch {
      // A user who never uploaded has no folder yet: an empty library, not an
      // error. (Listing used to create it, a write on a GET.)
      if (target === userRoot) return NextResponse.json({ dirs: [], files: [] });
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    const dirs: string[] = [];
    const files: { name: string; size: number }[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) dirs.push(e.name);
      else if (e.isFile() && EXT.test(e.name)) {
        const s = await stat(path.join(target, e.name)).catch(() => null);
        files.push({ name: e.name, size: s?.size ?? 0 });
      }
    }
    dirs.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ dirs, files });
  }

  if (op === "file") {
    if (!EXT.test(target)) return new NextResponse("Not found", { status: 404 });
    let data: Uint8Array;
    try {
      data = new Uint8Array(await readFile(target));
    } catch {
      return new NextResponse("Not found", { status: 404 });
    }
    const contentType = target.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/epub+zip";
    // Cast: a Uint8Array is a valid response body at runtime; the mismatch is
    // only the @types/node ArrayBufferLike vs DOM ArrayBuffer generic.
    // private: book files may be cached by the reader's browser (fullscreen
    // opens a second viewer of the same file) but never by shared caches.
    return new NextResponse(data as unknown as BodyInit, {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
    });
  }

  return NextResponse.json({ error: "Unknown op" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const userRoot = path.resolve(libraryDir, user.id);
  const contentType = request.headers.get("content-type") ?? "";

  // {op:"mkdir", path, name} → create a subfolder
  if (contentType.includes("application/json")) {
    const body = await readJsonBody(request);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const { op, path: rel, name } = body;
    if (op !== "mkdir") return NextResponse.json({ error: "Unknown op" }, { status: 400 });
    const clean = cleanName(String(name ?? ""));
    if (!clean) return NextResponse.json({ error: "Missing folder name" }, { status: 400 });
    const parent = resolveSafe(userRoot, String(rel ?? ""));
    if (!parent) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    await mkdir(path.join(parent, clean), { recursive: true });
    return NextResponse.json({ ok: true });
  }

  // multipart upload: file + dir (the subfolder it goes to)
  try {
    if (!contentType.startsWith("multipart/form-data")) throw new ClientError("Expected a multipart upload.");
    const room = await fileRoomLeft(user);
    const bb = busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: Math.min(100 * 1024 * 1024, room), files: 1 },
    });

    const result = await new Promise<{ name: string; path: string }>((resolve, reject) => {
      let dir = "";
      let resolved = false;
      let sawFile = false;
      bb.on("field", (field, value) => { if (field === "dir") dir = value; });
      bb.on("file", (_field, stream, info) => {
        sawFile = true;
        const name = cleanName(info.filename);
        if (!EXT.test(name)) {
          stream.resume();
          reject(new ClientError("Only PDF and EPUB files are supported.", 415));
          return;
        }
        const parent = resolveSafe(userRoot, dir);
        if (!parent) {
          stream.resume();
          reject(new ClientError("Invalid folder."));
          return;
        }
        mkdir(parent, { recursive: true }).then(() => {
          const filePath = path.join(parent, name);
          const dest = createWriteStream(filePath);
          stream.pipe(dest);
          stream.on("limit", () => {
            dest.destroy();
            unlink(filePath).catch(() => {});
            reject(new ClientError(room < 100 * 1024 * 1024 ? "Not enough storage quota left for this file." : "File too large (max 100MB)", 413));
          });
          dest.on("finish", () => {
            if (!resolved) { resolved = true; resolve({ name, path: dir ? `${dir}/${name}` : name }); }
          });
          dest.on("error", reject);
          stream.on("error", reject);
        }).catch(reject);
      });
      bb.on("error", reject);
      // A body with no file part never reaches the "file" handler; without
      // this the request would hang until the platform timeout.
      bb.on("close", () => {
        if (!sawFile) reject(new ClientError("No file in the upload."));
      });
      const nodeStream = Readable.fromWeb(request.body as import("stream/web").ReadableStream);
      nodeStream.pipe(bb);
    });

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "library", "Upload failed.");
  }
}
