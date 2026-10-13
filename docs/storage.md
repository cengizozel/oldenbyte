# Storage

## Models

The application state lives in SQLite through Prisma (`prisma/schema.prisma`). There are four models:

```prisma
model User {
  id                 String   @id @default(uuid())
  username           String   @unique
  passwordHash       String
  role               String   @default("user") // "admin" | "user"
  mustChangePassword Boolean  @default(false)
  createdAt          DateTime @default(now())
}

model Session {
  id        String   @id // sha256 hex of the cookie's random session id
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}

model Setting {
  userId    String
  key       String
  value     String
  updatedAt DateTime @updatedAt

  @@id([userId, key])
}

model AppConfig {
  key   String @id
  value String
}
```

- `Setting` is a per-user key-value store: every account has its own copy of every key. All values are strings (JSON for structured config). There is no schema enforcement beyond the `(userId, key)` pair being unique; widget components serialize and deserialize their own config. Keys are capped at 256 characters and values at 1,000,000 characters by `/api/settings`.
- `User` and `Session` hold accounts and login sessions (see [auth.md](auth.md)).
- `AppConfig` holds app-wide admin settings: the registration toggle, the hashed invite code, and the feed cache TTL (`feedCacheMinutes`).

There are no Prisma migrations. `instrumentation.ts` creates the tables with `CREATE TABLE IF NOT EXISTS` at startup, and migrates a legacy single-user `Setting` table (keyed by `key` only) into the per-user table. Legacy rows are tagged with the user id `__legacy__` and claimed by the first admin account created through `/api/setup`.

## Client API

`lib/storage.ts` wraps the settings API. Every widget component uses it:

```ts
getItem(key)               // GET /api/settings?key=...; null when absent OR when the request failed
getItemResult(key)         // same request, returns { ok, value } so a failed read is distinguishable
setItem(key, value)        // POST /api/settings { key, value }; resolves Promise<boolean>
removeItem(key)            // DELETE /api/settings?key=...; resolves Promise<boolean>
```

- Use `getItemResult` wherever a null read would otherwise be followed by writing a default: a transient failure (server restarting mid-deploy, network blip) must not overwrite real data.
- `setItem` resolves `true` when the server stored the value. On a rejection (too large, server down, network error) it resolves `false` and dispatches a `savefailed` window event with `{ key, reason }`. `components/SaveErrorNotice.tsx`, mounted once in the root layout, shows a short "Couldn't save your last change" notice for it. Callers that must not continue after a failed write (migrations, moves) check the result.
- A `401` from the API sends the browser to `/login`.
- In demo mode every call is redirected to an in-memory copy of the first-run seed (`lib/demo.ts`), so nothing reaches the server.

## Key Conventions

Global keys:

| Key | Contents |
|---|---|
| `dashboards` | Dashboard registry: `{ list: [{ id, name }], activeId }` |
| `widget-layout` / `widget-layout:<id>` | Layout of the default / other dashboards: JSON array of react-grid-layout items |
| `widget-instances` / `widget-instances:<id>` | Instance ID to Widget config map, per dashboard |
| `preload-dashboards` | `"1"` to mount every dashboard at page load |
| `theme` | `"dark"` or `"light"` (mirrored to `localStorage` for the pre-paint script) |
| `timezone` | IANA timezone chosen in settings (empty means follow the device) |
| `topbar-phrase` | Left TopBar field config |
| `topbar-mood` | Right TopBar field config |
| `topbar-date-format` | Clock/date format selection |
| `notepad-registry` | JSON array of every notepad instance ID ever created |
| `youtube-tubearchivist` | TubeArchivist connection shared by every YouTube widget |
| `digest-ai-sections-<YYYY-MM-DD>` | The digest page's generated sections for the day |

Per-widget keys (`<id>` is the instance ID):

