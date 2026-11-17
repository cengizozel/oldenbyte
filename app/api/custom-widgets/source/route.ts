import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { readSource } from "@/lib/customWidgetsServer";

// GET ?ext= -> the widget file, as plain text. The dashboard puts it in a
// sandboxed frame; it is never served as a page of this site.
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const html = await readSource(user.id, request.nextUrl.searchParams.get("ext") ?? "");
  if (html === null) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(html, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
  });
}
