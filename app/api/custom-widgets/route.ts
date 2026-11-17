import { NextRequest, NextResponse } from "next/server";
import { json, badRequest, bodyTooLarge, readJsonBody, requireUser, errorResponse } from "@/lib/http";
import { fileRoomLeft } from "@/lib/quota";
import { MAX_WIDGET_BYTES } from "@/lib/customWidgets";
import { accountElevated, install, listInstalled, remove, setEnabled } from "@/lib/customWidgetsServer";

// Custom widgets (docs/custom-widgets.md).
// GET                     -> { widgets: [installed], elevated: the account's switches }
// POST { html }           -> adds or replaces one of the user's own widget files
// PATCH { ext, enabled }  -> switches an elevated widget on or off
// DELETE ?ext=            -> removes a widget file (its instances keep their data)

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  return json({ widgets: await listInstalled(user.id), elevated: await accountElevated(user.id) });
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  if (bodyTooLarge(request, MAX_WIDGET_BYTES * 2)) return json({ error: "That file is too large for a widget." }, 413);
  const body = await readJsonBody(request);
  if (!body || typeof body.html !== "string") return badRequest();
  try {
    if ((await fileRoomLeft(user)) < Buffer.byteLength(body.html)) return json({ error: "Not enough storage left for this widget." }, 413);
    return json({ ok: true, widget: await install(user.id, "yours", body.html) });
  } catch (e) {
    return errorResponse(e, "custom-widgets");
  }
}

export async function PATCH(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = await readJsonBody(request);
  if (!body || typeof body.ext !== "string" || typeof body.enabled !== "boolean") return badRequest();
  try {
    return json({ ok: true, widget: await setEnabled(user.id, body.ext, body.enabled) });
  } catch (e) {
    return errorResponse(e, "custom-widgets");
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const ext = request.nextUrl.searchParams.get("ext") ?? "";
  if (!(await remove(user.id, ext))) return json({ error: "Not found" }, 404);
  return json({ ok: true });
}