| Widget | Keys |
|---|---|
| Notepad | `notebook-<id>-days` (index of dates with a note), `notebook-<id>-day-<YYYY-MM-DD>` (one day's note), `notebook-<id>-name` |
| Reader | `reader-config-<id>`, `reader-position-<id>` |
| Text | `text-widget-<id>` |
| Feed | `rss-widget-<id>`, cache `rss-widget-<id>-<YYYY-MM-DD>` |
| Reddit | `reddit-widget-<id>`, cache `reddit-widget-<id>-v3-<YYYY-MM-DD>-<sub:period:limit,...>` |
| YouTube | `youtube-widget-<id>`, cache `youtube-widget-<id>-<YYYY-MM-DD>-<hash>` |
| arXiv | `arxiv-widget-<id>`, cache `arxiv-widget-<id>-<YYYY-MM-DD>` |
| HF Daily | `hf-widget-<id>`, cache `hf-papers-<limit>-<YYYY-MM-DD>` |
| F1 | cache `f1-cache-<YYYY-MM-DD>T<HH>` (local day and hour) |
| Weather | `weather-widget-<id>` |
| Calendar | `calendar-widget-<id>` |
| Schedule | `schedule-widget-<id>` |
| Tracker | `tracker-config-<id>`, `tracker-days-<id>` (today's legacy `tracker-day-<id>-<date>` key is migrated when no days key exists) |
| Rhythm | `rhythm-config-<id>`, `rhythm-log-<id>` |
| Upkeep | `upkeep-config-<id>`, `upkeep-days-<id>` |
| Bookmarks | `bookmarks-config-<id>` |
| Typing | `typing-config-<id>`, `typing-stats-<id>` |
| Chess | `chess-<id>` |
| TV | `tv-widget-<id>` |
| Kiwix | `kiwix-widget-<id>` |
| Anytype | `anytype-widget-<id>` |
| Chat | `chat-<id>-index`, `chat-<id>-conv-<conversationId>` (legacy `chat-widget-<id>` is migrated); see [widgets/chat.md](widgets/chat.md) |
| Community (bank) | `bank-widget-<id>` (user settings), `bank-widget-<id>-cache` (last response) |

Notepads used to keep every day in one `notebook-<id>-dates` object that was rewritten on each edit. On load, a legacy blob is copied into per-day keys plus the index, and removed only after every write succeeded.

Some state stays in the browser's `localStorage` instead: the digest model settings (`digest-base-url`, `digest-model`, `digest-openai-key`, `digest-streaming`), the edit shelf's collapsed state (`shelf-collapsed`), and the epubjs location cache (`epub-locs-v1-<file>`).

## Cache Keys

`lib/settingKeys.ts` is the single definition of which keys are disposable caches. `isCacheKey(key)` is an explicit allow-list: a key is a cache when it starts with `f1-cache-`, `hf-papers-`, `digest-ai-sections-`, or `reddit-widget-` / `youtube-widget-` / `rss-widget-` / `arxiv-widget-` and contains a `YYYY-MM-DD` date, or when it starts with `epub-locs-` (rows left over from when that cache lived in the database). Date-stamped user data such as `notebook-<id>-day-<date>` and `tracker-day-<id>-<date>` never matches.

It is used by:

- `GET /api/settings/export` and `GET /api/config`, which leave caches out
- `PUT /api/config`, which ignores cache keys in the body and never deletes them in replace mode
- the cleanup in `lib/maintenance.ts`

## Maintenance

`lib/maintenance.ts` runs at startup (from `instrumentation.ts`) and then every 6 hours. It deletes dated cache rows whose date is more than 2 days old (`cacheKeyDate` returns the date of a dated cache key) and expired `Session` rows.

## Export / Import

`GET /api/settings/export` returns all of the signed-in user's non-cache keys as a flat JSON object. The edit shelf's export button downloads it as `oldenbyte-backup-<date>.json`.

`POST /api/settings/import` bulk-upserts the key-value pairs (up to 2000 entries, body up to 25 MB) in a Prisma transaction for the signed-in user, then the client reloads the page.
