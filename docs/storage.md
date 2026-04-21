# Storage

## Model

The entire application state lives in a single Prisma model:

```prisma
model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

This is a flat key-value store. All values are JSON strings. There is no schema enforcement beyond the key being unique — widget components are responsible for serializing and deserializing their own config.

## Client API

`lib/storage.ts` wraps the settings API with three functions used throughout every widget component:

```ts
getItem(key)          // GET  /api/settings?key=…
setItem(key, value)   // POST /api/settings  { key, value }
removeItem(key)       // DELETE /api/settings?key=…
```

## Key Conventions

Keys follow a consistent naming pattern:

| Pattern | Example | Contents |
|---|---|---|
| `widget-layout` | `widget-layout` | JSON array of react-grid-layout `LayoutItem` objects |
| `widget-instances` | `widget-instances` | JSON object mapping instance ID → Widget config |
| `{type}-widget-{id}` | `rss-widget-rss` | Widget-specific config (feeds, channels, etc.) |
| `{type}-{id}-dates` | `notebook-notebook-dates` | Notepad content keyed by date string |
| `{type}-{id}-name` | `notebook-notebook-name` | User-assigned widget name |
| `reader-config-{id}` | `reader-config-ebook` | Reader file config (filename, type, display name) |
| `reader-position-{id}` | `reader-position-ebook` | Last read position (page number or CFI string) |
| `topbar-phrase` | `topbar-phrase` | Left TopBar field config |
| `topbar-mood` | `topbar-mood` | Right TopBar field config |
| `topbar-date-format` | `topbar-date-format` | Clock/date format selection |
| `notepad-registry` | `notepad-registry` | JSON array of all notepad instance IDs ever created |
| `epub-locs-v1-{filename}` | `epub-locs-v1-abc.epub` | Cached epubjs location data for progress calculation |
| `{widget-cache-key}` | `rss-widget-rss-2026-04-21` | Daily-cached feed/video data |

## Export / Import

`GET /api/settings/export` returns all non-cache keys as a JSON object. Cache keys are excluded by pattern:

```ts
function isCache(key: string): boolean {
  return /\d{4}-\d{2}-\d{2}/.test(key) || key.startsWith("epub-locs-");
}
```

`POST /api/settings/import` bulk-upserts all key-value pairs via a Prisma transaction, then triggers a full page reload on the client.
