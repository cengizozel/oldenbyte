# API Reference

All routes are under `/api`. Routes that read or write user data are protected by the session middleware.

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

## Settings — Export / Import

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
Proxies a request to any OpenAI-compatible `/chat/completions` endpoint for the `/digest` page (local or hosted). `baseUrl` and `model` default to OpenAI's `gpt-4o-mini` for backward compatibility; `key` is accepted as a legacy alias for `apiKey`. The digest's newspaper-editor system prompt is applied server-side, and reasoning-model `<think>` output is naturally excluded (only `content` deltas are forwarded).

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

With `stream: true` (default), returns a `text/plain` stream of token deltas,
read with a `ReadableStreamDefaultReader`. With `stream: false`, returns
`{ "content": "..." }`. Upstream errors are surfaced as
`{ "error": "..." }` with the upstream status code (or `502` if unreachable).

**Kiwix tool calls (agentic lookup).** Pass an optional `kiwix` object to let the
model search the offline Kiwix library mid-conversation:

```json
{ "...": "...", "kiwix": { "baseUrl": "http://host:3702", "source": "wikipedia_en_all_maxi_2024-01", "sourceTitle": "Wikipedia" } }
```

When present, the model is given `search_kiwix(query)` and `get_article(url)`
tools. The route runs an agentic loop (up to 8 rounds) by calling `lib/kiwix.ts`
directly (not over HTTP — a server-side fetch to `/api/kiwix` would be redirected
to the login page by the auth middleware): it streams the model's turn, and
whenever the model calls a tool, executes it, feeds the result back, and
continues until the model answers. Query terms are simplified (filler/question
words stripped) before searching, since Kiwix is a keyword index. Tool progress
is streamed inside `<think>…</think>` so the client renders it as a collapsible
trail. Requires a tool-calling-capable model (e.g. qwen, llama3.1+).

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
Full-text search within one source (`{baseUrl}/search?content=<id>&pattern=<query>&format=xml`). `limit` is clamped to 1–20 (default 8). Each result's `url` is an absolute link to the article HTML.

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
