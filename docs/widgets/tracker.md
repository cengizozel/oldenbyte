# Tracker Widget

Times how long you spend on each of a set of named activities. Only one activity runs at a time: clicking an activity starts (or resumes) its stopwatch and pauses whichever was running. A donut chart shows today's split, flames mark streaks, and a history overlay adds a 14-day chart, insights, and per-day time editing.

## Storage Keys

| Key | Value |
|---|---|
| `tracker-config-{id}` | JSON: `{ items: Item[]; activeId: string \| null; since: number \| null }` |
| `tracker-days-{id}` | JSON: `Record<YYYY-MM-DD, Record<itemId, seconds>>` |

`Item` is `{ id: string; name: string }`.

Two keys with different lifetimes:

- **`tracker-config-{id}`**: the activity list plus the "what's running" pointer (`activeId` + `since`, an epoch-ms timestamp). This persists across days, so a stopwatch left running keeps running into the next day.
- **`tracker-days-{id}`**: every day's accumulated seconds per activity, keyed by local date. Past days are retained; the history overlay reads them. (An earlier version stored one key per day, `tracker-day-{id}-{date}`; on load that today-key is migrated into this consolidated store.)

## Day Boundary: Local Midnight

Days are keyed by the user's local calendar date (`localDateStr()`), not UTC: a timer running at 23:59 belongs to the day the user experienced. `today` is recomputed on every render and a 1-second tick runs while a timer is active, so the whole view rolls over within a second of local midnight.

## Timing Model and Cross-Midnight Splitting

`days` holds committed seconds only. The running segment is never persisted per tick; it is reconstructed from `since` on load, so reloading or closing the tab mid-run loses no time.

`splitAcrossDays(fromMs, toMs)` divides a segment into per-local-day parts, so time that crosses midnight is credited to the day it actually happened in. Both views of the data go through it:

- **`liveDays()`**: the committed days plus the live running segment, split across days. Everything on screen (rows, chart, streaks, history) derives from this, so a timer crossing midnight is always displayed on the correct days while still running.
- **`commitDays()`**: folds the running segment into committed storage on every transition. A segment spanning midnight lands in each day it touched rather than being dumped into one bucket.

Transitions: clicking an idle activity commits the current one (if any) and starts the clicked one (`since` = now); clicking the running activity commits it and pauses. Both keys are persisted on each transition.

## Main View

- **Donut**: hand-rolled SVG arcs (a shared `Donut` component, reused by the history day tiles). Hovering a segment dims the others and shows that activity's share (`%`) and name in the center; otherwise the center shows the day's total. Colors come from `tagColor(id)`, stable per activity id.
- **Activity rows** are ordered by time spent today, highest first, reordering live while a timer runs. Each row shows its color dot, name, today's time, and a play/pause indicator.
- **Streak badge**: an activity tracked on 2 or more consecutive days shows a flame with the streak count.

## Streaks

`streakFor()` counts consecutive days with time on the activity, ending today. If today has nothing yet, the count ends at yesterday instead, so an unbroken run keeps its number all day rather than dropping to zero at midnight.

## Settings

The card flips to a settings panel where activities are added (text field + `Plus`), renamed inline, and removed (`×`). Edits are staged in a draft and applied on save. On save, removed activities are dropped from today's bucket and the running pointer (the stopwatch stops if the running activity was removed), but their past-day history is kept: per-day time is keyed by activity **id**, so renaming keeps history intact and a removed activity's past time still appears (labeled `(removed)`, neutral dot).

The settings footer's reset button zeroes today's bucket (keeping the activity list). If something is running, its `since` resets to now so it continues cleanly from zero.

## History and Insights

The header's clock icon opens an overlay:

- **14-day chart**: one polyline per activity (the top 6 by time in the window), scaled to the window's largest value, with start/end date labels and a color-dot legend.
- **Week-over-week insight**: the last 7 days' total, with the percent change versus the 7 days before (green for up, red for down). The delta is omitted when the prior week is empty.
- **Best streaks**: up to 3 activities with a streak of 2+ days, each as a flame, count, and name.
- **Day grid**: a 3-column grid of mini donuts, one per day that has tracked time, newest first, labeled with the date and total. Click a day to drill in.

## Day Detail and Time Editing

A day's detail view shows its donut and a per-activity breakdown. Every current activity is listed even at zero (so a forgotten day can be backfilled); removed activities appear if they have time. The pencil on a row opens hours/minutes inputs to set the recorded time to an exact value ("I forgot to stop the timer"): Enter saves, Escape cancels, and 0 removes the entry. Editing the running activity pauses it first, so the stored value is exactly what was typed. The trash icon deletes the whole day; deleting today while a timer runs resets its `since` to now.

## Digest and Chat

`digestable: false`: numeric time data is not useful for the narrative `/digest` briefing, so the Tracker is excluded from it. The Chat widget's dashboard lookup **does** include it: the most recent 7 days that have entries, per activity, as text.
