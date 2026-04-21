# Reader Widget

Renders uploaded PDF or EPUB files with a persistent reading position and a Kindle-style progress bar. Supports a full-screen overlay mode.

## Storage Keys

| Key | Value |
|---|---|
| `reader-config-{id}` | JSON: `{ filename, fileType, displayName }` |
| `reader-position-{id}` | For PDF: page number string. For EPUB: CFI string |
| `epub-locs-v1-{filename}` | Serialized epubjs location data (cached in DB for progress %) |

## File Handling

Files are uploaded via `POST /api/upload`, which saves them to `UPLOADS_DIR` with a UUID filename. The original filename is stored in `displayName` only. Files are served at `/api/files/{filename}`.

## PDF Rendering

Uses `react-pdf` (backed by pdf.js). The PDF viewer measures its container with `ResizeObserver` and renders the current page at the available dimensions. Page position is a simple integer (1-indexed).

## EPUB Rendering

Uses `epubjs`. The viewer:

1. Measures available space with `ResizeObserver`
2. Creates a `Book` and calls `book.renderTo()` once dimensions are known
3. Displays the stored CFI position on load
4. Tracks position via the `relocated` event, storing the `location.start.cfi`

**Progress percentage:** epubjs does not provide accurate progress without pre-generating all locations. On first load, `book.locations.generate(1600)` is called asynchronously and the result is cached in `epub-locs-v1-{filename}`. On subsequent loads, the cached locations are loaded instead.

**Dark mode:** On init and whenever the `.dark` class changes on `<html>` (via `MutationObserver`), `rendition.themes.override()` injects `color` and `background` CSS into the epub iframe. The background color is read from the widget container's computed style so it matches the widget's theme color exactly.

## Full-screen Overlay

Clicking the widget or the expand icon opens a portal overlay. The overlay has its own `PdfViewer` or `EpubViewer` instance, independent of the in-widget one. Both share the same position state via the parent `savePosition` callback.
