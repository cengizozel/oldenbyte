import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { channels, topGames, TwitchNotConnected } from "@/lib/twitch";

// GET /api/twitch?op=channels&logins=a,b    who of these is live, and what they are streaming
// GET /api/twitch?op=games                  the most watched categories right now
// 404 { error: "not_connected" } until the operator connects a Twitch application.
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const q = request.nextUrl.searchParams;
  try {
    if (q.get("op") === "games") return NextResponse.json({ games: await topGames() }, { headers: { "Cache-Control": "no-store" } });
    if (q.get("op") === "channels") {
      const logins = (q.get("logins") ?? "").split(",").map(s => s.trim()).filter(Boolean);
      return NextResponse.json({ channels: await channels(logins) }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    if (err instanceof TwitchNotConnected) return NextResponse.json({ error: "not_connected" }, { status: 404 });
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 502 });
  }
}
