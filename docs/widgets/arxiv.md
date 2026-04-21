# arXiv Widget

Displays the latest papers from a chosen research field fetched from arXiv RSS feeds. Clicking a paper title slides in a detail view with the abstract, authors, and date.

## Storage Keys

| Key | Value |
|---|---|
| `arxiv-widget-{id}` | JSON: `{ group: number; category: string }` |
| `arxiv-widget-{id}-{YYYY-MM-DD}` | Daily cache of fetched papers |

The cache is keyed by date so it is reused for the rest of the day and refreshed on the next.

## Settings

Two-level selection:

1. **Field** — a broad research area (e.g. "Computer Science", "Physics"). Defined in `CATEGORY_GROUPS`, each with a label and an array of subcategories.
2. **Topic** — a specific arXiv category within that field (e.g. `cs.AI`, `physics.optics`).

Available groups:

| Group | Example categories |
|---|---|
| Computer Science | cs.AI, cs.LG, cs.CV, cs.CL, cs.RO, cs.CR, cs.SE, cs.NE |
| Mathematics | math.AG, math.NT, math.PR, math.ST, math.OC |
| Physics | physics.optics, physics.flu-dyn, physics.app-ph, physics.chem-ph |
| Astrophysics | astro-ph.GA, astro-ph.CO, astro-ph.HE, astro-ph.EP |
| Biology | q-bio.NC, q-bio.GN, q-bio.BM, q-bio.CB |
| Statistics | stat.ML, stat.AP, stat.ME, stat.TH |
| Electrical Engineering | eess.SP, eess.IV, eess.AS, eess.SY |
| Economics | econ.EM, econ.GN, econ.TH |

## Feed Fetching

Papers are fetched via the existing `GET /api/rss?url=…` route using arXiv's RSS endpoint:

```
https://rss.arxiv.org/rss/{category}
```

The route auto-detects RSS 2.0 vs Atom by checking for `<entry>` tags. arXiv uses RSS 2.0, so items are parsed from `<item>` elements.

## Content Parsing

arXiv RSS `<description>` fields contain HTML-encoded text with "Authors:" and "Abstract:" sections. `parseContent()`:

1. Strips all HTML tags
2. Extracts the authors line (text after "Authors:" up to the next label or end)
3. Extracts the abstract (text after "Abstract:")
4. Removes the HTML-encoded link suffix arXiv appends to descriptions

## List and Detail Views

The list and detail panels use the same absolute-position slide pattern as Reddit and HF Daily: both panels sit side-by-side in an `overflow-hidden` container and slide in/out via CSS `translate-x` transitions.

- **List** — 25 paper titles, each with an external link icon on hover
- **Detail** — authors, publication date, and abstract; scroll fades on both panels

## Scroll Fades

Both the list and detail panels track top/bottom fade overlays via `ResizeObserver` and scroll events.
