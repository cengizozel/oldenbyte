# Widget System

## Overview

Widgets are React components rendered inside a `react-grid-layout` grid. Each widget has a type, a color, and a unique instance ID. Multiple instances of the same widget type can exist simultaneously.

## Widget Definition

All widget types are defined in `lib/widgets.ts`:

```ts
type Widget = {
  id: string;        // unique instance ID (e.g. "notebook", "rss-1776129788318")
  type: WidgetType;  // "notebook" | "ebook" | "text" | "rss" | "reddit" | "youtube" | "f1"
  color: WidgetColor; // "amber" | "sky" | "neutral" | "rose" | "teal" | "orange"
  title: string;
  description: string;
};
```

The `colorMap` in `lib/widgets.ts` maps each color to a set of Tailwind CSS variable classes (`bg`, `border`, `label`, `text`, `fade`) that all widget components consume.

## Layout Persistence

The grid layout is persisted in two separate storage keys:

- **`widget-layout`** — array of `react-grid-layout` `LayoutItem` objects, each with `i` (instance ID), `x`, `y`, `w`, `h`
- **`widget-instances`** — object mapping instance ID → full `Widget` config

These are loaded from the database on hydration and saved on every layout change.

## Adding Widgets

In edit mode, a floating shelf appears with all available widget types. Clicking or dragging a widget from the shelf calls `addWidget()`, which:

1. Assigns a new instance ID (`{type}-{Date.now()}`)
2. Finds the first empty grid cell
3. Appends the new item to both `layout` and `instances`
4. Persists both to the database

## Rendering

`WidgetGrid.tsx` has a `renderWidget()` function that maps widget type to component:

```ts
if (widget.type === "notebook") return <NotepadWidget widget={widget} />;
if (widget.type === "rss")      return <RssWidget widget={widget} />;
// ...
```

The `ReaderWidget` is loaded with `dynamic(..., { ssr: false })` because epubjs and pdf.js require browser APIs.

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
