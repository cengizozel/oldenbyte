# HF Daily Widget

Displays the day's trending AI papers curated by Hugging Face, sorted by upvotes. Clicking a paper title slides in a detail view with the abstract, authors, date, and upvote count.

## Storage Keys

| Key | Value |
|---|---|
| `hf-widget-{id}` | JSON: `{ limit: number }` |
| `hf-papers-{limit}-{YYYY-MM-DD}` | Daily cache of fetched papers |

The cache is keyed by limit and date. Changing the limit produces a cache miss and triggers a fresh fetch.

## Settings

**Papers to show** — toggle between 10, 25, or 50. Papers are always sorted by upvotes descending; this setting controls how many are displayed.

## API Route

`GET /api/hf?limit={n}` fetches from the Hugging Face daily papers endpoint:

```
https://huggingface.co/api/daily_papers
```

The route:
1. Fetches the full list (no server-side pagination — the endpoint returns all papers for the day)
2. Maps each entry to `{ id, title, abstract, authors, publishedAt, upvotes, link }`
3. Sorts by `upvotes` descending
4. Slices to `limit` (capped at 50)

The route uses `export const dynamic = "force-dynamic"` and `cache: "no-store"` to prevent Next.js from caching the response.

> **Note:** The HF API has `type=trending&period=week/month` parameters but they return identical data to the daily endpoint — period filtering is not functional on Hugging Face's side. The widget only exposes the daily feed.

## List and Detail Views

Same absolute-position slide pattern as Reddit and arXiv.

- **List** — paper titles with an external link icon on hover
- **Detail** — authors, publication date, upvote count (`▲ N`), and abstract

## Scroll Fades

Both the list and detail panels track top/bottom fade overlays via `ResizeObserver` and scroll events.
