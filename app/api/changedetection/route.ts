import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { fetchForUser } from "@/lib/ssrf";
import { listWatches } from "@/lib/changedetection";

// POST /api/changedetection { url, apiKey }: the server's watches, newest
// change first. The key rides each request, like the other integrations, and
// the fetch goes through the per-user guard (the LAN for the admin only).
export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { url, apiKey } = body ?? {};
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return NextResponse.json({ error: "Missing url" }, { status: 400 });
  try {
    const watches = await listWatches((u, init) => fetchForUser(user, u, init), url, String(apiKey ?? ""));
    return NextResponse.json({ watches }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const name = (err as Error)?.name;
    const message = name === "TimeoutError" || name === "AbortError" ? "The server did not answer in time."
      : /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(String((err as Error)?.message)) ? "Could not reach that address."
      : String((err as Error)?.message ?? err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
