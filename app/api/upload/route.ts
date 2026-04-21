import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, mkdir } from "fs";
import { promisify } from "util";
import path from "path";
import { randomUUID } from "crypto";
import busboy from "busboy";
import { Readable } from "stream";

const mkdirAsync = promisify(mkdir);
const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");

export async function POST(request: NextRequest) {
  try {
    await mkdirAsync(uploadsDir, { recursive: true });

    const contentType = request.headers.get("content-type") ?? "";
    const bb = busboy({ headers: { "content-type": contentType } });

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
        const dest = createWriteStream(path.join(uploadsDir, filename));
        stream.pipe(dest);
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
