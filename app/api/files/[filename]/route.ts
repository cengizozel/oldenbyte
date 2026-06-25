import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { requireUser } from "@/lib/http";

const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const { filename } = await params;

  // Only allow UUID-based filenames with pdf/epub extension
  if (!/^[0-9a-f-]{36}\.(pdf|epub)$/i.test(filename)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = ext === "pdf" ? "application/pdf" : "application/epub+zip";

  let data: Uint8Array;
  try {
    data = new Uint8Array(await readFile(path.join(uploadsDir, user.id, filename)));
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  // Cast: a Uint8Array is a valid response body at runtime; the mismatch is only
  // the @types/node ArrayBufferLike vs DOM ArrayBuffer generic.
  return new NextResponse(data as unknown as BodyInit, {
    headers: { "Content-Type": contentType },
  });
}
