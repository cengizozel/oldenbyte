# Widget System

## Overview

Widgets are React components rendered inside a `react-grid-layout` grid. Each widget has a type, a color, and a unique instance ID. Multiple instances of the same widget type can exist simultaneously.

## Widget Definition

All built-in widget types are registered in the `widgets` array in `lib/widgets.ts`. A registry entry is a template; placing it creates an instance with the same fields:

```ts
type Widget = {
  id: string;              // template id, or the instance id once placed (e.g. "notebook", "rss-1776129788318")
  type: WidgetType;        // "notebook" | "ebook" | "text" | "rss" | "reddit" | "youtube" | "f1" | "weather" | "calendar"
                           // | "schedule" | "arxiv" | "hf" | "tracker" | "rhythm" | "upkeep" | "bookmarks" | "typing"
                           // | "chess" | "tv" | "chat" | "kiwix" | "anytype" | "custom" | "empty"
  color: WidgetColor;      // "amber" | "sky" | "neutral" | "rose" | "teal" | "orange"
  title: string;           // picker label and default instance title
  description: string;     // picker tooltip
  digestable?: boolean;    // whether this widget appears in /digest (default: true)
  category?: WidgetCategory; // picker group: "feeds" | "tools" | "knowledge" | "ai"
  bankId?: string;         // type "custom" only: which widget-bank definition renders it
  defaultSize?: WidgetSize;  // registry only: starting { w, h } in grid cells
};
```

`defaultSize` lives only on registry entries: `instanceOf()` strips it so it is never saved on placed instances, and `defaultSizeFor(type)` reads it (falling back to 2x2). The registry has no icon field: each widget component renders its own header icon (lucide-react).

`digestable` defaults to `true`: widgets appear in the digest unless explicitly set to `false`. Currently `notebook`, `ebook`, `tracker`, `schedule`, `rhythm`, `upkeep`, `bookmarks`, `typing`, `chess`, `chat`, `kiwix`, `anytype` and `tv` are `false`. The `/digest` page looks up each widget's definition at runtime to apply this filter, and only has loaders for `text`, `weather`, `calendar`, `f1`, `rss`, `reddit`, `youtube`, `arxiv` and `hf`; community (`custom`) widgets are skipped.

The `colorMap` in `lib/widgets.ts` maps each color to a set of Tailwind CSS variable classes (`bg`, `border`, `label`, `text`, `fade`, `glow`, `icon`) that all widget components consume.

## Adding a Widget Type

1. Add the type to `WidgetType` and a registry entry (with `defaultSize`, `category`, and `digestable: false` unless the digest should include it) in `lib/widgets.ts`.
2. Write the component (`components/<Name>Widget.tsx`, props `{ widget, className }`) and add it to `WIDGET_COMPONENTS` in `components/WidgetGrid.tsx`.
3. If the chat's `read_widget` tool should read it, add a reader to `lib/widgetData.ts`.
4. If it is digestable, add a loader to `loadSection` in `app/digest/page.tsx`.
5. Add a doc under `docs/widgets/`.

## Layout Persistence

The grid layout is persisted in two separate storage keys:

