# Upkeep Widget

A daily checklist of essentials. Each item has a weight; checking items off raises the day's score toward 100.

## Storage Keys

| Key | Value |
|---|---|
| `upkeep-config-{id}` | JSON: `{ items: Item[] }` |
| `upkeep-days-{id}` | JSON: `{ [date: "YYYY-MM-DD"]: itemId[] }` - which items were checked on each day |

- `items` - array of `{ id, name, weight }`.
  - **`id` must start with the creation timestamp in ms** (e.g. `1782354352574-0`). Scoring derives each item's "created day" from `parseInt(id.split("-")[0])`, so an item only counts toward a day's possible score from the day it existed.
  - `weight` - relative contribution to the score (must be > 0; treated as 1 if missing).
- Score for a day = `(sum of checked weights / sum of weights for items that existed that day) * 100`.

## Behaviour

- Tap an item to toggle it for today; the ring and score update live.
- A multi-day history grid shows past completion.
- Add/rename/remove/reweight items in the settings card.

(component: `components/UpkeepWidget.tsx`; digest read in `lib/widgetData.ts` `readUpkeep`)
