import { effectiveTimezone } from "@/lib/timezone";
import type { CalendarSource } from "@/lib/dashboardContext";
import type { ChatConfig, NormalizedProposal } from "./types";

// Run one approved proposal against its backing service; true = success. The
// credentials come from the live widget/chat config, never from the persisted
// proposal, so tokens never sit in chat history.
export async function executeProposal(p: NormalizedProposal, ctx: { calSource: CalendarSource | null; config: ChatConfig; timezone: string }): Promise<boolean> {
  const pay = p.payload;
  if (p.kind === "calendar-create" || p.kind === "calendar-delete") {
    const { calSource } = ctx;
    if (!calSource) return false;
    const account = {
      baseUrl: calSource.account.baseUrl,
      username: calSource.account.username,
      password: calSource.account.password,
    };
    const body = p.kind === "calendar-create"
      ? {
          op: "create", ...account,
          calendar: { name: pay.calendarName, url: pay.calendarUrl },
          event: { title: pay.title, start: pay.start, end: pay.end, location: pay.location, description: pay.description },
          timezone: pay.timezone ?? effectiveTimezone(ctx.timezone),
        }
      : { op: "delete", ...account, href: pay.href };
    const res = await fetch("/api/caldav", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  }
  if (p.kind === "anytype-create" || p.kind === "anytype-append") {
    const { config } = ctx;
    if (!config.anytypeBridgeUrl || !config.anytypeBridgeToken) return false;
    const rpc = p.kind === "anytype-create"
      ? { op: "create_object", space_id: pay.spaceId, name: pay.name, type_name: pay.typeName, markdown: pay.markdown, icon_emoji: pay.iconEmoji }
      : { op: "append_markdown", object_id: pay.objectId, markdown: pay.markdown };
    const res = await fetch("/api/anytype", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "bridge", bridgeUrl: config.anytypeBridgeUrl, bridgeToken: config.anytypeBridgeToken, rpc }),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return !data.error;
  }
  return false;
}
