// Minimal CalDAV client used by /api/caldav and the Chat route's calendar
// tools. Server-side only (Basic auth + CORS). Tested against Radicale and
// written for Nextcloud compatibility: discovery via current-user-principal,
// calendar-home-set, then PROPFIND/REPORT on the home collection.
//
// Parsing is dependency-free, namespace-agnostic regex over the XML (like
// lib/kiwix.ts) and a line-unfolding VEVENT reader for the iCal payloads.
// Recurring events rely on the server's time-range/expand handling; servers
// that don't expand return the recurrence master once.

export type CalDAVAccount = { baseUrl: string; username: string; password: string };
export type CalDAVCalendar = { name: string; url: string; readOnly?: boolean };
export type CalDAVEvent = {
  uid: string;
  href: string;
  calendar: string;     // calendar display name
  title: string;
  start: string;        // ISO-ish "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD" for all-day
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  recurring?: boolean;
};

function authHeader(a: CalDAVAccount): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${a.username}:${a.password}`).toString("base64")}` };
}

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

// Resolve an href (absolute path or full URL) against the account's origin.
function resolveHref(baseUrl: string, href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  const origin = new URL(baseUrl).origin;
  return origin + (href.startsWith("/") ? href : `/${href}`);
}

// Namespace-agnostic tag extraction: matches <x:tag ...>...</x:tag> or <tag>.
function xmlTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}(?:[\\s>][\\s\\S]*?)?</(?:[A-Za-z0-9_-]+:)?${tag}>|<(?:[A-Za-z0-9_-]+:)?${tag}[^>]*/>`, "g");
  return xml.match(re) ?? [];
}
function xmlText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${tag}>`));
  return m ? m[1].trim() : "";
}
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

async function dav(
  url: string, method: string, account: CalDAVAccount, body: string,
  headers: Record<string, string> = {}, signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(url, {
    method,
    headers: {
      ...authHeader(account),
      "Content-Type": "application/xml; charset=utf-8",
      ...headers,
    },
    body,
    signal,
  });
  if (res.status === 401) throw new Error("Authentication failed: check username and app password");
  if (!res.ok && res.status !== 207) throw new Error(`${method} failed (HTTP ${res.status})`);
  return res.text();
}

// ── Discovery ─────────────────────────────────────────────────────────────────

export async function listCalendars(account: CalDAVAccount, signal?: AbortSignal): Promise<CalDAVCalendar[]> {
  const base = normalizeBase(account.baseUrl);

  // 1. Who am I?
  const principalXml = await dav(base + "/", "PROPFIND", account,
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    { Depth: "0" }, signal);
  const principalHref = xmlText(xmlText(principalXml, "current-user-principal"), "href") || xmlText(principalXml, "href");
  const principalUrl = resolveHref(base, decodeXml(principalHref || "/"));

  // 2. Where do my calendars live?
  const homeXml = await dav(principalUrl, "PROPFIND", account,
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml-ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    { Depth: "0" }, signal);
  const homeHref = xmlText(xmlText(homeXml, "calendar-home-set"), "href");
  const homeUrl = resolveHref(base, decodeXml(homeHref || principalHref || "/"));

  // 3. Which children are calendars supporting VEVENT?
  const listXml = await dav(homeUrl, "PROPFIND", account,
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml-ns:caldav" xmlns:cs="http://calendarserver.org/ns/">` +
    `<d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>`,
    { Depth: "1" }, signal);

  const calendars: CalDAVCalendar[] = [];
  for (const resp of xmlTags(listXml, "response")) {
    const type = xmlText(resp, "resourcetype");
    if (!/calendar[\s/>]/.test(type)) continue;
    // Skip calendars that can't hold events (e.g. Nextcloud contact birthdays still report VEVENT; task-only lists report VTODO only).
    const comps = xmlText(resp, "supported-calendar-component-set");
    if (comps && !/VEVENT/i.test(comps)) continue;
    const href = decodeXml(xmlText(resp, "href"));
    if (!href) continue;
    const name = decodeXml(xmlText(resp, "displayname")) || decodeURIComponent(href.split("/").filter(Boolean).pop() ?? "calendar");
    const privileges = xmlText(resp, "current-user-privilege-set");
    const readOnly = privileges ? !/write(?:-content)?[\s/>]/.test(privileges) : false;
    calendars.push({ name, url: resolveHref(base, href), readOnly });
  }
  return calendars;
}

// ── Events ────────────────────────────────────────────────────────────────────

