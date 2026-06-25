import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";

// Unified shape returned to the widget
type Race = {
  raceName: string;
  round: string;
  date: string;
  time?: string;
  Circuit: { circuitId: string; circuitName: string; Location: { country: string } };
};
type Standing = {
  position: string;
  points: string;
  Driver: { givenName: string; familyName: string; code: string };
  Constructors: { name: string }[];
};
type F1Data = { race: Race | null; standings: Standing[] };

const TIMEOUT_MS = 7000;

async function fetchJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "oldenbyte/1.0 (+personal-dashboard)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Primary source: f1api.dev (Ergast-compatible circuit ids)
async function fromF1Api(): Promise<F1Data> {
  const [next, drivers] = await Promise.all([
    fetchJson("https://f1api.dev/api/current/next"),
    fetchJson("https://f1api.dev/api/current/drivers-championship"),
  ]);
  const r = next.race?.[0];
  const race: Race | null = r
    ? {
        raceName: r.raceName,
        round: String(r.round),
        date: r.schedule?.race?.date,
        time: r.schedule?.race?.time ?? undefined,
        Circuit: {
          circuitId: r.circuit?.circuitId,
          circuitName: r.circuit?.circuitName,
          Location: { country: r.circuit?.country },
        },
      }
    : null;
  const standings: Standing[] = (drivers.drivers_championship ?? []).slice(0, 5).map((s: any) => ({
    position: String(s.position),
    points: String(s.points),
    Driver: { givenName: s.driver?.name ?? "", familyName: s.driver?.surname ?? "", code: s.driver?.shortName ?? "" },
    Constructors: [{ name: s.team?.teamName ?? "" }],
  }));
  return { race, standings };
}

// Fallback: the Ergast mirror this widget originally used
async function fromJolpi(): Promise<F1Data> {
  const [nextRaceData, standingsData] = await Promise.all([
    fetchJson("https://api.jolpi.ca/ergast/f1/current/next.json"),
    fetchJson("https://api.jolpi.ca/ergast/f1/current/driverStandings.json"),
  ]);
  const raw = nextRaceData.MRData?.RaceTable?.Races?.[0];
  const race: Race | null = raw
    ? {
        raceName: raw.raceName,
        round: raw.round,
        date: raw.date,
        time: raw.time,
        Circuit: { circuitId: raw.Circuit.circuitId, circuitName: raw.Circuit.circuitName, Location: raw.Circuit.Location },
      }
    : null;
  const standings: Standing[] = standingsData.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.slice(0, 5) ?? [];
  return { race, standings };
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  for (const source of [fromF1Api, fromJolpi]) {
    try {
      const data = await source();
      if (data.race || data.standings.length > 0) return NextResponse.json(data);
    } catch {
      // try the next source
    }
  }
  return NextResponse.json({ error: "Failed to fetch F1 data" }, { status: 502 });
}
