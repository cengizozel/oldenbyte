# oldenbyte

A personal dashboard built with Next.js. Widgets are draggable, resizable, and persist their state to a local SQLite database. Multiple named dashboards, each with its own layout and widgets, switchable from the top bar. Responsive for mobile portrait view.

![screenshot](public/screenshot.png)

## Widgets

- **Notepad** - a daily notepad with a built-in calendar to browse past entries; multiple instances each get a numbered tab when browsing a past date; renameable
- **Reader** - upload and read PDF or EPUB files, with full-screen view, saved position, and a Kindle-style progress bar
- **Text** - display any static text or a live string fetched from a URL endpoint
- **Feed** - subscribe to any RSS feed, configurable item count, refetches on every page load
- **Reddit** - top posts from one or more subreddits, selectable time period and post count, interleaved across subreddits, refetches on every page load
- **YouTube** - latest videos from one or more channels, sorted newest-first with a "new" badge for uploads under 24 hours, refetches on every page load
- **Weather** - current conditions and a daily forecast for any place (search by name, °C/°F toggle), refreshed every 30 minutes
- **F1** - next race details with countdown and current top 5 driver standings, updated hourly
- **arXiv** - latest papers from a chosen research field (CS, Math, Physics, and more), with abstract view on click, refetches on every page load
- **HF Daily** - trending AI papers curated by Hugging Face, sorted by upvotes, refetches on every page load
- **Calendar** - upcoming events from any CalDAV server (Nextcloud, Radicale, ...); connect once, pick which calendars to show, and set the agenda window
- **Tracker** - time how long you spend on each activity with a one-tap stopwatch (only one runs at a time) and a donut chart of the day's breakdown; keeps a full per-day history with streaks, week-over-week stats, and editable past durations, and time that crosses midnight is credited to the day it happened in
- **Chess** - play an ongoing game against the Stockfish engine with an adjustable Elo difficulty; the game persists between visits
- **Kiwix** - search an offline [Kiwix](https://kiwix.org/) library (Wikipedia, WikiHow, …) running on your network; enter the server URL, pick a book, and full-text search results link straight to the article
- **Anytype** - browse and search your own [Anytype](https://anytype.io/) spaces; pair once with the local desktop app (a 4-digit code), pick a space, then search your objects with results that open straight in Anytype
- **Chat** - chat with any OpenAI-compatible model (Ollama, LM Studio, llama.cpp, vLLM, OpenAI, …) by entering the API URL and model name; responses stream in real-time and the conversation persists. Highlights:
  - **Dashboard lookup** toggle hands the model `read_widget` and `search_dashboard` tools so it reads your notes, feeds, and tracked time on demand ("what's new on arXiv?", "what did I note last Tuesday?"), with paging and keyword-find for long content; you choose per widget what it may read. A separate **calendar** toggle lets it list and create events through the Calendar widget's account
  - **Kiwix lookup** toggle hands the model search tools for an offline [Kiwix](https://kiwix.org/) library (agentic RAG) so it can look facts up mid-conversation and cite what it read
  - **Anytype lookup** toggle does the same for your own [Anytype](https://anytype.io/) notes - it searches, reads (with `find`/page navigation for long notes), and can map-reduce **summarize** a whole journal too big to fit in context, while honouring each note's dates and metadata
  - **Characters** - create personas, each with its own system prompt and a private, *scoped* long-term memory: give one a focus (e.g. an education coach) and it auto-remembers what you tell it that fits (your studies) while ignoring the rest (your trip)
  - **Model control** - for Ollama/LM Studio, a status pill shows whether the model is loaded and lets you set how long it lingers in VRAM, pin it, or unload it on demand
  - Regenerate a reply from any of your messages, edit your past messages to rewind, and an auto-growing composer for multi-line input

## Community widget bank

Widgets can also be defined as single JSON files in `widget-bank/`: declare a URL to fetch and map fields onto a small set of themed primitives (lists, stat rows, sparklines, ...), no React required. Valid definitions appear in the edit-mode picker under **Community**; invalid ones are skipped with reported errors. See [docs/widget-bank.md](docs/widget-bank.md).

## Morning digest

<img src="public/digest.gif" width="400" />

`/digest` is a separate page that reads today's cached widget data and generates a newspaper-style AI briefing using any OpenAI-compatible model - a local one (Ollama, LM Studio, llama.cpp) or a hosted provider. Set the endpoint URL, model, and optional API key via the **model** control in the masthead (stored in `localStorage`). Each widget section gets its own API call, running in parallel. A streaming mode toggle streams each section's text in real-time as it's generated. Accessible from the main dashboard via the newspaper icon in the top bar.

## Top bar

The left and right text fields are editable and can display either a static string or a live value fetched from any URL that returns plain text (for example a weather or IP address endpoint). The center shows a configurable date or clock with the action buttons (dashboard switcher, digest, layout edit, settings) grouped below it. The switcher creates, renames, and deletes dashboards; the settings panel holds the dark mode toggle. Dark mode preference is persisted to the database, and pressing **Shift+D** toggles it from anywhere (except while typing in a field).

## Stack

- **Next.js 16** with App Router and TypeScript
- **Tailwind CSS v4** for styling
- **Prisma + SQLite** for persistent storage
- **react-grid-layout** for drag and drop widget management
- **react-pdf** and **epubjs** for document rendering
- **chess.js** and **react-chessboard** with **Stockfish** (WebAssembly) for the chess widget

## Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`. A local SQLite database is created automatically at `data/` on first run.

## Self-hosting with Docker

**1. Create a `.env` file** next to `docker-compose.yml`:

```
DASHBOARD_PASSWORD=your-password
SESSION_SECRET=<random hex string>
```

Generate a secret with:

```bash
openssl rand -hex 32
```

**2. Initialize the data directory:**

```bash
mkdir -p data
touch data/db.sqlite
chmod 666 data/db.sqlite
```

**3. Start the container:**

```bash
docker compose up -d
```

The app is exposed on port `3847`. Data (database and uploaded files) is persisted in `./data/` on the host.

Watchtower is included and polls for new image versions every 5 minutes, pulling and restarting the container automatically when a new build is pushed.

## Credits

- F1 circuit outlines by [Jules Roy](https://github.com/julesr0y/f1-circuits-svg), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Chess engine: [Stockfish](https://stockfishchess.org/) compiled to WebAssembly via [stockfish.js](https://github.com/nmrugg/stockfish.js), licensed under [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)

## Deployment

Pushing to `main` triggers a GitHub Actions workflow that builds and pushes a Docker image to GHCR. Watchtower on the server picks it up automatically.
