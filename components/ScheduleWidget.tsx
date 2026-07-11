"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarRange, Plus, Pencil, Maximize2, Minimize2, Check, X, Trash2 } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { SettingsInput, SettingsSelect } from "./ui/Field";

// A fixed weekly schedule: the same seven-day time grid every week (classes,
// gym, standing calls), as opposed to the Calendar widget's dated events.
// Entries live on a Monday-first grid with configurable day start/end — the
// end can run past midnight (e.g. 01:00) for late routines. Overlapping
// entries share the column in lanes. An expand toggle floats the grid over a
// dimmed backdrop at 80% of the screen for comfortable editing.

type Entry = {
  id: string;
  title: string;
  days: number[]; // 0 = Monday … 6 = Sunday; one entry can repeat across days
  start: number;  // minutes from midnight
  end: number;    // minutes from midnight; numerically before start = past midnight
  color: string;
};
type Config = { entries: Entry[]; startHour: number; endHour: number };

const DEFAULT_CONFIG: Config = { entries: [], startHour: 6, endHour: 24 };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Block colors: muted tones that keep dark text readable and sit well on both
// themes. Deliberately its own palette — these fill areas, unlike the widget
// accent colors which are tuned for text on tinted backgrounds.
const PALETTE = ["#e8b04b", "#7fc8a9", "#8ab4e8", "#c39be0", "#e08a9b", "#d9c26e", "#7fd0d6", "#a8b0bd"];

const fmt = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const parseTime = (s: string): number | null => {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
};

// Minutes on the grid's own axis: times before the day's start belong to the
// tail past midnight (00:30 with a 06:00 start reads as 24:30).
const normMin = (mins: number, startHour: number) => (mins < startHour * 60 ? mins + 1440 : mins);

// Assign overlapping entries of one day to side-by-side lanes.
function layoutDay(entries: Entry[], startHour: number): { ev: Entry; lane: number; laneCount: number }[] {
  const norm = (m: number) => normMin(m, startHour);
  const sorted = [...entries].sort((a, b) => norm(a.start) - norm(b.start) || norm(b.end) - norm(a.end));
  const placed: { ev: Entry; lane: number; laneCount: number }[] = [];
  let cluster: typeof placed = [];
  let lanes: number[] = []; // per-lane end time within the current cluster
  const closeCluster = () => {
    for (const p of cluster) p.laneCount = lanes.length;
    placed.push(...cluster);
    cluster = [];
    lanes = [];
  };
  for (const ev of sorted) {
    const s = norm(ev.start);
    if (cluster.length && lanes.every(end => end <= s)) closeCluster();
    let lane = lanes.findIndex(end => end <= s);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = norm(ev.end);
    cluster.push({ ev, lane, laneCount: 0 });
  }
  closeCluster();
  return placed;
}

type EditorState = {
  id: string | null; // null = new entry
  title: string;
  days: number[];
  start: string;     // "HH:MM" as typed
  end: string;
  minutes: string;   // duration, when byDuration
  byDuration: boolean;
  color: string;
  error: string;
};

// Mono time field with 15-minute steppers — no native picker, no AM/PM stub.
// Free typing is normalized on blur ("8:5" becomes "08:05").
function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const shift = (delta: number) => {
    const t = parseTime(value);
    if (t !== null) onChange(fmt((t + delta + 1440) % 1440));
  };
  return (
    <div className="flex items-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface)]">
      <button onClick={() => shift(-15)} className="px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="15 minutes earlier">−</button>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => {
          const m = value.trim().match(/^(\d{1,2}):?(\d{2})$/);
          const t = m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : null;
          if (t !== null) onChange(fmt(t));
        }}
        inputMode="numeric"
        placeholder="18:30"
        className="w-12 text-center text-sm font-mono bg-transparent outline-none text-[var(--text-primary)] py-1.5"
      />
      <button onClick={() => shift(15)} className="px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="15 minutes later">+</button>
    </div>
  );
}

