# Design language

The rules every widget and page follows. Shared pieces live in `components/ui/`;
a widget should not restyle what they already provide.

## Type scale

Three sizes plus display numbers, nothing in between, all in the one system sans face (the feed
page is the exception: it sets its headlines and labels in Playfair Display).
Sizes are fixed pixels so a widget looks the same at every card size. The rule
of thumb is Discord's: names, labels and controls are body size, and only
timestamps, counts and badges go small.

| Size | Tailwind | Used for |
|---|---|---|
| 12px | `text-xs` | Meta only: times, counts, badges, the small eyebrow label over a section |
| 14px | `text-sm` | Everything meant to be read or pressed: body text, widget titles, tabs, chips, buttons, settings labels and fields, empty states |
| 16px+ | `text-base`, `text-lg`, `text-2xl` | Numbers meant to be read at a glance (temperature, timers, scores) |

Weight: `font-medium` for titles and list item titles, regular for everything
else. `font-semibold` is reserved for big numbers.

## Color and emphasis

Each widget has one palette (`colorMap` in `lib/widgets.ts`): `bg`, `border`,
`label` (titles and chrome), `text` (content), `icon` (action icons). Page-level
text uses the `--text-primary` / `--text-secondary` / `--text-muted` variables.

Emphasis is done with opacity on the palette color, in three steps only:

| Opacity | Role |
|---|---|
| 100% | Primary content |
| 80% | Secondary content (descriptions, body under a title) |
| 70% | Meta (timestamps, counts, labels, empty states, inactive chips) |

Nothing readable sits below 70%, with one exception: the upcoming words in
Typing sit at 60% so the typed text stands out, which still clears 3:1 in both
themes. Lower values are for decoration: dividers, disabled controls and
hover-only chrome.

## Accessibility

The targets, from WCAG 2.2 level AA, and how the rules above meet them. The
numbers were measured in a browser over every visible text run of the
dashboard and the feed page in both themes (contrast is computed over the
composited background: card over page), so a change to a palette color or to
an opacity step should be re-measured, not assumed.

- Contrast of text (1.4.3): primary and body text, controls and anything in
  the page text colors reach 4.5:1 in both themes. Meta text at the 70% step
  reaches 4.5:1 or better in dark mode and at least 3:1 in light mode (the
  pale card backgrounds cannot carry a translucent label any higher; 3:1 is
  the AA bar for large text and for user interface components and is where
  the secondary label of iOS sits). Nothing readable goes below 3:1.
- Non-text contrast (1.4.11): focus rings and control boundaries are drawn in
  the secondary or muted text color, both at 3:1 or better on the page.
- Target size (2.5.8): every control is at least 24 by 24 CSS pixels (icon
  buttons through `HIT_AREA`, chips and tabs at 28px, detail views
  through `BackButton`); neighbouring icon buttons keep `gap-3` so the areas
  do not overlap.
- Text size: 14px for anything meant to be read or pressed, 12px only for
  meta such as times and counts, 15px for the feed page's serif labels; the page zooms to 200% without
  loss (1.4.4), and touch devices get 16px fields so iOS does not zoom in on
  focus.
- Focus visible (2.4.7) and names: every icon button has an `aria-label`, the
  keyboard layer marks the focused widget, and the hidden inputs that catch
  keys are labelled.

## Spacing

Cards: `rounded-2xl`, 1px border, `p-5` (the `FlipCard` shell does this).
Inside a card the vertical rhythm uses three gaps: `gap-1`/`mb-1` within a
group (icon to label), `gap-2`/`mb-2` between related rows, `gap-3`/`mb-3`
between sections. The header always sits `mb-3` above the content.

Lists separate items with a hairline: `border-t border-black/10 dark:border-white/10`
on every row after the first, `py-2` per row. (The palette border is too close
to the card background in light mode to work as a divider.) Rows that carry
their own rounded fill, such as Tracker activities, use `gap-1` instead.
Grids use `gap-2`.

## Radius

| Radius | Used for |
|---|---|
| `rounded-md` | Chips, inputs, small buttons, inline code |
| `rounded-lg` | Tiles, thumbnails, standard buttons |
| `rounded-xl` | Images, panels, popovers |
| `rounded-2xl` | Cards |
| `rounded-full` | Pills, badges, avatars, toggles |

`rounded` and `rounded-sm` are not used.

## Icons

Lucide icons at three sizes: 12 inside badges and chips, 14 in headers and
inline with text, 16 in the top bar and on standalone buttons. Header icons are
the palette `label` color at 50% opacity.

## Controls

- Header: `WidgetHeader` from `components/ui/WidgetChrome.tsx`: icon, title
  (`text-sm font-medium`, palette label color) and an optional right-hand slot
  for counts and small actions. Every widget shows its title.
- Tab groups: the tab row is the header, in the same place and size as a
  single widget's header. The shown tab is the title (`text-sm font-medium`,
  with its widget's icon in front), the other tabs follow as names at 70%,
  and the shown widget's header actions sit at the row's right end. Members
  do not draw their own header row: `WidgetHeader` renders into the tab row
  through `lib/tabGroup.ts`, and they lose their top padding, so the first
  content line sits at the same height in a group as in a single widget.
- Chip (`Chip`): the small toggle used for modes and options. 28px tall,
  `text-sm`, `rounded-md`; the active chip has the translucent fill, inactive
  chips sit at 70% opacity.
- Button (`SmallButton`): the standard small action. 28px tall, `text-sm`,
  `rounded-lg`, palette label color on a translucent fill.
- Icon buttons: 24px hit area (`HIT_AREA` from `ui/Field.tsx`), visible focus
  ring (`FOCUS_RING`, which sets no radius), `aria-label`. Neighbouring icon
  buttons sit at least `gap-3` apart so their hit areas do not overlap.
- Settings: `PencilButton` opens the `FlipCard` back face; `SaveCancelRow`
  closes it. Fields use `ui/Field`.
- Detail views: `BackButton` sits on the left of the first block (the
  thumbnail, or the title when there is none) and stretches to its height, a
  36px wide `rounded-xl` translucent fill with a 16px chevron, so it is an easy
  target on phones. The row above it keeps the truncated title and the
  open-externally link.
- Empty states: `EmptyState`, centered, 14px at 70%. Never inside a styled
  frame (a player area, a dashed box) unless the frame is the control itself.

## Page chrome

Top bar text, in the same face as the widgets: title and the right-hand field
at `text-2xl font-medium` (`text-lg` on phones); the date at `text-lg`; the
dashboard switcher at `text-base` (`text-sm` on phones) in the secondary text
color; action icons at 16px in the secondary color. Settings sections use
`text-sm` labels at 70% in normal case. No all-caps text anywhere.
