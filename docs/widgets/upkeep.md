# Upkeep Widget

A daily checklist of essentials, the third sibling of Tracker and Rhythm. Each item has a weight; checking items off raises the day's score toward 100. The goal is to start each day at zero, end it at 100, and string perfect days together.

## Storage Keys

| Key | Value |
|---|---|
| `upkeep-config-{id}` | JSON: `{ items: Item[] }` |
| `upkeep-days-{id}` | JSON: `{ [date: "YYYY-MM-DD"]: itemId[] }`: which items were checked on each local day |

- `items` - array of `{ id, name, weight }`.
  - **`id` must start with the creation timestamp in ms** (e.g. `1782354352574-0`). Scoring derives each item's "created day" from `parseInt(id.split("-")[0])`, so an item only counts toward a day's possible score from the day it existed, and a new habit never breaks past perfect days. Ids without a numeric prefix (older items, the seed) count from the beginning of time.
  - `weight` - points the item is worth (new items start at 10; a missing or non-positive weight is treated as 1).
- Score for a day = `(sum of checked weights / sum of weights for items that existed that day) * 100`. The score is derived, never stored, so it always reflects the current items and weights.

## Behaviour

- Tap an item to toggle it for today; the completion ring (one slice per item, sized by weight) and score update live. Day boundaries are local midnight.
- A streak counter shows consecutive perfect days (today counts once it reaches 100; an unfinished today does not break the streak).
- The history view shows a 14-day heatmap and score line, with a per-day detail.
- Add/rename/remove/reweight items in the settings card.

Upkeep is not `digestable`; the chat's `read_widget` tool reads it through `lib/widgetData.ts` (`readUpkeep`).

(component: `components/UpkeepWidget.tsx`)
