# Monitor Widget

Whether your sites and services are answering: one row each, a dot for up or down and the response time. A row opens the address.

## Storage Keys

| Key | Value |
|---|---|
| `monitor-widget-{id}` | JSON: `{ sites: { id, name, url }[] }` |

## Behaviour

- Checks run from the dashboard's server (`GET /api/monitor?url=`), once a minute while the dashboard is showing, plus the refresh button. A result is kept for 20 seconds so several open tabs do not multiply the checks.
- Up means the server answered below HTTP 500: a page asking you to sign in (401, 403) is a service that is running. Down shows the status code, "no answer" or "timed out" (8 seconds).
- Like every outbound request, the admin may point it at addresses on the local network; other accounts at public addresses only (`lib/ssrf.ts`).
- An address typed without a scheme is taken as https.
- A https service with a self-signed certificate reads as down, since the certificate cannot be verified.

Not digestable.

(component: `components/MonitorWidget.tsx`, server: `app/api/monitor/route.ts`)
