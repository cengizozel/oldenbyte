import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { fetchForUser } from "@/lib/ssrf";

// GET /api/monitor?url=...: is this address answering, and how fast.
// The check runs from the dashboard's server. Like every other outbound
// request, an admin may point it at the LAN; other accounts at public
// addresses only (lib/ssrf).
//
// Up means the server answered at all below 500: a login page (401, 403) is
// a service that is running. Results are kept for 20 seconds so several open
// tabs do not multiply the checks.

type Result = { up: boolean; status: number | null; ms: number | null; error?: string };
const recent = new Map<string, { at: number; result: Result }>();
const KEEP_MS = 20_000;

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const url = request.nextUrl.searchParams.get("url") ?? "";
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });

  const key = `${user.id}|${url}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return NextResponse.json(hit.result);

  let result: Result;
  const started = performance.now();
  try {
    const res = await fetchForUser(user, url, {
      method: "GET",
      headers: { "User-Agent": "oldenbyte-monitor" },
      signal: AbortSignal.timeout(8000),
    });
    const ms = Math.round(performance.now() - started);
    // Only the status matters: drop the body unread.
    res.body?.cancel().catch(() => {});
    result = { up: res.status < 500, status: res.status, ms };
  } catch (err) {
    const name = (err as Error)?.name;
    result = { up: false, status: null, ms: null, error: name === "TimeoutError" || name === "AbortError" ? "timed out" : "no answer" };
  }
  recent.set(key, { at: Date.now(), result });
  if (recent.size > 500) for (const k of recent.keys()) { if (recent.size <= 400) break; recent.delete(k); }
  return NextResponse.json(result);
}
