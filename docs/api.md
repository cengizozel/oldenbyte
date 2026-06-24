# API Reference

All routes are under `/api`. Every route except `/api/auth` is protected by the middleware (`proxy.ts`): send a valid session cookie, or — for scripts — an `Authorization: Bearer <API_KEY>` header (see [auth.md](./auth.md)). Unauthenticated API calls return `401 {"error":"Unauthorized"}`.

---

## Config (dashboard as JSON)

The whole dashboard — every dashboard's layout, widget instances, and per-widget content, plus global settings like theme and timezone — lives in the key/value store. `/api/config` exposes it as a single hand-authorable JSON document. Unlike `/api/settings/export`, values are JSON-decoded (so `widget-layout` is a real array, not an escaped string) and re-encoded on the way back in.

### `GET /api/config`
Returns all non-cache config as `{ key: value, ... }` with each value parsed from JSON where possible.

### `PUT /api/config` (also `POST`)
Writes config from a JSON object. Non-string values are JSON-stringified before storage; cache keys in the body are ignored.

- `?mode=merge` (default): upserts the provided keys, leaving everything else untouched.
- `?mode=replace`: in addition, deletes existing config keys **not** present in the body, so the dashboard ends up matching the document exactly (cache keys are never deleted). Send the *complete* config; an empty body is refused (`400`) rather than wiping everything.

Response: `{ "ok": true, "written": <n>, "deleted": <n>, "mode": "merge" | "replace" }`.

```bash
# Export, edit, re-import a dashboard
curl -H "Authorization: Bearer $API_KEY" https://host/api/config > dash.json
# ...edit dash.json (see lib/seed.ts for the full shape)...
curl -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
     -X PUT --data @dash.json "https://host/api/config?mode=replace"
```

The minimum to define a dashboard: `dashboards` (the list + active id), `widget-layout[:id]` (grid positions), `widget-instances[:id]` (the widgets), and each widget's own config key (e.g. `weather-widget-<id>`, `bookmarks-config-<id>`). See [storage.md](./storage.md) for the per-widget key reference.

---

## Settings

### `GET /api/settings?key=<key>`
Returns the stored value for a key.
```json
{ "value": "..." }
```
Returns `{ "value": null }` if the key does not exist.

### `POST /api/settings`
Creates or updates a key-value pair.
```json
{ "key": "...", "value": "..." }
```

### `DELETE /api/settings?key=<key>`
Deletes a key.

---

## Settings: Export / Import

### `GET /api/settings/export`
Returns all non-cache settings as a flat JSON object `{ key: value, ... }`. Cache keys (date-keyed feed data, epub location caches) are excluded.

### `POST /api/settings/import`
Bulk-upserts all key-value pairs from a JSON object. Intended for restoring a backup exported from `/api/settings/export`.

---

## Auth

### `POST /api/auth`
```json
{ "password": "..." }
```
On success: sets an `httpOnly` session cookie and returns `{ "ok": true }`.  
On failure: returns `401`.

### `DELETE /api/auth`
Clears the session cookie (logout).

---

## Digest

### `POST /api/digest`
Proxies a request to any OpenAI-compatible `/chat/completions` endpoint for the `/digest` page (local or hosted). `baseUrl` and `model` default to OpenAI's `gpt-4o-mini` for backward compatibility; `key` is accepted as a legacy alias for `apiKey`. The digest's newspaper-editor system prompt is applied server-side.

**Reasoning handling.** For local backends (any `baseUrl` not matching a known hosted provider), the request includes `reasoning_effort: "none"`: a local reasoning model can otherwise burn the whole token budget thinking and return an empty summary. Hosted APIs reject the param on non-reasoning models, so it is sent for local backends only. Non-streaming summaries are additionally stripped of any `<think>…</think>` blocks before being returned; streaming forwards only `content` deltas, which excludes reasoning output by construction.

Request:
```json
{ "baseUrl": "http://localhost:11434/v1", "model": "llama3.2", "apiKey": "", "content": "...", "stream": false }
```

Non-streaming response:
```json
{ "summary": "..." }
```

