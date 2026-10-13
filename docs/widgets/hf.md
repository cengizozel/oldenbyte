# HF Daily Widget

Displays the day's trending AI papers curated by Hugging Face, sorted by upvotes. Clicking a paper title slides in a detail view with the abstract, authors, date, and upvote count.

## Storage Keys

| Key | Value |
|---|---|
| `hf-widget-{id}` | JSON: `{ limit: number }` |
| `hf-papers-{limit}-{YYYY-MM-DD}` | Daily cache of fetched papers |

The cache is keyed by limit and date. On load the widget paints the cached list (if any) right away and then always calls `/api/hf`, overwriting the cache with the result. Rows older than two days are removed by the server's maintenance job (see [storage.md](../storage.md)).

## Settings

**Papers to show**: toggle between 10, 25, or 50. Papers are always sorted by upvotes descending; this setting controls how many are displayed.

## API Route

`GET /api/hf?limit={n}[&refresh=1]` fetches from the Hugging Face daily papers endpoint:

```
https://huggingface.co/api/daily_papers
```

The route:
1. Fetches the full list (no server-side pagination: the endpoint returns all papers for the day)
2. Maps each entry to `{ id, title, abstract, authors, publishedAt, upvotes, link }`
3. Sorts by `upvotes` descending
4. Slices to `limit` (1 to 50, default 50)

The route uses `export const dynamic = "force-dynamic"` and `cache: "no-store"` so Next.js does not cache it. Instead the result goes through the server feed cache (`lib/feedCache.ts`, keyed `hf|<limit>`): a fresh entry is served as-is, a stale one (up to 24 hours old) is served instantly while a background refresh runs, and upstream is hit at most once per TTL. The TTL is the admin setting `feedCacheMinutes` (default 60). The header's refresh button sends `refresh=1`, which forces a real fetch.

> **Note:** The HF API has `type=trending&period=week/month` parameters but they return identical data to the daily endpoint; period filtering is not functional on Hugging Face's side. The widget only exposes the daily feed.

## List and Detail Views

Same absolute-position slide pattern as Reddit and arXiv.

- **List**: paper titles with an external link icon on hover
- **Detail**: authors, publication date, upvote count (`▲ N`), and abstract

## Scroll Fades

Both the list and detail panels track top/bottom fade overlays via `ResizeObserver` and scroll events.
