// Shared WMO weather-code labels (used by the widget, the digest, and the
// chat dashboard context). Icons live in the widget; words live here.

export type WeatherConfigStored = { name: string; region: string; lat: number; lon: number; unit: "c" | "f" };

export function weatherLabel(code: number): string {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunderstorm";
  return "mixed";
}

// One-line text summary for LLM consumers (digest, chat context).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function summarizeForecast(name: string, unit: "c" | "f", data: any): string[] {
  const u = unit === "f" ? "F" : "C";
  const lines: string[] = [];
  if (data.current) {
    lines.push(
      `Now in ${name}: ${Math.round(data.current.temp)}°${u}, ${weatherLabel(data.current.code)}, ` +
      `feels like ${Math.round(data.current.feelsLike)}°${u}, humidity ${data.current.humidity}%, wind ${Math.round(data.current.windKmh)} km/h`
    );
  }
  for (const d of (data.daily ?? []).slice(0, 3)) {
    lines.push(
      `${d.date}: ${weatherLabel(d.code)}, ${Math.round(d.min)}-${Math.round(d.max)}°${u}` +
      (d.rainPct > 20 ? `, ${d.rainPct}% chance of precipitation` : "")
    );
  }
  return lines;
}
