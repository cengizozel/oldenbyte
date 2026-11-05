# Upkeep Widget

A daily checklist of essentials, the third sibling of Tracker and Rhythm. Each item has a weight; checking items off raises the day's score toward 100. The goal is to start each day at zero, end it at 100, and string perfect days together. An item can be set to last several days per check (shaving, laundry), so it stays covered and keeps scoring without being re-checked daily.

## Storage Keys

| Key | Value |
|---|---|
| `upkeep-config-{id}` | JSON: `{ items: Item[] }` |
| `upkeep-days-{id}` | JSON: `{ [date: "YYYY-MM-DD"]: itemId[] }`: which items were checked on each local day |

- `items` - array of `{ id, name, weight, every? }`.
  - **`id` must start with the creation timestamp in ms** (e.g. `1782354352574-0`). Scoring derives each item's "created day" from `parseInt(id.split("-")[0])`, so an item only counts toward a day's possible score from the day it existed, and a new habit never breaks past perfect days. Ids without a numeric prefix (older items, the seed) count from the beginning of time.
  - `weight` - points the item is worth (new items start at 10; a missing or non-positive weight is treated as 1).
  - `every` - optional, how many days one check lasts (1 to 99). Absent or 1 means daily. With `every: 3`, a check on Monday covers Monday, Tuesday and Wednesday; the item is "carried" on the latter two days and counts toward their scores. Checking it again inside the span restarts it from that day.
- Score for a day = `(sum of covered weights / sum of weights for items that existed that day) * 100`, where covered means checked that day or carried by an earlier check. The score is derived, never stored, so it always reflects the current items, weights and spans.
- Scoring and coverage live in `lib/upkeep.ts`, shared with the chat reader, with tests in `tests/upkeep.test.ts`.

## Behaviour

- Tap an item to toggle it for today; the completion ring (one slice per item, sized by weight) and score update live. Day boundaries are local midnight.
- A carried item shows a dashed check, a fainter ring slice and how long the check still lasts ("2d left", "last day"). Tapping it checks it off again today, which restarts its span.
- A streak counter shows consecutive perfect days (today counts once it reaches 100; an unfinished today does not break the streak).
- The history view shows a 14-day heatmap and score line, with a per-day detail.
- Add/rename/remove/reweight items in the settings card, and set each one's span in days (the `d` field; 1 is daily).

Upkeep is not `digestable`; the chat's `read_widget` tool reads it through `lib/widgetData.ts` (`readUpkeep`).

(component: `components/UpkeepWidget.tsx`)
