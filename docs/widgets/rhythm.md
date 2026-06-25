# Rhythm Widget

Tap to log habits and see how often - and at what time of day - you do them. Habits can be one-tap "moments" or timed "sessions", and tracked as "build" (do more) or "reduce" (do less).

## Storage Keys

| Key | Value |
|---|---|
| `rhythm-config-{id}` | JSON: `{ items: Item[], open }` |
| `rhythm-log-{id}` | JSON: per-date log of events / sessions |

- `items` - array of `{ id, name, kind, mode, target? }`.
  - `kind` - `"moment"` (single tap) or `"session"` (start/stop with a duration).
  - `mode` - `"build"` (encourage) or `"reduce"` (discourage).
  - `target` - optional daily target count.
- `open` - UI state (which item's detail is expanded).
- The log records tap timestamps and session `[start, end]` pairs keyed by date, feeding the frequency count and the time-of-day rhythm view.

## Behaviour

- Tap a "moment" to log it now; a "session" toggles start/stop.
- A minus button removes the most recent tap (replacing a transient undo).
- Per-item detail shows frequency, sessions, targets, and the time-of-day distribution.

(component: `components/RhythmWidget.tsx`)
