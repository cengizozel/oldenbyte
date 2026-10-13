# Bookmarks Widget

A board of your favourite links, each shown as a site favicon tile (with a coloured letter-tile fallback, or a custom emoji/image override). Renders in one of four views.

## Storage Keys

| Key | Value |
|---|---|
| `bookmarks-config-{id}` | JSON: `{ bookmarks: Bookmark[], view, iconSize? }` |

- `bookmarks` - array of `{ id, url, name, icon?, hidden? }`.
  - `url` - the link target; a value without a scheme gets `https://` prepended. The favicon is derived from it: https links keep their origin (including the port, so several services on one host get their own icons), plain http is upgraded to `https://<domain>` so the favicon is never mixed content.
  - `name` - display label (falls back to the domain).
  - `icon` - optional override: an emoji, or a custom image URL (used instead of the favicon).
  - `hidden` - kept in the list but not shown on the widget.
- `view` - `"icon"` (tiles only), `"grid"` (tiles with names), `"row"` (icon + name rows), or `"name"` (compact name-only list).
- `iconSize` - tile size in px for the icon and grid views (28 to 80 in steps of 8, default 44), changed with the header's minus/plus buttons.

## Behaviour

- Favicons load straight from each link's site in the browser; on failure a tinted letter tile is shown. An emoji or image `icon` overrides the favicon.
- The header holds the view toggle and, in the tile views, the icon size buttons.
- The pencil flips to the settings card, where links are added, edited, removed, hidden or shown, and reordered by dragging (rows shift out of the way while dragging; the move commits on drop).
- No server API: links open directly and favicons are fetched client-side.

(component: `components/BookmarksWidget.tsx`)
