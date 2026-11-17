# Markets Widget

Stocks, indices, currency pairs and crypto: the last price, the change since the previous close, and today's trend as a small line with the previous close marked as a dashed level.

## Storage Keys

| Key | Value |
|---|---|
| `markets-widget-{id}` | JSON: `{ entries: { symbol, label }[] }` |

- `symbol` - as on Yahoo Finance: `AAPL` (a stock), `BTC-USD` (crypto), `^GSPC` (an index), `EURUSD=X` (a currency pair)
- `label` - an optional name of your own, shown above the instrument's name

## Behaviour

- Prices come from Yahoo Finance's public chart endpoint through `/api/markets` (no API key). Each symbol is cached on the server like the feeds; the refresh button forces a fresh fetch, and the widget asks again every five minutes while its dashboard is showing.
- Prices are shown in the decimals the instrument is quoted in (two for a stock, four for a currency pair).
- A symbol Yahoo does not know shows "unknown symbol" in its row; the others still load.
- Up is green, down is red; the figures carry a plus or minus too, so color is never the only signal.

Not digestable.

(component: `components/MarketsWidget.tsx`, server: `lib/markets.ts`, `app/api/markets/route.ts`)
