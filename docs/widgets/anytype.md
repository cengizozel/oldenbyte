# Anytype Widget

Browse and search your own [Anytype](https://anytype.io/) spaces from the dashboard. Anytype runs a local API inside its desktop app (default `http://127.0.0.1:31009`, localhost-only); the widget pairs with it once, then lists and searches your objects.

## Storage Keys

| Key | Value |
|---|---|
| `anytype-widget-{id}` | JSON: `{ baseUrl, apiKey, spaceId, spaceName, limit }` |

- `baseUrl` - the Anytype local API root (default `http://127.0.0.1:31009`). The desktop app must be running and reachable from wherever the dashboard server runs.
- `apiKey` - the Bearer token obtained by pairing (below).
- `spaceId` / `spaceName` - the selected space.
- `limit` - result count (10 / 25 / 50 / 100).

## Pairing

Anytype auth is a one-time challenge/response:

1. Enter the API URL and click **Pair with Anytype** → `POST /api/anytype { op: "challenge" }` triggers a **4-digit code** to appear in the desktop app.
2. Type the code and confirm → `POST /api/anytype { op: "key", challengeId, code }` exchanges it for an `api_key` (a Bearer token), stored in the config.
3. Pick a space (`GET /api/anytype?op=spaces`).

To revoke, remove the app authorization in Anytype's settings and re-pair.

## Behaviour

- The front view shows **recent objects** (an empty search sorted by last-modified) and a search box. Searching calls `GET /api/anytype?op=search` within the selected space.
- **Multi-word search** that finds nothing is retried as an AND of its terms (so `2026 journal` finds `Journal (2026)`) - handled in [`lib/anytype.ts`](../../lib/anytype.ts).
- Clicking an object (or its external-link icon) opens it in the desktop app via an `anytype://object?objectId=…&spaceId=…` deep link.
- The **home** button returns to the recent list; the **pencil** opens the settings card (flip animation, like the Kiwix widget).

## Reachability

The Anytype API binds to `127.0.0.1`, so it's only reachable when the dashboard server and Anytype run on the **same machine**. Running the dashboard on a different host requires tunnelling port `31009` onto a reachable interface; the URL field exists for exactly that.

## Why a server-side proxy

Requests go through [`/api/anytype`](../api.md#anytype) (which shares search/read logic with the Chat widget's Anytype lookup via `lib/anytype.ts`) rather than directly from the browser - same reason as the Kiwix and Chat widgets: it avoids CORS and HTTPS mixed-content blocking against a plain-http local server.

This widget is not `digestable`.
