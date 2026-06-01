"use client";

import { useState, useEffect, useRef } from "react";
import { Timer, Pencil, Check, X, Plus, RotateCcw, Play, Pause } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

type Item = { id: string; name: string };

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
  const dayKey = `tracker-day-${widget.id}-${today}`;

  // Item list + the "what's running" pointer persist across days (config key).
  // Accumulated seconds reset daily (day key).
  const [items, setItems]       = useState<Item[]>([]);
  const [elapsed, setElapsed]   = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [since, setSince]       = useState<number | null>(null);
  const [now, setNow]           = useState(todayStartMs);
  const [loaded, setLoaded]     = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft]               = useState<Item[]>([]);
  const [nameInput, setNameInput]       = useState("");

  useEffect(() => {
    Promise.all([storage.getItem(configKey), storage.getItem(dayKey)]).then(([cfgRaw, dayRaw]) => {
      try {
        if (cfgRaw) {
          const cfg = JSON.parse(cfgRaw) as { items?: Item[]; activeId?: string | null; since?: number | null };
          setItems(cfg.items ?? []);
          setDraft(cfg.items ?? []);
          setActiveId(cfg.activeId ?? null);
          setSince(cfg.since ?? null);
        }
        if (dayRaw) {
          const d = JSON.parse(dayRaw) as { elapsed?: Record<string, number> };
          setElapsed(d.elapsed ?? {});
        }
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
  function persistDay(nextElapsed: Record<string, number>) {
    storage.setItem(dayKey, JSON.stringify({ elapsed: nextElapsed }));
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
    persistDay(committed);
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
    persistDay({});
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
    const nextElapsed = Object.fromEntries(Object.entries(elapsed).filter(([k]) => validIds.has(k)));
    let nextActive = activeId;
    let nextSince = since;
    if (activeId && !validIds.has(activeId)) { nextActive = null; nextSince = null; }
    setItems(draft);
    setElapsed(nextElapsed);
    setActiveId(nextActive);
    setSince(nextSince);
    persistConfig(draft, nextActive, nextSince);
    persistDay(nextElapsed);
    setSettingsOpen(false);
  }

  // Live per-item seconds (committed + current running segment)
  const rows = items.map((it, i) => ({
    ...it,
    color: PALETTE[i % PALETTE.length],
    secs: (elapsed[it.id] ?? 0) + (it.id === activeId ? runningSecs() : 0),
  }));
  const total = rows.reduce((a, b) => a + b.secs, 0);

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
            <button
              onClick={() => { setDraft(items); setSettingsOpen(true); }}
              className={`opacity-0 group-hover:opacity-40 [@media(hover:none)]:!opacity-40 hover:!opacity-80 ${c.label}`}
            >
              <Pencil size={12} />
            </button>
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
                    <circle cx={50} cy={50} r={R} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={STROKE} />
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
                        />
                      );
                      acc += len;
                      return seg;
                    })}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-sm font-semibold tabular-nums ${c.text}`}>{fmt(total)}</span>
                    <span className={`text-[10px] uppercase tracking-widest opacity-40 ${c.label}`}>total</span>
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
                          isActive ? "bg-white/70" : "hover:bg-white/40"
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                        <span className={`flex-1 truncate text-sm ${c.text}`}>{r.name}</span>
                        <span className={`text-xs tabular-nums ${isActive ? c.label : `opacity-50 ${c.text}`}`}>{fmt(r.secs)}</span>
                        <span className={isActive ? c.label : `opacity-30 ${c.label}`}>
                          {isActive ? <Pause size={12} /> : <Play size={12} />}
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
                className="px-3 rounded-xl border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-800"
              >
                <Plus size={14} />
              </button>
            </div>
            {draft.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {draft.map((it, i) => (
                  <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/60">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                    <input
                      value={it.name}
                      onChange={e => setDraft(d => d.map(x => x.id === it.id ? { ...x, name: e.target.value } : x))}
                      className="flex-1 min-w-0 bg-transparent text-sm text-neutral-700 outline-none"
                    />
                    <button
                      onClick={() => setDraft(d => d.filter(x => x.id !== it.id))}
                      className="opacity-50 hover:opacity-100 leading-none text-neutral-600"
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
              <button onClick={() => { setDraft(items); setSettingsOpen(false); }} className="text-neutral-400 hover:text-neutral-600">
                <X size={14} />
              </button>
              <button onClick={handleSave} className="text-neutral-600 hover:text-neutral-900">
                <Check size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
