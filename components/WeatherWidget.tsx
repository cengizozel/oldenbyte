"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sun, Cloud, CloudSun, CloudRain, CloudDrizzle, CloudSnow, CloudLightning, CloudFog,
  Search, Loader, Droplets, Wind,
} from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { formatDate } from "@/lib/format";
import FlipCard from "./ui/FlipCard";
import { SettingsInput } from "./ui/Field";
import { PencilButton, EmptyState, LoadingState, SaveCancelRow } from "./ui/WidgetChrome";

type WeatherConfig = { name: string; region: string; lat: number; lon: number; unit: "c" | "f" };
type GeoResult = { name: string; lat: number; lon: number; region: string };
type Forecast = {
  current: { temp: number; feelsLike: number; humidity: number; windKmh: number; code: number };
  daily: { date: string; code: number; max: number; min: number; rainPct: number }[];
};

const DEFAULT: WeatherConfig = { name: "", region: "", lat: NaN, lon: NaN, unit: "c" };

// WMO weather codes to icon + label.
function codeInfo(code: number): { Icon: typeof Sun; label: string } {
  if (code === 0) return { Icon: Sun, label: "clear" };
  if (code === 1 || code === 2) return { Icon: CloudSun, label: "partly cloudy" };
  if (code === 3) return { Icon: Cloud, label: "overcast" };
  if (code === 45 || code === 48) return { Icon: CloudFog, label: "fog" };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, label: "drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { Icon: CloudRain, label: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { Icon: CloudSnow, label: "snow" };
  if (code >= 95) return { Icon: CloudLightning, label: "thunderstorm" };
  return { Icon: Cloud, label: "" };
}

