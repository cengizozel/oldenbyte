# Notepad Widget

A daily notepad with a built-in calendar for browsing past entries. Multiple instances are supported, each with its own storage and an optional custom name.

## Storage Keys

| Key | Value |
|---|---|
| `notebook-{id}-dates` | JSON object mapping `YYYY-MM-DD` → note content string |
| `notebook-{id}-name` | User-assigned name string |
| `notepad-registry` | JSON array of all instance IDs ever created |

## Date Navigation

The widget maintains a `viewDate` state (defaults to today). The built-in calendar allows clicking any day to view that date's note. Clicking "back to today" resets `viewDate`.

Notes are only editable when `viewDate === today`. Past dates are read-only.

## Cross-Instance History (Tabs)

When viewing a past date, the widget queries the global `notepad-registry` to find all notepad instances that have ever existed. It loads each instance's notes for that date and shows numbered tabs — one per instance that had content on that day.

This means even if a notepad instance was deleted and a new one created, the historical notes from the old instance remain accessible via the tab system when viewing past dates.

**Registry behavior:** On mount, every notepad instance registers its ID in `notepad-registry` if not already present. IDs are never removed from the registry even when the widget is deleted from the grid.

## Auto-save

Notes are saved with a 600ms debounce after each keystroke to avoid excessive API calls.

## Renaming

A pencil icon appears on hover in the widget header. Clicking it opens an inline rename input. The name is saved to `notebook-{id}-name` and displayed next to the icon in the header.
