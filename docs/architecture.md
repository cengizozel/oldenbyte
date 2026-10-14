# Architecture

## Overview

oldenbyte is a multi-user personal dashboard built with the Next.js App Router. Each account has its own dashboards and widget state, stored per user in a SQLite database and read/written through the `/api/settings` endpoint. The first account is created on first run and becomes the admin; further accounts join through invite-code registration (see [auth.md](auth.md)). A few browser-only values use `localStorage` directly: a mirror of the theme for the pre-paint script, the `/digest` page's model settings and API key, the edit shelf's collapsed state, and the epubjs location cache.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | SQLite via Prisma + better-sqlite3 |
| Grid | react-grid-layout |
| PDF rendering | react-pdf (pdf.js) |
| EPUB rendering | epubjs |
| Video | hls.js, mpegts.js (TV widget) |
| Tests / lint | Vitest, ESLint (eslint-config-next) |
| Container | Docker |
| CI/CD | GitHub Actions, GHCR, Watchtower |

## Directory Structure

```
app/
  api/                  # API route handlers
    account/password/   # Change your own password
    admin/              # Admin only: user list, password reset, delete; app config (registration, invite, feed cache TTL)
    anytype/            # Anytype local-API proxy (pairing, spaces, search, objects, write bridge)
    auth/               # Login/logout; auth/state reports whether first-run setup is needed
    caldav/             # CalDAV proxy (calendars, events, create/delete)
    chat/               # OpenAI-compatible chat proxy + agentic tool loop
    config/             # Whole dashboard config as hand-authorable JSON
    digest/             # OpenAI-compatible proxy for /digest, streaming and non-streaming
    f1/                 # F1 race data (f1api.dev, Jolpica fallback)
    files/[filename]/   # Serve the user's uploaded files
    hf/                 # Hugging Face daily papers
    kiwix/              # kiwix-serve proxy (catalog, search, article extract)
    library/            # Per-user reader library: browse folders, upload, read files
    me/                 # The signed-in account
    model/              # Model-residency control (Ollama/LM Studio load/unload/keep-alive)
    proxy/              # Public-URL text fetch for the top bar and Text widget
    reddit/             # Reddit RSS, queued against the rate limit
    register/           # Invite-code registration
    rss/                # RSS/Atom feed parser (Feed and arXiv widgets)
    settings/           # Key-value store CRUD + export/import
    setup/              # First-run admin account creation
    tubearchivist/      # TubeArchivist ping and archived-video check for the YouTube widget
    tv/                 # IPTV proxy: M3U channel lists, HLS playlists, stream segments
    upload/             # File upload handler
    weather/            # Open-Meteo proxy (geocoding search + forecast)
    widget-bank/        # Serves validated community widget defs from widget-bank/
    youtube/            # YouTube channel resolver, video list, video details
  admin/page.tsx        # Admin page: accounts, registration, invite code, feed cache TTL
  generated/prisma/     # Prisma-generated client
  globals.css           # CSS variable theming system
  layout.tsx            # Root layout, fonts, FOUC prevention, save-error notice
  login/page.tsx        # Login, first-run setup and registration
  digest/page.tsx       # Morning briefing page: AI summary of today's widget content
  page.tsx              # Main dashboard page

components/
  ui/                   # Shared widget primitives: FlipCard, Field, Toggle, WidgetChrome
  chat/                 # Chat widget panels (history, characters, settings, messages)
  BankWidget.tsx        # Renders any declarative widget-bank definition
  SaveErrorNotice.tsx   # Notice shown when a settings write fails
  ThemeHotkey.tsx       # Global Shift+D dark mode toggle
  TopBar.tsx            # Header: editable fields, date/clock, dashboard switcher, settings panel
  WidgetCard.tsx        # Fallback/empty widget shell
  WidgetGrid.tsx        # Grid layout, view modes, drag-drop, persistence, WIDGET_COMPONENTS
  WidgetShelf.tsx       # Edit-mode picker (built-ins + Community group), export/import, undo
  *Widget.tsx           # One component per widget type (Notepad, Reader, Feed, Reddit, YouTube,
                        # Weather, F1, arXiv, HF, Calendar, Schedule, Tracker, Rhythm, Upkeep,
                        # Bookmarks, Typing, Chess, TV, Chat, Kiwix, Anytype, Text)

lib/
  anytype.ts            # Shared Anytype API: search (AND fallback), read (markdown + metadata)
  appconfig.ts          # AppConfig table: registration, invite code, feed cache TTL
  assistant/, chat/     # Chat widget internals (see widgets/chat.md)
  auth.ts               # HMAC-SHA256 cookie signing, API key check (edge-safe)
  caldav.ts             # Minimal CalDAV client (discovery, events, create/delete)
  citations.ts          # Normalizes LLM citation markers + strips <think> blocks
  colors.ts             # Unified tag/badge palette with deterministic key hashing
  dashboardContext.ts   # Gathers the dashboard snapshot fed to Chat/digest
  dashboards.ts         # Multiple-dashboard registry + storage-key namespacing
  demo.ts, seed.ts      # Demo mode and the first-run dashboards
  feedCache.ts          # Server-side feed cache (stale-while-revalidate)
  format.ts             # Shared timeAgo/count/date/duration/clock formatters
  http.ts               # requireUser/requireAdmin and shared JSON error helpers
  kiwix.ts              # Shared Kiwix search + article extraction
  maintenance.ts        # Periodic cleanup of old cache rows and expired sessions
  password.ts           # scrypt password hashing
  prisma.ts             # Prisma client singleton
  ratelimit.ts          # In-memory rate limiter (login, setup, registration, password)
  requestUser.ts        # actAs/userFetch: per-request user for outbound fetches
  session.ts            # DB-backed sessions, the authoritative auth check
  settingKeys.ts        # isCacheKey: which setting keys are disposable caches
  ssrf.ts               # SSRF guard: safeFetch, fetchForUser, capped body reads
  storage.ts            # Client-side storage API wrapper
  theme.ts              # Shared light/dark toggle (TopBar button, Shift+D hotkey)
  timezone.ts           # Timezone preference
  useScrollFade.ts      # Scroll-fade hook for widget scroll containers
  weather.ts            # WMO weather-code labels shared by widget/digest/chat
  widgetBank.ts         # Declarative widget engine: validation, paths, transforms
  widgetData.ts         # Server-side widget readers for the chat's read_widget tool
  widgets.ts            # Widget registry, types and color map

tests/                  # Vitest unit tests (caldav, rss, settingKeys, ssrf, text)
tools/anytype-bridge/   # Optional write bridge for Anytype (Python)
widget-bank/            # Community widget definitions (one JSON file each)
instrumentation.ts      # Startup: SESSION_SECRET check, table creation/migration, maintenance
proxy.ts                # Auth gate: 401 for API calls, redirect to /login for pages
next.config.ts          # Standalone output, security headers, body size limit
prisma/
  schema.prisma         # User, Session, Setting (per user), AppConfig
public/
  circuits/             # F1 circuit SVG outlines
```

