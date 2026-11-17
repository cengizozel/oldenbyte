import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { leagueData, leagueTeams, teamData } from "@/lib/football";
import { isLeague } from "@/lib/footballLeagues";

// GET /api/football?op=teams&league=tur.1            the league's teams, for settings
// GET /api/football?op=league&league=tur.1           its matches and table
// GET /api/football?op=team&league=tur.1&team=432    a team's live, next and past matches
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const q = request.nextUrl.searchParams;
  const op = q.get("op"), league = q.get("league") ?? "", team = q.get("team") ?? "";
  if (!isLeague(league)) return NextResponse.json({ error: "Unknown league" }, { status: 400 });
  try {
    if (op === "teams") return NextResponse.json(await leagueTeams(league));
    if (op === "league") return NextResponse.json(await leagueData(league), { headers: { "Cache-Control": "no-store" } });
    if (op === "team") {
      if (!/^\d{1,9}$/.test(team)) return NextResponse.json({ error: "Missing team" }, { status: 400 });
      return NextResponse.json(await teamData(league, team), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 502 });
  }
}
