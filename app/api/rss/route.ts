import { NextRequest, NextResponse } from "next/server";
import { fetchFeed } from "@/lib/rss";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "5"), 20);

  if (!url || !url.startsWith("http")) {
    return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });
  }

  try {
    return NextResponse.json(await fetchFeed(url, limit, request.signal));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
