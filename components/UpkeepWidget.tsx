"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Plus, History, X, Flame, ChevronLeft, RotateCcw, Undo2 } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { parseJson } from "@/lib/text";
import { tagColor } from "@/lib/colors";
import { formatDate, localDateStr } from "@/lib/format";
import { effectiveTimezone, timeIn } from "@/lib/timezone";
import { useTimezone } from "@/lib/useTimezone";
import {
  type UpkeepItem as Item, type UpkeepLog as Log, type UpkeepOrder as Order,
  HOUR, DAY, MAX_HOURS, DEFAULT_HOURS, UNDO_WINDOW,
  addCheck, removeCheck, stopCheck, unstopCheck, normalizeItem, orderRows, shiftDay,
  stateAt, scoreAt, perfectSince, nextExpiry, sampleScores, summarize, dayChecks, formatSpan,
} from "@/lib/upkeep";
import FlipCard from "./ui/FlipCard";
import { SettingsInput, HIT_AREA, FOCUS_RING } from "./ui/Field";
import { PencilButton, EmptyState, SaveCancelRow, WidgetHeader, SmallButton } from "./ui/WidgetChrome";

// Upkeep is Tracker and Rhythm's third sibling. Tracker answers "how long?",
// Rhythm answers "when, and how often?" — Upkeep answers "am I keeping up with
// the basics right now?" Each item is a countdown (brush teeth: 12 hours,
// shower: a day and a half, laundry: a week) worth some points; checking it
// starts the timer, and while the timer runs its points count. The score is the
// running points over all points, out of 100, at this very moment. Nothing
// resets at midnight: the score just sinks as timers run out and rises as you
// check things off again. Scoring lives in lib/upkeep.

function newId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const GRID_DAYS = 14;  // heatmap width
const fmtDay = (date: string) => formatDate(`${date}T12:00:00`, { year: false });
const colorOf = (id: string) => tagColor(id).dot;

// History ranges: a close look sampled hourly, and a long one sampled at
// midnight and noon.
const RANGES = [
  { key: "2w", label: "2 weeks", days: 14, step: HOUR },
  { key: "3m", label: "3 months", days: 91, step: 12 * HOUR },
] as const;
type RangeKey = typeof RANGES[number]["key"];

