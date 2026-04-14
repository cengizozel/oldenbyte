# oldenbyte

A personal dashboard built with Next.js. Widgets are draggable, resizable, and persist their state to a local SQLite database.

## Widgets

- **Notebook** - a daily notepad with a built-in calendar to browse past entries
- **Reader** - upload and read PDF or EPUB files, with full-screen view and saved position
- **Text** - display any text or live string fetched from a URL, auto-fit to the widget size
- **Feed** - subscribe to any RSS feed, headlines cached daily

## Stack

- **Next.js 16** with App Router and TypeScript
- **Tailwind CSS** for styling
- **Prisma + SQLite** for persistent storage
- **react-grid-layout** for drag and drop widget management
- **react-pdf** and **epubjs** for document rendering

## Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`. A local SQLite database is created automatically at `data/uploads/` on first run.

## Self-hosting with Docker

```bash
docker compose up -d
```

The app is exposed on port `3847`. Data (database and uploaded files) is persisted in `./data/` on the host.

Watchtower is included and polls for new image versions every 5 minutes, pulling and restarting the container automatically when a new build is pushed.

## Deployment

Pushing to `main` triggers a GitHub Actions workflow that builds and pushes a Docker image to GHCR. Watchtower on the server picks it up automatically.
