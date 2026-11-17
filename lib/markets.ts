import { safeFetch, readCappedText } from "@/lib/ssrf";

// Quotes for the Markets widget, from Yahoo Finance's public chart endpoint
// (no key; the same source other dashboards use). One call per symbol returns
// the last price, the previous close and today's intraday points for the
// trend line. Symbols follow Yahoo: AAPL, BTC-USD, ^GSPC, EURUSD=X.

export type Quote = {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  digits: number;     // decimals this instrument is quoted in (2 for a stock, 4 for a currency pair)
  points: number[];   // today's closes, oldest first, for the trend line
};

export const SYMBOL_RE = /^[A-Za-z0-9.^=\-]{1,15}$/;

// Yahoo's JSON to a Quote; null when the payload has no usable price.
// Exported for tests.
export function parseChart(data: unknown, symbol: string): Quote | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (data as any)?.chart?.result?.[0];
  const m = r?.meta;
  const price = Number(m?.regularMarketPrice);
  const prevClose = Number(m?.chartPreviousClose ?? m?.previousClose);
  if (!m || !Number.isFinite(price)) return null;
  const closes: unknown[] = r?.indicators?.quote?.[0]?.close ?? [];
  const points = closes.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const base = Number.isFinite(prevClose) && prevClose > 0 ? prevClose : price;
  return {
    symbol: String(m.symbol ?? symbol).toUpperCase(),
    name: String(m.shortName ?? m.longName ?? m.symbol ?? symbol),
    currency: String(m.currency ?? ""),
    price,
    prevClose: base,
    change: price - base,
    changePct: base ? ((price - base) / base) * 100 : 0,
    digits: Number.isInteger(m.priceHint) && m.priceHint >= 0 && m.priceHint <= 8 ? m.priceHint : 2,
    points,
  };
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const res = await safeFetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=15m`,
    { headers: { "User-Agent": "Mozilla/5.0 (compatible; oldenbyte dashboard)" } },
  );
  const text = await readCappedText(res, 512 * 1024);
  let data: unknown = null;
  try { data = JSON.parse(text); } catch {}
  const quote = parseChart(data, symbol);
  if (!quote) throw new Error(res.status === 404 ? "Unknown symbol" : `No quote (HTTP ${res.status})`);
  return quote;
}
