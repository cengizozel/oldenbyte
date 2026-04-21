import { NextResponse } from "next/server";

export async function GET() {
  try {
    const [nextRaceRes, standingsRes] = await Promise.all([
      fetch("https://api.jolpi.ca/ergast/f1/current/next.json", { next: { revalidate: 3600 } }),
      fetch("https://api.jolpi.ca/ergast/f1/current/driverStandings.json", { next: { revalidate: 3600 } }),
    ]);

    if (!nextRaceRes.ok || !standingsRes.ok) throw new Error();

    const [nextRaceData, standingsData] = await Promise.all([
      nextRaceRes.json(),
      standingsRes.json(),
    ]);

    const race = nextRaceData.MRData?.RaceTable?.Races?.[0] ?? null;
    const standings = standingsData.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.slice(0, 5) ?? [];

    return NextResponse.json({ race, standings });
  } catch {
    return NextResponse.json({ error: "Failed to fetch F1 data" }, { status: 500 });
  }
}
