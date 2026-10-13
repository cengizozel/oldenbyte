# Text Widget

Displays a static string or a live value fetched from a URL. Supports three font styles and either an auto-fitted or a fixed text size.

## Storage Keys

| Key | Value |
|---|---|
| `text-widget-{id}` | JSON: `{ source: { type, value }, font, size? }` |

`source.type` is either `"text"` (static string) or `"url"` (fetched endpoint).  
`font` is one of `"sans"`, `"serif"`, or `"mono"`.  
`size` is `"auto"` (default) or a fixed size: `"sm"` (20px), `"md"` (32px), `"lg"` (48px), `"xl"` (72px).

## URL Mode

When `source.type === "url"`, the widget fetches the URL on mount via `GET /api/proxy?url=…`. The proxy route uses `User-Agent: curl/7.68.0`, which causes services like `wttr.in` to return plain text instead of HTML. It only fetches public addresses (every redirect hop is re-checked against the SSRF guard in `lib/ssrf.ts`, for every account) and caps the body at 1 MB.

The fetched value is trimmed to 300 characters, displayed, and re-fetched on every page load (no caching). Saving a URL test-fetches it first and refuses a URL that fails or returns nothing.

## Auto Size

With `size: "auto"`, a binary search finds the largest font size (8 to 150px) at which the text fits the card, including the longest word on one line, so long words shrink the font instead of breaking. It re-fits on resize (`ResizeObserver`) and whenever the text or font changes.

## Font Options

| Value | Font |
|---|---|
| `sans` | Tailwind `font-sans` (the system sans-serif font) |
| `serif` | Tailwind `font-serif` (the system serif font) |
| `mono` | Tailwind `font-mono` (the system monospace font) |
