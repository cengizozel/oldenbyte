# Reader Widget

Renders PDF or EPUB files from your per-user library with a persistent reading position and a Kindle-style progress bar. Supports a full-screen overlay mode.

## Storage Keys

| Key | Value |
|---|---|
| `reader-config-{id}` | JSON: `{ path?, filename?, fileType, displayName }` |
| `reader-position-{id}` | For PDF: page number string. For EPUB: CFI string |

`path` is a file in the library (relative to the user's library root, e.g. `books/novel.epub`); `filename` is a legacy UUID upload. A config has one or the other.

The epubjs locations cache (`epub-locs-v1-{src}`, used for the progress percentage) lives in the browser's `localStorage`, not in the settings database.

## File Handling

The settings card is a small file browser over the user's library (`/api/library`): a real folder per user at `LIBRARY_DIR/<userId>` (default `data/library/<userId>`), with subfolders. From there you can browse folders, go up one level, create a folder, upload a PDF or EPUB into the current folder, or pick a file to read. Files keep their names, so the folder can also be filled from outside (rsync, `docker cp`) and the files just show up. Uploads are capped at 100 MB. Choosing or uploading a file resets the saved position.

- `GET /api/library?op=list&path=<dir>` lists `{ dirs, files }`.
- `GET /api/library?op=file&path=<file>` serves the file.
- `POST /api/library` takes `{ op: "mkdir", path, name }` as JSON, or a multipart upload with `dir` and `file` fields.

Older configs point at a UUID file from the former upload flow (`POST /api/upload`, stored in `UPLOADS_DIR/<userId>`); those are still served from `/api/files/{filename}`. The widget no longer uploads there.

Uploads and folder creation are disabled in demo mode. The remove button clears the widget's config and position (the file stays in the library).

## PDF Rendering

Uses `react-pdf` (backed by pdf.js). The PDF viewer measures its container with `ResizeObserver`. It fits the page to the width (scrolls vertically, the default) or to the whole page, toggled by clicking the page. Zoom ranges from 50% to 400% via the toolbar buttons or Ctrl+wheel (trackpad pinch), and a zoomed page can be dragged to pan. A table of contents is built from the PDF outline when it has one, and a toolbar button opens the file in a new tab. Page position is a simple integer (1-indexed).

## EPUB Rendering

Uses `epubjs`. The viewer:

1. Measures available space with `ResizeObserver`
2. Creates a `Book` and calls `book.renderTo()` once dimensions are known
3. Displays the stored CFI position on load
4. Tracks position via the `relocated` event, storing the `location.start.cfi`

EPUBs also get a table of contents.

**Progress percentage:** epubjs does not provide accurate progress without pre-generating all locations. On first load, `book.locations.generate(1600)` is called asynchronously and the result is cached in `localStorage` under `epub-locs-v1-{src}`. On subsequent loads in the same browser, the cached locations are loaded instead.

**Dark mode:** On init and whenever the `.dark` class changes on `<html>` (via `MutationObserver`), `rendition.themes.override()` injects `color` and `background` CSS into the epub iframe. The background color is read from the widget container's computed style so it matches the widget's theme color exactly.

## Full-screen Overlay

The expand icon in the header opens a portal overlay. The overlay has its own `PdfViewer` or `EpubViewer` instance, and keyboard page navigation works while it is open. The in-widget viewer stays mounted but goes passive: it follows position changes without reporting its own, so the two viewers never fight over the position. Both save through the parent `savePosition` callback.