## Request Lifecycle

```
Browser component
  lib/storage.ts (getItem / setItem / removeItem)
  GET/POST/DELETE /api/settings
  requireUser (lib/http.ts, lib/session.ts)
  Prisma
  SQLite (data/db.sqlite), rows scoped to the user
```

All widget configuration, layout, and content is stored as strings in the `Setting` table under namespaced keys, one set per user. See [storage.md](storage.md) for key conventions.

## Outbound Fetches and SSRF

Routes that fetch a URL the user supplies go through `lib/ssrf.ts`:

- `safeFetch` resolves the host and rejects private, loopback, link-local, metadata, CGNAT, benchmarking (198.18.0.0/15), IETF (192.0.0.0/24), NAT64 and 6to4 addresses, re-checking every redirect hop. The fetch itself runs through an undici agent whose DNS lookup refuses private addresses again at connect time, so a host that re-resolves after the check (DNS rebinding) cannot reach the LAN. `/api/proxy` and `/api/rss` use it for every account.
- The self-hosted integrations (Kiwix, CalDAV, Anytype, TubeArchivist, TV playlists, chat, model control and digest LLM servers) legitimately live on the LAN or tailnet. Those routes call `actAs(user)` from `lib/requestUser.ts` right after their auth check and fetch through `userFetch`, which calls `fetchForUser`. Admin accounts may reach private addresses; every other account gets the same public-only check as `safeFetch`, so it cannot use the server to reach the owner's network. Library code (`lib/kiwix.ts`, `lib/caldav.ts`, `lib/anytype.ts`, `lib/widgetData.ts`) uses `userFetch` too, and falls back to the strict check when no user is set.

`readCappedText` reads response bodies with a byte cap so a huge upstream cannot exhaust memory.

## Feed Cache

`lib/feedCache.ts` is a server-side, in-memory cache with stale-while-revalidate, used by `/api/rss` (Feed and arXiv), `/api/youtube` and `/api/hf`. A fresh entry is served as is; a stale one (up to 24 hours old) is served immediately while a background refresh runs; if upstream fails, an entry up to 24 hours old is still served. The TTL is the admin setting `feedCacheMinutes` (default 60, range 1 to 1440, set on `/admin`). Each widget's refresh button adds `?refresh=1`, which skips the cache and fetches upstream. `/api/reddit` keeps its own cache with the same TTL, plus a paced upstream queue for Reddit's rate limit.

## Security Headers

