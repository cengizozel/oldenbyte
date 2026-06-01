# Tracker Widget

Times how long you spend on each of a set of named activities. Only one activity runs at a time: clicking an activity starts (or resumes) its stopwatch and pauses whichever was running. A donut chart shows the proportion of time spent on each activity. Times reset daily.

## Storage Keys

| Key | Value |
|---|---|
| `tracker-config-{id}` | JSON: `{ items: Item[]; activeId: string \| null; since: number \| null }` |
| `tracker-day-{id}-{YYYY-MM-DD}` | JSON: `{ elapsed: Record<itemId, seconds> }` |

`Item` is `{ id: string; name: string }`.

Two keys with different lifetimes:

- **`tracker-config-{id}`** — the activity list plus the "what's running" pointer (`activeId` + `since`, an epoch-ms timestamp). This persists across days, so a stopwatch left running keeps running into the next day.
- **`tracker-day-{id}-{date}`** — the accumulated seconds per activity for one day. A new day starts with an empty bucket, which is how the daily reset happens (old days' data is simply left untouched under their own date keys).

## Timing Model

`elapsed` holds *committed* seconds only — it never includes the segment currently being timed. The live value of the running activity is computed on the fly:

```
liveSecs(item) = elapsed[item] + (item === activeId ? now - max(since, todayStart) : 0)
```

A 1-second interval (`setInterval`) advances a `now` state value while an activity is running, re-rendering the live number and the chart. The interval is cleared when nothing is running.

State transitions go through `commit()`, which folds the running segment into `elapsed` before the pointer changes:

- **Click an idle activity** — commit the current one (if any), then set `activeId` to the clicked item and `since` to now.
- **Click the running activity** — commit it, then clear `activeId`/`since` (pause).
- **Switch** is just the two combined: the previous activity is committed and paused while the new one starts.

Both keys are persisted on every transition. The running segment itself is *not* persisted each tick — it is reconstructed from `since` on load, so reloading or closing the tab mid-run loses no time.

## Overnight Clamp

Because the running pointer survives across days, a segment started yesterday must not dump all of yesterday's elapsed time into today's bucket. Both `runningSecs()` and `commit()` clamp the segment start to `todayStart` (today's UTC midnight):

```
seconds = (now - max(since, todayStart)) / 1000
```

So today's bucket only ever accrues time from midnight onward. (Day boundaries use the same UTC `toISOString()` date string as the other date-keyed widgets.)

## Donut Chart

Hand-rolled SVG (no chart library). Each activity with non-zero live time is drawn as an arc on a shared `<circle>` using `stroke-dasharray`/`stroke-dashoffset`, accumulating an offset so the segments sit end to end. A faint full-circle track sits behind them, and the day's total time is shown in the center. Colors come from a fixed 12-entry palette indexed by the activity's position; the same palette colors the legend dots and the settings rows.

## Settings

The card flips (the same `rotateY` flip used by the YouTube/RSS widgets) to a settings panel where activities are added (text field + `Plus`), renamed inline, and removed (`×`). Edits are staged in a `draft` list and applied on save (`Check`). On save, `elapsed` entries for removed activities are dropped, and if the running activity was removed the stopwatch is stopped.

## Reset

The settings footer has a **reset times** button (`RotateCcw`) that zeroes the day's `elapsed` (keeping the activity list). If something is running, its `since` is reset to now so it continues cleanly from zero.

## Digest

`digestable: false` — numeric time data is not useful for the narrative `/digest` briefing, so the Tracker is excluded from it.
