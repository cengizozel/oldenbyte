# Clock Widget

The time in other places: one row per time zone, with how far ahead or behind it is ("6h ahead", "5h 30m behind") and "tomorrow" or "yesterday" when the date differs from yours.

## Storage Keys

| Key | Value |
|---|---|
| `clock-widget-{id}` | JSON: `{ zones: { id, tz, label }[]; hour12: boolean }` |

- `tz` - an IANA time zone id (`Asia/Tokyo`)
- `label` - the name shown, the city by default, editable in settings

## Behaviour

- In settings, add a place by city name ("tokyo") or zone id; the field suggests the browser's known zones. An unknown name is refused with a message.
- 24 hour (default) or 12 hour.
- Offsets come from the browser's own time zone data, so daylight saving changes are followed. The rows update when the minute turns.

Not digestable.

(component: `components/ClockWidget.tsx`)
