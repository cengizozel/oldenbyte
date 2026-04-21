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
    auth/               # Session login/logout
    digest/             # OpenAI proxy for /digest — supports streaming and non-streaming
    f1/                 # F1 race data proxy
    files/[filename]/   # Serve uploaded files
    hf/                 # Hugging Face daily papers proxy
    proxy/              # Server-side URL fetch proxy (curl UA)
    rss/                # RSS/Atom feed parser
    settings/           # Key-value store CRUD + export/import
    upload/             # File upload handler
    youtube/            # YouTube channel + video resolver
  generated/prisma/     # Prisma-generated client
  globals.css           # CSS variable theming system
  layout.tsx            # Root layout, fonts, FOUC prevention
  login/page.tsx        # Password login page
  digest/page.tsx       # Morning briefing page — AI summary of today's widget content
  page.tsx              # Main dashboard page

components/
  F1Widget.tsx
  NotepadWidget.tsx
  ReaderWidget.tsx
  RedditWidget.tsx
  RssWidget.tsx
  TextWidget.tsx
  WidgetCard.tsx        # Fallback/empty widget shell
  WidgetGrid.tsx        # Grid layout, shelf, drag-drop, persistence
  YoutubeWidget.tsx
  TopBar.tsx            # Header with editable fields, date/clock, dark mode

lib/
  auth.ts               # HMAC-SHA256 session token creation/verification
  prisma.ts             # Prisma client singleton
  storage.ts            # Client-side storage API wrapper
  widgets.ts            # Widget type definitions and color map

middleware.ts           # Auth gate — redirects to /login if no valid session
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

## Theming

Dark/light mode is implemented via CSS custom properties on `:root` and `.dark`. The `.dark` class is toggled on `<html>` by the TopBar button and persisted in `localStorage`. A `suppressHydrationWarning` attribute on `<html>` and an inline script in `<head>` prevent FOUC.

Tailwind v4 `dark:` utility variants are configured with `@variant dark (&:where(.dark, .dark *))` in `globals.css`, binding them to the `.dark` class rather than the default `prefers-color-scheme` media query.

See [globals.css](../app/globals.css) for the full variable list.
