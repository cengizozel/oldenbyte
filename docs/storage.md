# Storage

## Models

The application state lives in SQLite through Prisma (`prisma/schema.prisma`). There are five models:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../app/generated/prisma"
}

datasource db {
  provider     = "sqlite"
  // The tables are created by hand in instrumentation.ts without foreign
  // keys, so ownership is expressed here and cascades are run by the client:
  // deleting a User deletes their sessions, settings and caches.
  relationMode = "prisma"
}

model User {
  id                 String   @id @default(uuid())
  username           String   @unique
  passwordHash       String
  role               String   @default("user") // "admin" | "user"
  mustChangePassword Boolean  @default(false)
  createdAt          DateTime @default(now())

  sessions Session[]
  settings Setting[]
  caches   Cache[]
}

model Session {
  id        String   @id // sha256 hex of the cookie's random session id
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// Per-user config and widget data. `version` counts writes, so a client that
// read version N can ask to write only if it is still N (see /api/settings).
model Setting {
  userId    String
  key       String
  value     String
  version   Int      @default(0)
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, key])
}

// Disposable per-user data (today's feed responses and the like). Rows carry
// their own expiry and are dropped by lib/maintenance once it passes; nothing
// here is ever exported, counted against the settings quota, or migrated.
model Cache {
  userId    String
  key       String
  value     String
  expiresAt DateTime
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, key])
  @@index([expiresAt])
}

