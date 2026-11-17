import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/http";
import { readServerStats } from "@/lib/serverStats";

// GET /api/server-stats: processor, memory, disk and uptime of the machine
// running the dashboard. Admin only: it describes the owner's server.
export async function GET(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(await readServerStats(), { headers: { "Cache-Control": "no-store" } });
}