// Completion ring: the full circle is all the points; each running item fills
// its slice (sized by weight, colored like its dot), the rest stays a faint
// track. Mirrors Tracker's donut so the three siblings read as a family.
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
  const logKey = `upkeep-log-${widget.id}`;

  const [items, setItems] = useState<Item[]>([]);
  const [order, setOrder] = useState<Order>("custom");
  const [log, setLog] = useState<Log>({});
  // The clock the whole view is drawn at; ticks every 30s so countdowns move.
  const [now, setNow] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<Item[]>([]);
  const [nameInput, setNameInput] = useState("");
  // Drag reorder in the settings list with live preview, as in Bookmarks: rows
  // shift out of the way while dragging and the move commits on drop. The
  // target slot comes from the pointer against the list's untransformed
  // geometry, since the rows under the cursor move as the preview updates.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const ROW_GAP = 6; // gap-1.5

  function shiftFor(i: number): number {
    if (dragIdx === null || overIdx === null || dragIdx === overIdx) return 0;
    const h = (rowRefs.current[dragIdx]?.offsetHeight ?? 0) + ROW_GAP;
    if (i === dragIdx) return (overIdx - dragIdx) * h;
    if (dragIdx < overIdx && i > dragIdx && i <= overIdx) return -h;
    if (dragIdx > overIdx && i >= overIdx && i < dragIdx) return h;
    return 0;
  }

  function slotFromPointer(clientY: number): number | null {
    const list = listRef.current;
    const h = dragIdx !== null ? (rowRefs.current[dragIdx]?.offsetHeight ?? 0) + ROW_GAP : 0;
    if (!list || !h) return null;
    const y = clientY - list.getBoundingClientRect().top;
    return Math.max(0, Math.min(draft.length - 1, Math.floor(y / h)));
  }

  // Reorder happens on the draft and commits with the rest of the edits on save.
  function reorder(from: number, to: number) {
    if (from === to) return;
    setDraft(d => {
      const a = [...d];
      const [moved] = a.splice(from, 1);
      a.splice(to, 0, moved);
      return a;
    });
  }

  const [historyOpen, setHistoryOpen] = useState(false);
  const [range, setRange] = useState<RangeKey>("2w");
  const [detailDate, setDetailDate] = useState<string | null>(null);

  // The item just turned off, for the undo button that stays UNDO_WINDOW long.
  const [undoable, setUndoable] = useState<{ id: string; start: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function offerUndo(next: { id: string; start: number } | null) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoable(next);
    if (next) undoTimer.current = setTimeout(() => setUndoable(null), UNDO_WINDOW);
  }
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  // Older shapes (a day-based span, a per-day checklist) are brought up to
  // date by the server on read (lib/migrations), so this only parses.
  useEffect(() => {
    Promise.all([storage.getItem(configKey), storage.getItem(logKey)]).then(([cfgRaw, logRaw]) => {
      try {
        const at = Date.now();
        let its: Item[] = [];
        if (cfgRaw) {
          const cfg = parseJson<{ items?: Partial<Item>[]; order?: string }>(cfgRaw, {});
          its = (cfg.items ?? []).filter((i): i is Item => !!i.id && !!i.name).map(normalizeItem);
          if (cfg.order === "need") setOrder("need");
        }
        setItems(its);
        setDraft(its);
        if (logRaw) setLog(parseJson<Log | null>(logRaw, null) ?? {});
        setNow(at);
      } catch {}
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  // Slow tick: moves the countdowns and lets timers run out on screen.
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  function persistConfig(nextItems: Item[], nextOrder: Order = order) {
    storage.setItem(configKey, JSON.stringify({ items: nextItems, order: nextOrder }));
  }
  function changeOrder(next: Order) {
    setOrder(next);
    persistConfig(items, next);
  }
  function persistLog(next: Log) {
    setLog(next);
    storage.setItem(logKey, JSON.stringify(next));
  }

  // The row toggles: a dark item turns on (its countdown starts now), a
  // running item turns off (the check keeps its start and gets this moment as
  // its end, so history stays honest) and offers an undo for a short while.
  function tap(it: Item) {
    const at = Date.now();
    const st = stateAt(it, log, at);
    if (st.on && st.since != null) {
      persistLog(stopCheck(log, it.id, at));
      offerUndo({ id: it.id, start: st.since });
    } else {
      persistLog(addCheck(log, it.id, at));
      if (undoable?.id === it.id) offerUndo(null);
    }
    setNow(at);
  }

  // The rewind button on a running item: did it again, so the countdown
  // starts over from now. The earlier check stays in the log.
  function restart(it: Item) {
    const at = Date.now();
    persistLog(addCheck(log, it.id, at));
    setNow(at);
  }

  // Undo turning an item off: its check runs its full span again.
  function undoOff() {
    if (!undoable) return;
    persistLog(unstopCheck(log, undoable.id, undoable.start));
    offerUndo(null);
    setNow(Date.now());
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  function addItem() {
    const name = nameInput.trim();
    if (!name) return;
    setDraft(d => [...d, { id: newId(), name, weight: 10, hours: DEFAULT_HOURS }]);
    setNameInput("");
  }

  function setSpan(id: string, part: "d" | "h", raw: string) {
    const v = raw.replace(/\D/g, "");
    const n = v ? parseInt(v, 10) : 0;
    setDraft(d => d.map(x => {
      if (x.id !== id) return x;
      const days = part === "d" ? Math.min(n, 365) : Math.floor(x.hours / 24);
      const hrs = part === "h" ? Math.min(n, 23) : x.hours % 24;
      return { ...x, hours: Math.min(days * 24 + hrs, MAX_HOURS) };
    }));
  }

  function handleSave() {
    const cleaned = draft.map(it => normalizeItem({ ...it, name: it.name.trim() }))
      .filter(it => it.name);
    const validIds = new Set(cleaned.map(i => i.id));
    // Removing an item drops its checks; without the item its points are
    // meaningless (matching Rhythm, there is no ghost row).
    const nextLog: Log = {};
    for (const [id, ts] of Object.entries(log)) if (validIds.has(id)) nextLog[id] = ts;
    setItems(cleaned);
    setDraft(cleaned);
    persistConfig(cleaned);
    persistLog(nextLog);
    setSettingsOpen(false);
  }

  // ── Derived (front) ──────────────────────────────────────────────────────
  const at = now || Date.now();
  const today = localDateStr(new Date(at));
  const rows = orderRows(items.map(it => ({ ...it, color: colorOf(it.id), ...stateAt(it, log, at) })), order);
  const ringRows = rows.map(r => ({ id: r.id, color: r.color, weight: r.weight, done: r.on }));
  const { pct } = scoreAt(items, log, at);
  const perfect = pct === 100;
  const since = perfectSince(items, log, at);
  const next = nextExpiry(items, log, at);

  const headerIconCls = `opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`;
  const iconBtnCls = `${HIT_AREA} ${FOCUS_RING}`;

  const front = (
    <>
      <WidgetHeader
        c={c}
        icon={ShieldCheck}
        title="Upkeep"
        right={
          <>
            <button onClick={() => { setDetailDate(null); setHistoryOpen(true); }} title="History and insights" aria-label="History and insights" className={headerIconCls}>
              <History size={14} />
            </button>
            <PencilButton c={c} onClick={() => { setDraft(items); setSettingsOpen(true); }} title="Edit items" />
          </>
        }
      />

      {!loaded ? null : items.length === 0 ? (
        <EmptyState c={c} action="add essentials" />
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
                    {pct ?? "-"}
                  </span>
                  <span className={`mt-1 text-xs opacity-70 ${c.label}`}>
                    {perfect ? "perfect" : "/ 100"}
                  </span>
                </>
              }
            />
          </div>

          {perfect && since != null ? (
            <div className={`shrink-0 flex items-center justify-center gap-1 text-xs tabular-nums ${c.label} opacity-70`}>
              <Flame size={12} />
              <span>at 100 for {formatSpan(at - since)}</span>
            </div>
          ) : next ? (
            <div className={`shrink-0 flex items-center justify-center gap-1 text-xs tabular-nums ${c.label} opacity-70 truncate px-2`}>
              <span className="truncate">{next.item.name} runs out in {formatSpan(next.at - at)}</span>
            </div>
          ) : null}

          <ul className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-1">
            {rows.map(r => (
              <li key={r.id} className={`flex items-center rounded-lg transition-colors ${r.on ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"}`}>
                <button
                  onClick={() => tap(r)}
                  title={r.on ? `On, ${formatSpan(r.left)} left. Tap to turn off.` : `Tap to turn on for ${formatSpan(r.hours * HOUR)}.`}
                  className={`flex-1 min-w-0 flex items-center gap-2 pl-2 pr-1 py-2 rounded-l-lg text-left ${FOCUS_RING}`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color, opacity: r.on ? 1 : 0.4 }} />
                  <span className={`flex-1 min-w-0 truncate text-sm ${c.text} ${r.on ? "" : "opacity-80"}`}>{r.name}</span>
                  {r.on && <span className={`text-xs tabular-nums shrink-0 ${c.label} opacity-70`}>{formatSpan(r.left)}</span>}
                  <span className={`text-xs tabular-nums shrink-0 ${c.label} opacity-70`}>{r.weight}</span>
                </button>
                {r.on ? (
                  <button
                    onClick={() => restart(r)}
                    title={`Did it again: start the ${formatSpan(r.hours * HOUR)} over`}
                    aria-label={`Restart ${r.name}`}
                    className={`shrink-0 pl-1 pr-2 py-2 rounded-r-lg opacity-50 hover:opacity-100 ${c.label} ${FOCUS_RING}`}
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : undoable?.id === r.id ? (
                  <button
                    onClick={undoOff}
                    title="Undo turning this off"
                    className={`shrink-0 flex items-center gap-1 pl-1 pr-2 py-2 text-xs ${c.label} opacity-80 hover:opacity-100 ${FOCUS_RING}`}
                  >
                    <Undo2 size={13} />
                    <span>undo</span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  // ── Settings (back) ──────────────────────────────────────────────────────
  const draftTotal = draft.reduce((a, it) => a + (it.weight > 0 ? it.weight : 0), 0);
  const spanInputCls = `w-7 text-xs text-center tabular-nums border border-[var(--surface-border)] rounded-md px-0.5 py-1 outline-none bg-[var(--surface)] ${c.text}`;

  const back = (
    <>
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
        <div className="flex gap-1">
          <SettingsInput
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addItem()}
            placeholder="e.g. teeth clean, showered"
            className="flex-1"
          />
          <SmallButton c={c} onClick={addItem} title="Add item" className="self-center">
            <Plus size={14} />
          </SmallButton>
        </div>
        <div className={`flex items-center gap-2 text-xs ${c.label}`}>
          <span className="opacity-70">Order</span>
          {([["custom", "as arranged"], ["need", "by need"]] as [Order, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => changeOrder(key)}
              title={key === "need" ? "Off items first, heaviest first, then running items soonest to run out first" : "The order below, drag the dots to arrange"}
              className={`px-1.5 py-0.5 rounded-md ${FOCUS_RING} ${order === key ? `bg-black/10 dark:bg-white/15 ${c.text}` : "opacity-70 hover:opacity-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {draft.length > 1 && order === "custom" && (
          <p className={`text-xs opacity-70 -mt-1 ${c.text}`}>Drag the dot to reorder.</p>
        )}
        {draft.length > 0 && (
          <>
            <div
              ref={listRef}
              className="flex flex-col gap-1.5"
              onDragOver={e => {
                if (dragIdx === null) return;
                e.preventDefault();
                const slot = slotFromPointer(e.clientY);
                if (slot !== null && slot !== overIdx) setOverIdx(slot);
              }}
              onDrop={() => {
                if (dragIdx !== null && overIdx !== null) reorder(dragIdx, overIdx);
                setDragIdx(null);
                setOverIdx(null);
              }}
            >
              {draft.map((it, i) => (
                <div
                  key={it.id}
                  ref={el => { rowRefs.current[i] = el; }}
                  style={{ transform: shiftFor(i) ? `translateY(${shiftFor(i)}px)` : undefined }}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 transition-[transform,opacity] duration-150 ${dragIdx === i ? "opacity-40" : ""}`}
                >
                  <span
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                    title="Drag to reorder"
                    className="w-2.5 h-2.5 rounded-full shrink-0 cursor-grab active:cursor-grabbing"
                    style={{ backgroundColor: colorOf(it.id) }}
                  />
                  <input
                    value={it.name}
                    onChange={e => setDraft(d => d.map(x => x.id === it.id ? { ...x, name: e.target.value } : x))}
                    className={`flex-1 min-w-0 bg-transparent dark:!bg-transparent text-sm outline-none ${c.text}`}
                  />
                  <label className={`flex items-center gap-1 text-xs ${c.label} opacity-80`} title="Points this item is worth">
                    <input
                      inputMode="numeric"
                      value={it.weight}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, "");
                        setDraft(d => d.map(x => x.id === it.id ? { ...x, weight: v ? parseInt(v, 10) : 0 } : x));
                      }}
                      className={`w-8 text-xs text-center tabular-nums border border-[var(--surface-border)] rounded-md px-1 py-1 outline-none bg-[var(--surface)] ${c.text}`}
                    />
                    <span>pts</span>
                  </label>
                  <span className={`flex items-center gap-0.5 text-xs ${c.label} opacity-80`} title="How long one check lasts, in days and hours">
                    <input inputMode="numeric" value={Math.floor(it.hours / 24)} onChange={e => setSpan(it.id, "d", e.target.value)} aria-label="Days" className={spanInputCls} />
                    <span>d</span>
                    <input inputMode="numeric" value={it.hours % 24} onChange={e => setSpan(it.id, "h", e.target.value)} aria-label="Hours" className={spanInputCls} />
                    <span>h</span>
                  </span>
                  <button
                    onClick={() => setDraft(d => d.filter(x => x.id !== it.id))}
                    aria-label={`Remove ${it.name}`}
                    className={`opacity-70 hover:opacity-100 leading-none ${iconBtnCls} ${c.label}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className={`text-xs leading-relaxed opacity-70 ${c.text}`}>
              Points add up to <span className="tabular-nums font-medium">{draftTotal}</span>. Everything running at once scores 100, so the weights just set how much each one moves the needle. The span is how long a check lasts: 12 hours for teeth, a week for laundry.
            </p>
          </>
        )}
        {draft.length === 0 && (
          <p className={`text-xs leading-relaxed opacity-70 ${c.text}`}>
            Add the essentials you want to stay on top of: teeth, shower, laundry, a workout. Give each one points for how much it matters and a span for how long one check lasts. Checking an item starts its countdown; while it runs, its points count toward the score.
          </p>
        )}
      </div>
      <SaveCancelRow c={c} onSave={handleSave} onCancel={() => { setDraft(items); setSettingsOpen(false); }} />
    </>
  );

  // ── History overlay ────────────────────────────────────────────────────────
  // Check times print in the chosen timezone, not the browser's (privacy
  // settings often make the browser report UTC).
  const tz = useTimezone();
  const fmtTime = (ms: number) => timeIn(ms, tz);
  const rangeDef = RANGES.find(r => r.key === range) ?? RANGES[0];
  // Samples run from a local midnight `days` ago up to now; the 12-hour step
  // therefore lands on midnight and noon.
  const rangeStart = new Date(`${shiftDay(today, -(rangeDef.days - 1))}T00:00:00`).getTime();
  const samples = sampleScores(items, log, rangeStart, at, rangeDef.step).concat({ t: at, pct });
  const plotted = samples.filter((s): s is { t: number; pct: number } => s.pct != null);
  const week = summarize(sampleScores(items, log, at - 7 * DAY, at, HOUR));

  const gridDates = Array.from({ length: GRID_DAYS }, (_, i) => shiftDay(today, i - (GRID_DAYS - 1)));
  // Each heatmap cell is that day's average score (sampled hourly, today up to now).
  const dayAvg = gridDates.map(d => {
    const from = new Date(`${d}T00:00:00`).getTime();
    return { date: d, ...summarize(sampleScores(items, log, from, Math.min(from + DAY, at + 1), HOUR)) };
  });

  const x = (t: number) => 2 + ((t - rangeStart) / Math.max(1, at - rangeStart)) * 236;
  const y = (p: number) => 68 - (p / 100) * 60;

  // Scrubbing the chart: the nearest sample to the pointer, shown in the
  // header with its date and time, the way a stock chart reads.
  const [scrub, setScrub] = useState<{ t: number; pct: number } | null>(null);
  function onScrub(e: React.PointerEvent<SVGSVGElement>) {
    if (!plotted.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = rangeStart + ((e.clientX - r.left) / Math.max(1, r.width)) * (at - rangeStart);
    let best = plotted[0];
    for (const smp of plotted) if (Math.abs(smp.t - t) < Math.abs(best.t - t)) best = smp;
    setScrub({ t: best.t, pct: best.pct });
  }
  const whenLabel = (t: number) => {
    try {
      return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: effectiveTimezone(tz) });
    } catch {
      return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
  };

  return (
    <div className="relative h-full">
      <FlipCard c={c} flipped={settingsOpen} className={className} front={front} back={back} />

      {historyOpen && (
        <div className={`absolute inset-0 z-40 p-5 flex flex-col rounded-2xl border ${c.bg} ${c.border}`}>
          {detailDate ? (
            /* Day detail header: a back button in place of the title */
            <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
              <button onClick={() => setDetailDate(null)} title="Back to insights" className={`opacity-70 hover:opacity-100 flex items-center gap-1 min-w-0 ${iconBtnCls} ${c.label}`}>
                <ChevronLeft size={14} />
                <span className="text-xs font-medium truncate">{fmtDay(detailDate)}{detailDate === today && " · today"}</span>
              </button>
              <button onClick={() => { setHistoryOpen(false); setDetailDate(null); }} className={`shrink-0 opacity-70 hover:opacity-100 ${iconBtnCls} ${c.label}`} title="Close" aria-label="Close">
                <X size={14} />
              </button>
            </div>
          ) : (
            <WidgetHeader
              panel
              c={c}
              icon={History}
              title="Insights"
              right={
                <button onClick={() => { setHistoryOpen(false); setDetailDate(null); }} className={`opacity-70 hover:opacity-100 ${iconBtnCls} ${c.label}`} title="Close" aria-label="Close">
                  <X size={14} />
                </button>
              }
            />
          )}

          {detailDate ? (
            <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-3">
              {(() => {
                const avg = dayAvg.find(d => d.date === detailDate)?.avg ?? null;
                const checks = dayChecks(items, log, detailDate);
                return (
                  <>
                    <div className={`shrink-0 text-xs ${c.text} opacity-80`}>
                      {avg == null ? "no score this day" : <>average <span className="tabular-nums font-medium">{avg}</span> / 100</>}
                      {checks.length > 0 && <> · <span className="tabular-nums font-medium">{checks.length}</span> {checks.length === 1 ? "check" : "checks"}</>}
                    </div>
                    {checks.length === 0 ? (
                      <EmptyState c={c}>nothing checked this day</EmptyState>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {checks.map(ch => (
                          <div key={`${ch.item.id}-${ch.at}`} className={`group/row flex items-center gap-2 px-2 py-2 rounded-lg ${FOCUS_RING} hover:bg-black/5 dark:hover:bg-white/10`}>
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorOf(ch.item.id) }} />
                            <span className={`flex-1 min-w-0 truncate text-sm ${c.text}`}>{ch.item.name}</span>
                            <span className={`text-xs tabular-nums shrink-0 ${c.label} opacity-70`}>{fmtTime(ch.at)}{ch.stoppedAt != null && ` off ${fmtTime(ch.stoppedAt)}`}</span>
                            <button
                              onClick={() => persistLog(removeCheck(log, ch.item.id, ch.at))}
                              aria-label={`Remove this ${ch.item.name} check`}
                              title="Remove this check"
                              className={`opacity-40 hover:opacity-100 leading-none ${iconBtnCls} ${c.label}`}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-3">
              {items.length === 0 ? (
                <EmptyState c={c}>no items yet</EmptyState>
              ) : (
                <>
                  {/* Score over time */}
                  <div className="shrink-0">
                    <div className="flex items-center justify-between mb-1">
                      {scrub ? (
                        <span className={`text-xs tabular-nums whitespace-nowrap ${c.text}`}>{whenLabel(scrub.t)} · <span className="font-medium">{scrub.pct}</span><span className="opacity-70"> / 100</span></span>
                      ) : (
                        <span className={`text-xs ${c.label} opacity-70`}>score over time</span>
                      )}
                      {/* The range chips step aside while the reading is shown, so it never wraps. */}
                      {!scrub && <div className="flex gap-1">
                        {RANGES.map(r => (
                          <button
                            key={r.key}
                            onClick={() => setRange(r.key)}
                            className={`text-xs px-1.5 py-0.5 rounded-md ${FOCUS_RING} ${range === r.key ? `bg-black/10 dark:bg-white/15 ${c.text}` : `opacity-70 hover:opacity-100 ${c.label}`}`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>}
                    </div>
                    <svg viewBox="0 0 240 72" className="w-full touch-none cursor-crosshair" preserveAspectRatio="none" onPointerMove={onScrub} onPointerDown={onScrub} onPointerLeave={() => setScrub(null)}>
                      <line x1={2} y1={8} x2={238} y2={8} className="stroke-black/[0.06] dark:stroke-white/[0.07]" strokeWidth={1} strokeDasharray="2 3" />
                      {scrub && (
                        <line x1={x(scrub.t)} y1={6} x2={x(scrub.t)} y2={70} stroke="currentColor" className={c.label} strokeWidth={1} opacity={0.5} vectorEffect="non-scaling-stroke" />
                      )}
                      {plotted.length > 1 && (
                        <polyline
                          fill="none"
                          stroke="currentColor"
                          className={c.text}
                          strokeWidth={1.5}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          points={plotted.map(s => `${x(s.t)},${y(s.pct)}`).join(" ")}
                          opacity={0.8}
                        />
                      )}
                      {pct != null && (
                        <circle cx={x(at)} cy={y(pct)} r={2.4} className={pct === 100 ? "fill-emerald-500" : `${c.text} fill-current`} />
                      )}
                      {scrub && (
                        <circle cx={x(scrub.t)} cy={y(scrub.pct)} r={3} className={`${c.text} fill-current`} />
                      )}
                    </svg>
                    <div className={`flex justify-between text-xs opacity-70 ${c.label}`}>
                      <span>{fmtDay(shiftDay(today, -(rangeDef.days - 1)))}</span>
                      <span>now</span>
                    </div>
                  </div>

                  {/* Insights */}
                  <div className={`shrink-0 flex flex-col gap-1 text-xs ${c.text} opacity-80`}>
                    {week.avg != null && (
                      <span>last 7 days: <span className="tabular-nums font-medium">{week.avg}</span> average · at 100 <span className="tabular-nums font-medium">{week.perfectShare}%</span> of the time</span>
                    )}
                    {perfect && since != null && (
                      <span className="flex items-center gap-1">
                        <Flame size={12} className={c.label} />
                        <span className="tabular-nums">{formatSpan(at - since)}</span>
                        <span className="opacity-70">at 100 and counting</span>
                      </span>
                    )}
                  </div>

                  {/* Day heatmap: one cell per day, shaded by its average score; tap to drill in */}
                  <div className="shrink-0">
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${GRID_DAYS}, 1fr)` }}>
                      {dayAvg.map(s => {
                        const op = s.avg == null ? 0 : 0.2 + 0.8 * (s.avg / 100);
                        return (
                          <button
                            key={s.date}
                            onClick={() => setDetailDate(s.date)}
                            title={`${fmtDay(s.date)}: ${s.avg == null ? "no score" : `${s.avg} average`}`}
                            className={`h-5 rounded-md transition-transform hover:scale-110 ${FOCUS_RING}`}
                            style={{
                              backgroundColor: s.avg == null ? undefined : (s.avg === 100 ? "#10b981" : colorOf(widget.id)),
                              opacity: s.avg == null ? 1 : op,
                            }}
                          >
                            {s.avg == null && <span className="block w-full h-full rounded-md bg-black/[0.06] dark:bg-white/[0.07]" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className={`flex justify-between text-xs opacity-70 ${c.label} mt-1`}>
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
