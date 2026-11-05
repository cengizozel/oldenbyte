# Upkeep Widget

A checklist of essentials, the third sibling of Tracker and Rhythm. Each item is a countdown: checking it starts a timer of the item's span (teeth 12 hours, shower a day and a half, laundry a week), and while the timer runs the item's points count. The score is the running points over all points, out of 100, right now. Nothing resets at midnight: the score sinks as timers run out and rises as you check things off again. The goal is to keep it at 100 for as long as you can.

## Storage Keys

| Key | Value |
|---|---|
| `upkeep-config-{id}` | JSON: `{ items: Item[] }` |
| `upkeep-log-{id}` | JSON: `{ [itemId]: number[] }`: every time each item was checked, epoch ms, ascending |

- `items` - array of `{ id, name, weight, hours }`.
  - **`id` must start with the creation timestamp in ms** (e.g. `1782354352574-0`). Scoring derives each item's creation time from `parseInt(id.split("-")[0])`, so an item only counts toward the score from the moment it existed, and a new habit never lowers past scores. Ids without a numeric prefix (older items, the seed) count from the beginning of time.
  - `weight` - points the item is worth (new items start at 10; a missing or non-positive weight is treated as 1).
  - `hours` - how long one check lasts. New items start at 24. Configs from the earlier day-based version carry `every` (days) instead, which is read as `every * 24` and rewritten on load.
- The log keeps at most 500 checks per item. Removing an item in settings drops its checks.
- Score at a moment = `(sum of weights of items whose latest check is less than `hours` old / sum of weights of items that existed then) * 100`. It is derived, never stored, so it can be computed for any past moment and always reflects the current items, weights and spans. Changing an item's span rewrites its past as well.
- Scoring lives in `lib/upkeep.ts`, shared with the chat reader, with tests in `tests/upkeep.test.ts`.
- Earlier versions stored `upkeep-days-{id}` (`{ "YYYY-MM-DD": itemId[] }`). On load, if no log exists, those days become checks at local noon of each day (or now, if earlier), the log is written, and the old key is removed only after that write succeeds.

## Behaviour

- Tap an item to start its countdown; the row shows the time left, and the completion ring (one slice per item, sized by weight) and score update live. Tapping a running item restarts its countdown, except within five minutes of a check, where the tap undoes it (a misclick should not restart a long timer).
- Under the ring: how long the score has been at 100, or otherwise which item runs out next and when.
- The view ticks every 30 seconds so countdowns move and timers run out on screen.
- The history view plots the score over time, sampled hourly for the last two weeks or at midnight and noon for the last three months, with the last 7 days' average and share of time at 100, and a 14-day heatmap of each day's average score. Tapping a day lists that day's checks with their times; a check can be removed there.
- Add/rename/remove/reweight items in the settings card, and set each one's span in days and hours.

Upkeep is not `digestable`; the chat's `read_widget` tool reads it through `lib/widgetData.ts` (`readUpkeep`): the score now, how long it has been at 100, each item's state and time left, and the last 7 days' average.

(component: `components/UpkeepWidget.tsx`)