model AppConfig {
  key   String @id
  value String
}
```

- `Setting` is a per-user key-value store: every account has its own copy of every key. All values are strings (JSON for structured config). There is no schema enforcement beyond the `(userId, key)` pair being unique; widget components serialize and deserialize their own config, and `lib/migrations.ts` brings old shapes up to date on read (see Migrations). `version` counts the writes to a row and drives the compare-and-set in `/api/settings`. Keys are capped at 256 characters and values at 1,000,000 characters.
- `Cache` holds disposable per-user data (today's feed responses, the digest's generated sections, a community widget's last response) with an expiry per row. Which keys land here is decided by `lib/settingKeys.isCacheKey`; the row's `expiresAt` comes from `cacheExpiry` (the key's day plus two days for dated caches, a month for the rest). Caches are never exported, never counted against the settings quota, never migrated, and are dropped by maintenance once expired.
- `User` and `Session` hold accounts and login sessions (see [auth.md](auth.md)).
- `AppConfig` holds app-wide admin settings: the registration toggle, the hashed invite code, and the feed cache TTL (`feedCacheMinutes`).
- Ownership is declared as Prisma relations with `onDelete: Cascade` under `relationMode = "prisma"`: the tables carry no foreign keys (they are created by hand, below), so the client runs the cascade itself, and deleting a `User` removes their sessions, settings and caches.

There are no Prisma migrations. `lib/schema.ts` (called from `instrumentation.ts`) creates the tables with `CREATE TABLE IF NOT EXISTS` at startup and upgrades older files in place (adding the `version` column, creating `Cache`), and migrates a legacy single-user `Setting` table (keyed by `key` only) into the per-user table. Legacy rows are tagged with the user id `__legacy__` and claimed by the first admin account created through `/api/setup`. Every statement is idempotent, so any boot ends in the same state.

## Client API

`lib/storage.ts` wraps the settings API. Every widget component uses it:

```ts
getItem(key)               // GET /api/settings?key=...; null when absent OR when the request failed
getItemResult(key)         // same request, returns { ok, value } so a failed read is distinguishable
setItem(key, value)        // POST /api/settings { key, value, version? }; resolves Promise<boolean>
removeItem(key)            // DELETE /api/settings?key=...; resolves Promise<boolean>
```

- Use `getItemResult` wherever a null read would otherwise be followed by writing a default: a transient failure (server restarting mid-deploy, network blip) must not overwrite real data.
- `setItem` resolves `true` when the server stored the value. On a rejection (too large, server down, network error, conflict) it resolves `false` and dispatches a `savefailed` window event with `{ key, reason }`. `components/SaveErrorNotice.tsx`, mounted once in the root layout, shows a short "Couldn't save your last change" notice for it. Callers that must not continue after a failed write (moves, deletes that depend on a copy) check the result.
- Writes to the same key go out one at a time and the newest value wins: while one is in flight, only the latest waiting value is kept and sent next, and every caller in between resolves with that write's result. (Rapid layout drags used to fire overlapping saves that could land out of order.) Small writes use `keepalive`, so they can finish during a reload. The number of unconfirmed writes is broadcast as a `savestate` window event; `SaveErrorNotice` shows "Saving..." when it stays above zero for a moment, and the browser asks before leaving the page while it is.
- **Conflicts.** Every read returns the row's `version` and the client remembers it per key; every write of a key the page has read sends that version, and the server refuses the write with `409` if the row has moved on since (another tab, another device, the config API, an on-read migration). The page keeps its stale version after a conflict, so every further save of that key fails the same way until the page reloads, rather than the page winning on its second try and quietly undoing the other save. Keys the page never read are written unconditionally, as every write was before.
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
| `keyboard-config` | Keyboard layer: `{ enabled, leader, bindings: { [action]: key } }` (see [keyboard.md](keyboard.md)) |
| `theme` | `"dark"` or `"light"` (mirrored to `localStorage` for the pre-paint script) |
| `timezone` | IANA timezone chosen in settings (empty means follow the device) |
| `topbar-phrase` | Left TopBar field config |
| `topbar-mood` | Right TopBar field config |
| `topbar-date-format` | Clock/date format selection |
| `notepad-registry` | JSON array of every notepad instance ID ever created |
| `youtube-tubearchivist` | TubeArchivist connection shared by every YouTube widget |
| `reddit-api` | Reddit app credentials shared by every Reddit widget |

Per-widget keys (`<id>` is the instance ID):

| Widget | Keys |
|---|---|
| Notepad | `notebook-<id>-days` (index of dates with a note), `notebook-<id>-day-<YYYY-MM-DD>` (one day's note), `notebook-<id>-name` |
| Reader | `reader-config-<id>`, `reader-position-<id>` |
| Text | `text-widget-<id>` |
| Feed | `rss-widget-<id>`, cache `rss-widget-<id>-<YYYY-MM-DD>` |
| Reddit | `reddit-widget-<id>`, `reddit-<id>-seen`, `reddit-<id>-visit`, cache `reddit-widget-<id>-v3-<YYYY-MM-DD>-<sub:period:limit,...>` |
| YouTube | `youtube-widget-<id>`, cache `youtube-widget-<id>-<YYYY-MM-DD>-<hash>` |
| arXiv | `arxiv-widget-<id>`, cache `arxiv-widget-<id>-<YYYY-MM-DD>` |
| HF Daily | `hf-widget-<id>`, cache `hf-papers-<limit>-<YYYY-MM-DD>` |
| F1 | cache `f1-cache-<YYYY-MM-DD>T<HH>` (local day and hour) |
| Weather | `weather-widget-<id>` |
| Calendar | `calendar-widget-<id>` |
| Schedule | `schedule-widget-<id>` |
| Tracker | `tracker-config-<id>`, `tracker-days-<id>` |
| Rhythm | `rhythm-config-<id>`, `rhythm-log-<id>` |
| Upkeep | `upkeep-config-<id>`, `upkeep-log-<id>` |
| Deficit | `deficit-config-<id>`, `deficit-days-<id>` |
| Bookmarks | `bookmarks-config-<id>` |
| Typing | `typing-config-<id>`, `typing-stats-<id>` |
| Chess | `chess-<id>` |
| TV | `tv-widget-<id>` |
| Kiwix | `kiwix-widget-<id>` |
| Anytype | `anytype-widget-<id>` |
| Chat | `chat-<id>-index`, `chat-<id>-conv-<conversationId>` (legacy `chat-widget-<id>` is migrated by the widget); see [widgets/chat.md](widgets/chat.md) |
| Community (bank) | `bank-widget-<id>` (user settings), cache `bank-widget-<id>-cache` (last response) |
| Digest page | cache `digest-ai-sections-<YYYY-MM-DD>` |

`lib/settingKeys.instanceIdOf(key)` knows every family in this table and returns the instance id a key belongs to (null for caches, global keys and anything unlisted). A new per-widget key family must be added there, or its leftover data can never be cleaned up.

Some state stays in the browser's `localStorage` instead: the digest model settings (`digest-base-url`, `digest-model`, `digest-openai-key`, `digest-streaming`), the edit shelf's collapsed state (`shelf-collapsed`), and the epubjs location cache (`epub-locs-v1-<file>`).

## Cache Keys

`lib/settingKeys.ts` is the single definition of which keys are caches. `isCacheKey(key)` is an explicit allow-list: a key is a cache when it starts with `f1-cache-`, `hf-papers-`, `digest-ai-sections-`, or `reddit-widget-` / `youtube-widget-` / `rss-widget-` / `arxiv-widget-` and contains a `YYYY-MM-DD` date, when it starts with `epub-locs-` (rows left over from when that cache lived in the database), or when it is a community widget's `bank-widget-<id>-cache`. Date-stamped user data such as `notebook-<id>-day-<date>` and `tracker-day-<id>-<date>` never matches.

The widgets do not know the difference: they read and write caches through the same `storage` calls. `/api/settings` routes a cache key to the `Cache` table (with `cacheExpiry(key)` as its expiry, and an expired row reading as absent) and everything else to `Setting`. So the Setting table never holds a cache, exports and the config API never see one, and pruning is by expiry date rather than by inspecting key names. `GET /api/settings/export`, `GET /api/config` and `PUT /api/config` still skip cache keys defensively.

## Maintenance

`lib/maintenance.ts` runs at startup (from `instrumentation.ts`) and then every 6 hours:

- deletes `Cache` rows whose `expiresAt` has passed, and expired `Session` rows
- counts leftover widget data (below) and logs how much there is; it never deletes any

At startup it also moves any cache rows an earlier version left in the `Setting` table into `Cache` (`moveCacheRows`), then checkpoints the write-ahead log and runs `VACUUM`, so the file does not keep the space of churned caches.

## Leftover Widget Data

Removing a widget from a dashboard keeps its keys: the data of a notepad, chat or tracker is still the user's, and a removal can be undone within the edit session. `lib/gc.ts` defines what is leftover: a key whose family and instance id `instanceIdOf` knows, whose instance appears in no dashboard's `widget-instances*` map and not in `notepad-registry` (other notepads read registered ids for their history views, so a removed notepad's notes stay reachable on purpose). An unreadable instances map or registry makes the list empty rather than wrong.

`GET /api/settings/orphans` lists it per removed widget (id, key count, bytes, last write) and `DELETE /api/settings/orphans?instance=<id>` removes one widget's keys, after recomputing that they are still leftover. The edit shelf shows this list behind the eraser button next to export and import, with a remove button per widget. Nothing is removed automatically.

## Migrations

Stored shapes change. Rather than each widget converting old values when it happens to be opened (so a widget nobody opened stayed old, and every server-side reader had to understand every old shape), `lib/migrations.readSetting(userId, key)` converts on the server on every read, and both `/api/settings` and the chat's widget readers (`lib/widgetData.ts`) read through it. Each conversion runs in one transaction, bumps the row's `version` like any other write, and leaves an unreadable value untouched. The conversions themselves are pure functions in `lib/migrationRules.ts`, tested in `tests/migrationRules.test.ts`; `tests/db.test.ts` runs them against a throwaway database.

Current rules:

- `upkeep-config-<id>`: items with a day-based `every` get `hours` (`every * 24`; absent means 24).
- `upkeep-log-<id>` absent with `upkeep-days-<id>` present: each day's checked items become checks at noon of that day in the user's `timezone` (or now, if earlier); the days key is removed.
- `tracker-days-<id>`: any `tracker-day-<id>-<date>` keys are folded into the store (an existing store wins for a date both have) and removed.
- `notebook-<id>-days` absent with `notebook-<id>-dates` present: the blob is split into per-day keys plus the index; the blob is removed.

The chat widget's own migration (`chat-widget-<id>` into an index plus per-conversation keys) still runs in the widget, documented in [widgets/chat.md](widgets/chat.md).

## Export / Import

`GET /api/settings/export` returns all of the signed-in user's keys as a flat JSON object (caches are not in the Setting table, so they are never included). The edit shelf's export button downloads it as `oldenbyte-backup-<date>.json`.

`POST /api/settings/import` bulk-upserts the key-value pairs (up to 2000 entries, body up to 25 MB) in a Prisma transaction for the signed-in user, then the client reloads the page. Imported values are read through the migrations like any other, so an old backup comes back in the current shapes.
