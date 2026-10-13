# Deployment

## Docker

The recommended deployment method is Docker Compose. The image is published to GitHub Container Registry on every push to `main`.

### Setup

**1. Create a `.env` file:**
```env
SESSION_SECRET=<output of: openssl rand -hex 32>
```

**2. Initialize the data directory:**
```bash
mkdir -p data
touch data/db.sqlite
chmod 666 data/db.sqlite
```

The SQLite file must be writable by the container process. If you see `SQLITE_CANTOPEN` or `SQLITE_READONLY` errors, check that `data/db.sqlite` has `666` permissions and the `data/` directory has `777`.

**3. Start:**
```bash
docker compose up -d
```

The app is available on port `3847`.

### docker-compose.yml

```yaml
services:
  app:
    image: ghcr.io/cengizozel/oldenbyte:latest
    ports:
      - "3847:3000"
    restart: unless-stopped
    environment:
      - DATABASE_URL=file:/app/data/db.sqlite
      - UPLOADS_DIR=/app/data/uploads
      - SESSION_SECRET=${SESSION_SECRET}
    volumes:
      - ./data:/app/data

  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${HOME}/.docker/config.json:/config.json:ro
    command: --interval 300 oldenbyte-app-1
    restart: unless-stopped
```

### Data Persistence

All persistent data lives in `./data/` on the host:

| Path | Contents |
|---|---|
| `data/db.sqlite` | Accounts, sessions, app config, and every user's settings, widget configs and cached widget data |
| `data/library/<userId>/` | Each user's reader library (PDF and EPUB files, with folders); override with `LIBRARY_DIR` |
| `data/uploads/<userId>/` | Files uploaded before the reader library existed (UUID names) |

The database tables are created, and a legacy single-user table migrated, at startup by `instrumentation.ts`; there is no separate migration step. Old cache rows and expired sessions are cleaned up at startup and every 6 hours.

Back up this directory to preserve your dashboard state.

---

## CI/CD

Pushing to `main` triggers `.github/workflows/deploy.yml`, which has two jobs:

1. `check`: installs dependencies and runs `npm run typecheck`, `npm run lint` and `npm test`. A commit that fails any of them never reaches the registry, so Watchtower never deploys it.
2. `build` (only after `check` passes): logs in to GitHub Container Registry using `GITHUB_TOKEN` (automatic, no setup required), builds the Docker image from the repo root, and pushes it as `ghcr.io/cengizozel/oldenbyte:latest` and `ghcr.io/cengizozel/oldenbyte:<commit sha>`.

Watchtower polls every 5 minutes for a new `latest` tag and automatically pulls and restarts the container. To roll back, point the compose file at a `:<commit sha>` tag.

---

## Local Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`. A local SQLite database is created at `prisma/dev.db` on first run (the `DATABASE_URL` default in `lib/prisma.ts`).

Before pushing, run the same checks as CI:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint, see eslint.config.mjs
npm test            # vitest unit tests in tests/
```

No `.env` file is required for local development: `SESSION_SECRET` is optional and falls back to an insecure default. The first visit to the login page creates the admin account.
