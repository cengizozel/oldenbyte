import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { listCalendars, listEvents, createEvent, deleteEvent, type CalDAVAccount, type CalDAVCalendar } from "@/lib/caldav";
import { actAs } from "@/lib/requestUser";

// CalDAV proxy (Nextcloud, Radicale, any RFC 4791 server). Server-side for
// Basic auth + CORS; credentials ride each request and are never stored here.
// Ops:
//   POST { op: "calendars", baseUrl, username, password }
//   POST { op: "events", baseUrl, username, password, calendars: [{name,url}], start, end }
//   POST { op: "create", baseUrl, username, password, calendar: {name,url}, event: {title,start,end?,location?,description?} }
//   POST { op: "delete", baseUrl, username, password, href }
//   POST { op: "ics", links: [{name,url}], start, end }   plain .ics / webcal links, no account

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  actAs(user);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { op, baseUrl, username, password } = body ?? {};

  // Calendar links: a published .ics feed (Google's "secret address", an
  // iCloud public calendar, a webcal subscription) read without any account.
  // Fetched through the same per-user guard as every other outbound request.
  if (op === "ics") {
    const links: { name: string; url: string }[] = (Array.isArray(body.links) ? body.links : [])
      .filter((l: { url?: unknown }) => typeof l?.url === "string" && /^(https?|webcal):\/\//i.test(l.url as string))
      .slice(0, 20)
      .map((l: { name?: unknown; url: string }) => ({ name: typeof l.name === "string" && l.name.trim() ? l.name.trim().slice(0, 60) : "Calendar", url: l.url }));
    const start: string = body.start;
    const end: string = body.end;
    if (!links.length || !/^\d{4}-\d{2}-\d{2}$/.test(start ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? "")) {
      return NextResponse.json({ error: "Missing links or start/end (YYYY-MM-DD)" }, { status: 400 });
    }
    const tz = typeof body.timezone === "string" && body.timezone ? body.timezone : undefined;
    const none: CalDAVAccount = { baseUrl: "", username: "", password: "" };
    const settled = await Promise.allSettled(
      links.map(l => listEvents(none, { name: l.name, url: l.url, readOnly: true, source: l.url }, start, end, request.signal, tz))
    );
    const events = settled.flatMap(r => (r.status === "fulfilled" ? r.value : []));
    events.sort((a, b) => a.start.localeCompare(b.start));
    const failures = settled
      .map((r, i) => (r.status === "rejected" ? `${links[i].name}: ${String(r.reason?.message ?? r.reason)}` : null))
      .filter(Boolean);
    return NextResponse.json({ events, failures });
  }

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
      const tz = typeof body.timezone === "string" && body.timezone ? body.timezone : undefined;
      const settled = await Promise.allSettled(
        calendars.slice(0, 20).map(c => listEvents(account, c, start, end, request.signal, tz))
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
      const created = await createEvent(
        account, calendar, event, request.signal,
        typeof body.timezone === "string" && body.timezone ? body.timezone : undefined,
      );
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
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 503 });
  }
}