function dayLabel(date: string, index: number): string {
  if (index === 0) return "Today";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

export default function WeatherWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `weather-widget-${widget.id}`;

  const [config, setConfig] = useState<WeatherConfig>(DEFAULT);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<WeatherConfig>(DEFAULT);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searchError, setSearchError] = useState("");

  const configured = (cfg: WeatherConfig) => isFinite(cfg.lat) && isFinite(cfg.lon);

  const fetchForecast = useCallback(async (cfg: WeatherConfig) => {
    if (!configured(cfg)) return false;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/weather?lat=${cfg.lat}&lon=${cfg.lon}&unit=${cfg.unit}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load forecast.");
      setForecast(data);
      return true;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (saved) {
        try {
          const parsed: WeatherConfig = { ...DEFAULT, ...JSON.parse(saved) };
          setConfig(parsed);
          setDraft(parsed);
          fetchForecast(parsed);
        } catch {}
      }
      setLoaded(true);
    });
  }, [storageKey, fetchForecast]);

  // Refresh the forecast every 30 minutes while configured.
  useEffect(() => {
    if (!configured(config)) return;
    const id = setInterval(() => fetchForecast(config), 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [config, fetchForecast]);

  async function searchLocations() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError("");
    setResults([]);
    try {
      const res = await fetch(`/api/weather?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed.");
      setResults(data.results ?? []);
      if (!(data.results ?? []).length) setSearchError("No places found.");
    } catch (e) {
      setSearchError(String(e instanceof Error ? e.message : e));
    } finally {
      setSearching(false);
    }
  }

  async function handleSave() {
    if (!configured(draft)) {
      setSearchError("Search for a place and pick one first.");
      return;
    }
    setConfig(draft);
    await storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
    fetchForecast(draft);
  }

  async function handleReset() {
    await storage.removeItem(storageKey);
    setConfig(DEFAULT);
    setDraft(DEFAULT);
    setForecast(null);
    setResults([]);
    setQuery("");
    setSettingsOpen(false);
  }

  const unitSuffix = config.unit === "f" ? "°F" : "°C";
  const current = forecast?.current;
  const CurrentIcon = current ? codeInfo(current.code).Icon : Cloud;

  const front = (
    <>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
          <span className="opacity-50 shrink-0"><CurrentIcon size={14} /></span>
          {config.name && <span className="text-xs font-medium opacity-60 truncate">{config.name}</span>}
        </div>
        <PencilButton c={c} onClick={() => { setDraft(config); setQuery(""); setResults([]); setSearchError(""); setSettingsOpen(true); }} />
      </div>

      {!loaded ? null : !configured(config) ? (
        <EmptyState c={c} action="choose a location" />
      ) : loading && !forecast ? (
        <LoadingState c={c} />
      ) : error && !forecast ? (
        <p className="text-red-400 text-xs">{error}</p>
      ) : current ? (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* Current conditions */}
          <div className="shrink-0 flex items-center justify-center gap-3">
            <CurrentIcon size={36} className={`opacity-70 ${c.label}`} strokeWidth={1.5} />
            <div className="flex flex-col">
              <span className={`text-2xl font-semibold tabular-nums leading-none ${c.text}`}>
                {Math.round(current.temp)}{unitSuffix}
              </span>
              <span className={`text-[10px] opacity-50 ${c.label}`}>
                feels {Math.round(current.feelsLike)}° · {codeInfo(current.code).label}
              </span>
            </div>
          </div>
          <div className={`shrink-0 flex items-center justify-center gap-4 text-[10px] opacity-50 ${c.label}`}>
            <span className="flex items-center gap-1"><Droplets size={10} />{current.humidity}%</span>
            <span className="flex items-center gap-1"><Wind size={10} />{Math.round(current.windKmh)} km/h</span>
          </div>

          {/* Daily forecast */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-3">
            <ul className="flex flex-col">
              {(forecast?.daily ?? []).map((d, i) => {
                const { Icon } = codeInfo(d.code);
                return (
                  <li key={d.date} className={`flex items-center gap-2 py-1.5 ${i > 0 ? "border-t border-black/10" : ""}`} title={formatDate(`${d.date}T12:00:00`)}>
                    <span className={`w-10 shrink-0 text-xs ${c.text} ${i === 0 ? "font-medium" : "opacity-70"}`}>{dayLabel(d.date, i)}</span>
                    <Icon size={14} className={`shrink-0 opacity-60 ${c.label}`} />
                    {d.rainPct > 20 ? (
                      <span className={`text-[10px] tabular-nums opacity-50 ${c.label}`}>{d.rainPct}%</span>
                    ) : <span />}
                    <span className={`flex-1 text-right text-xs tabular-nums ${c.text}`}>
                      <span className="opacity-50">{Math.round(d.min)}°</span>
                      {" "}
                      <span>{Math.round(d.max)}°</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );

  const back = (
    <>
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
        <div className="flex gap-1">
          <SettingsInput
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && searchLocations()}
            placeholder="Search a city or place"
            className="flex-1"
          />
          <button
            onClick={searchLocations}
            disabled={searching || !query.trim()}
            className="px-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            {searching ? <Loader size={14} className="animate-spin" /> : <Search size={14} />}
          </button>
        </div>
        {results.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {results.map((r, i) => {
              const picked = draft.lat === r.lat && draft.lon === r.lon;
              return (
                <button
                  key={i}
                  onClick={() => setDraft(d => ({ ...d, name: r.name, region: r.region, lat: r.lat, lon: r.lon }))}
                  className={`text-left px-2 py-1 rounded-lg text-xs transition-colors ${picked ? `${c.label} font-medium opacity-100` : `${c.text} opacity-50 hover:opacity-80`}`}
                >
                  {r.name}{r.region ? `, ${r.region}` : ""}
                </button>
              );
            })}
          </div>
        )}
        {configured(draft) && (
          <p className={`text-[10px] opacity-50 ${c.label}`}>chosen: {draft.name}{draft.region ? `, ${draft.region}` : ""}</p>
        )}
        <div className="flex items-center gap-2">
          <span className={`text-xs opacity-60 ${c.label}`}>Unit</span>
          {(["c", "f"] as const).map(u => (
            <button
              key={u}
              onClick={() => setDraft(d => ({ ...d, unit: u }))}
              className={`w-8 py-1 rounded-lg text-xs font-medium transition-colors ${
                draft.unit === u
                  ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--surface-border)]"
                  : `${c.text} opacity-50 hover:opacity-80`
              }`}
            >
              °{u.toUpperCase()}
            </button>
          ))}
        </div>
        {searchError && <p className="text-red-400 text-xs">{searchError}</p>}
      </div>
      <SaveCancelRow
        c={c}
        onSave={handleSave}
        onCancel={() => { setSettingsOpen(false); setSearchError(""); }}
        onReset={handleReset}
        saving={loading}
      />
    </>
  );

  return <FlipCard c={c} flipped={settingsOpen} className={className} front={front} back={back} />;
}
