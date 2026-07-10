import type { Provider, WriteMode } from "@/lib/assistant/types";
import { dashboardProvider, type DashWidget } from "@/lib/assistant/providers/dashboard";
import { calendarProvider } from "@/lib/assistant/providers/calendar";
import { kiwixProvider, type KiwixConfig } from "@/lib/assistant/providers/kiwix";
import { anytypeProvider, type AnytypeConfig } from "@/lib/assistant/providers/anytype";
import type { CalDAVAccount, CalDAVCalendar } from "@/lib/caldav";

// Build the active providers for one chat request from the configs the client
// relayed. Each config is optional; a missing/incomplete one simply leaves its
// provider (and its tools) out. To add a future integration (gmail, todoist…):
// write lib/assistant/providers/<name>.ts and wire its config here.

export type AssistantConfigs = {
  dashboard?: { widgets: DashWidget[] } | null;
  caldav?: {
    baseUrl: string; username: string; password: string;
    calendars: CalDAVCalendar[];
    writeMode?: string;
  } | null;
  kiwix?: KiwixConfig | null;
  anytype?: {
    baseUrl: string; apiKey: string; spaceId: string; spaceName?: string;
    bridgeUrl?: string; bridgeToken?: string;
    writeMode?: string;
  } | null;
  today?: string;    // the client's local date (YYYY-MM-DD)
  timezone?: string; // the client's IANA zone
};

function asWriteMode(v: unknown): WriteMode {
  return v === "auto" ? "auto" : "confirm";
}

export function buildProviders(cfgs: AssistantConfigs): Provider[] {
  const providers: Provider[] = [];
  const today = /^\d{4}-\d{2}-\d{2}$/.test(cfgs.today ?? "")
    ? cfgs.today!
    : new Date().toISOString().slice(0, 10);

  const timezone = cfgs.timezone && /^[\w/+-]+$/.test(cfgs.timezone) ? cfgs.timezone : undefined;

  if (cfgs.dashboard?.widgets?.length) {
    providers.push(dashboardProvider(cfgs.dashboard.widgets, { today, timezone }));
  }

  const cal = cfgs.caldav;
  if (cal && cal.baseUrl && cal.username && cal.calendars?.length) {
    const account: CalDAVAccount = { baseUrl: cal.baseUrl, username: cal.username, password: cal.password };
    providers.push(calendarProvider({
      account,
      calendars: cal.calendars,
      today,
      timezone,
      writeMode: asWriteMode(cal.writeMode),
    }));
  }

  if (cfgs.kiwix?.baseUrl) {
    providers.push(kiwixProvider(cfgs.kiwix));
  }

  const at = cfgs.anytype;
  if (at && at.baseUrl && at.apiKey && at.spaceId) {
    const anytypeCfg: AnytypeConfig = {
      baseUrl: at.baseUrl, apiKey: at.apiKey, spaceId: at.spaceId, spaceName: at.spaceName,
      writeMode: asWriteMode(at.writeMode),
    };
    if (at.bridgeUrl && at.bridgeToken && /^https?:\/\//.test(at.bridgeUrl)) {
      anytypeCfg.bridge = { url: at.bridgeUrl, token: at.bridgeToken };
    }
    providers.push(anytypeProvider(anytypeCfg));
  }

  return providers;
}
