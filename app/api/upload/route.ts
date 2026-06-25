import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "fs";
import { mkdir, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import busboy from "busboy";
import { Readable } from "stream";
import { requireUser } from "@/lib/http";

const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const userDir = path.join(uploadsDir, user.id);
    await mkdir(userDir, { recursive: true });

    const contentType = request.headers.get("content-type") ?? "";
    const bb = busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    });

    const result = await new Promise<{ filename: string }>((resolve, reject) => {
      let resolved = false;

      bb.on("file", (_field, stream, info) => {
        const ext = info.filename.split(".").pop()?.toLowerCase();
        if (ext !== "pdf" && ext !== "epub") {
          stream.resume();
          reject(new Error("Only PDF and EPUB files are supported."));
          return;
        }

        const filename = `${randomUUID()}.${ext}`;
        const filePath = path.join(userDir, filename);
        const dest = createWriteStream(filePath);
        stream.pipe(dest);

        stream.on("limit", () => {
          dest.destroy();
          unlink(filePath).catch(() => {});
          reject(new Error("File too large (max 50MB)"));
        });
        dest.on("finish", () => {
          if (!resolved) { resolved = true; resolve({ filename }); }
        });
        dest.on("error", reject);
        stream.on("error", reject);
      });

      bb.on("error", reject);

      // Pipe the request body as a Node.js stream into busboy
      const nodeStream = Readable.fromWeb(request.body as import("stream/web").ReadableStream);
      nodeStream.pipe(bb);
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[upload]", err);
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
