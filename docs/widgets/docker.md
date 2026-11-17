# Docker Widget

The containers on your Docker host: name, a dot for its state and Docker's own status line ("Up 3 hours (healthy)"). Containers that keep restarting or report unhealthy are listed first, in red.

## Storage Keys

| Key | Value |
|---|---|
| `docker-widget-{id}` | JSON: `{ showStopped: boolean }` |

## Connecting Docker

Off until the operator connects it; the widget then says "Docker is not connected". Two ways:

1. A socket proxy (recommended). The raw Docker socket is root on the host, so give the dashboard a proxy that only allows listing containers, for example `tecnativa/docker-socket-proxy` with `CONTAINERS=1`, and point the dashboard at it:

```yaml
services:
  app:
    environment:
      - DOCKER_HOST=tcp://docker-proxy:2375
  docker-proxy:
    image: tecnativa/docker-socket-proxy
    environment:
      - CONTAINERS=1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

2. The socket itself, read-only, when you accept that the dashboard's container could then ask Docker anything:

```yaml
services:
  app:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

The container's user must be allowed to read the socket (its group on the host). `DOCKER_SOCKET` names another socket path.

## Behaviour

- Admin only (`GET /api/docker`). The server only ever calls `GET /containers/json`.
- Read every 15 seconds while the dashboard is showing.
- Settings can hide stopped containers; ones in trouble are always shown.

Not digestable.

(component: `components/DockerWidget.tsx`, server: `lib/docker.ts`)
