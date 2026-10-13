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

`POST /api/caldav` with `op: "events"` runs a `calendar-query` REPORT with a time range against each selected calendar (up to 20, in parallel; failures are reported per calendar without sinking the rest). The iCal payloads are parsed with a line-unfolding VEVENT reader. Times are timezone-aware: the widget sends the browser's IANA zone (`timezone`), and UTC values and TZID-stamped wall times are converted into it (the server's zone is used when none is sent); floating times and all-day dates (`VALUE=DATE`) are read in that zone. Escaped characters are unescaped. Servers that match the time range but do not inline `calendar-data` get those objects fetched directly (batches of 8, capped at 100). Recurring events are expanded locally (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY including monthly ordinals, EXDATE and RECURRENCE-ID overrides), so a server that returns only the recurrence master still yields the real occurrences in range.

The other ops are `calendars` (discovery), `create`, and `delete`.

## Agenda View

The front shows events for the next `days` days, grouped by local day with "Today" / "Tomorrow" / weekday headings. Each row has a color dot derived from the calendar name (`tagColor`), the title, an optional location line, and the start time (or "all day"). Hovering a row shows the calendar name and location as a tooltip. Events refresh every 15 minutes while configured.

## Chat Read/Write Tools

When the Chat widget's calendar toggle is on, the chat reuses this widget's account rather than storing a second copy of the credentials: `getCalendarAccount()` in `lib/dashboardContext.ts` returns the first configured Calendar widget's config on the active dashboard, and the chat relays it with each request. The calendar tools (`list_calendar_events`, `create_calendar_event`, `delete_calendar_event`) live in `lib/assistant/providers/calendar.ts`; see [chat.md](chat.md) for how they behave. Only writable calendars are eligible for writes. Created events get a generated UID, a default duration of one hour for timed events (all-day events cover their day), a TZID in the user's zone, and an `If-None-Match: *` header so an existing object is never overwritten.

## Digest

Calendar is `digestable` (the default): the `/digest` page fetches the next two days of events (today and tomorrow, regardless of the widget's `days` setting) and includes them as one line per event. The chat's `read_widget` tool reads the calendar server-side through `lib/widgetData.ts`.

## Network Access

`/api/caldav` fetches through `userFetch` ([`lib/requestUser.ts`](../../lib/requestUser.ts)): admin accounts may reach a CalDAV server on the LAN or tailnet, every other account is limited to public addresses.
