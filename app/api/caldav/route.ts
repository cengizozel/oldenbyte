import { NextRequest, NextResponse } from "next/server";
import { listCalendars, listEvents, createEvent, deleteEvent, type CalDAVAccount, type CalDAVCalendar } from "@/lib/caldav";

// CalDAV proxy (Nextcloud, Radicale, any RFC 4791 server). Server-side for
// Basic auth + CORS; credentials ride each request and are never stored here.
// Ops:
//   POST { op: "calendars", baseUrl, username, password }
//   POST { op: "events", baseUrl, username, password, calendars: [{name,url}], start, end }
//   POST { op: "create", baseUrl, username, password, calendar: {name,url}, event: {title,start,end?,location?,description?} }
//   POST { op: "delete", baseUrl, username, password, href }

export async function POST(request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { op, baseUrl, username, password } = body ?? {};
  if (!op || !baseUrl || !/^https?:\/\//.test(baseUrl) || !username) {
    return NextResponse.json({ error: "Missing op, baseUrl, or username" }, { status: 400 });
  }
  const account: CalDAVAccount = { baseUrl, username, password: password ?? "" };

  try {
    if (op === "calendars") {
      return NextResponse.json({ calendars: await listCalendars(account, request.signal) });
    }

    if (op === "events") {
      const calendars: CalDAVCalendar[] = Array.isArray(body.calendars) ? body.calendars : [];
      const start: string = body.start;
      const end: string = body.end;
      if (!calendars.length || !/^\d{4}-\d{2}-\d{2}$/.test(start ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? "")) {
        return NextResponse.json({ error: "Missing calendars or start/end (YYYY-MM-DD)" }, { status: 400 });
      }
      const settled = await Promise.allSettled(
        calendars.slice(0, 20).map(c => listEvents(account, c, start, end, request.signal))
      );
      const events = settled.flatMap(r => (r.status === "fulfilled" ? r.value : []));
      events.sort((a, b) => a.start.localeCompare(b.start));
      const failures = settled
        .map((r, i) => (r.status === "rejected" ? `${calendars[i].name}: ${String(r.reason?.message ?? r.reason)}` : null))
        .filter(Boolean);
      return NextResponse.json({ events, failures });
    }

    if (op === "create") {
      const calendar: CalDAVCalendar = body.calendar;
      const event = body.event ?? {};
      if (!calendar?.url || !event.title || !event.start) {
        return NextResponse.json({ error: "Missing calendar or event title/start" }, { status: 400 });
      }
      const created = await createEvent(account, calendar, event, request.signal);
      return NextResponse.json(created);
    }

    if (op === "delete") {
      if (!body.href || !/^https?:\/\//.test(body.href)) {
        return NextResponse.json({ error: "Missing href" }, { status: 400 });
      }
      await deleteEvent(account, body.href, request.signal);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown op "${op}"` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
