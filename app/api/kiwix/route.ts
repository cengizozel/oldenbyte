import { NextRequest, NextResponse } from "next/server";
import { isValidBase, listSources, search, articleExtract } from "@/lib/kiwix";

// Server-side proxy to a kiwix-serve instance (https://github.com/kiwix/kiwix-tools).
// Running it server-side avoids CORS and mixed-content blocking when the dashboard
// is served over HTTPS but kiwix-serve runs on plain http on the LAN/Tailnet. The
// fetching + XML parsing lives in lib/kiwix.ts so the Chat route can reuse it.
// Modes:
//   GET ?baseUrl=…                          → list sources (ZIMs) from the catalog
//   GET ?baseUrl=…&source=…&q=…&limit=N     → full-text search within one source
//   GET ?baseUrl=…&article=<url>            → fetch + extract one article's text

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const baseUrl = p.get("baseUrl");
  if (!isValidBase(baseUrl)) {
    return NextResponse.json({ error: "Missing or invalid baseUrl" }, { status: 400 });
  }
  const q = p.get("q");
  const article = p.get("article");

  // ── Fetch an article and extract a readable text summary ────────────────────
  if (article) {
    try {
      return NextResponse.json({ extract: await articleExtract(baseUrl, article, request.signal) });
    } catch (err) {
      return NextResponse.json({ error: `Could not load article: ${String(err)}` }, { status: 502 });
    }
  }

  // ── List sources ────────────────────────────────────────────────────────────
  if (!q) {
    try {
      return NextResponse.json({ sources: await listSources(baseUrl, request.signal) });
    } catch (err) {
      return NextResponse.json({ error: `Could not list sources: ${String(err)}` }, { status: 502 });
    }
  }

  // ── Search within a source ──────────────────────────────────────────────────
  const source = p.get("source");
  if (!source) {
    return NextResponse.json({ error: "Missing source" }, { status: 400 });
  }
  const limit = Number(p.get("limit")) || 8;
  try {
    return NextResponse.json({ results: await search(baseUrl, source, q, limit, request.signal) });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
