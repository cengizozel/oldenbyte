import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { assertPublicUrl, readCappedText, safeFetch } from "@/lib/ssrf";

const MAX_BYTES = 1024 * 1024;

// Fetches a public URL as plain text for the top bar's live text fields. Each
// redirect hop is re-checked by safeFetch, and the body is capped at 1 MB.
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "Invalid or disallowed URL" }, { status: 400 });

  try {
    await assertPublicUrl(raw);
  } catch {
    return NextResponse.json({ error: "Invalid or disallowed URL" }, { status: 400 });
  }

  try {
    const res = await safeFetch(raw, { headers: { "User-Agent": "curl/7.68.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await readCappedText(res, MAX_BYTES)).trim();
    return new NextResponse(text, { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
