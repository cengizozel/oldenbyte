import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { loadBank } from "@/lib/widgetBankServer";

// Serve the community widget bank: every valid JSON def in widget-bank/.
// Invalid files are skipped and reported so a bad PR can't break the picker.
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const { widgets, errors } = await loadBank();
  return NextResponse.json({ widgets, errors });
}
