"use client";

import { useEffect, useState } from "react";
import { Flame, ChevronLeft, ChevronRight } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { parseJson } from "@/lib/text";
import { formatDate, localDateStr } from "@/lib/format";
import { shiftDay } from "@/lib/upkeep";
import {
  ACTIVITY_LEVELS, KCAL_PER_KG, dailyBurn, isValidConfig, project,
  type DeficitConfig, type DeficitDays, type DayEntry,
} from "@/lib/deficit";
import FlipCard from "./ui/FlipCard";
import { SettingsInput, SettingsSelect, HIT_AREA, FOCUS_RING } from "./ui/Field";
import { PencilButton, EmptyState, SaveCancelRow, WidgetHeader } from "./ui/WidgetChrome";

// Deficit: a profile gives a daily burn, each day you enter what you ate (and
// any exercise, and a weigh-in if you like), and the widget keeps an estimated
// weight at 7700 kcal per kilogram, the calories still to go to the goal
// weight, and the date you reach it at your average pace so far. The chart
// shows the estimate from the start weight down toward the goal, with real
// weigh-ins as dots. The model lives in lib/deficit.

const fmtDay = (date: string) => formatDate(`${date}T12:00:00`, { year: false });
const fmtKcal = (n: number) => Math.round(n).toLocaleString();
const fmtKg = (n: number) => n.toFixed(1);
const CHART_DAYS_MIN = 14;
const CHART_DAYS_MAX = 400;

type Draft = { sex: "male" | "female"; age: string; heightCm: string; startWeightKg: string; goalWeightKg: string; activity: string; startDate: string };
const emptyDraft = (today: string): Draft => ({ sex: "male", age: "", heightCm: "", startWeightKg: "", goalWeightKg: "", activity: "1.2", startDate: today });
const toDraft = (c: DeficitConfig): Draft => ({
  sex: c.sex, age: String(c.age), heightCm: String(c.heightCm), startWeightKg: String(c.startWeightKg),
  goalWeightKg: String(c.goalWeightKg), activity: String(c.activity), startDate: c.startDate,
});

