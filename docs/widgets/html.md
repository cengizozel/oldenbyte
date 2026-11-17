# HTML Widget

Your own HTML, CSS and JavaScript as a widget: a countdown, a formatted note, a small tool.

## Storage Keys

| Key | Value |
|---|---|
| `html-widget-{id}` | JSON: `{ html, name, network }` |

- `html` - the markup, up to 200,000 characters; `<style>` and `<script>` are allowed
- `name` - shown as the widget's title
- `network` - whether its scripts may contact servers (default off)

## How it is kept safe

The markup is not placed in the dashboard's page. It runs in an iframe sandboxed without `allow-same-origin`, which gives it an origin of its own (`null`):

- its scripts run, but cannot read the dashboard's page, cookies, storage, other widgets or the session;
- it cannot navigate the dashboard; links open in a new tab;
- a content security policy inside the frame decides what it may load. Network off: inline styles and scripts, images and media over https, nothing else, so a script cannot send anything anywhere. Network on: `fetch` to the web, and scripts, styles and fonts from https.

This holds whatever the markup contains, so a widget copied from somewhere else cannot reach your account.

## Styling

The frame starts with the dashboard's font at 14px and a transparent background. Two variables carry the card's own colors, so your markup matches the widget's palette in every theme: `var(--text)` and `var(--muted)`.

Not digestable.

(component: `components/HtmlWidget.tsx`)
