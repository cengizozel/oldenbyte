# Schedule Widget

A fixed weekly routine on a seven-day time grid: classes, gym, standing calls. Every week looks the same, unlike the Calendar widget's dated events.

## Storage Keys

| Key | Value |
|---|---|
| `schedule-widget-{id}` | JSON: `{ entries: Entry[]; startHour: number; endHour: number }` |

`Entry` is `{ id, title, description?, days: number[], start, end, color }`:

- `days` - `0` = Monday through `6` = Sunday; one entry can repeat on several days
- `start` / `end` - minutes from midnight. An `end` numerically before `start` runs past midnight
- `color` - a hex color from the block palette, or a custom one

The grid defaults to 06:00 to 24:00. The day can start between 00:00 and 12:00 and end between 12:00 and 02:00 the next day, with at least 6 hours shown. Older entries with a single `day` field are migrated to `days` on load.

## Behaviour

- Monday-first columns; today's column header is highlighted and a red line marks the current time. On first mount the grid scrolls to the current time.
- Click an empty slot (or **+**) to add an entry there; click an entry to edit it. Times use 15-minute steppers, and an entry can be set by end time or by duration (5 minutes to 16 hours).
- Drag an entry to move it; the ghost snaps to the grid. Moving one day of a multi-day entry asks before splitting it out of its group.
- Overlapping entries share the column in side-by-side lanes.
- **Export as text** shows the whole week as plain, copyable text, grouped by day.
- The expand toggle floats the grid over a dimmed backdrop at 80% of the screen. Escape closes dialogs first, then the expanded view.

Not digestable. The chat's `read_widget` tool reads it through `lib/widgetData.ts` (`readSchedule`).

(component: `components/ScheduleWidget.tsx`)