export default function DeficitWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const configKey = `deficit-config-${widget.id}`;
  const daysKey = `deficit-days-${widget.id}`;

  const [config, setConfig] = useState<DeficitConfig | null>(null);
  const [days, setDays] = useState<DeficitDays>({});
  const [loaded, setLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft(localDateStr()));

  // The day being entered: today by default, past days reachable to fix them.
  const [viewDate, setViewDate] = useState(localDateStr());
  const [ate, setAte] = useState("");
  const [burned, setBurned] = useState("");
  const [weight, setWeight] = useState("");

  const today = localDateStr();

  useEffect(() => {
    Promise.all([storage.getItem(configKey), storage.getItem(daysKey)]).then(([cfgRaw, daysRaw]) => {
      try {
        const cfg = cfgRaw ? parseJson<Partial<DeficitConfig> | null>(cfgRaw, null) : null;
        if (isValidConfig(cfg)) { setConfig(cfg); setDraft(toDraft(cfg)); }
        if (daysRaw) setDays(parseJson<DeficitDays | null>(daysRaw, null) ?? {});
      } catch {}
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  // The inputs follow the viewed day.
  useEffect(() => {
    const e = days[viewDate];
    setAte(e && e.ate >= 0 ? String(e.ate) : "");
    setBurned(e?.burned ? String(e.burned) : "");
    setWeight(e?.weight ? String(e.weight) : "");
  }, [viewDate, days]);

  function persistDays(next: DeficitDays) {
    setDays(next);
    storage.setItem(daysKey, JSON.stringify(next));
  }

  // Commit the viewed day's inputs; an empty "ate" removes the day.
  function commitDay() {
    const a = Number(ate);
    const next = { ...days };
    if (ate.trim() === "" || !(a >= 0)) {
      if (!next[viewDate]) return;
      delete next[viewDate];
    } else {
      const entry: DayEntry = { ate: Math.round(a) };
      if (Number(burned) > 0) entry.burned = Math.round(Number(burned));
      if (Number(weight) > 0) entry.weight = Math.round(Number(weight) * 10) / 10;
      const cur = next[viewDate];
      if (cur && cur.ate === entry.ate && (cur.burned ?? 0) === (entry.burned ?? 0) && (cur.weight ?? 0) === (entry.weight ?? 0)) return;
      next[viewDate] = entry;
    }
    persistDays(next);
  }

  function handleSave() {
    const next: DeficitConfig = {
      sex: draft.sex,
      age: Number(draft.age),
      heightCm: Number(draft.heightCm),
      startWeightKg: Number(draft.startWeightKg),
      goalWeightKg: Number(draft.goalWeightKg),
      activity: Number(draft.activity),
      startDate: draft.startDate,
    };
    if (!isValidConfig(next)) return;
    setConfig(next);
    storage.setItem(configKey, JSON.stringify(next));
    setSettingsOpen(false);
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const p = config ? project(config, days, today) : null;
  const viewPoint = p?.points.find(x => x.date === viewDate) ?? null;
  // Burn for the viewed day: as computed if entered, else at the estimate
  // before that day (the last point before it, or the start weight).
  const viewBurnBase = config
    ? dailyBurn(config, [...(p?.points ?? [])].reverse().find(x => x.date < viewDate)?.estWeight ?? config.startWeightKg)
    : 0;
  const viewBurn = viewPoint ? viewPoint.burn : viewBurnBase + (Number(burned) > 0 ? Math.round(Number(burned)) : 0);
  const viewDeficit = ate.trim() !== "" && Number(ate) >= 0 ? viewBurn - Math.round(Number(ate)) : null;

  const iconBtnCls = `${HIT_AREA} ${FOCUS_RING}`;

  // ── Chart ────────────────────────────────────────────────────────────────
  // x: from the start date to the goal date (or today), y: between the goal
  // and the start, padded so weigh-ins outside that band still show.
  let chart: React.ReactNode = null;
  if (config && p) {
    const endDate = p.goalDate && p.goalDate > today ? p.goalDate : today;
    const span = Math.max(CHART_DAYS_MIN, Math.min(CHART_DAYS_MAX, dayDiff(config.startDate, endDate)));
    const x = (date: string) => 2 + (Math.max(0, Math.min(span, dayDiff(config.startDate, date))) / span) * 236;
    const ys = [config.startWeightKg, config.goalWeightKg, p.estWeight, ...p.points.flatMap(pt => (pt.weight ? [pt.weight] : []))];
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const pad = Math.max(0.5, (hi - lo) * 0.08);
    const yMin = lo - pad, yMax = hi + pad;
    const y = (kg: number) => 68 - ((kg - yMin) / (yMax - yMin)) * 62;
    const line = [{ date: config.startDate, kg: config.startWeightKg }, ...p.points.map(pt => ({ date: pt.date, kg: pt.estWeight }))];
    const last = line[line.length - 1];
    const pts = line.map(l => `${x(l.date)},${y(l.kg)}`).join(" ");
    const area = `${x(config.startDate)},${y(yMin)} ${pts} ${x(last.date)},${y(yMin)}`;
    chart = (
      <svg viewBox="0 0 240 72" className="w-full" preserveAspectRatio="none" aria-hidden>
        <line x1={2} y1={y(config.goalWeightKg)} x2={238} y2={y(config.goalWeightKg)} className="stroke-emerald-500" strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
        <polygon points={area} fill="currentColor" className={c.text} opacity={0.12} />
        <polyline fill="none" stroke="currentColor" className={c.text} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" points={pts} opacity={0.9} />
        {p.goalDate && p.goalDate > today && !p.reached && (
          <line x1={x(last.date)} y1={y(last.kg)} x2={x(p.goalDate)} y2={y(config.goalWeightKg)} stroke="currentColor" className={c.text} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
        )}
        {p.points.filter(pt => pt.weight).map(pt => (
          <circle key={pt.date} cx={x(pt.date)} cy={y(pt.weight!)} r={2} className="fill-emerald-500" />
        ))}
        <circle cx={x(last.date)} cy={y(last.kg)} r={2.2} fill="currentColor" className={c.text} />
      </svg>
    );
  }

  const front = (
    <>
      <WidgetHeader
        c={c}
        icon={Flame}
        title="Deficit"
        right={<PencilButton c={c} onClick={() => { setDraft(config ? toDraft(config) : emptyDraft(today)); setSettingsOpen(true); }} title="Profile and goal" />}
      />

      {!loaded ? null : !config || !p ? (
        <EmptyState c={c} action="set your profile and goal" />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto pr-1">
          <div className="shrink-0 flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className={`text-2xl font-semibold tabular-nums leading-none ${p.reached ? "text-emerald-600 dark:text-emerald-400" : c.text}`}>{fmtKg(p.estWeight)}</span>
              <span className={`text-xs ${c.label} opacity-60`}>kg now</span>
            </div>
            <span className={`text-xs tabular-nums ${c.label} opacity-60 shrink-0`}>goal {fmtKg(config.goalWeightKg)} kg</span>
          </div>
          <div className={`shrink-0 text-xs ${c.text} opacity-80 leading-relaxed`}>
            {p.reached ? (
              <span className="text-emerald-600 dark:text-emerald-400">goal reached</span>
            ) : (
              <>
                <span className="tabular-nums font-medium">{fmtKcal(Math.abs(p.remainingKcal))}</span> kcal to go
                {p.goalDate ? <> · around <span className="font-medium">{formatDate(`${p.goalDate}T12:00:00`, { year: p.goalDate.slice(0, 4) !== today.slice(0, 4) })}</span></>
                  : p.loggedDays ? <span className="opacity-70"> · not on track</span> : <span className="opacity-70"> · no days logged yet</span>}
              </>
            )}
            {p.avgDeficit !== null && (
              <span className="opacity-60"> · {fmtKcal(Math.abs(p.avgDeficit))} kcal {p.avgDeficit >= 0 ? "deficit" : "surplus"} a day over {p.loggedDays} {p.loggedDays === 1 ? "day" : "days"}</span>
            )}
          </div>

          <div className="shrink-0">{chart}</div>

          {/* Day entry */}
          <div className="shrink-0 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <button onClick={() => setViewDate(d => shiftDay(d, -1))} title="Previous day" aria-label="Previous day" className={`opacity-60 hover:opacity-100 ${iconBtnCls} ${c.label}`}><ChevronLeft size={14} /></button>
              <span className={`text-xs font-medium ${c.label}`}>{fmtDay(viewDate)}{viewDate === today && " · today"}</span>
              <button onClick={() => setViewDate(d => shiftDay(d, 1))} disabled={viewDate >= today} title="Next day" aria-label="Next day" className={`opacity-60 hover:opacity-100 disabled:opacity-20 ${iconBtnCls} ${c.label}`}><ChevronRight size={14} /></button>
            </div>
            <div className="flex items-center gap-1.5">
              <label className={`flex-1 min-w-0 flex items-center gap-1 text-xs ${c.label}`} title="Calories eaten this day">
                <SettingsInput inputMode="numeric" value={ate} onChange={e => setAte(e.target.value.replace(/[^\d]/g, ""))} onBlur={commitDay} onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="ate" className="!px-2 !py-1 !rounded-lg text-center" />
                <span className="opacity-60 shrink-0">kcal</span>
              </label>
              <label className={`flex-1 min-w-0 flex items-center gap-1 text-xs ${c.label}`} title="Extra calories burned by exercise this day">
                <SettingsInput inputMode="numeric" value={burned} onChange={e => setBurned(e.target.value.replace(/[^\d]/g, ""))} onBlur={commitDay} onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="burned" className="!px-2 !py-1 !rounded-lg text-center" />
                <span className="opacity-60 shrink-0">kcal</span>
              </label>
              <label className={`flex-1 min-w-0 flex items-center gap-1 text-xs ${c.label}`} title="Weigh-in this day, optional">
                <SettingsInput inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value.replace(/[^\d.]/g, ""))} onBlur={commitDay} onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="weigh" className="!px-2 !py-1 !rounded-lg text-center" />
                <span className="opacity-60 shrink-0">kg</span>
              </label>
            </div>
            <div className={`text-xs tabular-nums ${c.label} opacity-60`}>
              burns <span className="font-medium">{fmtKcal(viewBurn)}</span>
              {viewDeficit !== null && <> · <span className={`font-medium ${viewDeficit >= 0 ? "" : "text-red-500"}`}>{fmtKcal(Math.abs(viewDeficit))}</span> {viewDeficit >= 0 ? "deficit" : "surplus"} · {fmtKg(Math.abs(viewDeficit) / KCAL_PER_KG * 1000)} g</>}
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ── Settings (back) ──────────────────────────────────────────────────────
  const field = (label: string, node: React.ReactNode) => (
    <label className={`flex items-center gap-2 text-xs ${c.label}`}>
      <span className="w-20 shrink-0 opacity-70">{label}</span>
      {node}
    </label>
  );
  const num = (key: keyof Draft, placeholder: string, decimal = false) => (
    <SettingsInput
      inputMode={decimal ? "decimal" : "numeric"}
      value={draft[key]}
      onChange={e => setDraft(d => ({ ...d, [key]: e.target.value.replace(decimal ? /[^\d.]/g : /[^\d]/g, "") }))}
      placeholder={placeholder}
      className="!py-1.5"
    />
  );
  const draftValid = isValidConfig({
    sex: draft.sex, age: Number(draft.age), heightCm: Number(draft.heightCm), startWeightKg: Number(draft.startWeightKg),
    goalWeightKg: Number(draft.goalWeightKg), activity: Number(draft.activity), startDate: draft.startDate,
  });
  const draftBurn = draftValid ? dailyBurn({
    sex: draft.sex, age: Number(draft.age), heightCm: Number(draft.heightCm), startWeightKg: Number(draft.startWeightKg),
    goalWeightKg: Number(draft.goalWeightKg), activity: Number(draft.activity), startDate: draft.startDate,
  }, Number(draft.startWeightKg)) : null;

  const back = (
    <>
      <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto pr-3">
        {field("sex", (
          <SettingsSelect value={draft.sex} onChange={e => setDraft(d => ({ ...d, sex: e.target.value as "male" | "female" }))} className="!py-1.5">
            <option value="male">male</option>
            <option value="female">female</option>
          </SettingsSelect>
        ))}
        {field("age", num("age", "years"))}
        {field("height", num("heightCm", "cm"))}
        {field("start weight", num("startWeightKg", "kg", true))}
        {field("goal weight", num("goalWeightKg", "kg", true))}
        {field("activity", (
          <SettingsSelect value={draft.activity} onChange={e => setDraft(d => ({ ...d, activity: e.target.value }))} className="!py-1.5">
            {ACTIVITY_LEVELS.map(a => <option key={a.value} value={String(a.value)}>{a.label}, {a.hint}</option>)}
          </SettingsSelect>
        ))}
        {field("start date", (
          <SettingsInput type="date" value={draft.startDate} max={today} onChange={e => setDraft(d => ({ ...d, startDate: e.target.value }))} className="!py-1.5" />
        ))}
        <p className={`text-xs leading-relaxed opacity-60 ${c.text}`}>
          {draftBurn !== null
            ? <>About <span className="tabular-nums font-medium">{fmtKcal(draftBurn)}</span> kcal a day at the start weight, before exercise. The burn is recomputed from the estimated weight as it changes, and the deficit of each day moves the estimate at {KCAL_PER_KG.toLocaleString()} kcal per kilogram.</>
            : <>Everything is needed for the daily burn: it is the Mifflin-St Jeor rate for your sex, age, height and weight, times the activity level. The start date is the day the start weight was true.</>}
        </p>
      </div>
      <SaveCancelRow c={c} onSave={handleSave} onCancel={() => { setDraft(config ? toDraft(config) : emptyDraft(today)); setSettingsOpen(false); }} />
    </>
  );

  return (
    <div className="relative h-full">
      <FlipCard c={c} flipped={settingsOpen} className={className} front={front} back={back} />
    </div>
  );
}

// Whole days from a to b ("YYYY-MM-DD"), negative when b is earlier.
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