- **`widget-layout`** (or `widget-layout:<dashboardId>` for dashboards other than the default) - array of `TabLayoutItem` objects (extends `react-grid-layout`'s `LayoutItem` with an optional `tabs` field), each with `i` (instance ID), `x`, `y`, `w`, `h`, and optionally `tabs`
- **`widget-instances`** (or `widget-instances:<dashboardId>`) - object mapping instance ID to the full `Widget` config

These are loaded from the database on hydration and saved on every layout change. The `tabs` array is preserved across drag/resize by merging it back in `onLayoutChange`.

## Placing Widgets

In edit mode, a floating shelf appears with all available widget types, grouped by category, plus a Community group. Clicking or dragging a widget from the shelf calls `addWidget()`, which:

1. Assigns a new instance ID (`{template id}-{Date.now()}`) and numbers the title when the type is already on the grid ("Feed 2")
2. Scores every empty grid cell by available area (capped at the widget's default size) and places it in the best-fitting gap, falling back to appending below the grid if no gaps exist
3. Appends the new item to both `layout` and `instances`, which are then persisted

The starting size comes from the registry entry's `defaultSize`; community widgets use their definition's `defaultSize` (default 1x3). Current defaults:

| Type | w | h |
|---|---|---|
| notebook | 2 | 2 |
| ebook | 2 | 3 |
| text | 2 | 1 |
| rss | 2 | 3 |
| reddit | 1 | 3 |
| youtube | 1 | 3 |
| weather | 1 | 3 |
| f1 | 1 | 2 |
| arxiv | 2 | 3 |
| hf | 2 | 3 |
| calendar | 1 | 3 |
| tracker | 1 | 3 |
| schedule | 2 | 4 |
| rhythm | 1 | 3 |
| upkeep | 1 | 3 |
| bookmarks | 1 | 3 |
| typing | 2 | 3 |
| chess | 2 | 4 |
| chat | 1 | 4 |
| kiwix | 1 | 4 |
| anytype | 1 | 4 |
| tv | 2 | 3 |

## Community Widgets

Widgets do not have to be React components. A JSON file dropped into `widget-bank/` defines a fetch-and-display widget (type `custom`) that the dashboard renders with the same card chrome, colors, and dark mode as built-ins, with no code execution. See [Widget Bank](../widget-bank.md).

## Tab Grouping

Any two widgets can be merged into a tabbed cell in edit mode.

**Data model:**

```ts
type TabLayoutItem = LayoutItem & { tabs?: string[] };
```

The layout item with ID `i` is the container. `tabs` holds the IDs of additional widgets grouped into it. `activeTabs: Record<string, string>` tracks which tab is currently visible per container (defaults to `i` itself).

**Grouping flow:**
1. Click the `Layers` icon on any widget - it enters grouping mode (highlighted with a blue border)
2. Click another widget's "Add as tab" overlay - the source widget is removed from the layout and added to the target's `tabs` array
3. Click the same `Layers` icon again to cancel

**Ungrouping:**
- In edit mode, each non-primary tab in the tab bar has a close button that removes it from the group and places it back in the next available grid gap
- Removing the whole cell (the close button on the cell) removes the container and all its tabs from both `layout` and `instances`

## Rendering

`WidgetGrid.tsx` maps each widget type to its component in `WIDGET_COMPONENTS`; `renderWidget()` looks the type up there (type `custom` renders `BankWidget`, unknown or `empty` types render `WidgetCard`), and `renderWithTabs()` wraps it with a tab bar when a cell contains grouped widgets:

```ts
const WIDGET_COMPONENTS: Record<Exclude<WidgetType, "custom" | "empty">, ComponentType<WidgetProps>> = {
  notebook: NotebookWidget,
  text: TextWidget,
  rss: RssWidget,
  // ...
};
```

Each widget renders once, through a portal into its own persistent DOM node, so toggling edit mode or crossing a view-mode breakpoint moves the node instead of remounting the widget (chat streams, readers and feeds keep running).

`ReaderWidget`, `ChessWidget` and `TvWidget` are loaded with `dynamic(..., { ssr: false })` because epubjs, pdf.js, the Stockfish worker and the video players require browser APIs.

In edit mode, the tab bar is rendered outside the `pointer-events-none` wrapper so tab switching and ungrouping remain interactive.

## Colors

Each widget uses a color palette defined as CSS custom properties, allowing automatic light/dark mode switching without any JavaScript:

```ts
amber: {
  bg:     "bg-[var(--w-amber-bg)]",
  border: "border-[var(--w-amber-border)]",
  label:  "text-[var(--w-amber-label)]",
  text:   "text-[var(--w-amber-text)]",
  fade:   "from-[var(--w-amber-bg)]",
  glow:   "w-amber-glow",
  icon:   "text-[var(--w-amber-text)]",
}
```

The `fade` class is used for scroll fade gradients that blend into the widget background.

The `icon` class is the single source of truth for small action-icon colors (the pencil, history, settings, clear icons in widget headers). It uses each palette's `text` tone, which is the higher-contrast-against-background shade in **both** modes (darker than `label` in light mode, lighter than `label` in dark mode) so icons stay clearly visible on every widget regardless of hue. Change icon contrast here, not in each widget.
