# Reddit Widget

Displays top posts from one or more subreddits with per-subreddit time period and post limit controls. Clicking a post title opens an inline detail view with the post body.

## Storage Keys

| Key | Value |
|---|---|
| `reddit-widget-{id}` | JSON: `{ subreddits: SubEntry[]; images?: boolean }` |
| `reddit-widget-{id}-v3-{YYYY-MM-DD}-{sub:period:limit,...}` | Daily cache of the combined post list |

`SubEntry` is `{ name: string; limit: number; period: "day" | "week" | "month" | "year" | "all" }`. New subreddits default to 5 posts per `week`. `images` turns on list thumbnails.

The cache key encodes the date and the full configuration, so any change to subreddits, limits, or periods produces a cache miss. On load the widget paints the day cache (if any) and then always refetches. Only a complete result is written to the day cache: a partial one (some subreddits failed) is shown but not cached, and the missing feeds are retried quietly after a minute (up to 3 times).

## Feed Fetching

Posts come from `GET /api/reddit?subreddit=…&period=…&limit=…`, which reads Reddit's public RSS endpoint server-side:

```
https://www.reddit.com/r/{name}/top.rss?t={period}&limit={limit}
```

Reddit rate-limits logged-out clients hard (about one request a minute per IP as of October 2026), so the server sends every upstream fetch through one queue that waits for Reddit's own budget headers, keeps a rate-limited subreddit queued for up to 30 minutes, and caches results for the admin feed cache TTL, in memory and in `data/cache/reddit.json` so restarts keep them. The widget retries missing subreddits every minute for up to 30 minutes; the counter shows them as "waiting" rather than failed. See [api.md](../api.md#reddit).

The widget fires one request per subreddit at once, feeds with nothing shown yet going first. Each subreddit paints as it arrives instead of the whole widget waiting for the slowest one. The combined list is sorted newest first by publish date. While loading, or when a feed failed, a counter in the header shows how many subreddits have loaded; tap it for the per-feed breakdown. The refresh button refetches with `refresh=1`.

RSS carries no vote counts, so scores are not shown.

## Post Detail View

The list and detail views sit side-by-side in a clipped container and slide in/out with a CSS `translate-x` transition. Clicking a post title slides in the detail panel; a back button slides back to the list.

## HTML Sanitization

Reddit RSS includes the post body as entity-encoded HTML inside `<content>`; the server decodes one level and the widget decodes the rest. `sanitizeRedditHtml()`:

1. Decodes HTML entities with `decodeEntities()` from `lib/text.ts`
2. Parses the result with `DOMParser`
3. Finds the `.md` div (Reddit's Markdown-rendered container)
4. Walks the DOM tree, allowing only a safe set of tags: `p`, `em`, `strong`, `b`, `i`, `ol`, `ul`, `li`, `hr`, `a`, `blockquote`, `code`, `pre`, `br`
5. For `<a>` tags, preserves `href` and adds `target="_blank" rel="noopener noreferrer"`
6. Text nodes have `<`, `>`, and `&` escaped before being re-inserted

If the post has no text body (link posts), the sanitizer returns an empty string and a placeholder is shown instead.

## Subreddit Badge and Images

Each post shows a colored `r/{name}` badge and its relative publish time. Badge colors come from `tagColor()` in `lib/colors.ts`, a hash of the subreddit name, so a subreddit keeps its color however the list is ordered.

With **Show post images** on, image posts show a thumbnail next to the title (the feed thumbnail, or the full image when there is none). The detail view always shows the post image when there is one, falling back to the thumbnail if the full image fails.

## Config Migration

On load, the saved config is migrated from two older formats:

- `subreddits` was previously `string[]`: migrated to `SubEntry[]` (5 posts each) using a top-level `period` field as the default (`day` if absent)
- `SubEntry` previously had no `period`: migrated from the top-level `period` field

## Scroll Fades

Both the list panel and the detail panel have independent top/bottom fade overlays tracked via `ResizeObserver` and scroll event listeners.
