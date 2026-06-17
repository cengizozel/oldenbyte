"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Plus, History, Trash2, X, Flame, ChevronLeft, Circle, CircleCheck } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { tagColor } from "@/lib/colors";
import { formatDate } from "@/lib/format";
import FlipCard from "./ui/FlipCard";
import { SettingsInput } from "./ui/Field";
import { PencilButton, EmptyState, SaveCancelRow } from "./ui/WidgetChrome";

// Upkeep is Tracker and Rhythm's third sibling. Tracker answers "how long?",
// Rhythm answers "when, and how often?" — Upkeep answers "did I keep up with the
// basics today?" Each item is a thing you should do daily (brush teeth, shower,
// take medicine), worth some points; the points you check off divide by the
// points possible to make a score out of 100. The goal is to start each day at
// zero and end it at 100, and to string perfect days together as long as you can.

type Item = { id: string; name: string; weight: number };
// Per local day: the ids that were checked off that day. The score is derived,
// never stored, so it always reflects the current items and weights.
type Days = Record<string, string[]>;

function newId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Local-calendar day helpers — the day boundary is the user's midnight, matching
// Tracker and Rhythm, so a late-night check-off belongs to the day they lived.
function localDateStr(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function shiftDay(date: string, delta: number): string {
  const t = new Date(`${date}T12:00:00`);
  t.setDate(t.getDate() + delta);
  return localDateStr(t);
}

// Ids carry their creation time as a prefix (see newId), so a day only counts an
// item toward its score if the item already existed then. This keeps a fresh
// habit from retroactively breaking past perfect days — and the streak with it.
// Items from before this scheme (or a seed) have no numeric prefix and count
// from the beginning of time.
function itemCreatedDay(id: string): string {
  const ms = parseInt(id.split("-")[0], 10);
  return Number.isFinite(ms) ? localDateStr(new Date(ms)) : "1970-01-01";
}

const GRID_DAYS = 14;  // heatmap width and score-line span
const fmtDay = (date: string) => formatDate(`${date}T12:00:00`, { year: false });
const colorOf = (id: string) => tagColor(id).dot;

// Completion ring: the full circle is the day's possible points; each checked
// item fills its slice (sized by weight, colored like its dot), the rest stays a
// faint track. Mirrors Tracker's donut so the three siblings read as a family.
function ScoreRing({
  rows, total, size, stroke, center,
}: {
  rows: { id: string; color: string; weight: number; done: boolean }[];
  total: number;
  size: number;
  stroke: number;
  center?: React.ReactNode;
}) {
  const R = 42;
  const CIRC = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx={50} cy={50} r={R} fill="none" strokeWidth={stroke} className="stroke-black/[0.07] dark:stroke-white/10" />
        {total > 0 && rows.map(r => {
          const len = (r.weight / total) * CIRC;
          const seg = r.done ? (
            <circle
              key={r.id}
              cx={50} cy={50} r={R}
              fill="none"
              stroke={r.color}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 0.6)} ${CIRC - Math.max(0, len - 0.6)}`}
              strokeDashoffset={-acc}
              strokeLinecap="butt"
            />
          ) : null;
          acc += len;
          return seg;
        })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
          {center}
        </div>
      )}
    </div>
  );
}

export default function UpkeepWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];

  const configKey = `upkeep-config-${widget.id}`;
  const daysKey = `upkeep-days-${widget.id}`;

  const [items, setItems] = useState<Item[]>([]);
  const [days, setDays] = useState<Days>({});
  const [now, setNow] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<Item[]>([]);
  const [nameInput, setNameInput] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailDate, setDetailDate] = useState<string | null>(null);

  // Recomputed every render so the whole view re-keys itself at local midnight
  // (the slow tick below keeps renders coming so the rollover is prompt).
  const today = localDateStr();

  useEffect(() => {
    Promise.all([storage.getItem(configKey), storage.getItem(daysKey)]).then(([cfgRaw, daysRaw]) => {
      try {
        if (cfgRaw) {
          const cfg = JSON.parse(cfgRaw) as { items?: Item[] };
          const its = (cfg.items ?? []).map(i => ({ ...i, weight: i.weight > 0 ? i.weight : 1 }));
          setItems(its);
          setDraft(its);
        }
        if (daysRaw) setDays((JSON.parse(daysRaw) as Days) ?? {});
      } catch {}
      setNow(Date.now());
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  // Slow tick: keeps "today" fresh and rolls the view over at local midnight.
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  function persistConfig(nextItems: Item[]) {
    storage.setItem(configKey, JSON.stringify({ items: nextItems }));
  }
  function persistDays(next: Days) {
    setDays(next);
    storage.setItem(daysKey, JSON.stringify(next));
  }

  // Toggle one item's done state on a given day (today by default; past days are
  // toggled from the history detail view to backfill a forgotten check).
  function toggle(id: string, date: string) {
    const list = days[date] ?? [];
    const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    persistDays({ ...days, [date]: next });
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  function addItem() {
    const name = nameInput.trim();
    if (!name) return;
    setDraft(d => [...d, { id: newId(), name, weight: 10 }]);
    setNameInput("");
  }

  function handleSave() {
    const cleaned = draft.map(it => ({ ...it, name: it.name.trim(), weight: it.weight > 0 ? it.weight : 1 }))
      .filter(it => it.name);
    const validIds = new Set(cleaned.map(i => i.id));
    // Removing an item drops it from every day's checked list — without the item
    // its points are meaningless (matching Rhythm, there is no ghost row).
    const nextDays: Days = {};
    for (const [date, ids] of Object.entries(days)) {
      const kept = ids.filter(id => validIds.has(id));
      if (kept.length) nextDays[date] = kept;
    }
    setItems(cleaned);
    setDraft(cleaned);
    persistConfig(cleaned);
    persistDays(nextDays);
    setSettingsOpen(false);
  }

  // ── Scoring ────────────────────────────────────────────────────────────────
  // A day's score is the checked points over the points that were possible that
  // day, ×100. "Possible" counts only items that existed on the day, so all
  // boxes checked is always exactly 100. Days before any item exists score null.
  function dayScore(date: string): { done: number; total: number; pct: number | null } {
    const active = items.filter(it => itemCreatedDay(it.id) <= date);
    const total = active.reduce((a, it) => a + it.weight, 0);
    if (total <= 0) return { done: 0, total: 0, pct: null };
    const checked = new Set(days[date] ?? []);
    const done = active.filter(it => checked.has(it.id)).reduce((a, it) => a + it.weight, 0);
    return { done, total, pct: Math.round((done / total) * 100) };
  }

  // Consecutive perfect (100) days ending today — or yesterday if today is not
  // yet perfect, so an in-progress day never reads as a broken streak.
  function perfectStreak(): number {
    let d = today;
    if (dayScore(today).pct !== 100) d = shiftDay(today, -1);
    let n = 0, guard = 0;
    while (dayScore(d).pct === 100 && guard++ < 370) {
      n++;
      d = shiftDay(d, -1);
    }
    return n;
  }

  // ── Derived (front) ──────────────────────────────────────────────────────
  const checkedToday = new Set(days[today] ?? []);
  const ringRows = items.map(it => ({ id: it.id, color: colorOf(it.id), weight: it.weight, done: checkedToday.has(it.id) }));
  const { pct } = dayScore(today);
  const streak = perfectStreak();
  const perfect = pct === 100;

  const headerIconCls = `opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`;

  const front = (
    <>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className={`flex items-center gap-1.5 ${c.label}`}>
          <span className="opacity-50"><ShieldCheck size={14} /></span>
          <span className="text-xs font-medium opacity-60">Upkeep</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setDetailDate(null); setHistoryOpen(true); }} title="History and insights" className={headerIconCls}>
            <History size={14} />
          </button>
          <PencilButton c={c} onClick={() => { setDraft(items); setSettingsOpen(true); }} title="Edit items" />
        </div>
      </div>

      {!loaded ? null : items.length === 0 ? (
        <EmptyState c={c} action="add daily essentials" />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="shrink-0 flex justify-center">
            <ScoreRing
              rows={ringRows}
              total={ringRows.reduce((a, r) => a + r.weight, 0)}
              size={112}
              stroke={14}
              center={
                <>
                  <span className={`text-2xl font-semibold tabular-nums leading-none ${perfect ? "text-emerald-600 dark:text-emerald-400" : c.text}`}>
                    {pct ?? "—"}
                  </span>
                  <span className={`mt-1 text-[10px] uppercase tracking-widest opacity-40 ${c.label}`}>
                    {perfect ? "perfect" : "/ 100"}
                  </span>
                </>
              }
            />
          </div>

          {streak >= 2 && (
            <div className={`shrink-0 flex items-center justify-center gap-1 text-[11px] tabular-nums ${c.label} opacity-70`}>
              <Flame size={12} />
              <span>{streak}-day perfect streak</span>
            </div>
          )}

          <ul className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-1">
            {items.map(it => {
              const done = checkedToday.has(it.id);
              const dot = colorOf(it.id);
              return (
                <li key={it.id}>
                  <button
                    onClick={() => toggle(it.id, today)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                      done ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dot, opacity: done ? 1 : 0.4 }} />
                    <span className={`flex-1 min-w-0 truncate text-sm ${c.text} ${done ? "" : "opacity-70"}`}>{it.name}</span>
                    <span className={`text-[10px] tabular-nums shrink-0 ${c.label} opacity-45`}>{it.weight}</span>
                    <span className={done ? "text-emerald-600 dark:text-emerald-400" : `opacity-30 ${c.label}`}>
                      {done ? <CircleCheck size={16} /> : <Circle size={16} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );

  // ── Settings (back) ──────────────────────────────────────────────────────
  const draftTotal = draft.reduce((a, it) => a + (it.weight > 0 ? it.weight : 0), 0);

  const back = (
    <>
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
        <div className="flex gap-1">
          <SettingsInput
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addItem()}
            placeholder="e.g. brushed teeth, took medicine"
            className="flex-1"
          />
          <button
            onClick={addItem}
            className="px-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Plus size={14} />
          </button>
        </div>
        {draft.length > 0 && (
          <>
            <div className="flex flex-col gap-1.5">
              {draft.map(it => (
                <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-black/5 dark:bg-white/10">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(it.id) }} />
                  <input
                    value={it.name}
                    onChange={e => setDraft(d => d.map(x => x.id === it.id ? { ...x, name: e.target.value } : x))}
                    className={`flex-1 min-w-0 bg-transparent dark:!bg-transparent text-sm outline-none ${c.text}`}
                  />
                  <label className={`flex items-center gap-1 text-[10px] ${c.label} opacity-70`} title="Points this item is worth">
                    <input
                      inputMode="numeric"
                      value={it.weight}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, "");
                        setDraft(d => d.map(x => x.id === it.id ? { ...x, weight: v ? parseInt(v, 10) : 0 } : x));
                      }}
                      className={`w-10 text-center tabular-nums border border-[var(--surface-border)] rounded-lg px-1 py-1 outline-none bg-[var(--surface)] ${c.text}`}
                    />
                    <span>pts</span>
                  </label>
                  <button
                    onClick={() => setDraft(d => d.filter(x => x.id !== it.id))}
                    className={`opacity-50 hover:opacity-100 leading-none ${c.label}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className={`text-[11px] leading-relaxed opacity-55 ${c.text}`}>
              Points add up to <span className="tabular-nums font-medium">{draftTotal}</span> — checking everything always scores 100, so the weights just set how much each one moves the needle.
            </p>
          </>
        )}
        {draft.length === 0 && (
          <p className={`text-[11px] leading-relaxed opacity-55 ${c.text}`}>
            Add the daily essentials you want to stay on top of — brushing teeth, showering, taking medicine, a clean bed. Give each one a point value for how much it matters; checking them all off scores a perfect 100.
          </p>
        )}
      </div>
      <SaveCancelRow c={c} onSave={handleSave} onCancel={() => { setDraft(items); setSettingsOpen(false); }} />
    </>
  );

  // ── History overlay ────────────────────────────────────────────────────────
  const gridDates = Array.from({ length: GRID_DAYS }, (_, i) => shiftDay(today, i - (GRID_DAYS - 1)));
  const scored = gridDates.map(d => ({ date: d, ...dayScore(d) }));
  const withScore = scored.filter(s => s.pct != null);
  const avg7 = withScore.length ? Math.round(withScore.reduce((a, s) => a + (s.pct ?? 0), 0) / withScore.length) : null;
  const perfectDays = withScore.filter(s => s.pct === 100).length;
  const chartMax = 100;

  // The checklist as it stands for one day (used in the day detail), each row
  // toggleable so a forgotten check can be backfilled.
  function dayRows(date: string) {
    const checked = new Set(days[date] ?? []);
    return items
      .filter(it => itemCreatedDay(it.id) <= date)
      .map(it => ({ ...it, color: colorOf(it.id), done: checked.has(it.id) }));
  }

  return (
    <div className="relative h-full">
      <FlipCard c={c} flipped={settingsOpen} className={className} front={front} back={back} />

      {historyOpen && (
        <div className={`absolute inset-0 z-40 p-5 flex flex-col rounded-2xl border ${c.bg} ${c.border}`}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 ${c.label}`}>
              {detailDate ? (
                <button onClick={() => setDetailDate(null)} title="Back to insights" className="opacity-60 hover:opacity-100 flex items-center gap-1">
                  <ChevronLeft size={14} />
                  <span className="text-xs font-medium">{fmtDay(detailDate)}{detailDate === today && " · today"}</span>
                </button>
              ) : (
                <>
                  <span className="opacity-50"><History size={14} /></span>
                  <span className="text-xs font-medium opacity-60">Insights</span>
                </>
              )}
            </div>
            <button onClick={() => { setHistoryOpen(false); setDetailDate(null); }} className={`opacity-50 hover:opacity-90 ${c.label}`} title="Close">
              <X size={14} />
            </button>
          </div>

          {detailDate ? (
            <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-3">
              <div className="shrink-0 flex justify-center">
                {(() => {
                  const s = dayScore(detailDate);
                  const rows = dayRows(detailDate).map(r => ({ id: r.id, color: r.color, weight: r.weight, done: r.done }));
                  return (
                    <ScoreRing
                      rows={rows}
                      total={s.total}
                      size={96}
                      stroke={14}
                      center={
                        <>
                          <span className={`text-xl font-semibold tabular-nums leading-none ${s.pct === 100 ? "text-emerald-600 dark:text-emerald-400" : c.text}`}>{s.pct ?? "—"}</span>
                          <span className={`mt-1 text-[9px] uppercase tracking-widest opacity-40 ${c.label}`}>{s.pct === 100 ? "perfect" : "/ 100"}</span>
                        </>
                      }
                    />
                  );
                })()}
              </div>
              {dayRows(detailDate).length === 0 ? (
                <EmptyState c={c}>no items existed this day</EmptyState>
              ) : (
                <div className="flex flex-col gap-1">
                  {dayRows(detailDate).map(r => (
                    <button
                      key={r.id}
                      onClick={() => toggle(r.id, detailDate)}
                      className={`group/row flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                        r.done ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color, opacity: r.done ? 1 : 0.4 }} />
                      <span className={`flex-1 min-w-0 truncate text-xs ${c.text} ${r.done ? "opacity-80" : "opacity-55"}`}>{r.name}</span>
                      <span className={`text-[10px] tabular-nums shrink-0 ${c.label} opacity-45`}>{r.weight}</span>
                      <span className={r.done ? "text-emerald-600 dark:text-emerald-400" : `opacity-30 ${c.label}`}>
                        {r.done ? <CircleCheck size={14} /> : <Circle size={14} />}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-4">
              {items.length === 0 ? (
                <EmptyState c={c}>no items yet</EmptyState>
              ) : (
                <>
                  {/* 14-day score line */}
                  <div className="shrink-0">
                    <svg viewBox="0 0 240 72" className="w-full" preserveAspectRatio="none">
                      <line x1={2} y1={8} x2={238} y2={8} className="stroke-black/[0.06] dark:stroke-white/[0.07]" strokeWidth={1} strokeDasharray="2 3" />
                      <polyline
                        fill="none"
                        stroke="currentColor"
                        className={c.text}
                        strokeWidth={1.5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={scored.map((s, i) => `${(i / (GRID_DAYS - 1)) * 236 + 2},${68 - ((s.pct ?? 0) / chartMax) * 60}`).join(" ")}
                        opacity={0.8}
                      />
                      {scored.map((s, i) => s.pct != null && (
                        <circle
                          key={s.date}
                          cx={(i / (GRID_DAYS - 1)) * 236 + 2}
                          cy={68 - (s.pct / chartMax) * 60}
                          r={s.pct === 100 ? 2.4 : 1.6}
                          className={s.pct === 100 ? "fill-emerald-500" : `${c.text} fill-current`}
                          opacity={s.pct === 100 ? 1 : 0.6}
                        />
                      ))}
                    </svg>
                    <div className={`flex justify-between text-[9px] opacity-40 ${c.label}`}>
                      <span>{fmtDay(gridDates[0])}</span>
                      <span>{fmtDay(today)}</span>
                    </div>
                  </div>

                  {/* Insights */}
                  <div className={`shrink-0 flex flex-col gap-1 text-[11px] ${c.text} opacity-75`}>
                    {avg7 != null && (
                      <span>last {withScore.length} days: <span className="tabular-nums font-medium">{avg7}</span> average · <span className="tabular-nums font-medium">{perfectDays}</span> perfect</span>
                    )}
                    {streak >= 1 && (
                      <span className="flex items-center gap-1">
                        <Flame size={11} className={c.label} />
                        <span className="tabular-nums">{streak}d</span>
                        <span className="opacity-60">current perfect streak</span>
                      </span>
                    )}
                  </div>

                  {/* Day heatmap: one cell per day, shaded by score; tap to drill in */}
                  <div className="shrink-0">
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${GRID_DAYS}, 1fr)` }}>
                      {scored.map(s => {
                        const op = s.pct == null ? 0 : 0.2 + 0.8 * (s.pct / 100);
                        return (
                          <button
                            key={s.date}
                            onClick={() => setDetailDate(s.date)}
                            title={`${fmtDay(s.date)}: ${s.pct == null ? "no items" : s.pct}`}
                            className="h-5 rounded-sm transition-transform hover:scale-110"
                            style={{
                              backgroundColor: s.pct == null ? undefined : (s.pct === 100 ? "#10b981" : colorOf(widget.id)),
                              opacity: s.pct == null ? 1 : op,
                            }}
                          >
                            {s.pct == null && <span className="block w-full h-full rounded-sm bg-black/[0.06] dark:bg-white/[0.07]" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className={`flex justify-between text-[8px] opacity-40 ${c.label} mt-1`}>
                      <span>{fmtDay(gridDates[0])}</span>
                      <span>{fmtDay(today)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
