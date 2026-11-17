import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/http";
import { listContainers } from "@/lib/docker";

// GET /api/docker: the containers on the Docker host, for the Docker widget.
// Admin only, and only when the operator has connected Docker (lib/docker).
export async function GET(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;
  try {
    return NextResponse.json({ containers: await listContainers() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const notConnected = (err as { code?: string })?.code === "NOT_CONNECTED";
    return NextResponse.json(
      { error: notConnected ? "not_connected" : String((err as Error)?.message ?? err) },
      { status: notConnected ? 404 : 502 },
    );
  }
}
