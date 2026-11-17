import { NextRequest, NextResponse } from "next/server";
import { v1 } from "@/lib/apiV1";
import { requireUser } from "@/lib/http";
import { revokeDevice } from "@/lib/devices";

// DELETE /api/v1/devices/<id>: signs that device out (a lost phone). Only
// the account's own devices; another account's id reads as not found.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!(await revokeDevice(user.id, id))) return v1({ error: "Not found" }, 404);
  return v1({ ok: true });
}
