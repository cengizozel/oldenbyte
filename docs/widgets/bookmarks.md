# Bookmarks Widget

A board of your favourite links, each shown as a site favicon tile (with a coloured letter-tile fallback, or a custom emoji/image override). Renders in one of three views.

## Storage Keys

| Key | Value |
|---|---|
| `bookmarks-config-{id}` | JSON: `{ bookmarks: Bookmark[], view, iconSize? }` |

- `bookmarks` - array of `{ id, url, name, icon? }`.
  - `url` - should be an absolute `https://` URL; it's the link target and the favicon is derived from it (`https://<domain>/favicon.ico`).
  - `name` - display label (falls back to the domain).
  - `icon` - optional override: an emoji, or a custom image URL (used instead of the favicon).
- `view` - `"icon"` (tiles only), `"row"` (icon + name), or `"name"` (compact name-only list).
- `iconSize` - tile size in px.

## Behaviour

- Favicons load straight from each link's domain in the browser; on failure a tinted letter tile is shown. An emoji or image `icon` overrides the favicon.
- Edit mode adds/removes/reorders links and switches the view.
- No server API - links open directly and favicons are fetched client-side.

(component: `components/BookmarksWidget.tsx`)
