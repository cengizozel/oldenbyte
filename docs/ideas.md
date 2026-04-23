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

---

## Hosted Service + Open Source Model

Open source the core so anyone can self-host. Run a hosted version at a proper domain for people who don't want to manage infrastructure. Standard model (Plausible, Gitea, Umami).

### The hosted service

- **Landing page** — explains the concept, shows the dashboard in action, clear call to action
- **Smart onboarding** — instead of dropping users into a blank grid, ask 3–5 questions (interests, field of work, content sources) and auto-generate a sensible starting layout from the widget bank. Eliminates the blank canvas problem and demonstrates the product immediately
- **Account system** — OAuth (Google, GitHub) for low-friction signup, persistent layouts and settings tied to account
- **Free tier** — core dashboard, limited widgets, no AI digest
- **Paid tier** — full widget count, AI digest (no need to bring your own OpenAI key), widget bank access, possibly custom domain

### The moat

The code being public doesn't undermine the hosted service. Self-hosters still have to manage a server, a database, Docker, and their own OpenAI key. The hosted version's value is convenience + the onboarding experience + managed AI features. That's a real differentiator even with an identical codebase.

### Smart onboarding detail

User picks interests from a tag list or types free-form. The system maps those to widget presets from the bank and generates a layout config — either rule-based (interest tags → widget types) or AI-assisted. This is also a strong marketing moment: the dashboard looks immediately useful on first load rather than requiring 20 minutes of configuration.

### Revenue model

- Free tier drives adoption and open source credibility
- Paid tier covers hosting costs and funds continued development
- Widget bank grows the ecosystem and makes the product more valuable for everyone

---

## Academic Research Angle

The productivity angle could support an academic paper, primarily in **Human-Computer Interaction (HCI)** — specifically Personal Information Management (PIM) and ambient information displays. Natural venues: CHI or CSCW.

### Research questions worth pursuing

- Does a unified information surface reduce context-switching and improve focus vs. a fragmented multi-tab workflow?
- How do people's information consumption patterns change when content is passively surfaced vs. actively sought?
- What widget compositions correlate with sustained daily engagement vs. abandonment?

### What a conference-worthy study needs

- **Participants** — 16–24 for a controlled study, 8–12 for qualitative
- **Longitudinal design** — days or weeks, not a one-hour lab session; CHI reviewers weight this heavily
- **Measurable outcomes** — tab switch count, NASA-TLX cognitive load scale, time-on-task, information recall, daily active use over time
- **Qualitative component** — semi-structured interviews to explain the "why" behind numbers
- **IRB approval** — required before collecting any data
- **A counterintuitive finding** — something that changes how people think about the design space (e.g. unified display increases source diversity, not reduces it; more customization correlates with higher abandonment). Confirming the obvious doesn't get accepted.

Realistic timeline from study design to publication: 12–18 months. UIST or IMWUT are slightly more accessible venues for a first paper in this space.
