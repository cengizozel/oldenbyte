"use client";

import { useState, useEffect, useRef } from "react";
import { Flag, Loader } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

type Race = {
  raceName: string;
  round: string;
  Circuit: { circuitId: string; circuitName: string; Location: { country: string } };
  date: string;
  time?: string;
};

type DriverStanding = {
  position: string;
  points: string;
  Driver: { givenName: string; familyName: string; code: string };
  Constructors: { name: string }[];
};

type F1Data = { race: Race | null; standings: DriverStanding[] };

function countdown(dateStr: string, timeStr?: string): string {
  const raceDate = new Date(`${dateStr}T${timeStr ?? "12:00:00Z"}`);
  const diffMs = raceDate.getTime() - Date.now();
  if (diffMs <= 0) return "race day";
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function formatRaceDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function F1Widget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const cacheKey = `f1-cache-${new Date().toISOString().slice(0, 13)}`;

  const [data, setData] = useState<F1Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTopFade, setShowTopFade] = useState(false);
  const [showBottomFade, setShowBottomFade] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function checkFade(el: HTMLDivElement) {
    const overflows = el.scrollHeight > el.clientHeight + 1;
    setShowTopFade(overflows && el.scrollTop > 20);
    setShowBottomFade(overflows && el.scrollHeight - el.scrollTop - el.clientHeight > 20);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkFade(el);
    const ro = new ResizeObserver(() => checkFade(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  useEffect(() => {
    storage.getItem(cacheKey).then(async cached => {
      if (cached) { setData(JSON.parse(cached)); return; }
      setLoading(true);
      try {
        const res = await fetch("/api/f1");
        if (!res.ok) throw new Error();
        const json: F1Data = await res.json();
        setData(json);
        await storage.setItem(cacheKey, JSON.stringify(json));
      } catch {}
      finally { setLoading(false); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${className}`}>

      {/* Header */}
      <div className={`flex items-center gap-1.5 mb-3 shrink-0 ${c.label}`}>
        <span className="opacity-50"><Flag size={14} /></span>
        <span className="text-xs font-medium opacity-60">Formula 1</span>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto pr-3"
          onScroll={e => checkFade(e.currentTarget)}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
            </div>
          ) : data ? (
            <div className="flex flex-col gap-3">

              {/* Next race */}
              {data.race ? (
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <p className={`text-[10px] font-semibold uppercase tracking-widest opacity-50 mb-0.5 ${c.label}`}>
                      Next Race · Round {data.race.round}
                    </p>
                    <p className={`text-sm font-medium leading-snug ${c.text}`}>{data.race.raceName}</p>
                    <p className={`text-xs opacity-60 ${c.text}`}>{data.race.Circuit.circuitName}</p>
                    <p className={`text-xs opacity-50 ${c.text}`}>
                      {formatRaceDate(data.race.date)} · {countdown(data.race.date, data.race.time)}
                    </p>
                  </div>
                  <img
                    src={`/circuits/${data.race.Circuit.circuitId}.svg`}
                    alt=""
                    className="w-16 h-16 shrink-0 opacity-20 dark:opacity-25 dark:invert"
                  />
                </div>
              ) : (
                <p className={`text-xs opacity-50 ${c.text}`}>Season complete</p>
              )}

              {/* Standings */}
              {data.standings.length > 0 && (
                <>
                  <div className="border-t border-black/5" />
                  <div className="flex flex-col">
                    <p className={`text-[10px] font-semibold uppercase tracking-widest opacity-50 mb-1.5 ${c.label}`}>
                      Standings
                    </p>
                    {data.standings.map((s, i) => (
                      <div
                        key={s.position}
                        className={`flex items-center gap-2 py-1.5 ${i > 0 ? "border-t border-black/5" : ""}`}
                      >
                        <span className={`text-xs font-semibold opacity-40 w-4 shrink-0 tabular-nums ${c.label}`}>{s.position}</span>
                        <span className={`text-xs font-bold w-8 shrink-0 ${c.label}`}>{s.Driver.code}</span>
                        <span className={`text-xs flex-1 opacity-70 truncate ${c.text}`}>{s.Driver.familyName}</span>
                        <span className={`text-xs font-medium tabular-nums opacity-80 ${c.text}`}>{s.points}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
            </div>
          )}
        </div>

        {showTopFade && (
          <div className={`absolute top-0 left-0 right-0 h-8 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />
        )}
        {showBottomFade && (
          <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />
        )}
      </div>
    </div>
  );
}
