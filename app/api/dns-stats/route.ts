import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { fetchForUser } from "@/lib/ssrf";
import { adguardStats, piholeStats } from "@/lib/dnsStats";

// POST /api/dns-stats { kind: "adguard" | "pihole", url, username?, password }
// Totals from the user's DNS blocker. Credentials ride each request, like the
// CalDAV proxy, and are not kept here. Outbound requests go through the
// per-user guard: the LAN for the admin, public addresses for anyone else.
export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { kind, url, username, password } = body ?? {};
  if ((kind !== "adguard" && kind !== "pihole") || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Missing kind or url" }, { status: 400 });
  }
  const fetcher = (u: string, init?: RequestInit) => fetchForUser(user, u, init);
  try {
    const stats = kind === "adguard"
      ? await adguardStats(fetcher, url, String(username ?? ""), String(password ?? ""))
      : await piholeStats(fetcher, url, String(password ?? ""));
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const name = (err as Error)?.name;
    const message = name === "TimeoutError" || name === "AbortError" ? "The server did not answer in time."
      : /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(String((err as Error)?.message)) ? "Could not reach that address."
      : String((err as Error)?.message ?? err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
