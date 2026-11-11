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

// The saved preference, held in memory so plain formatting helpers (lib/format,
// lib/chat/format) can honour it without each caller threading it through.
// Browsers with privacy protections often report UTC as the device zone, so
// anything that prints a clock time or decides "today" must use this, not the
// device. The top bar and useTimezone set it when the setting loads or
// changes; it is mirrored to localStorage so the first paint is right too. On
// the server it stays empty and everything falls back to the server's zone.
let active = "";
let primed = false;
export function setActiveTimezone(tz: string) {
  active = tz || "";
  primed = true;
  try { if (typeof localStorage !== "undefined") localStorage.setItem("timezone", active); } catch { /* private mode */ }
}
export function activeTimezone(): string {
  if (!primed && typeof localStorage !== "undefined") {
    primed = true;
    try { active = localStorage.getItem("timezone") ?? ""; } catch { /* private mode */ }
  }
  return effectiveTimezone(active);
}
// "Now", or any instant, as a Date whose local fields are the wall clock of
// the chosen zone: feed it to getHours(), toLocaleTimeString() and friends.
export function zoned(input: Date | number | string = new Date()): Date {
  const d = input instanceof Date ? input : new Date(input);
  return zonedDate(d, activeTimezone());
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
  setActiveTimezone(value);
  await storage.setItem("timezone", value);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TZ_EVENT, { detail: value }));
  }
}

// "12:37 AM" in the chosen zone (device zone when automatic).
export function timeIn(ms: number, tz: string): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: effectiveTimezone(tz) });
  } catch {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}