Streaming response (`stream: true`): returns a `text/plain` stream of token deltas, suitable for reading with a `ReadableStreamDefaultReader`.

---

## Chat

Proxies an **OpenAI-compatible** chat endpoint for the Chat widget. Used for
locally hosted models (Ollama, LM Studio, llama.cpp, vLLM) or any hosted
provider. The base URL and API key are supplied by the client per-request and
never stored server-side. `/chat/completions` and `/models` are appended to the
provided `baseUrl`.

### `GET /api/chat?baseUrl=<url>&apiKey=<key>`
Lists available models from `{baseUrl}/models`. Accepts both OpenAI-style
(`{ data: [{ id }] }`) and Ollama-style (`{ models: [{ name }] }`) responses.

```json
{ "models": ["llama3.2", "qwen2.5-coder", "..."] }
```

### `POST /api/chat`
Sends a chat completion request to `{baseUrl}/chat/completions`.

```json
{ "baseUrl": "http://localhost:11434/v1", "apiKey": "", "model": "llama3.2", "messages": [{ "role": "user", "content": "..." }], "stream": true }
```

Optional fields: `maxTokens` (`max_tokens`), `reasoningEffort` (`reasoning_effort`),
`ttl` (LM Studio idle-unload seconds, ignored by other servers), and the `kiwix` /
`anytype` / `dashboard` / `caldav` lookup objects below.

With `stream: true` (default), returns a `text/plain` stream of token deltas,
read with a `ReadableStreamDefaultReader`. With `stream: false`, returns
`{ "content": "..." }`. Upstream errors are surfaced as
`{ "error": "..." }` with the upstream status code (or `502` if unreachable).

**Agentic lookup (Kiwix, Anytype, dashboard, calendar).** Pass any of these
objects to hand the model tools so it can ground answers in a source it reads:

```json
{ "...": "...",
  "kiwix":     { "baseUrl": "http://host:3702", "source": "wikipedia_en_all_maxi_2024-01", "sourceTitle": "Wikipedia" },
  "anytype":   { "baseUrl": "http://127.0.0.1:31009", "apiKey": "…", "spaceId": "…", "spaceName": "Main Space" },
  "dashboard": { "widgets": [{ "id": "notebook", "title": "Notepad", "type": "notebook", "text": "…" }] },
  "caldav":    { "baseUrl": "https://cloud.example/remote.php/dav", "username": "…", "password": "…", "calendars": [{ "name": "Personal", "url": "…" }] } }
```

`kiwix.source` is optional: omit it to search **all** books on the server at once
(set it to pin the search to one ZIM). `dashboard.widgets` is the live widget data
gathered client-side; only a roster line (id, title, type, text length) enters the model's
context, the texts stay server-side until a tool reads them. `caldav` credentials
come from the Calendar widget's config, relayed per request.

When any is present, the route runs an agentic loop (up to 10 rounds), calling
`lib/kiwix.ts` / `lib/anytype.ts` / `lib/caldav.ts` **directly** (not over HTTP: a
server-side fetch to `/api/*` carries no session cookie and the auth middleware
would redirect it to the login page). It streams the model's turn, executes any
tool calls, feeds results back, and repeats until the model answers. Tools offered:

- **Kiwix:** `search_kiwix(query)`, `get_article(url)`.
- **Anytype:** `search_anytype(query)`, `read_anytype_object(id, find?, page?)`
  (long notes return in ~6k-char parts; `find` jumps to matching sections, `page`
  reads sequentially), and `summarize_anytype_object(id, focus?)`, a **map-reduce**
  digest of a whole long note (chunk → summarize each chunk via a non-streaming
  sub-call → return per-part summaries to synthesize).
- **Dashboard:** `read_widget(id, find?, page?)` reads one widget's content (same
  `find`/`page` windowing as long notes; forgiving fallbacks accept a title or type
  in place of an id), and `search_dashboard(query)` keyword-searches all widgets at
  once (phrase first, then individual terms, up to 3 merged ±200-char windows per
  widget). Widget data is the user's own; it is not a citeable source.
