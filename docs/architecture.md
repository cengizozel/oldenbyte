# Architecture

## Overview

oldenbyte is a single-user personal dashboard built with the Next.js App Router. All widget state lives in a SQLite database on the server and is read/written through the `/api/settings` endpoint. Two exceptions use `localStorage` directly: the theme preference (dark/light) and the OpenAI API key used by the `/digest` page.

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
| Container | Docker |
| CI/CD | GitHub Actions → GHCR → Watchtower |

## Directory Structure

```
app/
  api/                  # API route handlers
    anytype/            # Anytype local-API proxy (auth pairing, spaces, search)
    auth/               # Session login/logout
    caldav/             # CalDAV proxy (calendars, events, create/delete)
    chat/               # OpenAI-compatible chat proxy + agentic tool loop (Kiwix/Anytype/dashboard/calendar)
    digest/             # OpenAI-compatible proxy for /digest, streaming and non-streaming
    f1/                 # F1 race data proxy
    files/[filename]/   # Serve uploaded files
    hf/                 # Hugging Face daily papers proxy
    kiwix/              # kiwix-serve proxy (catalog, search, article extract)
    model/              # Model-residency control (Ollama/LM Studio load/unload/keep-alive)
    proxy/              # Server-side URL fetch proxy (curl UA)
    reddit/             # Reddit feed proxy
    rss/                # RSS/Atom feed parser
    settings/           # Key-value store CRUD + export/import
    upload/             # File upload handler
    weather/            # Open-Meteo proxy (geocoding search + forecast)
    widget-bank/        # Serves validated community widget defs from widget-bank/
    youtube/            # YouTube channel + video resolver
  generated/prisma/     # Prisma-generated client
  globals.css           # CSS variable theming system
  layout.tsx            # Root layout, fonts, FOUC prevention
  login/page.tsx        # Password login page
  digest/page.tsx       # Morning briefing page: AI summary of today's widget content
  page.tsx              # Main dashboard page

components/
  ui/                   # Shared widget primitives: FlipCard, settings fields, chrome
  AnytypeWidget.tsx     # Browse/search Anytype spaces (pairing + flip-card settings)
  BankWidget.tsx        # Renders any declarative widget-bank definition
  CalendarWidget.tsx    # CalDAV agenda (Nextcloud, Radicale, …)
  ChatWidget.tsx        # Chat: lookups, model residency, characters/memory
  KiwixWidget.tsx       # Offline Kiwix full-text search
  F1Widget.tsx
  NotepadWidget.tsx
  ReaderWidget.tsx
  RedditWidget.tsx
  RssWidget.tsx
  TextWidget.tsx
  WeatherWidget.tsx     # Open-Meteo current conditions + forecast
  WidgetCard.tsx        # Fallback/empty widget shell
  WidgetGrid.tsx        # Grid layout, view modes, drag-drop, persistence
  WidgetShelf.tsx       # Edit-mode picker (built-ins + Community group)
  YoutubeWidget.tsx
  TopBar.tsx            # Header with editable fields, date/clock, dark mode
  (and ArxivWidget, ChessWidget, HuggingFaceWidget, TrackerWidget, Markdown, …)

lib/
  anytype.ts            # Shared Anytype API: search (AND fallback), read (markdown + metadata)
  auth.ts               # HMAC-SHA256 session token creation/verification
  caldav.ts             # Minimal CalDAV client (discovery, events, create/delete)
  citations.ts          # Normalizes LLM citation markers + strips <think> blocks
  colors.ts             # Unified tag/badge palette with deterministic key hashing
  dashboardContext.ts   # Gathers the dashboard snapshot fed to Chat/digest
  dashboards.ts         # Multiple-dashboard registry + storage-key namespacing
  format.ts             # Shared timeAgo/count/date/duration/clock formatters
  kiwix.ts              # Shared Kiwix search + article extraction
  prisma.ts             # Prisma client singleton
  storage.ts            # Client-side storage API wrapper
  theme.ts              # Shared light/dark toggle (TopBar button, Shift+D hotkey)
  useScrollFade.ts      # Scroll-fade hook for widget scroll containers
  weather.ts            # WMO weather-code labels shared by widget/digest/chat
  widgetBank.ts         # Declarative widget engine: validation, paths, transforms
  widgets.ts            # Widget type definitions and color map

widget-bank/            # Community widget definitions (one JSON file each)
proxy.ts                # Auth gate: redirects to /login if no valid session
prisma/
  schema.prisma         # Single `Setting` model (key/value store)
public/
  circuits/             # F1 circuit SVG outlines (24 circuits, 2025 season)
```

## Request Lifecycle

```
Browser component
  → lib/storage.ts (getItem / setItem / removeItem)
  → GET/POST/DELETE /api/settings
  → Prisma
  → SQLite (data/db.sqlite)
```

All widget configuration, layout, and content is stored as JSON strings in the `Setting` table under namespaced keys. See [storage.md](storage.md) for key conventions.

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

Widget code that used to be copy-pasted now lives in a small shared layer:

- [`components/ui/`](../components/ui/): `FlipCard` (the standard front/settings flip shell), `Field` (canonical settings inputs, selects, textareas driven by theme CSS vars), and `WidgetChrome` (the hover pencil button, scroll fades, loading spinner, empty-state copy, and the settings save/cancel row).
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

Dark/light mode is implemented via CSS custom properties on `:root` and `.dark`. The `.dark` class is toggled on `<html>` by the TopBar button and persisted in `localStorage`. A `suppressHydrationWarning` attribute on `<html>` and an inline script in `<head>` prevent FOUC.

Tailwind v4 `dark:` utility variants are configured with `@variant dark (&:where(.dark, .dark *))` in `globals.css`, binding them to the `.dark` class rather than the default `prefers-color-scheme` media query.

See [globals.css](../app/globals.css) for the full variable list.
