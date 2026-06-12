# Widget Bank

Community widgets without writing React. Each widget is one JSON file in `widget-bank/` that declares what to fetch and how to display it. The dashboard renders it with the same card chrome, colors, and dark mode as built-in widgets. No code execution, no HTML injection: a config can only fetch a URL and map fields onto a fixed set of primitives.

## Quick start

Drop a file in `widget-bank/`, for example `widget-bank/hacker-news.json`:

```json
{
  "id": "hacker-news",
  "title": "Hacker News",
  "description": "Front page stories right now.",
  "color": "orange",
  "defaultSize": { "w": 1, "h": 3 },
  "fetch": {
    "url": "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15",
    "cacheMinutes": 30
  },
  "items": {
    "path": "$.hits",
    "title": "$.title",
    "link": "$.url",
    "meta": "$.points | count",
    "limit": 12
  }
}
```

It appears in the edit-mode picker under Community. Invalid files are skipped (the `/api/widget-bank` response lists their errors), so a broken def cannot take down the picker.

## Definition fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | kebab-case, unique across the bank |
| `title` | yes | max 40 chars |
| `description` | yes | max 160 chars, shown as the picker tooltip |
| `color` | no | one of `amber sky neutral rose teal orange` (default `neutral`) |
| `defaultSize` | no | grid units, `{ "w": 1, "h": 3 }` default |
| `digestable` | no | default `false`; set `true` to include in the morning digest |
| `config` | no | user settings, see below |
| `fetch.url` | yes | https only, fetched server-side; `{config.key}` placeholders allowed |
| `fetch.cacheMinutes` | no | client cache TTL, default 60 |
| `items` | one of | shorthand for a mapped list |
| `layout` | one of | full primitive layout |

## Path expressions

Strings starting with `$.` select from the fetched JSON: `$.hits[0].title`. A pipe applies a built-in transform: `$.points | count`. Available transforms: `count` (1234 to 1.2K), `date`, `dateShort`, `timeAgo`, `clock`, `duration`, `upper`, `lower`. Inside a `list`, paths are relative to each array item.

## Primitives (`layout`)

- `label`: `{ "component": "label", "value": "$.title", "size": "xs|sm|lg", "muted": true }`
- `list`: `{ "component": "list", "path": "$.items", "title": "$.name", "subtitle": "...", "link": "...", "meta": "...", "limit": 8 }`
- `stat-row`: `{ "component": "stat-row", "items": [{ "label": "Stars", "value": "$.stars | count" }] }`
- `progress-bar`: `{ "component": "progress-bar", "value": "$.done", "max": "$.total" }`
- `badge-list`: `{ "component": "badge-list", "path": "$.tags", "label": "$.name" }`
- `image`: `{ "component": "image", "src": "$.img", "caption": "$.alt" }` (https only)
- `divider`: `{ "component": "divider" }`
- `sparkline`: `{ "component": "sparkline", "values": "$.history" }` (array of numbers)

Unknown component names are skipped gracefully, so configs written against a newer primitive library degrade instead of breaking.

## User settings (`config`)

```json
"config": [
  { "key": "username", "label": "GitHub user", "type": "text", "placeholder": "torvalds" },
  { "key": "limit", "label": "Items", "type": "number", "default": 10 }
]
```

Values are editable on the widget's settings face and interpolate into the fetch URL via `{config.username}`.

## Contributing

Submit a PR adding one JSON file to `widget-bank/`. Checklist:

- the API is public, keyless, and CORS-irrelevant (fetches go through the server proxy)
- `fetch.url` is https and stable
- a reasonable `cacheMinutes` so the source is not hammered
- run the dashboard locally and confirm the widget renders

Anything needing a truly custom UI still belongs as a built-in React widget; the bank covers data-display widgets, which is most of them.
