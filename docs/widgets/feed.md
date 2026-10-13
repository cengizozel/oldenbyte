# Feed Widget (RSS)

Displays headlines from any RSS or Atom feed. Each widget instance shows one feed; add more instances for more feeds.

## Storage Keys

| Key | Value |
|---|---|
| `rss-widget-{id}` | JSON: `{ url, limit, name? }` (`limit` is 3, 5, 7 or 10; `name` labels the header) |
| `rss-widget-{id}-{YYYY-MM-DD}` | Daily cache of parsed feed items |

## Caching

On load the widget paints today's cache entry, if there is one, and then always refetches the feed and overwrites the cache. When the local date changes at midnight the widget reloads with the new day's key. Saving settings test-fetches the URL first and only saves when it returns items.

The refetch is cheap: `/api/rss` goes through the server feed cache (`lib/feedCache.ts`), which serves a feed from memory for the admin-set TTL (`feedCacheMinutes`, default 60) and refreshes stale entries in the background. The refresh button adds `refresh=1` to force a real upstream fetch.

## Feed Parsing

Feed parsing happens server-side in `GET /api/rss?url=…&limit=…` (`parseFeed` in `lib/rss.ts`). The feed URL must resolve to a public address, and the body is read up to 5 MB. The parser:

- Detects RSS vs Atom by checking for `<entry>` tags
- Extracts `<title>`, `<link>`, `<pubDate>` / `<updated>`, and `<content>` / `<description>` / `<summary>`
- Unwraps CDATA sections and decodes HTML entities

## Scroll Fades

The feed list uses `position: absolute; overflow-y: auto` inside a relative container. A `ResizeObserver` and scroll event listener track scroll position and toggle top/bottom gradient fade overlays that blend into the widget background color.
