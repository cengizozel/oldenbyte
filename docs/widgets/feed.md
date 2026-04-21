# Feed Widget (RSS)

Displays headlines from any RSS or Atom feed. Multiple feeds can be configured per widget instance.

## Storage Keys

| Key | Value |
|---|---|
| `rss-widget-{id}` | JSON: `{ url, limit, name? }` or multi-feed format |
| `rss-widget-{id}-{YYYY-MM-DD}` | Daily cache of parsed feed items |

## Caching

Feed data is cached per day using a date-keyed storage entry. On load, if a cache entry exists for today's date it is used directly. Otherwise, a fresh fetch is made and the result cached.

## Feed Parsing

Feed parsing happens server-side in `GET /api/rss?url=…&limit=…`. The parser:

- Detects RSS vs Atom by checking for `<entry>` tags
- Extracts `<title>`, `<link>`, `<pubDate>` / `<updated>`, and `<content>` / `<description>`
- Unwraps CDATA sections and decodes HTML entities

## Scroll Fades

The feed list uses `position: absolute; overflow-y: auto` inside a relative container. A `ResizeObserver` and scroll event listener track scroll position and toggle top/bottom gradient fade overlays that blend into the widget background color.
