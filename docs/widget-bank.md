# Widget Bank

Widgets without writing React. Each widget is one JSON file in `widget-bank/` that declares what to fetch and how to display it. The dashboard renders it with the same card chrome, colors, and dark mode as built-in widgets. No code execution, no HTML injection: a file can only make one request and map the answer onto a fixed set of primitives.

A widget file can read a public API, a public API that needs your key, or a service of your own on the home network (Sonarr, Jellyfin, Immich, Home Assistant and the like). For a widget with its own markup and scripts, see [custom widgets](./custom-widgets.md).

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

It appears in the edit-mode picker under its `category`, or under More without one. Invalid files are skipped (the `/api/widget-bank` response lists their errors), so a broken def cannot take down the picker.

## Definition fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | kebab-case, unique across the bank |
| `title` | yes | max 40 chars |
| `description` | yes | max 160 chars, shown as the picker tooltip |
| `color` | no | one of `amber sky neutral rose teal orange` (default `neutral`) |
| `category` | no | the picker group: `feeds notes links time habits live library server media play ai`; without one the widget is listed under More |
| `defaultSize` | no | grid units, `{ "w": 1, "h": 3 }` default |
| `digestable` | no | default `false`. Reserved: the morning digest does not support widget files yet, so `true` has no effect |
| `config` | no | user settings, see below |
| `fetch.url` | yes | either `https://` with a fixed host (a public address), or starting with a setting of type `url`, like `{config.url}/api/v3/queue` (the user's own service). Placeholders, see below. The server makes the request; the answer must be JSON, at most 1 MB |
| `fetch.headers` | no | request headers, up to 10; values may use placeholders: `"X-Api-Key": "{config.apiKey}"` |
| `fetch.cacheMinutes` | no | client cache TTL, default 60; the last response is kept under `bank-widget-<id>-cache` |
| `items` | one of | shorthand for a mapped list |
| `layout` | one of | full primitive layout |

## Path expressions

Strings starting with `$.` select from the fetched JSON: `$.hits[0].title`. A pipe applies a built-in transform: `$.points | count`. Available transforms: `count` (1234 to 1.2K, and nothing for 0), `number` (12,345, and 0 stays 0), `bytes` (1536 to 1.5 KB), `percent` (99.52 to 99.5%), `date`, `dateShort`, `timeAgo`, `clock`, `duration`, `upper`, `lower`. Inside a `list`, paths are relative to each array item. `a || b` takes the first alternative that is not empty: `$.url || $.comments_url` for a field that may be missing, or `$.name || unnamed` to fall back to plain text.

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
  { "key": "url", "label": "Address", "type": "url", "placeholder": "http://sonarr.lan:8989" },
  { "key": "apiKey", "label": "API key", "type": "secret", "hint": "Sonarr, Settings, General." },
  { "key": "limit", "label": "Items", "type": "number", "default": 10 }
]
```

Values are edited on the widget's settings face. Types:

| Type | Is |
|---|---|
| `text`, `number`, `select` (with `options`) | Plain settings |
| `url` | The address of the user's own service. It may only stand at the very start of `fetch.url` |
| `secret` | An API key, token or password. Kept on the server, see below |

Each field may carry a `placeholder` and a `hint`.

## Placeholders

In `fetch.url` and in header values:

| Placeholder | Becomes |
|---|---|
| `{config.key}` | That setting's value, escaped for a URL (as it is in a header) |
| `{date}` | Today in the user's timezone, `YYYY-MM-DD` |
| `{date+7}`, `{date-1}` | That many days from today |

A setting can never change the host of a fixed address: values are escaped, and a `url` setting is only accepted as the start of the address.

## Your own services and keys

A file whose `fetch.url` starts with a `url` setting talks to an address the user types. The server makes that request the way every other integration does: an admin account may reach the home network (plain http included), any other account only public addresses.

`secret` settings are write-only. When the user saves one it goes to the server (`PUT /api/widget-bank/secrets`) and is never sent to a browser again: the settings face only shows that a key is saved, with Remove. The server adds it when it makes the widget's request. Secrets are kept apart from the user's settings on purpose, so the settings API, the app API and backups cannot contain them; after restoring a backup on another server, type them again. They are removed with the widget's leftover data and with the account.

A key is only ever sent where the file's `fetch` says. Read a file's `fetch.url` before giving it a key, as with any integration.

## Shipped files

| File | Needs |
|---|---|
| `hacker-news`, `lobsters`, `xkcd` | Nothing |
| `sonarr-upcoming`, `sonarr-queue`, `radarr-upcoming`, `radarr-queue`, `lidarr-queue`, `sabnzbd-queue` | Address and API key |
| `jellyfin-library`, `jellyfin-sessions`, `tautulli-activity`, `jellyseerr-requests`, `navidrome-recent`, `audiobookshelf-progress` | Address and key or sign-in |
| `immich-stats`, `paperless-recent`, `gitea-repos`, `miniflux-unread`, `linkding-recent`, `gotify-messages`, `syncthing-status`, `grocy-due`, `home-assistant-entity` | Address and key or token |
| `lastfm-recent`, `nasa-apod`, `github-notifications`, `tmdb-trending`, `raindrop-recent`, `readwise-highlights`, `news-headlines`, `wakatime-today` | Your key for that public service |

The files for other people's services were written from those services' API documentation and checked against stand-in answers, not every one against a live install. If one shows nothing for you, the service's answer probably differs by version: open an issue or fix the paths in a pull request.

## Contributing

Submit a PR adding one JSON file to `widget-bank/`. Checklist:

- the address is a fixed https host, or starts with a `url` setting for a self-hosted service
- keys and tokens are `secret` settings, with a `hint` saying where to find them
- say in the pull request which version of the service you tried it against
- a reasonable `cacheMinutes` so the source is not hammered
- run the dashboard locally and confirm the widget renders

Anything needing a truly custom UI still belongs as a built-in React widget; the bank covers data-display widgets, which is most of them.
