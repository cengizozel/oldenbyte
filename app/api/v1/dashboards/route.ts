import { NextRequest, NextResponse } from "next/server";
import { v1, dashboardsFor } from "@/lib/apiV1";
import { requireUser } from "@/lib/http";

// GET /api/v1/dashboards: every dashboard with its widgets in reading order,
// for an app's navigation. A widget's own data is read from its settings
// keys (/api/v1/settings), documented per widget in docs/widgets/.
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  return v1({ dashboards: await dashboardsFor(user.id) });
}
