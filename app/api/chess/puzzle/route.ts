import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { parseDailyPuzzle, type DailyPuzzle } from "@/lib/chess";

// GET /api/chess/puzzle: Lichess's daily puzzle (public, no key), parsed into
// a position and a solution. Lichess changes it once a day, so the answer is
// kept for an hour.
let cached: { at: number; puzzle: DailyPuzzle } | null = null;

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  if (cached && Date.now() - cached.at < 3600_000) return NextResponse.json(cached.puzzle);
  try {
    const res = await fetch("https://lichess.org/api/puzzle/daily", {
      headers: { Accept: "application/json", "User-Agent": "oldenbyte dashboard" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const puzzle = parseDailyPuzzle(await res.json());
    if (!puzzle) throw new Error("Unexpected puzzle format");
    cached = { at: Date.now(), puzzle };
    return NextResponse.json(puzzle);
  } catch (err) {
    if (cached) return NextResponse.json(cached.puzzle);
    return NextResponse.json({ error: `Could not load the daily puzzle: ${String(err)}` }, { status: 503 });
  }
}
