import { NextRequest, NextResponse } from "next/server";
import { json, badRequest, readJsonBody, requireUser, errorResponse } from "@/lib/http";
import { fileRoomLeft } from "@/lib/quota";
import { parseWidgetFile } from "@/lib/customWidgets";
import { install } from "@/lib/customWidgetsServer";
import { fetchCatalogWidget, loadCatalog } from "@/lib/widgetCatalog";

// The community catalog (docs/custom-widgets.md).
// GET [?refresh=1] -> { widgets: [catalog entries], off? }
// POST { id }      -> downloads that widget and installs it as community/<id>

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  try {
    const { entries, url } = await loadCatalog(request.nextUrl.searchParams.get("refresh") === "1");
    return json({ widgets: entries, off: url === null });
  } catch (e) {
    return errorResponse(e, "custom-widgets/catalog", "The community catalog could not be loaded.");
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = await readJsonBody(request);
  if (!body || typeof body.id !== "string") return badRequest();
  try {
    const html = await fetchCatalogWidget(body.id);
    const parsed = parseWidgetFile(html);
    if (!parsed.manifest || parsed.manifest.id !== body.id) return json({ error: "The catalog lists a file that is not this widget." }, 409);
    if ((await fileRoomLeft(user)) < Buffer.byteLength(html)) return json({ error: "Not enough storage left for this widget." }, 413);
    return json({ ok: true, widget: await install(user.id, "community", html) });
  } catch (e) {
    return errorResponse(e, "custom-widgets/catalog");
  }
}
