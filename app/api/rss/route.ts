import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { parseFeed } from "@/lib/rss";
import { safeFetch } from "@/lib/ssrf";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const url = request.nextUrl.searchParams.get("url");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "5"), 20);

  if (!url || !url.startsWith("http")) {
    return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });
  }

  try {
    // User-supplied feed URL = SSRF risk: safeFetch validates the host (and every
    // redirect hop) against private/loopback/metadata addresses before fetching.
    const res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return NextResponse.json(parseFeed(await res.text(), limit));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
