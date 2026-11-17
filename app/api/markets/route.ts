import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { cachedFeed } from "@/lib/feedCache";
import { fetchQuote, SYMBOL_RE, type Quote } from "@/lib/markets";

// GET /api/markets?symbols=AAPL,BTC-USD[&refresh=1]
// One entry per symbol, in the order asked: a quote, or { symbol, error }.
// Each symbol is cached on the server like the feeds (lib/feedCache).
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "")
    .split(",").map(s => s.trim().toUpperCase()).filter(s => SYMBOL_RE.test(s)).slice(0, 25);
  if (!symbols.length) return NextResponse.json({ error: "Missing symbols" }, { status: 400 });
  const force = request.nextUrl.searchParams.get("refresh") === "1";

  const settled = await Promise.allSettled(symbols.map(s => cachedFeed<Quote>(`market|${s}`, () => fetchQuote(s), force)));
  return NextResponse.json(settled.map((r, i) =>
    r.status === "fulfilled" ? r.value : { symbol: symbols[i], error: String(r.reason?.message ?? r.reason) }
  ));
}
