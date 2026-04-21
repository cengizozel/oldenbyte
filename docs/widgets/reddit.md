# Reddit Widget

Displays top posts from one or more subreddits with per-subreddit time period and post limit controls. Clicking a post title opens an inline detail view with the post body.

## Storage Keys

| Key | Value |
|---|---|
| `reddit-widget-{id}` | JSON: `{ subreddits: SubEntry[] }` |
| `reddit-widget-{id}-v2-{YYYY-MM-DD}-{sub:period:limit,...}` | Daily cache of fetched posts |

`SubEntry` is `{ name: string; limit: number; period: "day" | "week" | "month" | "year" | "all" }`.

The cache key encodes the full configuration so any change to subreddits, limits, or periods produces a cache miss and triggers a fresh fetch.

## Feed Fetching

Posts are fetched via `GET /api/rss?url=…&limit=…` using Reddit's public RSS endpoint:

```
https://www.reddit.com/r/{name}/top.rss?t={period}&limit={limit}
```

One request is made per subreddit in parallel. Results are interleaved round-robin (one post from each subreddit in turn) so no single subreddit dominates the list.

## Post Detail View

The list and detail views sit side-by-side in a clipped container and slide in/out with a CSS `translate-x` transition. Clicking a post title slides in the detail panel; a back button slides back to the list.

## HTML Sanitization

Reddit RSS includes the post body as entity-encoded HTML inside `<content>`. `sanitizeRedditHtml()`:

1. Decodes the outer HTML entities using a `<textarea>` trick
2. Parses the result with `DOMParser`
3. Finds the `.md` div (Reddit's Markdown-rendered container)
4. Walks the DOM tree, allowing only a safe set of tags: `p`, `em`, `strong`, `b`, `i`, `ol`, `ul`, `li`, `hr`, `a`, `blockquote`, `code`, `pre`, `br`
5. For `<a>` tags, preserves `href` and adds `target="_blank" rel="noopener noreferrer"`
6. Text nodes have `<`, `>`, and `&` escaped before being re-inserted

If the post has no text body (link posts), the sanitizer returns an empty string and a placeholder is shown instead.

## Subreddit Badge

Each post shows a colored badge for its subreddit. Hovering the badge reveals a tooltip with the post's rank within its subreddit, the period label, and the publish date. The tooltip flips left if it would overflow the right edge of the viewport.

Each subreddit is assigned a color from a fixed palette (`SUB_COLORS`) cycling through sky, teal, violet, rose, amber, and emerald.

## Config Migration

On load, the saved config is migrated from two older formats:

- `subreddits` was previously `string[]` — migrated to `SubEntry[]` using a top-level `period` field as the default
- `SubEntry` previously had no `period` — migrated from the top-level `period` field

## Scroll Fades

Both the list panel and the detail panel have independent top/bottom fade overlays tracked via `ResizeObserver` and scroll event listeners.
