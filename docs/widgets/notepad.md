# Notepad Widget

A daily notepad with a built-in calendar for browsing past entries. Notes are rich text (bold, italic, underline, bullet lists) stored as HTML. Multiple instances are supported, each with its own storage and an optional custom name.

## Storage Keys

| Key | Value |
|---|---|
| `notebook-{id}-days` | JSON array of the `YYYY-MM-DD` dates that have a note (the index) |
| `notebook-{id}-day-{YYYY-MM-DD}` | That day's note (HTML, or plain text from older versions) |
| `notebook-{id}-name` | User-assigned name string |
| `notepad-registry` | JSON array of all instance IDs ever created |

Each edit rewrites only that day's key, plus the index when the day gains or loses its note. The day key is written before it is indexed and unindexed before it is removed, so the index never points at a missing note. These keys are user data: the cache cleanup never touches them even though they contain dates.

**Legacy format.** Older versions kept every day in one `notebook-{id}-dates` object (`YYYY-MM-DD` to note) that was rewritten on each edit. When a notepad has no index yet, the blob is copied into per-day keys plus the index on load, and the blob is removed only after every write is confirmed; if a write fails the migration is retried on the next load.

## Loading and Save Safety

Reads use `getItemResult`, so a failed read is never mistaken for an empty notepad. Until the initial load succeeds the editor stays read-only, and a failed load or save shows an error line in the widget instead of silently losing the edit.

## Date Navigation

The widget maintains a `viewDate` state (defaults to today). The built-in calendar shows a dot on days with a note and allows clicking any day to view that date's note. Clicking "back to today" resets `viewDate`.

Notes are only editable when `viewDate` is today. Past dates are read-only.

## Cross-Instance History (Tabs)

When viewing a past date, the widget queries the global `notepad-registry` to find all notepad instances that have ever existed. It loads each instance's note for that date and shows numbered tabs, one per instance that had content on that day.

This means even if a notepad instance was deleted and a new one created, the historical notes from the old instance remain accessible via the tab system when viewing past dates.

**Registry behavior:** On mount, every notepad instance registers its ID in `notepad-registry` if not already present (only after the registry was read successfully). IDs are never removed from the registry even when the widget is deleted from the grid.

## History List

The history button lists every dated note across all registered notepads, newest first, with the notepad's name and a short plain-text snippet. Clicking an entry opens that date; each entry can also be deleted (the day is unindexed first, then its key removed).

## Auto-save

Notes are saved with a 600ms debounce after each keystroke to avoid excessive API calls. Saves are queued so they land in order.

## Renaming

A pencil icon appears on hover in the widget header. Clicking it opens an inline rename input. The name is saved to `notebook-{id}-name` and displayed next to the icon in the header.

Notepad is not `digestable`. The chat's `read_widget` tool can still read it.
