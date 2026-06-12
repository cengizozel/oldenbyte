# Calendar Widget

An agenda of upcoming events from a CalDAV server. Works with Nextcloud, Radicale, and any other RFC 4791 server.

## Storage Keys

| Key | Value |
|---|---|
| `calendar-widget-{id}` | JSON: `{ baseUrl, username, password, calendars: [{ name, url, readOnly? }], days }` |

`calendars` holds only the selected (displayed) calendars; `days` is the agenda window (7, 14, or 30). Credentials are stored with the widget config in the database and ride each request to `/api/caldav`; the server keeps no copy of its own.

## CalDAV Setup

The card flips to a settings panel:

1. **Server URL**: the DAV base, e.g. `https://cloud.example.com/remote.php/dav`
2. **Username** and **app password**
3. **Connect**: lists the account's calendars; check the ones to show
4. **Days ahead**: 7 / 14 / 30
5. Save (requires at least one calendar selected). Reset clears everything.

**Nextcloud**: do not use your account password. Create an app password under *Settings, Security* and use the URL ending in `/remote.php/dav`. The settings panel repeats this hint. Radicale and other servers take their usual base URL and credentials the same way.

## Discovery and Read-Only Detection

`lib/caldav.ts` is a minimal, dependency-free CalDAV client (namespace-agnostic regex over the XML, like `lib/kiwix.ts`). Listing calendars walks the standard discovery chain:

1. `PROPFIND` on the base URL for `current-user-principal`
2. `PROPFIND` on the principal for `calendar-home-set`
3. Depth-1 `PROPFIND` on the home collection, keeping children whose resource type is a calendar and whose `supported-calendar-component-set` includes `VEVENT` (this skips task-only lists)

Each calendar's `current-user-privilege-set` is checked for a `write`/`write-content` privilege; without one the calendar is marked `readOnly`. Read-only calendars show a READ-ONLY tag in the picker and are excluded from chat writes.

## Events

`POST /api/caldav` with `op: "events"` runs a `calendar-query` REPORT with a time range against each selected calendar (up to 20, in parallel; failures are reported per calendar without sinking the rest). The iCal payloads are parsed with a line-unfolding VEVENT reader: UTC times are converted to the server's local time for display, all-day events are detected via `VALUE=DATE`, and escaped characters are unescaped. Servers that match the time range but do not inline `calendar-data` get those objects fetched directly (batches of 8, capped at 100). Recurring events rely on the server's time-range handling; servers that do not expand recurrences return the master once.

The other ops are `calendars` (discovery), `create`, and `delete`.

## Agenda View

The front shows events for the next `days` days, grouped by local day with "Today" / "Tomorrow" / weekday headings. Each row has a color dot derived from the calendar name (`tagColor`), the title, an optional location line, and the start time (or "all day"). Hovering a row shows the calendar name and location as a tooltip. Events refresh every 15 minutes while configured.

## Chat Read/Write Tools

When the Chat widget's calendar toggle is on, the chat reuses this widget's account rather than storing a second copy of the credentials: `getCalendarAccount()` in `lib/dashboardContext.ts` returns the first configured Calendar widget's config on the active dashboard, and the chat relays it with each request (the same pattern as its Anytype connection). The model gets two tools:

- `list_calendar_events(start_date?, end_date?)`: events across the selected calendars, defaulting to the next 14 days.
- `create_calendar_event(title, start, end?, calendar?, location?, description?)`: only writable calendars are eligible; the calendar name is matched loosely and falls back to the first writable one. Created events get a generated UID, a default duration of one hour for timed events (one day for all-day), and a `If-None-Match: *` header so an existing object is never overwritten.

The chat's system prompt instructs the model to create events only on an explicit request and to confirm exactly what it created.

## Digest

Calendar is `digestable` (the default): the `/digest` page fetches the configured window's events and includes them as one line per event. The chat's dashboard lookup gathers the same entry.
