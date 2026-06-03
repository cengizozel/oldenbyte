"use client";

import { useState, useEffect, useRef } from "react";
import { Timer, Pencil, Check, X, Plus, RotateCcw, Play, Pause, History, Trash2 } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

type Item = { id: string; name: string };
// All days of tracked time: date (YYYY-MM-DD) → activity id → seconds.
type Days = Record<string, Record<string, number>>;

// Distinct colors for the donut segments + legend dots (used as inline SVG/CSS colors)
const PALETTE = [
  "#f43f5e", "#0ea5e9", "#8b5cf6", "#14b8a6",
  "#f59e0b", "#10b981", "#ec4899", "#6366f1",
  "#ef4444", "#06b6d4", "#a855f7", "#84cc16",
];

function newId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function fmt(secs: number): string {
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function fmtDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type HistoryDay = { date: string; total: number; rows: { id: string; name: string; color: string; secs: number }[] };

export default function TrackerWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const today = new Date().toISOString().split("T")[0];
  const todayStartMs = Date.parse(`${today}T00:00:00Z`);

  const configKey = `tracker-config-${widget.id}`;
  const daysKey = `tracker-days-${widget.id}`;
  const legacyDayKey = `tracker-day-${widget.id}-${today}`; // pre-history single-day format

  // Item list + the "what's running" pointer persist across days (config key).
  // Per-day accumulated seconds live in `daysKey`; `elapsed` mirrors today's.
  const [items, setItems]       = useState<Item[]>([]);
  const [elapsed, setElapsed]   = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [since, setSince]       = useState<number | null>(null);
  const [now, setNow]           = useState(todayStartMs);
  const [loaded, setLoaded]     = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft]               = useState<Item[]>([]);
  const [nameInput, setNameInput]       = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory]         = useState<HistoryDay[]>([]);
  const [hovered, setHovered]         = useState<string | null>(null);

  // Full multi-day store; `elapsed` is always days[today].
  const daysRef = useRef<Days>({});

  useEffect(() => {
    Promise.all([
      storage.getItem(configKey),
      storage.getItem(daysKey),
      storage.getItem(legacyDayKey),
    ]).then(([cfgRaw, daysRaw, legacyRaw]) => {
      try {
        if (cfgRaw) {
          const cfg = JSON.parse(cfgRaw) as { items?: Item[]; activeId?: string | null; since?: number | null };
          setItems(cfg.items ?? []);
          setDraft(cfg.items ?? []);
          setActiveId(cfg.activeId ?? null);
          setSince(cfg.since ?? null);
        }
        let days: Days = {};
        if (daysRaw) {
          days = (JSON.parse(daysRaw) as Days) ?? {};
        } else if (legacyRaw) {
          // Migrate the old one-key-per-day format (only today's key is reachable).
          const d = JSON.parse(legacyRaw) as { elapsed?: Record<string, number> };
          if (d.elapsed) days[today] = d.elapsed;
          storage.setItem(daysKey, JSON.stringify(days));
        }
        daysRef.current = days;
        setElapsed(days[today] ?? {});
      } catch {}
      setNow(Date.now());
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  // Tick once a second while a timer is running, to advance the live display.
  useEffect(() => {
    if (activeId == null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeId, since]);

  function persistConfig(nextItems: Item[], nextActive: string | null, nextSince: number | null) {
    storage.setItem(configKey, JSON.stringify({ items: nextItems, activeId: nextActive, since: nextSince }));
  }
  // Write today's elapsed into the multi-day store (preserving every other day).
  function persistDays(todayElapsed: Record<string, number>) {
    const next: Days = { ...daysRef.current, [today]: todayElapsed };
    daysRef.current = next;
    storage.setItem(daysKey, JSON.stringify(next));
  }

  // Seconds run by the active item since its segment started (clamped to today's
  // start so a timer left running overnight only counts toward today).
  function runningSecs(): number {
    if (activeId == null || since == null) return 0;
    return Math.max(0, (now - Math.max(since, todayStartMs)) / 1000);
  }

  // Fold the live running segment into the committed totals.
  function commit(): Record<string, number> {
    if (activeId == null || since == null) return elapsed;
    const add = Math.max(0, (Date.now() - Math.max(since, todayStartMs)) / 1000);
    return { ...elapsed, [activeId]: (elapsed[activeId] ?? 0) + add };
  }

  // Click an item: pause it if it's already running, otherwise switch to it
  // (committing whatever was running first).
  function select(id: string) {
    const committed = commit();
    setElapsed(committed);
    persistDays(committed);
    if (activeId === id) {
      setActiveId(null);
      setSince(null);
      persistConfig(items, null, null);
    } else {
      const s = Date.now();
      setActiveId(id);
      setSince(s);
      persistConfig(items, id, s);
    }
  }

  function resetTimes() {
    setElapsed({});
    const s = activeId ? Date.now() : null;
    setSince(s);
    persistDays({});
    persistConfig(items, activeId, s);
  }

  function addItem() {
    const name = nameInput.trim();
    if (!name) return;
    setDraft(d => [...d, { id: newId(), name }]);
    setNameInput("");
  }

  function handleSave() {
    const validIds = new Set(draft.map(i => i.id));
    // Drop removed items from today only; past days keep their data (kept by id
    // so history and future stats survive renames/removals).
    const nextElapsed = Object.fromEntries(Object.entries(elapsed).filter(([k]) => validIds.has(k)));
    let nextActive = activeId;
    let nextSince = since;
    if (activeId && !validIds.has(activeId)) { nextActive = null; nextSince = null; }
    setItems(draft);
    setElapsed(nextElapsed);
    setActiveId(nextActive);
    setSince(nextSince);
    persistConfig(draft, nextActive, nextSince);
    persistDays(nextElapsed);
    setSettingsOpen(false);
  }

  function openHistory() {
    const meta = new Map(items.map((it, i) => [it.id, { name: it.name, color: PALETTE[i % PALETTE.length] }]));
    const entries: HistoryDay[] = Object.entries(daysRef.current)
      .map(([date, map]) => {
        const rows = Object.entries(map)
          .filter(([, s]) => s > 0)
          .map(([id, secs]) => ({
            id,
            secs,
            name: meta.get(id)?.name ?? "(removed)",
            color: meta.get(id)?.color ?? "#9ca3af",
          }))
          .sort((a, b) => b.secs - a.secs);
        return { date, total: rows.reduce((a, b) => a + b.secs, 0), rows };
      })
      .filter(e => e.total > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
    setHistory(entries);
    setHistoryOpen(true);
  }

  function deleteDay(date: string) {
    const next = { ...daysRef.current };
    delete next[date];
    daysRef.current = next;
    storage.setItem(daysKey, JSON.stringify(next));
    if (date === today) {
      setElapsed({});
      const s = activeId ? Date.now() : null;
      setSince(s);
      persistConfig(items, activeId, s);
    }
    setHistory(h => h.filter(e => e.date !== date));
  }

  // Live per-item seconds (committed + current running segment)
  const rows = items.map((it, i) => ({
    ...it,
    color: PALETTE[i % PALETTE.length],
    secs: (elapsed[it.id] ?? 0) + (it.id === activeId ? runningSecs() : 0),
  }));
  const total = rows.reduce((a, b) => a + b.secs, 0);

  const hoveredRow = hovered != null ? rows.find(r => r.id === hovered) : undefined;
  const hoveredPct = hoveredRow && total > 0 ? Math.round((hoveredRow.secs / total) * 100) : 0;

  // Donut geometry
  const R = 42;
  const STROKE = 14;
  const CIRC = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div
      className={`rounded-2xl border h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}
      style={{ perspective: "1200px" }}
    >
      <div
        className="relative w-full h-full transition-transform duration-300 ease-in-out"
        style={{ transformStyle: "preserve-3d", WebkitTransformStyle: "preserve-3d", transform: settingsOpen ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        {/* Front */}
        <div className={`absolute inset-0 p-5 flex flex-col rounded-2xl overflow-clip ${c.bg}`} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", pointerEvents: settingsOpen ? "none" : "auto" }}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 ${c.label}`}>
              <span className="opacity-50"><Timer size={14} /></span>
              <span className="text-xs font-medium opacity-60">Tracker</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openHistory}
                title="History"
                className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`}
              >
                <History size={14} />
              </button>
              <button
                onClick={() => { setDraft(items); setSettingsOpen(true); }}
                title="Edit"
                className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`}
              >
                <Pencil size={14} />
              </button>
            </div>
          </div>

          {!loaded ? null : items.length === 0 ? (
            <p className={`text-xs opacity-45 ${c.text}`}>
              hover and click the pencil to add activities
            </p>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              {/* Donut */}
              <div className="shrink-0 flex justify-center">
                <div className="relative w-28 h-28">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx={50} cy={50} r={R} fill="none" strokeWidth={STROKE} className="stroke-black/[0.07] dark:stroke-white/10" />
                    {total > 0 && rows.filter(r => r.secs > 0).map(r => {
                      const len = (r.secs / total) * CIRC;
                      const seg = (
                        <circle
                          key={r.id}
                          cx={50} cy={50} r={R}
                          fill="none"
                          stroke={r.color}
                          strokeWidth={STROKE}
                          strokeDasharray={`${len} ${CIRC - len}`}
                          strokeDashoffset={-acc}
                          style={{ cursor: "pointer", opacity: hovered && hovered !== r.id ? 0.4 : 1 }}
                          onMouseEnter={() => setHovered(r.id)}
                          onMouseLeave={() => setHovered(null)}
                        />
                      );
                      acc += len;
                      return seg;
                    })}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-3 text-center">
                    {hoveredRow ? (
                      <>
                        <span className={`text-sm font-semibold tabular-nums ${c.text}`}>{hoveredPct}%</span>
                        <span className={`text-[10px] leading-tight line-clamp-2 ${c.label} opacity-60`}>{hoveredRow.name}</span>
                      </>
                    ) : (
                      <>
                        <span className={`text-sm font-semibold tabular-nums ${c.text}`}>{fmt(total)}</span>
                        <span className={`text-[10px] uppercase tracking-widest opacity-40 ${c.label}`}>total</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Item list */}
              <ul className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-1">
                {rows.map(r => {
                  const isActive = r.id === activeId;
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => select(r.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                          isActive ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                        <span className={`flex-1 truncate text-sm ${c.text}`}>{r.name}</span>
                        <span className={`text-xs tabular-nums ${isActive ? c.label : `opacity-50 ${c.text}`}`}>{fmt(r.secs)}</span>
                        <span className={isActive ? c.label : `opacity-30 ${c.label}`}>
                          {isActive ? <Pause size={14} /> : <Play size={14} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Back (settings) */}
        <div className={`absolute inset-0 p-5 flex flex-col gap-3 rounded-2xl overflow-clip ${c.bg}`} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)", pointerEvents: settingsOpen ? "auto" : "none" }}>
          <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">
            <div className="flex gap-1">
              <input
                type="text"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addItem()}
                placeholder="Activity name"
                className="flex-1 text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
              />
              <button
                onClick={addItem}
                className="px-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <Plus size={14} />
              </button>
            </div>
            {draft.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {draft.map((it, i) => (
                  <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-black/5 dark:bg-white/10">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                    <input
                      value={it.name}
                      onChange={e => setDraft(d => d.map(x => x.id === it.id ? { ...x, name: e.target.value } : x))}
                      className="flex-1 min-w-0 bg-transparent dark:!bg-transparent text-sm text-neutral-700 outline-none"
                    />
                    <button
                      onClick={() => setDraft(d => d.filter(x => x.id !== it.id))}
                      className={`opacity-50 hover:opacity-100 leading-none ${c.label}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between shrink-0">
            <button onClick={resetTimes} className={`${c.label} opacity-40 hover:opacity-70 flex items-center gap-1 text-xs`} title="Reset today's times">
              <RotateCcw size={13} /> times
            </button>
            <div className="flex gap-3">
              <button onClick={() => { setDraft(items); setSettingsOpen(false); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={14} />
              </button>
              <button onClick={handleSave} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <Check size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* History overlay: time per activity, grouped by day (newest first) */}
      {historyOpen && (
        <div className={`absolute inset-0 z-40 p-5 flex flex-col rounded-2xl ${c.bg}`}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 ${c.label}`}>
              <span className="opacity-50"><History size={14} /></span>
              <span className="text-xs font-medium opacity-60">History</span>
            </div>
            <button onClick={() => setHistoryOpen(false)} className={`opacity-50 hover:opacity-90 ${c.label}`} title="Close">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-3">
            {history.length === 0 ? (
              <p className={`text-xs opacity-45 ${c.text}`}>no history yet</p>
            ) : history.map(day => (
              <div key={day.date} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${c.label}`}>{fmtDate(day.date)}{day.date === today && " · today"}</span>
                  <span className={`text-xs tabular-nums opacity-50 ${c.text}`}>{fmt(day.total)}</span>
                  <button
                    onClick={() => deleteDay(day.date)}
                    title="Delete day"
                    className={`ml-auto shrink-0 opacity-40 hover:opacity-100 hover:text-red-500 ${c.label}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {day.rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2 pl-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                    <span className={`flex-1 truncate text-xs opacity-80 ${c.text}`}>{r.name}</span>
                    <span className={`text-xs tabular-nums opacity-50 ${c.text}`}>{fmt(r.secs)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
