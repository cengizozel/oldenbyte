import { listEvents, createEvent, deleteEvent, type CalDAVAccount, type CalDAVCalendar, type CalDAVEvent } from "@/lib/caldav";
import type { Provider, ProviderCtx, ToolSpec, ToolResult, WriteMode } from "@/lib/assistant/types";

// Calendar provider: read (time-range listing), add, and remove events over
// CalDAV. Writes honor the per-source write mode: "confirm" turns them into
// proposals the user approves in the chat UI (the default); "auto" executes
// immediately and reports what was done.
//
// Deletion is two-step by design: the model must list events first — each
// deletable event gets a short ref like e3 — then delete by ref. That pins the
// delete to an exact server href instead of trusting the model to reproduce a
// title, and makes "remove my dentist appointment" naturally read-then-act.

export type CalendarConfig = {
  account: CalDAVAccount;
  calendars: CalDAVCalendar[];
  today: string;              // user-local YYYY-MM-DD
  timezone?: string;          // IANA zone for creating timed events
  writeMode: WriteMode;
};

function fmtEventLine(e: CalDAVEvent, ref?: string): string {
  const when = e.allDay ? `${e.start} (all day)` : `${e.start.replace("T", " ")} to ${e.end.slice(11, 16) || e.end}`;
  const tag = ref ? ` (ref: ${ref})` : "";
  return `- ${when}: ${e.title} [${e.calendar}]${e.location ? ` @ ${e.location}` : ""}${tag}${e.recurring ? " (recurring)" : ""}`;
}