// Duration in minutes, same stepper treatment.
function DurationField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const shift = (delta: number) => {
    const v = Math.floor(Number(value)) || 0;
    onChange(String(Math.min(960, Math.max(5, v + delta))));
  };
  return (
    <div className="flex items-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface)]">
      <button onClick={() => shift(-15)} className="px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="15 minutes less">−</button>
      <input
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^\d]/g, ""))}
        inputMode="numeric"
        className="w-10 text-center text-sm font-mono bg-transparent outline-none text-[var(--text-primary)] py-1.5"
      />
      <span className="pr-1 text-[10px] text-[var(--text-muted)]">min</span>
      <button onClick={() => shift(15)} className="px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="15 minutes more">+</button>
    </div>
  );
}

export default function ScheduleWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `schedule-widget-${widget.id}`;

  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(6);
  const [draftEnd, setDraftEnd] = useState(24);
  // Ticks each minute so the now-line tracks the clock.
  const [, setNowTick] = useState(0);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    storage.getItem(storageKey).then(raw => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.entries)) {
            // Early entries carried a single `day`; the model is now multi-day.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const entries = parsed.entries.map((e: any) => (Array.isArray(e.days) ? e : { ...e, days: [e.day ?? 0] }));
            setConfig({ ...DEFAULT_CONFIG, ...parsed, entries });
          }
        } catch {}
      }
      setLoaded(true);
    });
  }, [storageKey]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Escape backs out one layer: editor, then settings, then fullscreen.
  useEffect(() => {
    if (!expanded && !editor && !settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editor) setEditor(null);
      else if (settingsOpen) setSettingsOpen(false);
      else setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, editor, settingsOpen]);

  function apply(next: Config) {
    setConfig(next);
    storage.setItem(storageKey, JSON.stringify(next));
  }

  // ── Editor ──────────────────────────────────────────────────────────────────
  function openEditor(entry: Entry | null, prefill?: { day: number; start: number }) {
    const todayIdx = (new Date().getDay() + 6) % 7;
    setSettingsOpen(false);
    setEditor(entry ? {
      id: entry.id,
      title: entry.title,
      days: [...entry.days],
      start: fmt(entry.start),
      end: fmt(entry.end),
      minutes: String(normMin(entry.end, config.startHour) - normMin(entry.start, config.startHour)),
      byDuration: false,
      color: entry.color,
      error: "",
    } : {
      id: null,
      title: "",
      days: [prefill?.day ?? todayIdx],
      start: fmt(prefill?.start ?? 18 * 60),
      end: fmt((prefill?.start ?? 18 * 60) + 60),
      minutes: "60",
      byDuration: false,
      color: PALETTE[config.entries.length % PALETTE.length],
      error: "",
    });
  }

  function saveEditor() {
    if (!editor) return;
    const title = editor.title.trim();
    const start = parseTime(editor.start);
    const err = (error: string) => setEditor({ ...editor, error });
    if (!title) return err("Give it a title.");
    if (!editor.days.length) return err("Pick at least one day.");
    if (start === null) return err("Times must be valid HH:MM.");
    let end: number | null;
    if (editor.byDuration) {
      const mins = Math.floor(Number(editor.minutes));
      if (!mins || mins < 5) return err("Duration must be at least 5 minutes.");
      end = (start + mins) % 1440;
    } else {
      end = parseTime(editor.end);
      if (end === null) return err("Times must be valid HH:MM.");
    }
    const s = normMin(start, config.startHour);
    const e = normMin(end, config.startHour);
    if (e <= s) return err("End must be after start (past-midnight ends are fine if the grid reaches them).");
    if (e - s > 16 * 60) return err("Longer than 16 hours — double-check the times.");
    const entry: Entry = {
      id: editor.id ?? `s${Date.now()}${Math.floor(Math.random() * 1e3)}`,
      title, days: [...editor.days].sort((a, b) => a - b), start, end, color: editor.color,
    };
    apply({
      ...config,
      entries: editor.id
        ? config.entries.map(x => (x.id === editor.id ? entry : x))
        : [...config.entries, entry],
    });
    setEditor(null);
  }

  function deleteEntry() {
    if (!editor?.id) return;
    apply({ ...config, entries: config.entries.filter(x => x.id !== editor.id) });
    setEditor(null);
  }

  // ── Grid ────────────────────────────────────────────────────────────────────
  function renderGrid(big: boolean) {
    const { startHour, endHour } = config;
    const hours = endHour - startHour;
    const HOUR_PX = big ? 52 : 40;
    const todayIdx = (new Date().getDay() + 6) % 7;
    const now = new Date();
    const nowY = (normMin(now.getHours() * 60 + now.getMinutes(), startHour) - startHour * 60) / 60 * HOUR_PX;
    const labels = big ? DAYS : DAYS_SHORT;

    return (
      <div
        className="flex-1 min-h-0 overflow-auto relative"
        // First mount only: bring the current time into view (an hour above
        // center) so the grid opens where the day actually is.
        ref={el => {
          if (!el || el.dataset.scrolled) return;
          el.dataset.scrolled = "1";
          el.scrollTop = Math.max(0, nowY - 2 * HOUR_PX);
        }}
      >
        <div className="flex min-w-[520px]">
          {/* time gutter */}
          <div className="w-10 shrink-0 relative" style={{ marginTop: 24, height: hours * HOUR_PX }}>
            {Array.from({ length: hours + 1 }, (_, h) => (
              <span
                key={h}
                className={`absolute right-1.5 text-[9px] font-mono opacity-40 ${c.label}`}
                style={{ top: h * HOUR_PX, transform: h === 0 ? "none" : h === hours ? "translateY(-100%)" : "translateY(-50%)" }}
              >
                {fmt((startHour + h) * 60)}
              </span>
            ))}
          </div>
          {/* day columns */}
          {DAYS.map((_, dayIdx) => (
            <div key={dayIdx} className="flex-1 min-w-0">
              <div className={`sticky top-0 z-10 h-6 flex items-center px-1.5 text-[10px] font-medium ${c.bg} ${dayIdx === todayIdx ? c.text : `${c.label} opacity-50`}`}>
                {labels[dayIdx]}
              </div>
              <div
                className="relative border-l border-black/5 dark:border-white/10 cursor-pointer"
                style={{ height: hours * HOUR_PX }}
                onClick={e => {
                  // Click on empty grid: start a new entry at that slot.
                  const rect = e.currentTarget.getBoundingClientRect();
                  const mins = startHour * 60 + Math.floor((e.clientY - rect.top) / HOUR_PX * 60 / 30) * 30;
                  openEditor(null, { day: dayIdx, start: mins % 1440 });
                }}
              >
                {Array.from({ length: hours - 1 }, (_, h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-black/5 dark:border-white/10 pointer-events-none" style={{ top: (h + 1) * HOUR_PX }} />
                ))}
                {layoutDay(config.entries.filter(en => en.days.includes(dayIdx)), startHour).map(({ ev, lane, laneCount }) => {
                  const s = normMin(ev.start, startHour) - startHour * 60;
                  const e2 = normMin(ev.end, startHour) - startHour * 60;
                  const top = Math.max(0, s / 60 * HOUR_PX);
                  const bottom = Math.min(hours * HOUR_PX, e2 / 60 * HOUR_PX);
                  if (bottom <= 0 || top >= hours * HOUR_PX) return null; // outside the visible hours
                  const w = 100 / laneCount;
                  return (
                    <button
                      key={ev.id}
                      onClick={e3 => { e3.stopPropagation(); openEditor(ev); }}
                      title={`${ev.title} (${fmt(ev.start)}–${fmt(ev.end)})`}
                      className="absolute rounded-md px-1.5 py-0.5 text-left overflow-hidden text-[#16181c] hover:brightness-110 transition-[filter]"
                      style={{
                        top, height: Math.max(16, bottom - top - 2),
                        left: `calc(${lane * w}% + 2px)`, width: `calc(${w}% - 4px)`,
                        background: ev.color,
                      }}
                    >
                      {big && <span className="block font-mono text-[9px] opacity-70">{fmt(ev.start)}–{fmt(ev.end)}</span>}
                      <span className={`block font-medium truncate ${big ? "text-[11px]" : "text-[10px]"}`}>{ev.title}</span>
                    </button>
                  );
                })}
                {dayIdx === todayIdx && nowY > 0 && nowY < hours * HOUR_PX && (
                  <div className="absolute inset-x-0 border-t-2 border-red-500/80 pointer-events-none z-[5]" style={{ top: nowY }}>
                    <span className="absolute -left-1 -top-[4px] w-1.5 h-1.5 rounded-full bg-red-500/80" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {loaded && config.entries.length === 0 && !editor && (
          <div className={`absolute inset-0 flex items-center justify-center text-xs opacity-45 pointer-events-none ${c.text}`}>
            click a slot (or +) to plan your week
          </div>
        )}
      </div>
    );
  }

  // ── Card (shared between the grid tile and the fullscreen overlay) ─────────
  const actionCls = `opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`;
  const chip = (active: boolean) =>
    `px-2 py-0.5 rounded-md text-[11px] transition-colors ${active ? `bg-black/10 dark:bg-white/15 ${c.text}` : `${c.label} opacity-50 hover:opacity-90`}`;

  function card(big: boolean) {
    return (
      <>
        {/* Header */}
        <div className="flex items-center justify-between mb-1 shrink-0 gap-2">
          <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
            <span className="opacity-50"><CalendarRange size={14} /></span>
            <span className="text-xs font-medium opacity-60 truncate">{widget.title}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => openEditor(null)} title="Add entry" className={actionCls}>
              <Plus size={14} />
            </button>
            <button
              onClick={() => { setDraftStart(config.startHour); setDraftEnd(config.endHour); setEditor(null); setSettingsOpen(o => !o); }}
              title="Grid hours"
              className={actionCls}
            >
              <Pencil size={13} />
            </button>
            <button onClick={() => setExpanded(v => !v)} title={big ? "Close (Esc)" : "Expand"} className={actionCls}>
              {big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
        </div>

        {renderGrid(big)}

        {/* Entry editor */}
        {editor && (
          <div className={`absolute inset-0 z-40 rounded-2xl flex flex-col gap-3 p-5 overflow-y-auto ${c.bg}`}>
            <p className={`text-[10px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-50 ${c.label}`}>
              {editor.id ? "Edit entry" : "New entry"}
            </p>
            <SettingsInput
              autoFocus
              value={editor.title}
              onChange={e => setEditor({ ...editor, title: e.target.value })}
              onKeyDown={e => e.key === "Enter" && saveEditor()}
              placeholder="Title, e.g. Gym"
              maxLength={60}
            />
            {/* Days: one entry can repeat across the week — pick them all here
                instead of adding the same block day by day. */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {DAYS_SHORT.map((d, i) => {
                const on = editor.days.includes(i);
                return (
                  <button
                    key={d}
                    onClick={() => setEditor({
                      ...editor, error: "",
                      days: on ? editor.days.filter(x => x !== i) : [...editor.days, i],
                    })}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      on ? `bg-black/10 dark:bg-white/15 ${c.text}` : `${c.label} opacity-45 hover:opacity-80`
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
              <span className={`opacity-20 ${c.label}`}>|</span>
              <button onClick={() => setEditor({ ...editor, error: "", days: [0, 1, 2, 3, 4] })} className={`text-[10px] ${c.label} opacity-50 hover:opacity-90`}>
                weekdays
              </button>
              <button onClick={() => setEditor({ ...editor, error: "", days: [0, 1, 2, 3, 4, 5, 6] })} className={`text-[10px] ${c.label} opacity-50 hover:opacity-90`}>
                every day
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <TimeField value={editor.start} onChange={v => setEditor({ ...editor, start: v })} />
              <span className={`opacity-40 text-xs ${c.label}`}>to</span>
              {editor.byDuration ? (
                <DurationField value={editor.minutes} onChange={v => setEditor({ ...editor, minutes: v })} />
              ) : (
                <TimeField value={editor.end} onChange={v => setEditor({ ...editor, end: v })} />
              )}
              <span className="flex items-center gap-1">
                <button onClick={() => setEditor({ ...editor, byDuration: false })} className={chip(!editor.byDuration)}>end time</button>
                <button onClick={() => setEditor({ ...editor, byDuration: true })} className={chip(editor.byDuration)}>duration</button>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {PALETTE.map(col => (
                <button
                  key={col}
                  onClick={() => setEditor({ ...editor, color: col })}
                  aria-label={`color ${col}`}
                  className={`w-5 h-5 rounded-full transition-transform ${editor.color === col ? "scale-110 ring-2 ring-[var(--text-secondary)] ring-offset-1 ring-offset-transparent" : "opacity-70 hover:opacity-100"}`}
                  style={{ background: col }}
                />
              ))}
            </div>
            {editor.error && <p className="text-red-400 text-[11px]">{editor.error}</p>}
            <div className="flex items-center gap-3 mt-auto">
              {editor.id && (
                <button onClick={deleteEntry} title="Delete entry" className="text-red-400/80 hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              )}
              <span className="flex-1" />
              <button onClick={() => setEditor(null)} title="Cancel" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={14} />
              </button>
              <button onClick={saveEditor} title="Save" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <Check size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Grid-hours settings */}
        {settingsOpen && (
          <div className={`absolute inset-0 z-40 rounded-2xl flex flex-col gap-3 p-5 ${c.bg}`}>
            <p className={`text-[10px] uppercase tracking-widest font-[family-name:var(--font-dm-mono)] opacity-50 ${c.label}`}>Grid hours</p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Day starts</p>
                <SettingsSelect value={draftStart} onChange={e => setDraftStart(+e.target.value)}>
                  {Array.from({ length: 13 }, (_, h) => <option key={h} value={h}>{fmt(h * 60)}</option>)}
                </SettingsSelect>
              </div>
              <div className="flex-1">
                <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Day ends</p>
                <SettingsSelect value={draftEnd} onChange={e => setDraftEnd(+e.target.value)}>
                  {Array.from({ length: 15 }, (_, i) => {
                    const h = i + 12;
                    return <option key={h} value={h}>{fmt(h * 60)}{h >= 24 ? " (+1d)" : ""}</option>;
                  })}
                </SettingsSelect>
              </div>
            </div>
            {draftEnd - draftStart < 6 && <p className="text-red-400 text-[11px]">The grid must span at least 6 hours.</p>}
            <div className="flex items-center justify-end gap-3 mt-auto">
              <button onClick={() => setSettingsOpen(false)} title="Cancel" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={14} />
              </button>
              <button
                onClick={() => { if (draftEnd - draftStart >= 6) { apply({ ...config, startHour: draftStart, endHour: draftEnd }); setSettingsOpen(false); } }}
                disabled={draftEnd - draftStart < 6}
                title="Save"
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
              >
                <Check size={14} />
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className={`rounded-2xl border h-full relative group flex flex-col p-4 ${c.bg} ${c.border} ${c.glow} ${className}`}>
        {expanded ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <CalendarRange size={22} className={`${c.label} opacity-40`} />
            <p className={`text-xs ${c.label} opacity-60`}>Schedule is open in fullscreen</p>
            <button onClick={() => setExpanded(false)} className={`text-xs px-3 py-1.5 rounded-lg bg-black/10 dark:bg-white/15 ${c.text} hover:bg-black/15 dark:hover:bg-white/20 transition-colors`}>
              Close
            </button>
          </div>
        ) : card(false)}
      </div>

      {expanded && mounted && createPortal(
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setExpanded(false); }}
        >
          <div className={`tw-overlay-in group w-[80vw] h-[80vh] max-w-[1400px] rounded-2xl border shadow-2xl relative flex flex-col p-6 ${c.bg} ${c.border}`}>
            {card(true)}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export type { Entry as ScheduleEntry, Config as ScheduleConfig };
