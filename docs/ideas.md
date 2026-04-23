# Ideas

A scratchpad for thinking out loud — half-formed ideas, future directions, things worth revisiting. Nothing here is planned or committed.

---

## Community Widget Bank

The goal is to let third-party devs or community contributors add widgets without writing React components. Each widget is a declarative config file that lives in a directory and automatically shows up in the widget picker.

Inspired by [Glance's community widgets](https://github.com/glanceapp/community-widgets), but instead of HTML templates, use a structured data-mapping schema that renders using the existing UI.

### How it would work

A new `custom` widget type backed by a `public/widget-bank/` directory. Each file is one widget:

```json
{
  "id": "github-trending",
  "title": "GitHub Trending",
  "description": "Top trending repos right now",
  "color": "neutral",
  "defaultSize": { "w": 1, "h": 3 },
  "digestable": true,
  "fetch": {
    "url": "https://api.github.com/...",
    "cache": "1h"
  },
  "items": {
    "path": "items",
    "title": "full_name",
    "subtitle": "description",
    "link": "html_url",
    "meta": "stargazers_count"
  }
}
```

The `items` block is a path mapping — it tells the widget how to extract a list of items from the JSON response and which fields map to title, subtitle, link, and meta. No arbitrary code execution, no HTML injection.

### Pieces to build

1. **`CustomWidget.tsx`** — fetches the URL server-side (via `/api/proxy` or a dedicated `/api/custom` route), maps the response using the `items` schema, renders with the existing card/list UI and color system
2. **`public/widget-bank/*.json`** — the community directory; each file is one widget definition
3. **Widget picker update** — reads bank files at build time and shows them as a separate section alongside built-in widgets
4. **`digestable` default** — false for custom widgets unless explicitly set in the config

### Contributor flow

Submit a PR with a single JSON file. No React knowledge required, no code review needed for security — just a config that declares what to fetch and how to map it.

### Constraints

The `items` mapping schema handles list-style feeds well (trending repos, leaderboards, API data, news sources) but can't do arbitrary layouts. That covers ~90% of useful community widgets. Anything that needs a truly custom UI would still require a built-in widget.
