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

---

## UI Component Library for Widget Configs

Instead of locking widget configs into a flat list/card layout, expose a library of safe, themeable UI primitives that widget authors can compose declaratively. No arbitrary code — just references to named components with data paths wired in.

```json
{
  "layout": [
    { "component": "label", "value": "$.raceName" },
    { "component": "progress-bar", "value": "$.lapsCompleted", "max": "$.totalLaps", "color": "accent" },
    { "component": "stat-row", "items": [
      { "label": "Driver", "value": "$.leader" },
      { "label": "Gap",    "value": "$.gap" }
    ]},
    { "component": "badge-list", "path": "$.drivers", "label": "$.code", "color": "$.team_color" }
  ]
}
```

Each primitive is a React component that already understands the color system and dark mode. Widget authors reference them by name and bind data using `$.field` path expressions. The component library is the extension surface — start with a small set and grow it based on what community configs can't express.

### Starting primitives

- `label` — text, supports size/color/weight
- `progress-bar` — value + max, themed
- `stat-row` — horizontal label/value pairs
- `badge-list` — list of colored tags
- `image` — URL to an image with optional caption
- `divider` — horizontal rule
- `sparkline` — small inline chart from an array of numbers

### Growth model

Every time a community widget needs something that can't be expressed with existing primitives, that's a signal to add a new one. The library grows organically from real use cases rather than being designed upfront. Widget configs that use an unknown component name just skip that block gracefully.