`next.config.ts` adds to every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy: frame-ancestors 'self'` and `Referrer-Policy: strict-origin-when-cross-origin`.

## Tests, Lint and CI

- `npm test` runs the Vitest unit tests in `tests/` (pure logic: CalDAV parsing, RSS parsing, cache key rules, SSRF checks, text helpers) with `TZ=UTC`.
- `npm run lint` runs ESLint with `eslint.config.mjs` (Next.js core web vitals + TypeScript). The React Compiler rules (`react-hooks/refs`, `set-state-in-effect`, `purity`, `immutability`) are warnings by design: the app does not use the React Compiler and those patterns are correct without it.
- `npm run typecheck` runs `tsc --noEmit`.
- `.github/workflows/deploy.yml` runs typecheck, lint and unit tests on every push to `main`. Only when they pass is the Docker image built and pushed, tagged `:latest` and `:<commit sha>`. See [deployment.md](deployment.md).

## Multiple Dashboards

The grid supports multiple named dashboards, managed by [`lib/dashboards.ts`](../lib/dashboards.ts). The registry lives under the `dashboards` storage key as `{ list: [{ id, name }], activeId }`. Each dashboard gets its own layout and instance keys via `layoutKey(id)` / `instancesKey(id)`: the original dashboard keeps the reserved id `default` and the legacy keys `widget-layout` / `widget-instances`, so existing data needs no migration; additional dashboards use namespaced keys (`widget-layout:<id>`, `widget-instances:<id>`). Per-widget config keys are instance-id scoped and globally unique, so they need no namespacing: they follow their instances. Consumers that read the grid outside `WidgetGrid` (the digest, the chat dashboard context) resolve the active dashboard's keys with `getActiveDataKeys()`.

## Widget Bank

A declarative engine for community widgets: each one is a JSON file in `widget-bank/` declaring what to fetch and how to map it onto a fixed library of safe, themed primitives. No code execution, no HTML injection; contributors submit a config, not a component.

- [`lib/widgetBank.ts`](../lib/widgetBank.ts) defines the schema, validates untrusted defs, and resolves `$.path | transform` expressions and `{config.key}` URL interpolation.
- `/api/widget-bank` serves every valid def in `widget-bank/`, skipping and reporting invalid files.
- [`components/BankWidget.tsx`](../components/BankWidget.tsx) renders a def: it fetches the declared URL through `/api/proxy`, caches the response in the settings store per the def's `cacheMinutes`, and maps the data onto the primitives with the same chrome, colors, and dark mode as built-in widgets.
- Bank widgets appear in the edit-mode picker under a Community group.

See [widget-bank.md](widget-bank.md) for the definition format, primitives, and contribution checklist.

## Shared UI Primitives

Widget code that would otherwise be copy-pasted lives in a small shared layer:

- [`components/ui/`](../components/ui/): `FlipCard` (the standard front/settings flip shell), `Field` (canonical settings inputs, selects, textareas driven by theme CSS vars), `Toggle`, and `WidgetChrome` (the hover pencil and refresh buttons, scroll fades, loading spinner, empty-state copy, and the settings save/cancel row).
- [`lib/format.ts`](../lib/format.ts): single source of truth for relative-time (`timeAgo`), count (`1.2K`), date, duration, and clock strings.
- [`lib/colors.ts`](../lib/colors.ts): one 12-entry tag/badge palette (raw hex for SVG plus Tailwind badge classes) with hash-based color assignment, so colors survive list reordering.
- [`lib/useScrollFade.ts`](../lib/useScrollFade.ts): shared scroll-fade state for widget scroll containers, paired with `ScrollFades` from `WidgetChrome`.

## Responsive View Modes

`WidgetGrid` measures its container with a `ResizeObserver` and picks a layout band by width:

| Mode | Width | Layout |
|---|---|---|
| `full` | ≥ 900px | Fixed 4-column CSS grid sized to fill the viewport (no page scroll) |
| `two` | 600-900px | Scrolling 2-column reflow; widget widths clamp to 2 columns, heights map to fixed auto-rows |
| `stack` | < 600px | Single-column stacked list of fixed-height cards, ordered by grid position |

Tracks use `minmax(0, 1fr)` and cells `min-w-0` so a widget with intrinsically wide content cannot stop shrinking and squeeze the others. Edit mode always uses the react-grid-layout drag grid (except on mobile widths, where the page scrolls).

## Theming

Dark/light mode is implemented via CSS custom properties on `:root` and `.dark`. The `.dark` class is toggled on `<html>` by the settings panel switch or Shift+D (`lib/theme.ts`), saved to the database under `theme`, and mirrored to `localStorage` for the pre-paint script. A `suppressHydrationWarning` attribute on `<html>` and an inline script in `<head>` prevent FOUC.

Tailwind v4 `dark:` utility variants are configured with `@variant dark (&:where(.dark, .dark *))` in `globals.css`, binding them to the `.dark` class rather than the default `prefers-color-scheme` media query.

See [globals.css](../app/globals.css) for the full variable list.
