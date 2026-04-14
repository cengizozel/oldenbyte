import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "epub") {
      return NextResponse.json({ error: "Only PDF and EPUB files are supported." }, { status: 400 });
    }

    await mkdir(uploadsDir, { recursive: true });

    const filename = `${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadsDir, filename), buffer);

    return NextResponse.json({ filename });
  } catch {
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