// "20260613T140000Z" / "20260613T140000" / "20260613" → display-oriented ISO.
function icalToIso(value: string, isDate: boolean): string {
  if (isDate || /^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/);
  if (!m) return value;
  if (m[7] === "Z") {
    // Convert UTC to the server's local time for display.
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z`);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

function unescapeIcal(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

// Parse the VEVENTs out of one iCal document.
function parseVevents(ics: string, href: string, calendarName: string): CalDAVEvent[] {
  // Unfold continuation lines (CRLF followed by space/tab).
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const events: CalDAVEvent[] = [];
  for (const block of unfolded.split(/BEGIN:VEVENT/).slice(1)) {
    const body = block.split(/END:VEVENT/)[0];
    const prop = (name: string): { params: string; value: string } | null => {
      const m = body.match(new RegExp(`^${name}((?:;[^:\\n]*)?):(.*)$`, "mi"));
      return m ? { params: m[1] ?? "", value: m[2].trim() } : null;
    };
    const dtstart = prop("DTSTART");
    if (!dtstart) continue;
    const allDay = /VALUE=DATE(?:;|$)/i.test(dtstart.params) || /^\d{8}$/.test(dtstart.value);
    const dtend = prop("DTEND");
    const start = icalToIso(dtstart.value, allDay);
    const end = dtend ? icalToIso(dtend.value, allDay) : start;
    events.push({
      uid: prop("UID")?.value ?? "",
      href,
      calendar: calendarName,
      title: unescapeIcal(prop("SUMMARY")?.value ?? "(untitled)"),
      start,
      end,
      allDay,
      location: unescapeIcal(prop("LOCATION")?.value ?? "") || undefined,
      description: unescapeIcal(prop("DESCRIPTION")?.value ?? "") || undefined,
      recurring: !!prop("RRULE") || undefined,
    });
  }
  return events;
}

// All events in [startIso, endIso) for one calendar. Dates as "YYYY-MM-DD".
export async function listEvents(
  account: CalDAVAccount, calendar: CalDAVCalendar,
  startIso: string, endIso: string, signal?: AbortSignal,
): Promise<CalDAVEvent[]> {
  const fmt = (iso: string) => iso.replace(/-/g, "") + "T000000Z";
  const body =
    `<?xml version="1.0"?>` +
    `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml-ns:caldav">` +
    `<d:prop><d:getetag/><c:calendar-data/></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${fmt(startIso)}" end="${fmt(endIso)}"/>` +
    `</c:comp-filter></c:comp-filter></c:filter>` +
    `</c:calendar-query>`;
  const xml = await dav(calendar.url, "REPORT", account, body, { Depth: "1" }, signal);
  const events: CalDAVEvent[] = [];
  const missing: string[] = [];
  for (const resp of xmlTags(xml, "response")) {
    const href = decodeXml(xmlText(resp, "href"));
    if (!href || href.endsWith("/")) continue;
    const data = decodeXml(xmlText(resp, "calendar-data"));
    if (data && /BEGIN:VEVENT/i.test(data)) {
      events.push(...parseVevents(data, resolveHref(account.baseUrl, href), calendar.name));
    } else {
      missing.push(href);
    }
  }
  // Some servers (e.g. Radicale builds) match the time-range but don't inline
  // calendar-data; fetch those objects directly, capped to keep this bounded.
  const CAP = 100;
  for (let i = 0; i < Math.min(missing.length, CAP); i += 8) {
    const batch = missing.slice(i, i + 8);
    const settled = await Promise.allSettled(batch.map(async href => {
      const url = resolveHref(account.baseUrl, href);
      const res = await fetch(url, { headers: authHeader(account), signal });
      if (!res.ok) return [];
      return parseVevents(await res.text(), url, calendar.name);
    }));
    for (const r of settled) if (r.status === "fulfilled") events.push(...r.value);
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return events;
}

// ── Writes ────────────────────────────────────────────────────────────────────

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (treated as server-local floating time).
function isoToIcal(iso: string): { value: string; isDate: boolean } {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) throw new Error(`Invalid date "${iso}" (use YYYY-MM-DD or YYYY-MM-DDTHH:mm)`);
  if (!m[4]) return { value: `${m[1]}${m[2]}${m[3]}`, isDate: true };
  return { value: `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00`, isDate: false };
}

export async function createEvent(
  account: CalDAVAccount, calendar: CalDAVCalendar,
  ev: { title: string; start: string; end?: string; location?: string; description?: string },
  signal?: AbortSignal,
): Promise<{ uid: string; href: string }> {
  const uid = `ob-${Date.now()}-${Math.floor(Math.random() * 1e6)}@oldenbyte`;
  const start = isoToIcal(ev.start);
  // Default duration: one hour for timed events, one day for all-day.
  const end = ev.end ? isoToIcal(ev.end) : null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//oldenbyte//dashboard//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    start.isDate ? `DTSTART;VALUE=DATE:${start.value}` : `DTSTART:${start.value}`,
    end
      ? (end.isDate ? `DTEND;VALUE=DATE:${end.value}` : `DTEND:${end.value}`)
      : (start.isDate ? "" : `DURATION:PT1H`),
    `SUMMARY:${icsEscape(ev.title)}`,
    ev.location ? `LOCATION:${icsEscape(ev.location)}` : "",
    ev.description ? `DESCRIPTION:${icsEscape(ev.description)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const href = `${normalizeBase(calendar.url)}/${uid}.ics`;
  const res = await fetch(href, {
    method: "PUT",
    headers: {
      ...authHeader(account),
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": "*",
    },
    body: lines.join("\r\n"),
    signal,
  });
  if (res.status === 401) throw new Error("Authentication failed");
  if (res.status === 403) throw new Error(`No write permission on "${calendar.name}" (read-only calendar?)`);
  if (!res.ok) throw new Error(`Create failed (HTTP ${res.status})`);
  return { uid, href };
}

export async function deleteEvent(account: CalDAVAccount, href: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(href, { method: "DELETE", headers: authHeader(account), signal });
  if (!res.ok && res.status !== 204) throw new Error(`Delete failed (HTTP ${res.status})`);
}
