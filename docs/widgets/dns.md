# DNS Widget

What your DNS blocker has done: queries, how many were blocked and what share, plus the average answer time (AdGuard Home) or the size of the blocklists (Pi-hole).

## Storage Keys

| Key | Value |
|---|---|
| `dns-widget-{id}` | JSON: `{ kind, url, username, password }` |

- `kind` - `adguard` or `pihole`
- `url` - where you open the blocker, without `/admin`
- `username` - AdGuard Home only
- `password` - the sign-in password; on Pi-hole version 5, the API token from its settings

The password is stored with the widget's settings, like the Calendar's, and sent to the dashboard's server with each request (`POST /api/dns-stats`).

## Behaviour

- Saving tries the connection first: a refused password or an unreachable address is reported in settings and nothing is saved.
- AdGuard Home: `GET /control/stats` with basic authentication. The figures cover AdGuard's own statistics period (24 hours by default).
- Pi-hole 6: signs in at `/api/auth` and reads `/api/stats/summary`. Pi-hole limits how many sessions exist, so the server keeps one per blocker and reuses it. Pi-hole 5: `/admin/api.php?summaryRaw`.
- Read once a minute while the dashboard is showing.

Not digestable.

(component: `components/DnsWidget.tsx`, server: `lib/dnsStats.ts`)
