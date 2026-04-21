# Widget System

## Overview

Widgets are React components rendered inside a `react-grid-layout` grid. Each widget has a type, a color, and a unique instance ID. Multiple instances of the same widget type can exist simultaneously.

## Widget Definition

All widget types are defined in `lib/widgets.ts`:

```ts
type Widget = {
  id: string;        // unique instance ID (e.g. "notebook", "rss-1776129788318")
  type: WidgetType;  // "notebook" | "ebook" | "text" | "rss" | "reddit" | "youtube" | "f1" | "arxiv" | "hf"
  color: WidgetColor; // "amber" | "sky" | "neutral" | "rose" | "teal" | "orange"
  title: string;
  description: string;
};
```

The `colorMap` in `lib/widgets.ts` maps each color to a set of Tailwind CSS variable classes (`bg`, `border`, `label`, `text`, `fade`) that all widget components consume.

## Layout Persistence

The grid layout is persisted in two separate storage keys:

- **`widget-layout`** — array of `TabLayoutItem` objects (extends `react-grid-layout`'s `LayoutItem` with an optional `tabs` field), each with `i` (instance ID), `x`, `y`, `w`, `h`, and optionally `tabs`
- **`widget-instances`** — object mapping instance ID → full `Widget` config

These are loaded from the database on hydration and saved on every layout change. The `tabs` array is preserved across drag/resize by merging it back in `onLayoutChange`.

## Adding Widgets

In edit mode, a floating shelf appears with all available widget types. Clicking or dragging a widget from the shelf calls `addWidget()`, which:

1. Assigns a new instance ID (`{type}-{Date.now()}`)
2. Scores every empty grid cell by available area (capped at the widget's default size) and places in the best-fitting gap, falling back to appending below the grid if no gaps exist
3. Appends the new item to both `layout` and `instances`
4. Persists both to the database

Default sizes per type:

| Type | w | h |
|---|---|---|
| notebook | 2 | 2 |
| ebook | 2 | 3 |
| text | 2 | 1 |
| rss | 2 | 3 |
| reddit | 1 | 3 |
| youtube | 1 | 3 |
| f1 | 1 | 2 |
| arxiv | 2 | 3 |
| hf | 2 | 3 |

## Tab Grouping

Any two widgets can be merged into a tabbed cell in edit mode.

**Data model:**

```ts
type TabLayoutItem = LayoutItem & { tabs?: string[] };
```

The layout item with ID `i` is the container. `tabs` holds the IDs of additional widgets grouped into it. `activeTabs: Record<string, string>` tracks which tab is currently visible per container (defaults to `i` itself).

**Grouping flow:**
1. Click the `Layers` icon on any widget — it enters grouping mode (highlighted with a blue border)
2. Click another widget's "Add as tab" overlay — the source widget is removed from the layout and added to the target's `tabs` array
3. Click the same `Layers` icon again to cancel

**Ungrouping:**
- In edit mode, each non-primary tab in the tab bar has a `×` that removes it from the group and places it back in the next available grid gap
- Removing the whole cell (the `×` button on the cell) removes the container and all its tabs from both `layout` and `instances`

## Rendering

`WidgetGrid.tsx` has a `renderWidget()` function that maps widget type to component, and `renderWithTabs()` which wraps it with a tab bar when a cell contains grouped widgets:

```ts
if (widget.type === "notebook") return <NotepadWidget widget={widget} />;
if (widget.type === "rss")      return <RssWidget widget={widget} />;
// ...
```

The `ReaderWidget` is loaded with `dynamic(..., { ssr: false })` because epubjs and pdf.js require browser APIs.

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
}
```

The `fade` class is used for scroll fade gradients that blend into the widget background.
