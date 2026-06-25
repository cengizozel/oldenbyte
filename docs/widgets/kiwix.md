# Kiwix Widget

Search an offline [Kiwix](https://kiwix.org/) library (Wikipedia, Stack Overflow, iFixit, etc.) served by a local `kiwix-serve`, with an inline article preview.

## Storage Keys

| Key | Value |
|---|---|
| `kiwix-widget-{id}` | JSON: `{ baseUrl, source, sourceTitle, limit }` |

- `baseUrl` - the `kiwix-serve` root (e.g. `http://192.168.1.24:3702`). Must be reachable from wherever the dashboard server runs.
- `source` / `sourceTitle` - the selected ZIM book id and its display title. (Older configs used `book` / `bookTitle`; both field names are read for back-compat.)
- `limit` - number of search results (default 8).

## Behaviour / Reachability

- Search and article fetch go through the server-side [`/api/kiwix`](../api.md) proxy (avoids CORS and HTTPS mixed-content against a plain-http local server) - same pattern as the Anytype and Chat widgets.
- `baseUrl` points at the owner's local/LAN `kiwix-serve`, so this widget intentionally reaches an **internal** service: the route is authenticated but deliberately **not** SSRF-blocked.

(component: `components/KiwixWidget.tsx`; shared retrieval in `lib/kiwix.ts`)
