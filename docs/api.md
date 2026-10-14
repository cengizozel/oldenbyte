# API Reference

All routes are under `/api`. The middleware (`proxy.ts`) lets `/api/auth` (and `/api/auth/state`), `/api/setup` and `/api/register` through without a session; every other route needs a valid session cookie or, for scripts, an `Authorization: Bearer <API_KEY>` header (see [auth.md](./auth.md)). Unauthenticated API calls return `401 {"error":"Unauthorized"}`. Each handler then checks the session against the database (`requireUser` / `requireAdmin` in `lib/http.ts`) and scopes all data to the signed-in user. An account with `mustChangePassword` set gets `403 {"error":"password_change_required"}` from every route except `/api/me` and `/api/account/password`.

Routes that fetch a URL the client supplies (Kiwix, CalDAV, Anytype, TubeArchivist, TV, chat, model, digest) let admin accounts reach LAN and tailnet addresses; for every other account the URL must resolve to a public address. `/api/proxy` and `/api/rss` are public-only for everyone. See [architecture.md](./architecture.md#outbound-fetches-and-ssrf).

---


Unreachable or failing upstream services (Kiwix, Anytype, CalDAV, LLM servers, feeds) answer `503`, never `502` or `504`: behind Cloudflare those two are replaced by Cloudflare's own HTML error page and the JSON error would be lost.
## Config (dashboard as JSON)

The whole dashboard (every dashboard's layout, widget instances, and per-widget content, plus global settings like theme and timezone) lives in the key/value store. `/api/config` exposes it as a single hand-authorable JSON document. Unlike `/api/settings/export`, values are JSON-decoded (so `widget-layout` is a real array, not an escaped string) and re-encoded on the way back in.

### `GET /api/config`
Returns all of the user's non-cache config as `{ key: value, ... }`. Values that are JSON objects or arrays are parsed; scalars stay verbatim strings, so the round trip is lossless. Cache keys are those matched by `isCacheKey` in `lib/settingKeys.ts` (see [storage.md](./storage.md#cache-keys)).

### `PUT /api/config` (also `POST`)
Writes config from a JSON object. Non-string values are JSON-stringified before storage; cache keys in the body are ignored. Bodies over 25 MB get `413`. A bearer `API_KEY` request acts as the first admin account, so scripts edit the admin's dashboards.

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
`key` must be 1 to 256 characters and `value` a string of at most 1,000,000 characters; anything else returns `400` with `{ "error": "Invalid key" }` or `{ "error": "Invalid value" }`. Success returns `{ "ok": true }`.

### `DELETE /api/settings?key=<key>`
Deletes a key.

---

## Settings: Export / Import

### `GET /api/settings/export`
Returns all of the user's non-cache settings as a flat JSON object `{ key: value, ... }`, with values as stored strings. Cache keys (see [storage.md](./storage.md#cache-keys)) are excluded.

### `POST /api/settings/import`
Bulk-upserts the key-value pairs from a JSON object in one transaction. Intended for restoring a backup exported from `/api/settings/export`. Entries whose value is not a string, or whose key or value break the `/api/settings` limits, are skipped; at most 2000 entries are imported. Bodies over 25 MB get `413`. Returns `{ "ok": true, "count": <n> }`.

---

## Auth

### `POST /api/auth`
```json
{ "username": "...", "password": "..." }
```
On success: sets an `httpOnly` session cookie and returns `{ "ok": true, "mustChangePassword": false }`.
On failure: returns `401 {"error":"Invalid username or password"}`. A username over 64 or password over 200 characters returns `400`. Rate limited per client IP plus username, per client IP, per username and globally (`429` with `Retry-After`); see [auth.md](auth.md).

### `DELETE /api/auth`
Deletes the session row and clears the cookie (logout).

### `GET /api/auth/state`
Public. Returns `{ "needsSetup": true, "registrationEnabled": false, "hasInvite": false }` so the login page can show the right form.

### `POST /api/setup`
Public, and only while there are no accounts (otherwise `403`). Creates the first account as admin from `{ "username", "password" }` (username 3 to 32 of `A-Z a-z 0-9 _ . -`, password 8 to 200 characters), claims any legacy single-user settings and uploads, and signs in.

### `POST /api/register`
Public. Creates a regular account from `{ "username", "password", "invite" }` when registration is enabled and the invite code matches; otherwise `403`. A taken username returns `400`. Rate limited per IP. Signs in on success.

### `GET /api/me`
Returns the signed-in account: `{ "id", "username", "role", "mustChangePassword" }`.

### `POST /api/account/password`
```json
{ "currentPassword": "...", "newPassword": "..." }
```
Changes your own password (8 to 200 characters), clears `mustChangePassword`, ends every session of the account, and issues a fresh cookie. A wrong current password returns `400`. Rate limited.

---

## Admin

All admin routes need an admin account (`403` otherwise).

### `GET /api/admin/users`
Returns `{ "users": [{ "id", "username", "role", "mustChangePassword", "createdAt" }] }`, oldest first.

### `PATCH /api/admin/users/<id>`
`{ "action": "resetPassword" }` sets a random temporary password, marks the account `mustChangePassword`, ends its sessions, and returns `{ "ok": true, "tempPassword": "..." }`.

### `DELETE /api/admin/users/<id>`
Deletes the account with its settings, sessions, uploads and library folder. You cannot delete yourself or the only admin (`400`).

### `GET /api/admin/config`
Returns `{ "registrationEnabled": false, "hasInvite": true, "feedCacheMinutes": 60 }`.

### `PUT /api/admin/config`
Accepts any of `registrationEnabled` (boolean), `inviteCode` (string, stored hashed), and `feedCacheMinutes` (number, clamped to 1 to 1440; the TTL of the server feed cache). Returns `{ "ok": true, ... }` with the current values.

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

### `GET /api/chat?baseUrl=<url>`
Lists available models from `{baseUrl}/models`. The API key, if any, goes in an `X-Api-Key` header, never the query string (URLs end up in proxy and access logs). Accepts both OpenAI-style
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
`ttl` (LM Studio idle-unload seconds, ignored by other servers), `today` and
`timezone` (the client's local date and IANA zone, for calendar anchoring), and the
`kiwix` / `anytype` / `dashboard` / `caldav` lookup objects below. More than 1000
messages in one request returns `413`.

With `stream: true` (default), returns a `text/plain` stream of token deltas,
read with a `ReadableStreamDefaultReader`. With `stream: false`, returns
`{ "content": "..." }`. Upstream errors are surfaced as
`{ "error": "..." }` with the upstream status code (or `503` if unreachable).

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
  digest of a whole long note (split into chunks, summarize each chunk via a
  non-streaming sub-call, then return the per-part summaries to synthesize).
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

Upstream errors (e.g. a ZIM that can't be read) are surfaced as `{ "error": "..." }` with a `503` status.

---

## Model

Backend-aware model-residency control for the Chat widget's status pill. The OpenAI-compatible `/v1` endpoint ignores residency options, so this talks to each server's **native** API (deriving the root by stripping `/v1` from `baseUrl`). Detects the backend by probing; reports `backend: null` for servers with no controllable residency (llama.cpp, vLLM, hosted) so the UI hides the control.

### `GET /api/model?baseUrl=<url>`
Reports the backend and what's loaded. Probes Ollama's `/api/ps` then LM Studio's `/api/v1/models`.

```json
{ "backend": "ollama", "models": [{ "name": "qwen3:8b", "expiresAt": "2026-…Z", "loaded": true }] }
```

`expiresAt` (unload time) is Ollama-only; LM Studio reports `loaded` with no countdown.

### `GET /api/model?baseUrl=<url>&op=caps&model=<name>`
Reports whether a model accepts images: `{ "vision": true }`, or `{ "vision": null }` when the backend does not say.

### `POST /api/model`
Changes residency. Ollama: `keep_alive` via `/api/generate` (`"5m"`, `-1` to pin, `0` to unload). LM Studio: `action: "pin"` (manual load via `/api/v1/models/load`) or `"unload"` (`/api/v1/models/unload`); durations are applied as `ttl` on the chat request instead.

```json
{ "baseUrl": "…", "backend": "ollama", "model": "qwen3:8b", "keepAlive": "30m" }
```

---

## Anytype

Server-side proxy to the [Anytype](https://anytype.io/) local API (in the desktop app, default `http://127.0.0.1:31009`, localhost-only). Search and object-read logic lives in [`lib/anytype.ts`](../lib/anytype.ts) so the Chat widget's agentic lookup can reuse it directly. Sends the required `Anytype-Version` header; auth is a Bearer token from pairing.

### `POST /api/anytype` (pairing)
- `{ op: "challenge", baseUrl }` returns `{ challengeId }` (and a 4-digit code appears in the desktop app).
- `{ op: "key", baseUrl, challengeId, code }` returns `{ apiKey }`.

### `POST /api/anytype` (write bridge)
Relays to the optional write bridge in `tools/anytype-bridge`; credentials ride each request.
- `{ op: "bridge-health", bridgeUrl }` returns the bridge's `/health` answer.
- `{ op: "bridge", bridgeUrl, bridgeToken, rpc: { op, ... } }` forwards `rpc` to the bridge's `/rpc`. Allowed `rpc.op` values: `list_types`, `style_profile`, `create_object`, `append_markdown`, `read_object`, `search`, `archive_object`.

### `GET` reads
Every read sends the API key in an `X-Api-Key` header, never in the URL:

```bash
curl -H "X-Api-Key: $ANYTYPE_KEY" "https://host/api/anytype?op=spaces&baseUrl=http://127.0.0.1:31009"
```

- `?op=spaces&baseUrl=<url>` returns `{ "spaces": [{ "id": "...", "name": "Main Space" }] }`.
- `?op=search&baseUrl=<url>&spaceId=<id>&q=<query>&limit=<n>[&type=<type>]` searches a space (empty `q` = recent, newest first; `limit` 1 to 100, default 25). A multi-word query that returns nothing is retried as an AND of its terms.

```json
{ "objects": [{ "id": "...", "name": "Journal (2026)", "snippet": "...", "type": "Page", "spaceId": "...", "created": "2026-...Z", "modified": "2026-...Z" }] }
```

- `?op=types&baseUrl=<url>&spaceId=<id>` returns `{ "types": [...] }`, the space's object types.
- `?op=object&baseUrl=<url>&spaceId=<id>&id=<objectId>` returns `{ "object": ... }`, one object read as markdown plus metadata.

An unreachable host is reported as a hint that the Anytype app is not running; upstream errors return `503`.

---

## CalDAV

Server-side proxy to any CalDAV server (RFC 4791; tested against Radicale, written for Nextcloud compatibility) for the Calendar widget. Server-side for Basic auth and CORS; credentials ride each request and are never stored. The client logic lives in [`lib/caldav.ts`](../lib/caldav.ts) so the Chat widget's calendar tools can reuse it directly. All operations are `POST /api/caldav` with an `op` field plus `baseUrl`, `username`, `password`. Errors are surfaced as `{ "error": "..." }` with `400` (bad input) or `503` (upstream).

### `op: "calendars"`
Discovers the account's event calendars (`current-user-principal`, then `calendar-home-set`, then `PROPFIND`). Collections that can't hold VEVENTs (task-only lists) are skipped; `readOnly` is derived from the reported privileges.

```json
{ "calendars": [{ "name": "Personal", "url": "https://…/calendars/user/personal/", "readOnly": false }] }
```

### `op: "events"`
```json
{ "op": "events", "baseUrl": "…", "username": "…", "password": "…", "calendars": [{ "name": "Personal", "url": "…" }], "start": "2026-06-12", "end": "2026-06-26", "timezone": "Europe/Istanbul" }
```
Fetches events in `[start, end)` (dates as `YYYY-MM-DD`) across up to 20 calendars in parallel, merged and sorted by start. A calendar that fails doesn't sink the rest: its error is reported in `failures`.

```json
{ "events": [{ "uid": "…", "href": "…", "calendar": "Personal", "title": "Dentist", "start": "2026-06-13T14:00", "end": "2026-06-13T15:00", "allDay": false, "location": "…", "recurring": true }], "failures": [] }
```

An optional `timezone` (IANA name) sets the zone event times are converted to; without it the server's zone is used. `start`/`end` on an event are `YYYY-MM-DDTHH:mm` (or `YYYY-MM-DD` with `allDay: true`) in that zone. Recurring events are expanded locally by `lib/caldav.ts` (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` rules), so they work on servers that do not expand them.

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
Fetches and parses an RSS or Atom feed. Returns up to `limit` items (1 to 20, default 5). Used by the Feed and arXiv widgets.

```json
[
  { "title": "...", "link": "...", "pubDate": "...", "content": "..." }
]
```

Handles CDATA sections, HTML entity decoding, and both RSS `<item>` and Atom `<entry>` formats. The feed URL must resolve to a public address (for every account, admins included), every redirect hop is re-checked, and the body is read up to 5 MB. Results go through the server feed cache (`lib/feedCache.ts`): served from memory within the admin TTL, refreshed in the background when stale. Add `refresh=1` to force an upstream fetch. Errors return `500`.

---

## Reddit

### `GET /api/reddit?subreddit=<name>&period=<period>&limit=<n>`
Top posts of one subreddit from Reddit's RSS feed (`/r/<name>/top.rss?t=<period>`). `subreddit` must match `[A-Za-z0-9_]{1,50}` (`400` otherwise), `period` defaults to `week`, `limit` is 1 to 25 (default 5).

```json
[{ "title": "...", "link": "...", "pubDate": "...", "score": 0, "subreddit": "programming", "content": "<html>", "thumbnail": "...", "image": "..." }]
```

RSS carries no vote counts, so `score` is always `0`. Reddit rate-limits unauthenticated requests hard, so every upstream fetch goes through one queue that follows Reddit's `x-ratelimit-remaining` / `x-ratelimit-reset` headers (about one request a minute per IP as of October 2026). A `429` goes back into the queue and is retried for up to 30 minutes. Results are cached with the admin feed TTL, in memory and in `data/cache/reddit.json` so they survive restarts. A stale entry (up to 24 hours) is served immediately while it refreshes. `refresh=1` skips the cache but still waits its turn. A request with nothing cached waits up to 20 seconds, then answers `503 { "error": "queued", "retryAfter": 60 }` while the fetch continues in the background; other failures return `503` with the error, unless an entry from the last 24 hours exists.

---

## YouTube

### `GET /api/youtube?channel=<handle-or-url>&limit=<n>`
Resolves a YouTube handle, `@handle`, channel URL or raw `UC...` id to a channel id, then fetches videos. Full URLs must be on a YouTube host. The channel id is read from the page's canonical link, its `externalId` field, or any `/channel/UC...` link.

### `GET /api/youtube?channelId=<id>&limit=<n>`
Fetches the latest videos for a known channel id (`UC` + 22 characters).

Optional parameters: `includeShorts=true` keeps Shorts, `filterMembers=true` drops members-only videos, `refresh=1` bypasses the feed cache. `limit` is 1 to 15 (default 5).

**Video fetching:**
1. Without `includeShorts`, the feed is the channel's `UULF...` playlist (its uploads without Shorts), fetched as RSS (`/feeds/videos.xml?playlist_id=UULF...`); with it, the channel feed (`?channel_id=UC...`). A failed feed is retried once after 1.5 seconds.
2. Because the UULF playlist occasionally carries a Short anyway, each video is checked with a `HEAD` request to `/shorts/<id>`: a real Short answers `200`, a regular video redirects to `/watch`. Answers are remembered per video id.
3. If RSS fails, the route scrapes the channel's `/videos` page (`ytInitialData`). Relative times there ("2 days ago") are converted to approximate timestamps.
4. With `filterMembers`, the channel page is always scraped (only it shows members-only badges), and exact publish times are borrowed from the RSS feed by video id.

Returns:
```json
{
  "channelId": "UC...",
  "name": "Channel Name",
  "videos": [
    { "title": "...", "link": "https://www.youtube.com/watch?v=...", "published": "<ISO 8601 or empty>", "isMembersOnly": false, "isShort": false }
  ]
}
```

### `GET /api/youtube?video=<url-or-id>`
Details for one video, from its watch page: `{ "title", "author", "description", "lengthSeconds", "viewCount" }` (description capped at 4000 characters).

All modes go through the server feed cache. Errors return `500` (`503` for video details).

---

## TubeArchivist

### `POST /api/tubearchivist`
Bridge to a [TubeArchivist](https://www.tubearchivist.com/) server for the YouTube widget. POST so the API token rides in the body, never a URL. `url` (http or https) and `token` are required.

- `{ op: "ping", url, token }` returns `{ "ok": true, "version": "..." }`. A rejected token is reported as an error.
- `{ op: "check", url, token, ids, force? }` returns `{ "archived": ["<videoId>", ...] }`, the subset of up to 100 `ids` present in the archive. Answers are cached per server and token: "archived" for an hour, "not archived" for 2 minutes; `force: true` skips the cache. If TubeArchivist is unreachable, the last known answer is kept.

Errors return `503`.

---

## HF Daily

### `GET /api/hf?limit=<n>`
Hugging Face daily papers (`https://huggingface.co/api/daily_papers`), sorted by upvotes, `limit` 1 to 50 (default 50). Goes through the server feed cache; `refresh=1` forces a fetch.

```json
[{ "id": "2606.01234", "title": "...", "abstract": "...", "authors": ["..."], "publishedAt": "...", "upvotes": 42, "link": "https://huggingface.co/papers/2606.01234" }]
```

---

## TV

### `GET /api/tv?op=<op>&url=<url>`
Proxy for the TV widget. IPTV servers (for example ErsatzTV) usually serve plain http on the LAN while the dashboard is on https, so the browser cannot fetch the streams directly.

- `op=channels&url=<.m3u>` parses an M3U channel list: `{ "channels": [{ "name", "url", "logo" }] }`.
- `op=playlist&url=<.m3u8>` returns the HLS playlist with every URI rewritten back through this route (nested playlists as `op=playlist`, segments and keys as `op=seg`).
- `op=seg&url=<segment-or-stream>` streams the bytes through. Only `video/*` and `audio/*` content types are passed on; anything else is sent as `application/octet-stream` with `Content-Disposition: attachment`, so an upstream page can never render on the dashboard's origin.

Missing or non-http URLs return `400`; upstream errors return `503`.

---

## F1

### `GET /api/f1`
Fetches current season data from [f1api.dev](https://f1api.dev), falling back to the [Jolpica F1 API](https://api.jolpi.ca/ergast/) (Ergast-compatible) when the first returns nothing or fails. Upstream requests have a 7 second timeout and are cached for 1 hour via Next.js fetch revalidation. Both sources are mapped to the same shape. If both fail, the route returns `503`.

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
Current conditions plus a 6-day daily forecast for a coordinate. `unit` defaults to `c`. Cached for 30 minutes. Invalid coordinates return `400`; upstream failures return `503` with `{ "error": "..." }`.

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
Fetches a URL server-side with `User-Agent: curl/7.68.0` and returns the response body as plain text (trimmed, capped at 1 MB). Used by the TopBar, the Text widget and community bank widgets for URL-based content (e.g. `wttr.in`, where the response differs by User-Agent). The URL must resolve to a public address for every account, and each redirect hop is re-checked; otherwise `400 {"error":"Invalid or disallowed URL"}`.

---

## Files

### `POST /api/upload`
Accepts a `multipart/form-data` request with one file. Saves it to the user's own folder `UPLOADS_DIR/<userId>/` with a UUID filename. Returns:
```json
{ "filename": "<uuid>.<ext>" }
```
Accepted types: `.pdf`, `.epub`, up to 50 MB, and for non-admin accounts within the storage quota (uploads plus library, 2 GB by default, `USER_STORAGE_QUOTA_MB`; `413` when it would be exceeded). The Reader widget now uploads through `/api/library`; this route and `/api/files` remain for files uploaded before the library existed. Client errors return a JSON `error` with `400` (not multipart, no file part), `413` (too large) or `415` (unsupported type); anything else is a `500` with a generic message.

### `GET /api/files/<filename>`
Serves one of the user's uploaded files (`<uuid>.pdf` or `<uuid>.epub`) from `UPLOADS_DIR/<userId>/`. Any other name, or another user's file, returns `404`.

### `/api/library`
A per-user reader library: a real folder tree of PDFs and EPUBs under `LIBRARY_DIR/<userId>/` (default `data/library/<userId>/`). Files keep their names, so the folder can also be filled from outside (rsync, `docker cp`). Paths are relative to the user's root; any path that escapes it returns `400`.

- `GET ?op=list&path=<dir>` returns `{ "dirs": ["..."], "files": [{ "name", "size" }] }` (hidden entries skipped). A user with no folder yet gets an empty list.
- `GET ?op=file&path=<file>` returns the file with its content type.
- `POST` JSON `{ "op": "mkdir", "path": "<parent>", "name": "<folder>" }` creates a subfolder.
- `POST` multipart with a `file` and an optional `dir` field uploads into that folder (`.pdf` or `.epub`, up to 100 MB, and for non-admin accounts within the storage quota shared with `/api/upload`), returning `{ "name", "path" }`. Client errors return `400`, `413` or `415` like `/api/upload`.