- **Calendar:** `list_calendar_events(start_date?, end_date?)` (defaults to the
  next 14 days) and `create_calendar_event(title, start, end?, calendar?,
  location?, description?)`, which targets the first writable calendar unless one
  is named and is described to the model as explicit-request-only.

The model's answer streams live except while the "snippet gate" is armed (it
searched but hasn't read a source yet); then content is buffered so a
snippet-only answer can be bounced back to read first. Tool progress streams
inside `<think>…</think>` as a collapsible trail. Requires a tool-calling model
(e.g. qwen, llama3.1+).

**Citations.** Each retrieved article is numbered, and the model is told to cite
claims inline with `[n]`. The stream's final trailer carries the sources the
model actually cited:

```
…answer text…\x1e{"tokens": 412, "sources": [{"n": 1, "title": "Lionel Messi", "url": "http://host:3702/content/…/A/Lionel_Messi"}]}
```

The client turns each inline `[n]` into a clickable chip and renders a collapsible
"Sources" list under the reply.

---

## Kiwix

Server-side proxy to a [kiwix-serve](https://github.com/kiwix/kiwix-tools) instance for the Kiwix widget. Running it server-side avoids CORS and mixed-content blocking when the dashboard is served over HTTPS but kiwix-serve runs on plain http on the LAN/Tailnet. kiwix-serve only returns XML for full-text search, so the route parses it and hands the client clean JSON. The base URL is supplied by the client per-request and never stored server-side.

A **source** is a ZIM (Wikipedia, WikiHow, …); its `id` is the content-route name kiwix uses internally.

### `GET /api/kiwix?baseUrl=<url>`
Lists the sources (ZIMs) from the OPDS catalog (`{baseUrl}/catalog/v2/entries`).

```json
{ "sources": [{ "title": "Wikipedia", "id": "wikipedia_en_all_maxi_2024-01" }] }
```

### `GET /api/kiwix?baseUrl=<url>&source=<id>&q=<query>&limit=<n>`
Full-text search within one source (`{baseUrl}/search?content=<id>&pattern=<query>&format=xml`). `limit` is clamped to 1-20 (default 8). Each result's `url` is an absolute link to the article HTML.

```json
{ "results": [{ "title": "Isaac Newton", "url": "http://host:3702/content/<id>/A/Isaac_Newton", "snippet": "..." }] }
```

### `GET /api/kiwix?baseUrl=<url>&article=<articleUrl>`
Fetches one article and returns a plain-text extract of its lead paragraphs (tags, inline styles, and citation markers stripped). `articleUrl` must be within the configured `baseUrl`.

```json
{ "extract": "Isaac Newton was an English mathematician..." }
```

Upstream errors (e.g. a ZIM that can't be read) are surfaced as `{ "error": "..." }` with a `502` status.

---

## Model

Backend-aware model-residency control for the Chat widget's status pill. The OpenAI-compatible `/v1` endpoint ignores residency options, so this talks to each server's **native** API (deriving the root by stripping `/v1` from `baseUrl`). Detects the backend by probing; reports `backend: null` for servers with no controllable residency (llama.cpp, vLLM, hosted) so the UI hides the control.

### `GET /api/model?baseUrl=<url>`
Reports the backend and what's loaded. Probes Ollama's `/api/ps` then LM Studio's `/api/v1/models`.

```json
{ "backend": "ollama", "models": [{ "name": "qwen3:8b", "expiresAt": "2026-…Z", "loaded": true }] }
```

`expiresAt` (unload time) is Ollama-only; LM Studio reports `loaded` with no countdown.

### `POST /api/model`
Changes residency. Ollama: `keep_alive` via `/api/generate` (`"5m"` | `-1` pin | `0` unload). LM Studio: `action: "pin"` (manual load) or `"unload"` (`/api/v1/models/unload`); durations are applied as `ttl` on the chat request instead.

```json
{ "baseUrl": "…", "backend": "ollama", "model": "qwen3:8b", "keepAlive": "30m" }
```

---

## Anytype

Server-side proxy to the [Anytype](https://anytype.io/) local API (in the desktop app, default `http://127.0.0.1:31009`, localhost-only). Search and object-read logic lives in [`lib/anytype.ts`](../lib/anytype.ts) so the Chat widget's agentic lookup can reuse it directly. Sends the required `Anytype-Version` header; auth is a Bearer token from pairing.

### `POST /api/anytype` (auth)
- `{ op: "challenge", baseUrl }` → `{ challengeId }` (and a 4-digit code appears in the desktop app).
- `{ op: "key", baseUrl, challengeId, code }` → `{ apiKey }`.

### `GET /api/anytype?op=spaces&baseUrl=<url>&apiKey=<key>`
```json
{ "spaces": [{ "id": "…", "name": "Main Space" }] }
```

### `GET /api/anytype?op=search&baseUrl=<url>&apiKey=<key>&spaceId=<id>&q=<query>&limit=<n>`
Searches a space (empty `q` = recent, newest first). A multi-word query that returns nothing is retried as an AND of its terms.

```json
{ "objects": [{ "id": "…", "name": "Journal (2026)", "snippet": "…", "type": "Page", "spaceId": "…", "created": "2026-…Z", "modified": "2026-…Z" }] }
```

---

## CalDAV

Server-side proxy to any CalDAV server (RFC 4791; tested against Radicale, written for Nextcloud compatibility) for the Calendar widget. Server-side for Basic auth and CORS; credentials ride each request and are never stored. The client logic lives in [`lib/caldav.ts`](../lib/caldav.ts) so the Chat widget's calendar tools can reuse it directly. All operations are `POST /api/caldav` with an `op` field plus `baseUrl`, `username`, `password`. Errors are surfaced as `{ "error": "..." }` with `400` (bad input) or `502` (upstream).

### `op: "calendars"`
Discovers the account's event calendars (`current-user-principal` → `calendar-home-set` → `PROPFIND`). Collections that can't hold VEVENTs (task-only lists) are skipped; `readOnly` is derived from the reported privileges.

```json
{ "calendars": [{ "name": "Personal", "url": "https://…/calendars/user/personal/", "readOnly": false }] }
```

### `op: "events"`
```json
{ "op": "events", "baseUrl": "…", "username": "…", "password": "…", "calendars": [{ "name": "Personal", "url": "…" }], "start": "2026-06-12", "end": "2026-06-26" }
```
Fetches events in `[start, end)` (dates as `YYYY-MM-DD`) across up to 20 calendars in parallel, merged and sorted by start. A calendar that fails doesn't sink the rest: its error is reported in `failures`.

```json
{ "events": [{ "uid": "…", "href": "…", "calendar": "Personal", "title": "Dentist", "start": "2026-06-13T14:00", "end": "2026-06-13T15:00", "allDay": false, "location": "…", "recurring": true }], "failures": [] }
```

`start`/`end` on an event are `YYYY-MM-DDTHH:mm` (or `YYYY-MM-DD` with `allDay: true`); UTC times are converted to the server's local time for display. Recurring events rely on the server's time-range expansion; servers that don't expand return the recurrence master once.

### `op: "create"`
```json
{ "op": "create", "…": "…", "calendar": { "name": "Personal", "url": "…" }, "event": { "title": "Dentist", "start": "2026-06-13T14:00", "end": "…", "location": "…", "description": "…" } }
```
`PUT`s a new VEVENT into the calendar. `start` is `YYYY-MM-DD` for all-day or `YYYY-MM-DDTHH:mm` (treated as floating local time); a timed event without `end` defaults to one hour. Returns `{ "uid": "…", "href": "…" }`.

### `op: "delete"`
```json
{ "op": "delete", "…": "…", "href": "https://…/personal/ob-….ics" }
```
Deletes the event object at `href`. Returns `{ "ok": true }`.

---

## RSS

### `GET /api/rss?url=<feed-url>&limit=<n>`
Fetches and parses an RSS or Atom feed. Returns up to `limit` items (max 20).

```json
[
  { "title": "...", "link": "...", "pubDate": "...", "content": "..." }
]
```

Handles CDATA sections, HTML entity decoding, and both RSS `<item>` and Atom `<entry>` formats.

---

## YouTube

### `GET /api/youtube?channelId=<id>&limit=<n>`
Fetches the latest videos for a known channel ID.

### `GET /api/youtube?channel=<handle-or-url>&limit=<n>`
Resolves a YouTube handle, `@handle`, or channel URL to a channel ID first, then fetches videos.

**Resolution strategy:** Fetches the YouTube channel page and extracts the channel ID from the canonical `<link>` tag.

**Video fetching strategy:**
1. Try YouTube's RSS feed (`/feeds/videos.xml?channel_id=…`)
2. On failure, scrape the channel's `/videos` page and extract `ytInitialData`

Returns:
```json
{
  "channelId": "UC...",
  "name": "Channel Name",
  "videos": [
    { "title": "...", "link": "https://youtube.com/watch?v=...", "published": "<ISO 8601>" }
  ]
}
```

---

## F1

### `GET /api/f1`
Fetches current season data from the [Jolpica F1 API](https://api.jolpi.ca/ergast/) (Ergast-compatible). Cached for 1 hour via Next.js fetch revalidation.

Returns:
```json
{
  "race": {
    "raceName": "...",
    "round": "4",
    "date": "2025-05-04",
    "time": "19:00:00Z",
    "Circuit": {
      "circuitId": "miami",
      "circuitName": "...",
      "Location": { "country": "..." }
    }
  },
  "standings": [
    {
      "position": "1",
      "points": "...",
      "Driver": { "givenName": "...", "familyName": "...", "code": "VER" },
      "Constructors": [{ "name": "Red Bull" }]
    }
  ]
}
```

`race` is `null` when the season has no upcoming races. `standings` contains the top 5 drivers.

---

## Weather

Proxy to [Open-Meteo](https://open-meteo.com/) (keyless) for the Weather widget. Two operations on one route.

### `GET /api/weather?q=<query>`
Geocoding search; returns the top 5 matches. Cached for 24 hours via Next.js fetch revalidation.

```json
{ "results": [{ "name": "Istanbul", "lat": 41.01, "lon": 28.95, "region": "Istanbul, Turkey" }] }
```

### `GET /api/weather?lat=<lat>&lon=<lon>&unit=<c|f>`
Current conditions plus a 6-day daily forecast for a coordinate. `unit` defaults to `c`. Cached for 30 minutes. Invalid coordinates return `400`; upstream failures return `502` with `{ "error": "..." }`.

```json
{
  "current": { "temp": 24.1, "feelsLike": 23.4, "humidity": 48, "windKmh": 11.2, "code": 1 },
  "daily": [
    { "date": "2026-06-12", "code": 3, "max": 26.0, "min": 17.2, "rainPct": 10 }
  ]
}
```

`code` is a WMO weather code; [`lib/weather.ts`](../lib/weather.ts) maps codes to labels.

---

## Widget Bank

### `GET /api/widget-bank`
Serves the community widget definitions: every JSON file in `widget-bank/` that passes validation (see [widget-bank.md](widget-bank.md)). Invalid or unreadable files are skipped and reported in `errors`, so one bad def can't break the picker. The result is cached in memory for 5 minutes in production.

```json
{
  "widgets": [{ "id": "hacker-news", "title": "Hacker News", "description": "…", "fetch": { "url": "https://…" }, "items": { "path": "$.hits", "title": "$.title" } }],
  "errors": { "broken.json": ["fetch.url required and must be https"] }
}
```

---

## Proxy

### `GET /api/proxy?url=<url>`
Fetches a URL server-side with `User-Agent: curl/7.68.0` and returns the response body as plain text. Used by the TopBar and Text widget for URL-based dynamic content (e.g. `wttr.in`), where the response differs based on User-Agent.

---

## Files

### `POST /api/upload`
Accepts a `multipart/form-data` request with a `file` field. Saves the file to `UPLOADS_DIR` with a UUID filename. Returns:
```json
{ "filename": "<uuid>.<ext>" }
```
Accepted types: `.pdf`, `.epub`.

### `GET /api/files/<filename>`
Serves an uploaded file from `UPLOADS_DIR`.
