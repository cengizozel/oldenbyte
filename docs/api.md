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
