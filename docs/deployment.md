# Deployment

## Docker

The recommended deployment method is Docker Compose. The image is published to GitHub Container Registry on every push to `main`.

### Setup

**1. Create a `.env` file:**
```env
DASHBOARD_PASSWORD=your-password
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
      - DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}
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
| `data/db.sqlite` | All settings, widget configs, and cached feed data |
| `data/uploads/` | Uploaded PDF and EPUB files |

Back up this directory to preserve your dashboard state.

---

## CI/CD

Pushing to `main` triggers `.github/workflows/deploy.yml`, which:

1. Logs in to GitHub Container Registry using `GITHUB_TOKEN` (automatic, no setup required)
2. Builds the Docker image from the repo root
3. Pushes it as `ghcr.io/<owner>/oldenbyte:latest`

Watchtower polls every 5 minutes for a new `latest` tag and automatically pulls and restarts the container.

---

## Local Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`. A local SQLite database is created at `prisma/dev.db` on first run (the `DATABASE_URL` default in `lib/prisma.ts`).

No `.env` file is required for local development — `DASHBOARD_PASSWORD` and `SESSION_SECRET` are optional and fall back to insecure defaults.
