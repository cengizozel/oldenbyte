# Rhythm Widget

Tap to log habits and see how often, and at what time of day, you do them. Rhythm is Tracker's sibling: Tracker answers "how long?", Rhythm answers "when, and how often?". Habits can be one-tap "moments" or timed "sessions", and tracked as "build" (do more) or "reduce" (do less).

## Storage Keys

| Key | Value |
|---|---|
| `rhythm-config-{id}` | JSON: `{ items: Item[], open }` |
| `rhythm-log-{id}` | JSON: `{ events: { [itemId]: number[] }, sessions: { [itemId]: [start, end][] } }` |

- `items` - array of `{ id, name, kind, mode, target? }`.
  - `kind` - `"moment"` (single tap) or `"session"` (start/stop with a duration).
  - `mode` - `"build"` (encourage) or `"reduce"` (discourage).
  - `target` - optional daily target count.
- `open` - the sessions currently running: `{ [itemId]: startMs }`.
- The log keeps tap timestamps (moments) and `[start, end]` pairs (sessions), all epoch ms, keyed by item id. It is stored apart from the config so a settings save never risks the history; removing an item in settings also drops its log entries.

## Behaviour

- Tap a "moment" to log it now; a "session" toggles start/stop.
- A minus button removes the most recent tap.
- Day boundaries are local midnight, like Tracker; a session counts on the day it started.
- Each card shows a streak (build: consecutive days at or above the target, default 1; reduce with a target: consecutive days at or under it) or, for reduce habits without a target, the time since the last one. Frequency is the 7-day average per day plus the average gap between entries; the time-of-day rhythm uses a circular mean and spread over the last 30 days, so a cluster around midnight averages to midnight.
- A strip for today marks every tap and session start/end at its time of day.
- The history and insights view shows per-item stats over the last 30 days and a per-day detail where single entries can be deleted.

Rhythm is not `digestable`; the chat's `read_widget` tool reads it through `lib/widgetData.ts`.

(component: `components/RhythmWidget.tsx`)
