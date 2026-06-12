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
export type CalDAVCalendar = { name: string; url: string; readOnly?: boolean; source?: string };
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
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    { Depth: "0" }, signal);
  const homeHref = xmlText(xmlText(homeXml, "calendar-home-set"), "href");
  const homeUrl = resolveHref(base, decodeXml(homeHref || principalHref || "/"));

  // 3. Which children are calendars supporting VEVENT?
  const listXml = await dav(homeUrl, "PROPFIND", account,
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">` +
    `<d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><d:current-user-privilege-set/><cs:source/></d:prop></d:propfind>`,
    { Depth: "1" }, signal);

  const calendars: CalDAVCalendar[] = [];
  for (const resp of xmlTags(listXml, "response")) {
    const type = xmlText(resp, "resourcetype");
    // Real calendars, plus webcal subscriptions (e.g. a Google calendar added
    // to Nextcloud): subscriptions are served read-only but are queryable.
    const isCalendar = /calendar[\s/>]/.test(type);
    const isSubscribed = /subscribed[\s/>]/.test(type);
    if (!isCalendar && !isSubscribed) continue;
    // Skip calendars that can't hold events (task-only lists report VTODO only).
    const comps = xmlText(resp, "supported-calendar-component-set");
    if (isCalendar && comps && !/VEVENT/i.test(comps)) continue;
    const href = decodeXml(xmlText(resp, "href"));
    if (!href) continue;
    const name = decodeXml(xmlText(resp, "displayname")) || decodeURIComponent(href.split("/").filter(Boolean).pop() ?? "calendar");
    const privileges = xmlText(resp, "current-user-privilege-set");
    const readOnly = isSubscribed || (privileges ? !/write(?:-content)?[\s/>]/.test(privileges) : false);
    // Subscriptions carry the upstream webcal/ICS URL; Nextcloud serves the
    // node itself empty over DAV, so events are read from the source feed.
    const source = isSubscribed ? decodeXml(xmlText(xmlText(resp, "source"), "href")) || undefined : undefined;
    calendars.push({ name, url: resolveHref(base, href), readOnly, source });
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

// ── Webcal subscriptions ──────────────────────────────────────────────────────
// Nextcloud (and most servers) expose a subscription as an empty node plus a
// source URL; the events live in the upstream ICS feed. We fetch the feed and
// expand recurrences ourselves: DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL,
// COUNT, UNTIL, BYDAY (incl. monthly ordinals like 2TU/-1FR), EXDATE, and
// RECURRENCE-ID overrides. TZID-local times are treated as server-local time;
// UTC times are converted (good enough when the feed and user share a region).

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function icalToMs(value: string, isDate: boolean): number {
  const iso = icalToIso(value, isDate);
  return Date.parse(iso.includes("T") ? iso : `${iso}T00:00:00`);
}

function msToIso(ms: number, allDay: boolean): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return allDay ? date : `${date}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Occurrence starts (epoch ms) of an RRULE within [rangeStart, rangeEnd).
function expandRrule(rule: string, startMs: number, rangeStart: number, rangeEnd: number): number[] {
  const parts: Record<string, string> = {};
  for (const kv of rule.split(";")) {
    const [k, v] = kv.split("=");
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const freq = parts.FREQ;
  if (!freq) return [];
  const interval = Math.max(1, parseInt(parts.INTERVAL ?? "1") || 1);
  let count = parts.COUNT ? parseInt(parts.COUNT) : Infinity;
  const until = parts.UNTIL ? icalToMs(parts.UNTIL, /^\d{8}$/.test(parts.UNTIL)) + (/^\d{8}$/.test(parts.UNTIL) ? 86399000 : 0) : Infinity;
  const limit = Math.min(rangeEnd, until + 1);
  const out: number[] = [];
  const MAX = 1000;

  const consider = (t: number) => {
    if (count <= 0) return false;
    count--;
    if (t >= rangeStart && t < limit) out.push(t);
    return true;
  };

  const start = new Date(startMs);
  if (freq === "DAILY") {
    for (let i = 0, t = startMs; i < MAX && t < limit && count > 0; i++, t = startMs + i * interval * 86400000) consider(t);
  } else if (freq === "WEEKLY") {
    const bydays = (parts.BYDAY ? parts.BYDAY.split(",") : []).map(d => WEEKDAYS[d.trim()]).filter(d => d !== undefined);
    const days = bydays.length ? bydays : [start.getDay()];
    // Walk week by week from the start's week (weeks begin Monday per RFC default
    // unless WKST; close enough for typical feeds).
    const weekAnchor = new Date(startMs);
    weekAnchor.setHours(0, 0, 0, 0);
    weekAnchor.setDate(weekAnchor.getDate() - weekAnchor.getDay());
    for (let w = 0; w < MAX && count > 0; w += interval) {
      const weekStart = new Date(weekAnchor);
      weekStart.setDate(weekStart.getDate() + w * 7);
      if (weekStart.getTime() > limit) break;
      for (const dow of [...days].sort()) {
        const occ = new Date(weekStart);
        occ.setDate(occ.getDate() + dow);
        occ.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        const t = occ.getTime();
        if (t < startMs) continue;
        if (t > limit && count !== Infinity) { consider(t); continue; }
        if (t >= limit) { count = 0; break; }
        if (!consider(t)) break;
      }
    }
  } else if (freq === "MONTHLY") {
    const byday = parts.BYDAY?.match(/^(-?\d)([A-Z]{2})$/);
    for (let i = 0; i < MAX && count > 0; i += interval) {
      const month = new Date(start.getFullYear(), start.getMonth() + i, 1, start.getHours(), start.getMinutes());
      let occ: Date | null = null;
      if (byday) {
        const ord = parseInt(byday[1]);
        const dow = WEEKDAYS[byday[2]];
        if (ord > 0) {
          const first = new Date(month);
          first.setDate(1 + ((dow - first.getDay() + 7) % 7) + (ord - 1) * 7);
          occ = first.getMonth() === month.getMonth() ? first : null;
        } else {
          const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, start.getHours(), start.getMinutes());
          last.setDate(last.getDate() - ((last.getDay() - dow + 7) % 7) + (ord + 1) * 7);
          occ = last.getMonth() === month.getMonth() ? last : null;
        }
      } else {
        const dom = start.getDate();
        const candidate = new Date(month.getFullYear(), month.getMonth(), dom, start.getHours(), start.getMinutes());
        occ = candidate.getMonth() === month.getMonth() ? candidate : null; // skip short months
      }
      if (!occ) continue;
      const t = occ.getTime();
      if (t < startMs) continue;
      if (t >= limit) break;
      if (!consider(t)) break;
    }
  } else if (freq === "YEARLY") {
    for (let i = 0; i < MAX && count > 0; i += interval) {
      const t = new Date(start.getFullYear() + i, start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()).getTime();
      if (t >= limit) break;
      if (!consider(t)) break;
    }
  }
  return out;
}

// Events from a subscription's ICS feed within [startIso, endIso).
async function listSubscriptionEvents(
  calendar: CalDAVCalendar, startIso: string, endIso: string, signal?: AbortSignal,
): Promise<CalDAVEvent[]> {
  const url = calendar.source!.replace(/^webcal:/i, "https:");
  const res = await fetch(url, { headers: { "User-Agent": "oldenbyte-dashboard" }, signal });
  if (!res.ok) throw new Error(`Subscription feed failed (HTTP ${res.status})`);
  const unfolded = (await res.text()).replace(/\r?\n[ \t]/g, "");
  const rangeStart = Date.parse(`${startIso}T00:00:00`);
  const rangeEnd = Date.parse(`${endIso}T00:00:00`);

  type Raw = {
    uid: string; title: string; location?: string; description?: string;
    allDay: boolean; startMs: number; durMs: number;
    rrule?: string; exdates: number[]; recId?: number;
  };
  const raws: Raw[] = [];
  for (const block of unfolded.split(/BEGIN:VEVENT/).slice(1)) {
    const body = block.split(/END:VEVENT/)[0];
    const prop = (name: string) => {
      const m = body.match(new RegExp(`^${name}((?:;[^:\\n]*)?):(.*)$`, "mi"));
      return m ? { params: m[1] ?? "", value: m[2].trim() } : null;
    };
    const dtstart = prop("DTSTART");
    if (!dtstart) continue;
    const allDay = /VALUE=DATE(?:;|$)/i.test(dtstart.params) || /^\d{8}$/.test(dtstart.value);
    const startMs = icalToMs(dtstart.value, allDay);
    const dtend = prop("DTEND");
    const endMs = dtend ? icalToMs(dtend.value, allDay) : startMs + (allDay ? 86400000 : 3600000);
    const exdates: number[] = [];
    for (const m of body.matchAll(/^EXDATE((?:;[^:\n]*)?):(.*)$/gim)) {
      for (const v of m[2].split(",")) {
        const val = v.trim();
        if (val) exdates.push(icalToMs(val, /^\d{8}$/.test(val)));
      }
    }
    const recIdProp = prop("RECURRENCE-ID");
    raws.push({
      uid: prop("UID")?.value ?? "",
      title: unescapeIcal(prop("SUMMARY")?.value ?? "(untitled)"),
      location: unescapeIcal(prop("LOCATION")?.value ?? "") || undefined,
      description: unescapeIcal(prop("DESCRIPTION")?.value ?? "") || undefined,
      allDay, startMs, durMs: Math.max(0, endMs - startMs),
      rrule: prop("RRULE")?.value,
      exdates,
      recId: recIdProp ? icalToMs(recIdProp.value, /^\d{8}$/.test(recIdProp.value)) : undefined,
    });
  }

  // Occurrences replaced by a RECURRENCE-ID override are dropped from expansion.
  const overridden = new Set(raws.filter(r => r.recId != null).map(r => `${r.uid}:${r.recId}`));
  const events: CalDAVEvent[] = [];
  const emit = (r: Raw, occStartMs: number) => {
    events.push({
      uid: r.uid, href: url, calendar: calendar.name, title: r.title,
      start: msToIso(occStartMs, r.allDay), end: msToIso(occStartMs + r.durMs, r.allDay),
      allDay: r.allDay, location: r.location, description: r.description,
      recurring: !!r.rrule || undefined,
    });
  };
  for (const r of raws) {
    if (r.rrule) {
      const excluded = new Set(r.exdates);
      for (const t of expandRrule(r.rrule, r.startMs, rangeStart, rangeEnd)) {
        if (excluded.has(t) || overridden.has(`${r.uid}:${t}`)) continue;
        emit(r, t);
      }
    } else if (r.startMs + r.durMs > rangeStart && r.startMs < rangeEnd) {
      emit(r, r.startMs);
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return events;
}

// All events in [startIso, endIso) for one calendar. Dates as "YYYY-MM-DD".
export async function listEvents(
  account: CalDAVAccount, calendar: CalDAVCalendar,
  startIso: string, endIso: string, signal?: AbortSignal,
): Promise<CalDAVEvent[]> {
  if (calendar.source) return listSubscriptionEvents(calendar, startIso, endIso, signal);
  const fmt = (iso: string) => iso.replace(/-/g, "") + "T000000Z";
  const body =
    `<?xml version="1.0"?>` +
    `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">` +
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
