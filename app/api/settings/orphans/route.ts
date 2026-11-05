import { NextRequest, NextResponse } from "next/server";
import { json, badRequest, requireUser } from "@/lib/http";
import { deleteOrphan, findOrphans } from "@/lib/orphans";

// Leftover data of widgets that are on no dashboard any more (lib/gc.ts).
// GET lists it per removed widget; DELETE removes one widget's keys. Shown in
// the edit shelf next to export and import.

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const orphans = await findOrphans(user.id);
  return json({
    orphans: orphans.map(o => ({ id: o.id, keys: o.keys.length, bytes: o.bytes, lastWrite: o.lastWrite.toISOString() })),
  });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const instance = request.nextUrl.searchParams.get("instance");
  if (!instance) return badRequest("Missing instance");
  const deleted = await deleteOrphan(user.id, instance);
  return json({ ok: true, deleted });
}
