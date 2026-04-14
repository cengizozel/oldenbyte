import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    // Only allow UUID-based filenames with pdf/epub extension
    if (!/^[0-9a-f-]{36}\.(pdf|epub)$/i.test(filename)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const filePath = path.join(uploadsDir, filename);
    const buffer = await readFile(filePath);
    const ext = filename.split(".").pop()?.toLowerCase();
    const contentType = ext === "pdf" ? "application/pdf" : "application/epub+zip";

    return new NextResponse(buffer, {
      headers: { "Content-Type": contentType },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
