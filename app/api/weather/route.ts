import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";

// Open-Meteo proxy (keyless). Two operations:
//   GET /api/weather?q=istanbul        — geocoding search, top 5 matches
//   GET /api/weather?lat=..&lon=..&unit=c|f — current conditions + daily forecast

const UA = { "User-Agent": "oldenbyte-dashboard" };

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q");

  if (q) {
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`,
        { headers: UA, signal: request.signal, next: { revalidate: 86400 } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      type GeoHit = { name: string; latitude: number; longitude: number; country?: string; admin1?: string };
      const results = ((data.results ?? []) as GeoHit[]).map(r => ({
        name: r.name,
        lat: r.latitude,
        lon: r.longitude,
        region: [r.admin1, r.country].filter(Boolean).join(", "),
      }));
      return NextResponse.json({ results });
    } catch (err) {
      return NextResponse.json({ error: `Could not search locations: ${String(err)}` }, { status: 502 });
    }
  }

  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }
  const unit = searchParams.get("unit") === "f" ? "fahrenheit" : "celsius";

  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "auto",
      forecast_days: "6",
      temperature_unit: unit,
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      headers: UA,
      signal: request.signal,
      next: { revalidate: 1800 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return NextResponse.json({
      current: {
        temp: data.current?.temperature_2m,
        feelsLike: data.current?.apparent_temperature,
        humidity: data.current?.relative_humidity_2m,
        windKmh: data.current?.wind_speed_10m,
        code: data.current?.weather_code,
      },
      daily: (data.daily?.time ?? []).map((date: string, i: number) => ({
        date,
        code: data.daily.weather_code?.[i],
        max: data.daily.temperature_2m_max?.[i],
        min: data.daily.temperature_2m_min?.[i],
        rainPct: data.daily.precipitation_probability_max?.[i],
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: `Could not fetch forecast: ${String(err)}` }, { status: 502 });
  }
}
