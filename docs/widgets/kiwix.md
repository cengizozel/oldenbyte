# Kiwix Widget

Search an offline [Kiwix](https://kiwix.org/) library (Wikipedia, Stack Overflow, iFixit, etc.) served by a local `kiwix-serve`, with an inline article preview.

## Storage Keys

| Key | Value |
|---|---|
| `kiwix-widget-{id}` | JSON: `{ baseUrl, source, sourceTitle, limit }` |

- `baseUrl` - the `kiwix-serve` root (e.g. `http://kiwix.lan:3702`). Must be reachable from wherever the dashboard server runs.
- `source` / `sourceTitle` - the selected ZIM book id and its display title. (Older configs used `book` / `bookTitle`; both field names are read for back-compat.)
- `limit` - number of search results (default 8).

## Behaviour / Reachability

- The settings card loads the server's sources (ZIMs) from its catalog; the saved source is kept if it still exists, otherwise the first one is picked. Switching source clears the old results.
- Clicking a result opens an inline preview (a plain-text extract of the article's lead paragraphs); the external-link icon opens the full article in kiwix-serve.
- Search, source listing and article fetch go through the server-side [`/api/kiwix`](../api.md#kiwix) proxy (avoids CORS and HTTPS mixed-content against a plain-http local server), the same pattern as the Anytype and Chat widgets.
- `baseUrl` usually points at a `kiwix-serve` on the LAN or tailnet. The route fetches through `userFetch` ([`lib/requestUser.ts`](../../lib/requestUser.ts)): admin accounts may reach private addresses, every other account is held to the public-only SSRF check, so only an admin can use an internal Kiwix server.

(component: `components/KiwixWidget.tsx`; shared retrieval in `lib/kiwix.ts`)