export function calendarProvider(cfg: CalendarConfig): Provider {
  const names = cfg.calendars.map(c => `"${c.name}"${c.readOnly ? " (read-only)" : ""}`).join(", ");
  const writable = cfg.calendars.filter(c => !c.readOnly);
  // Refs live for this request: list_calendar_events fills the map, the write
  // tools resolve against it.
  const byRef = new Map<string, CalDAVEvent>();

  const confirmNote = cfg.writeMode === "confirm"
    ? " The user must approve a confirmation card before anything changes; tell them it is awaiting confirmation, never claim it was done."
    : " This executes immediately; report exactly what you did.";

  return {
    key: "calendar",

    tools(): ToolSpec[] {
      const tools: ToolSpec[] = [
        {
          type: "function",
          function: {
            name: "list_calendar_events",
            description:
              `Read the user's calendar (calendars: ${names}). Use for anything about their schedule: ` +
              `"what's on my calendar", "am I free Friday", "when is X". Defaults to the next 14 days. ` +
              `Also the required first step before deleting anything — it assigns each event a ref.`,
            parameters: {
              type: "object",
              properties: {
                start_date: { type: "string", description: "YYYY-MM-DD (default today)" },
                end_date: { type: "string", description: "YYYY-MM-DD exclusive (default start + 14 days)" },
              },
            },
          },
        },
      ];
      if (writable.length) {
        tools.push(
          {
            type: "function",
            function: {
              name: "create_calendar_event",
              description:
                `Add an event to the user's calendar. ONLY call this when the user explicitly asks to add, ` +
                `schedule, or book something.${confirmNote} Writable calendars: ` +
                writable.map(c => `"${c.name}"`).join(", ") + ".",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Event title" },
                  start: { type: "string", description: "YYYY-MM-DD for all-day, or YYYY-MM-DDTHH:mm in the user's local time" },
                  end: { type: "string", description: "Optional end, same format (default: 1 hour after start)" },
                  calendar: { type: "string", description: "Calendar name (default: first writable)" },
                  location: { type: "string" },
                  description: { type: "string" },
                },
                required: ["title", "start"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "delete_calendar_event",
              description:
                `Remove an event from the user's calendar. ONLY call this when the user explicitly asks to ` +
                `remove, cancel, or delete something. Two steps: first call list_calendar_events for the ` +
                `relevant dates, find the event and its ref (e.g. e3), then call this with that ref.` +
                confirmNote + ` Deleting a recurring event removes the whole series.`,
              parameters: {
                type: "object",
                properties: {
                  ref: { type: "string", description: "Event ref from list_calendar_events, e.g. e3" },
                },
                required: ["ref"],
              },
            },
          },
        );
      }
      return tools;
    },

    async run(name, args, ctx: ProviderCtx): Promise<ToolResult | null> {
      if (name === "list_calendar_events") {
        const today = cfg.today;
        const start = /^\d{4}-\d{2}-\d{2}$/.test(String(args?.start_date ?? "")) ? String(args.start_date) : today;
        const end = /^\d{4}-\d{2}-\d{2}$/.test(String(args?.end_date ?? ""))
          ? String(args.end_date)
          : new Date(Date.parse(start) + 14 * 86400000).toISOString().slice(0, 10);
        const settled = await Promise.allSettled(
          cfg.calendars.slice(0, 20).map(c => listEvents(cfg.account, c, start, end, ctx.signal, cfg.timezone))
        );
        const events = settled.flatMap(r => (r.status === "fulfilled" ? r.value : []));
        events.sort((a, b) => a.start.localeCompare(b.start));
        // Assign refs; only events on writable calendars are deletable.
        const readOnlyNames = new Set(cfg.calendars.filter(c => c.readOnly).map(c => c.name));
        const lines = events.map((e, i) => {
          if (readOnlyNames.has(e.calendar)) return fmtEventLine(e);
          const ref = `e${i + 1}`;
          byRef.set(ref, e);
          return fmtEventLine(e, ref);
        });
        const text = events.length
          ? `Today is ${today}. Events from ${start} to ${end}, in chronological order:\n${lines.join("\n")}`
          : `Today is ${today}. No events between ${start} and ${end}.`;
        return { kind: "widget", note: `checking calendar ${start} to ${end} (${events.length} events)`, text };
      }

      if (name === "create_calendar_event") {
        const title = String(args?.title ?? "").trim();
        const start = String(args?.start ?? "").trim();
        if (!title || !start) return { kind: "message", text: "Missing title or start." };
        if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(start)) {
          return { kind: "message", text: `Invalid start "${start}" — use YYYY-MM-DD or YYYY-MM-DDTHH:mm.` };
        }
        const wanted = String(args?.calendar ?? "").trim().toLowerCase();
        const calendar = (wanted && writable.find(c => c.name.toLowerCase().includes(wanted))) || writable[0];
        if (!calendar) return { kind: "message", text: "No writable calendar available." };
        const event = {
          title, start,
          end: args?.end ? String(args.end) : undefined,
          location: args?.location ? String(args.location) : undefined,
          description: args?.description ? String(args.description) : undefined,
        };
        const whenLabel = start.replace("T", " ");

        if (cfg.writeMode === "auto") {
          await createEvent(cfg.account, calendar, event, ctx.signal, cfg.timezone);
          return {
            kind: "action",
            note: `added "${title}" (${whenLabel}) to ${calendar.name}`,
            text: `Done: event "${title}" (${whenLabel}) was created on calendar "${calendar.name}". Confirm this to the user.`,
            action: { kind: "calendar-create", summary: `Added "${title}"`, detail: `${whenLabel} · ${calendar.name}` },
          };
        }
        return {
          kind: "proposal",
          note: `proposing "${title}" for ${whenLabel}`,
          text:
            `Proposed event "${title}" (${whenLabel}) for calendar "${calendar.name}". ` +
            `It is NOT on the calendar yet: the user sees a confirmation card and must approve it. ` +
            `Tell them it is awaiting their confirmation; never claim it was added.`,
          proposal: {
            kind: "calendar-create",
            summary: `Add "${title}"`,
            detail: `${whenLabel} · ${calendar.name}`,
            payload: { ...event, calendarName: calendar.name, calendarUrl: calendar.url, timezone: cfg.timezone },
          },
        };
      }

      if (name === "delete_calendar_event") {
        const ref = String(args?.ref ?? "").trim();
        const e = byRef.get(ref);
        if (!e) {
          return {
            kind: "message",
            text: `Unknown ref "${ref}". Call list_calendar_events first for the relevant dates, then pass the ref (e.g. e3) of the event to delete.`,
          };
        }
        const whenLabel = e.allDay ? e.start : e.start.replace("T", " ");
        if (cfg.writeMode === "auto") {
          await deleteEvent(cfg.account, e.href, ctx.signal);
          return {
            kind: "action",
            note: `deleted "${e.title}" (${whenLabel}) from ${e.calendar}`,
            text: `Done: event "${e.title}" (${whenLabel}) was deleted from calendar "${e.calendar}"${e.recurring ? " (whole series)" : ""}. Confirm this to the user.`,
            action: { kind: "calendar-delete", summary: `Deleted "${e.title}"`, detail: `${whenLabel} · ${e.calendar}` },
          };
        }
        return {
          kind: "proposal",
          note: `proposing to delete "${e.title}" (${whenLabel})`,
          text:
            `Proposed deleting "${e.title}" (${whenLabel}) from calendar "${e.calendar}"${e.recurring ? " — recurring, the WHOLE series would go" : ""}. ` +
            `Nothing is deleted yet: the user sees a confirmation card and must approve it. ` +
            `Tell them it is awaiting their confirmation; never claim it was deleted.`,
          proposal: {
            kind: "calendar-delete",
            summary: `Delete "${e.title}"`,
            detail: `${whenLabel} · ${e.calendar}${e.recurring ? " · whole series" : ""}`,
            payload: { href: e.href, title: e.title, start: e.start, calendarName: e.calendar },
          },
        };
      }

      return null;
    },
  };
}
