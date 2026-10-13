# Design language

The rules every widget and page follows. Shared pieces live in `components/ui/`;
a widget should not restyle what they already provide.

## Type scale

Five sizes, nothing in between. Sizes are fixed pixels so a widget looks the
same at every card size; the floor is 12px for anything meant to be read.

| Size | Tailwind | Used for |
|---|---|---|
| 11px | `text-[11px]` | Badges and pills only (subreddit, channel, tag) |
| 12px | `text-xs` | Meta text (times, counts, labels), widget titles, chips, empty states |
| 13px | `text-[13px]` | Only the serif accent face (`font-ui`), whose small letters need it |
| 14px | `text-sm` | Body text: list item titles, notes, chat, settings fields |
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
| 60% | Meta (timestamps, counts, labels, empty states) |

Nothing readable sits below 60%. Lower values are for decoration: dividers,
disabled controls, hover-only chrome, and the dimmed upcoming words in Typing.

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
  (`text-xs font-medium`, palette label color) and an optional right-hand slot
  for counts and small actions. Every widget shows its title.
- Chip (`Chip`): the small toggle used for modes and options. 24px tall,
  `text-xs`, `rounded-md`; the active chip has the translucent fill, inactive
  chips sit at 60% opacity.
- Button (`SmallButton`): the standard small action. 28px tall, `text-xs`,
  `rounded-lg`, palette label color on a translucent fill.
- Icon buttons: 24px hit area (`HIT_AREA` from `ui/Field.tsx`), visible focus
  ring (`FOCUS_RING`, which sets no radius), `aria-label`. Neighbouring icon
  buttons sit at least `gap-3` apart so their hit areas do not overlap.
- Settings: `PencilButton` opens the `FlipCard` back face; `SaveCancelRow`
  closes it. Fields use `ui/Field`.
- Empty states: `EmptyState`, centered, 12px at 60%. Never inside a styled
  frame (a player area, a dashed box) unless the frame is the control itself.

## Page chrome

Top bar text: title and the right-hand field in Playfair at `text-2xl`
(`text-lg` on phones); the date at `text-lg`; the dashboard switcher at
`text-base` (`text-sm` on phones) in the secondary text color; action icons at
16px in the secondary color. Settings sections use `text-[13px]` serif labels
in normal case. No all-caps text anywhere.
