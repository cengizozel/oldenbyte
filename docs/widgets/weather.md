# Weather Widget

Shows current conditions and a short daily forecast for a chosen place. Data comes from Open-Meteo, which is keyless: no account or API key required.

## Storage Keys

| Key | Value |
|---|---|
| `weather-widget-{id}` | JSON: `{ name, region, lat, lon, unit }` |

`unit` is `"c"` or `"f"`. The widget is unconfigured until a place is picked (`lat`/`lon` default to `NaN`).

## Location Search

The card flips to a settings panel (the same flip as the YouTube/RSS widgets). Type a city or place and press Enter (or click the search button): `GET /api/weather?q=...` geocodes through Open-Meteo's geocoding API and returns the top 5 matches, each with a name and a region string built from `admin1` + country. Click a result to choose it; the chosen place is echoed below the list. A unit toggle picks °C or °F. Save requires a chosen place; reset clears the stored key and returns to the empty state.

## Data Source

`GET /api/weather` (`app/api/weather/route.ts`) is a keyless Open-Meteo proxy with two operations:

- `?q=istanbul`: geocoding search, top 5 matches, server-side cache revalidates daily (`revalidate: 86400`).
- `?lat=..&lon=..&unit=c|f`: forecast. Requests current temperature, apparent temperature, humidity, weather code, and wind, plus 6 days of daily weather code, max/min temperature, and precipitation probability, with `timezone: auto`. Revalidates every 30 minutes (`revalidate: 1800`).

The route validates `lat`/`lon` ranges and normalizes the response to:

```ts
{
  current: { temp, feelsLike, humidity, windKmh, code },
  daily: [{ date, code, max, min, rainPct }]  // 6 days
}
```

## Display

- **Current conditions**: a large icon and temperature, a "feels N° · label" caption, and a humidity/wind row. WMO weather codes map to lucide icons and labels in `codeInfo()` (clear, partly cloudy, overcast, fog, drizzle, rain, snow, thunderstorm).
- **Forecast list**: 6 rows ("Today", then short weekday names). Each shows the condition icon, the precipitation probability when it exceeds 20%, and min/max temperatures. Hovering a row shows the full date as a tooltip.
- The forecast auto-refreshes every 30 minutes while configured.

## Digest and Chat

Weather is `digestable` (the default), so the `/digest` page reads the saved config, fetches a fresh forecast, and includes it as text. The Chat widget's dashboard lookup gathers the same entry. Both use `summarizeForecast()` in `lib/weather.ts`: a one-line "Now in {place}" summary (temperature, condition, feels-like, humidity, wind) plus the next 3 days, with precipitation chance when above 20%. The WMO code-to-label mapping lives in `lib/weather.ts` so the widget, the digest, and the chat context all use the same words.
