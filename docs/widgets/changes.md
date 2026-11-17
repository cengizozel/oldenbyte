# Changes Widget

The pages you watch with [changedetection.io](https://github.com/dgtlmoon/changedetection.io): which changed and when, newest first. A changed page opens its diff there; one that has not changed opens the page itself.

## Storage Keys

| Key | Value |
|---|---|
| `changes-widget-{id}` | JSON: `{ url, apiKey }` |

`apiKey` is the key from changedetection.io's Settings, API tab. It is stored with the widget's settings and sent to the dashboard's server with each request (`POST /api/changedetection`).

## Behaviour

- Saving tries the connection first: a refused key or an unreachable address is reported in settings and nothing is saved.
- A green dot and a bolder title mark a change you have not looked at yet in changedetection.io; a red dot marks a watch whose last check failed, with its error.
- A watch is named by its own title, else the page's title, else its address.
- Read every five minutes while the dashboard is showing.

Not digestable.

(component: `components/ChangesWidget.tsx`, server: `lib/changedetection.ts`)
