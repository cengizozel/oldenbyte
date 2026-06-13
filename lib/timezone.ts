import * as storage from "@/lib/storage";

// A single optional timezone preference (stored under "timezone"). Empty string
// means "follow the device". It drives the top-bar clock and the date/time the
// Chat widget puts in its prompt, so a self-hoster whose server sits in another
// region can pin the zone they actually live in.

export const TZ_EVENT = "timezonechange";
export const TZ_AUTO = "";

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// The chosen zone, falling back to the device zone when set to automatic.
export function effectiveTimezone(saved: string): string {
  return saved || deviceTimezone();
}

// Full IANA list where the browser exposes it, else a sensible shortlist.
export function timezoneOptions(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof f === "function") return f("timeZone");
  } catch { /* fall through */ }
  return [
    "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
    "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Istanbul", "Europe/Moscow",
    "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney",
  ];
}

// A Date whose device-local fields equal the wall-clock in `tz`, so existing
// local formatters and the analog clock render the chosen zone without each
// call having to pass a timeZone option.
export function zonedDate(base: Date, tz: string): Date {
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
    });
    const p = Object.fromEntries(f.formatToParts(base).map(x => [x.type, x.value]));
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  } catch {
    return base;
  }
}

// "2026-06-13" in the given zone.
export function todayIn(tz: string): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date().toLocaleDateString("en-CA");
  }
}

// "Saturday, June 13, 2026, 2:30 PM (Europe/Istanbul)" for the chat prompt.
export function nowLine(tz: string): string {
  const d = new Date();
  try {
    const date = d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: tz });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
    return `${date}, ${time} (${tz})`;
  } catch {
    return d.toString();
  }
}

export async function setTimezone(value: string): Promise<void> {
  await storage.setItem("timezone", value);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TZ_EVENT, { detail: value }));
  }
}
