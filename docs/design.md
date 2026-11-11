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
themes. Nothing is hover-only: a widget's header options sit behind the header
toggle, and row actions (open a link, edit, delete, rename, the chat message
buttons) rest at 70% and go to 100% on hover. Lower values are for
decoration: dividers, disabled controls, the dashboard drag handle and the
link hint on bookmark rows at 40%.

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

Light palette: the `label` and `text` colors of every palette in light mode
are set so that text at the 70% meta step still clears 4.5:1 over that
palette's tinted card (measured by compositing: for amber, `#632c0a` at 70%
over `#fffbeb` is 4.6:1). They are darker than the Tailwind 800/900 values
they started from, and label and text end up close in tone; the hue stays.
The only run under 4.5:1 in light mode is Typing's upcoming words while the
card is unfocused (60% inside the 40% fade), which is decoration by design.

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

- Header: `WidgetHeader` from `components/ui/WidgetChrome.tsx`. Every header,
  single or in a tab group, reads the same way: the widget's identity on the
  left (icon and title, `text-sm font-medium`, palette label color; or the
  tabs) and one toggle at the right end, the oldenbyte mark (the logo's
  dashed square and solid square, one color, 16px) on every widget. Nothing else sits in a header by default: no always-on buttons,
  nothing hover-only, no status text (a status like Typing's best wpm goes
  on a line in the body). The toggle swaps the identity for the widget's
  options in the same row (its `after` and `right` content, then a full
  screen button every widget gets from the grid), the mark turning into a
  close cross, and the same spot brings the identity back. Hover-only
  buttons show in full once the options are asked for. In layout edit mode
  the same toggle swaps in the tile's controls instead (move to another
  dashboard, group as tabs, remove), so every operation on a tile is in the
  one place and the title or tabs keep the whole row. A widget with a
  settings face passes `onSettings`, and the header draws the one settings
  control for it (a sliders icon, `data-widget-settings`) last in the row,
  after full screen, so settings sits in the same spot on every widget and the keyboard
  layer's `e` always finds it, options open or closed.
- Full screen: the grid (`lib/widgetFrame.ts`) lifts the tile over a dimmed,
  blurred backdrop at the viewport's size minus a margin, keeping the widget
  mounted so its state survives; a tab group goes up with its tab row.
  Escape (when no widget dialog claims it), the backdrop, the header's
  button, or entering edit mode bring it back.
- Tab groups: the tab row is the header, in the same place and size as a
  single widget's header. The shown tab is the title (`text-sm font-medium`,
  with its widget's icon in front), the other tabs follow as icon and name at
  70% in the same weight, so nothing shifts when the open tab changes. One
  2px underline travels to the open tab on a spring (leading edge first, the
  trailing edge catching up, a little overshoot); reduced motion gets a 150ms slide.
  A tab's icon and name are the ones its widget's header would show (a feed
  tab reads "BBC News", a weather tab its city), not the registry title;
  and the shown widget's options sit behind the header toggle at the row's
  right end, as in a single header: the row shows tabs by default, the
  toggle slides the tabs out and the options in (the widget's header content
  left-aligned, its `right` group, then full screen and settings at the
  end), and the same spot brings the tabs back (so does switching tab). In
  layout edit mode the toggle swaps in the tile's controls instead. Members do not draw their own
  header row: `WidgetHeader` renders into the tab row through
  `lib/tabGroup.ts`, and they lose their top padding, so the first content
  line sits at the same height in a group as in a single widget. The header
  of an overlay panel (history, insights, the chat's character editor) is
  marked `panel` and draws in place even in a group: the tab keeps the
  widget's name and the panel's title and buttons head the panel below it.
  In layout edit mode a press on a tab drags it along the row to reorder.
  The drop slot is the one whose resting position is nearest the dragged
  tab's own left edge (Chrome's rule), so a neighbor steps aside only after
  the tab has moved half the neighbor's width, wherever it was grabbed, and
  slides over 200ms ease-out. The row auto-scrolls while the tab is held
  near either end (slowly,
  faster the nearer the edge, so the drop can be aimed); a press
  anywhere else on the tile, the row's empty space included, moves the tile.
  Because neither press can scroll the row, edit mode shows a small arrow at
  each end of the list whenever tabs are cut off; a click pages the row that
  way, so every tab can be reached and clicked.
  When the row is wider than the card it scrolls by drag (with momentum), by
  the mouse wheel, and to the chosen tab on selection. Past either end it
  glows like Android's edge effect: the glow grows with how far you keep
  pulling and stays while held, fades on release, and a fling into the end
  gives a burst sized by its speed. It is small (at most 40px wide), even
  across the row's height, and sits at the tab list's own edge, inside the
  header actions.
- Chip (`Chip`): the small toggle used for modes and options. 28px tall,
  `text-sm`, `rounded-md`; the active chip has the translucent fill, inactive
  chips sit at 70% opacity.
- Button (`SmallButton`): the standard small action. 28px tall, `text-sm`,
  `rounded-lg`, palette label color on a translucent fill.
- Icon buttons: 24px hit area (`HIT_AREA` from `ui/Field.tsx`), visible focus
  ring (`FOCUS_RING`, which sets no radius), `aria-label`. Neighbouring icon
  buttons sit at least `gap-3` apart so their hit areas do not overlap.
- Settings faces: every widget's settings share one shape, built from
  `SettingsFace` and friends in `ui/WidgetChrome.tsx`. The face is the
  sliders icon and "Settings" as a panel header, a scrolling body, and the
  save row pinned at the bottom (reset when there is one, cancel, save);
  Escape cancels, the same as the cross. Inside: `SettingsField` puts a
  label above each control (or beside a short one, `inline`) with hint copy
  under it, all `text-sm`; choices are chips up to five options and a select
  beyond that; on or off is the `Toggle`, never a checkbox; a number you
  tune (counts, seconds, points) is the `Stepper`, a number you know (an age,
  a weight) is a typed field with the unit as its placeholder; collections
  are `SettingsListRow`s, one neutral row style with a leading handle, icon
  or color dot, the name (a borderless field when editable), icon actions at
  70% on the right, and per-item controls on the lines below. Rows never
  take a palette color of their own; a color dot is allowed when it is data
  the widget shows. Each list card is a grouped list: the item's own row
  first, then one `SettingsListControl` per control (label left, control
  right), all 36px tall and a hairline apart. Short options come first and
  the collection last, so nothing has to be scrolled past to reach a
  setting. Copy inside a face is `SettingsNote`, errors `SettingsError`.
  Every face has reset: it puts the fields back to the widget's defaults
  (the draft only; save applies it), after a "Back to defaults?" step that
  disarms by itself. The save row's three actions are 28px filled buttons
  with 16px glyphs. The widget's own layout opens the face (a `FlipCard`
  back, or an overlay inside the card); the face does not care which. In
  a tab group the row returns to its tabs when a face opens.
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
color; action icons at 16px in the secondary color. No all-caps text anywhere.

The settings drawer is built from `SettingsSection` and `SettingsRow`
(`components/ui/Field.tsx`): a muted `text-sm` section title, then rows at
least 40px tall separated by hairlines, each with its label in the primary
color, an optional one-line hint under it in the muted color, and its control
on the right. Long lists (the key bindings) sit behind a disclosure row, so
the drawer reads as a short list of decisions. Themes: light, dark and grey
(dark with every widget palette on the neutral one), chosen with a segmented
control and cycled with Shift+D. The card glow is a per-theme switch next to
it (off in light by default, on in dark and grey), applied as the `glow` class
on the root.
