# Text Widget

Displays a static string or a live value fetched from a URL. Supports three font styles.

## Storage Keys

| Key | Value |
|---|---|
| `text-widget-{id}` | JSON: `{ source: { type, value }, font }` |

`source.type` is either `"text"` (static string) or `"url"` (fetched endpoint).  
`font` is one of `"sans"`, `"serif"`, or `"mono"`.

## URL Mode

When `source.type === "url"`, the widget fetches the URL on mount via `GET /api/proxy?url=…`. The proxy route uses `User-Agent: curl/7.68.0`, which causes services like `wttr.in` to return plain text instead of HTML.

The fetched value is displayed and re-fetched on every page load (no caching).

## Font Options

| Value | CSS |
|---|---|
| `sans` | `font-family: Arial, Helvetica, sans-serif` |
| `serif` | `font-family: var(--font-playfair)` (Playfair Display) |
| `mono` | `font-family: var(--font-dm-mono)` (DM Mono) |
