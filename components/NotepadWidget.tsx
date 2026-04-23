"use client";

import { useState, useEffect, useRef } from "react";
import { NotebookPen, Pencil, Check, X } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

const REGISTRY_KEY = "notepad-registry";

function toDateStr(date: Date) {
  return date.toISOString().split("T")[0];
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function NotebookWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color];
  const storageKey = `notebook-${widget.id}-dates`;
  const today = toDateStr(new Date());

  const [notesByDate, setNotesByDate] = useState<Record<string, string>>({});
  const [viewDate, setViewDate] = useState(today);
  const [calMonth, setCalMonth] = useState(new Date());
  const [customName, setCustomName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");

  // Past-date tabs: one entry per registered notepad that has data (or is this widget)
  const [tabs, setTabs] = useState<{ id: string; num: number; content: string }[]>([]);
  const [activeTabId, setActiveTabId] = useState(widget.id);

  // Load own notes and register in global registry
  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (saved) setNotesByDate(JSON.parse(saved));
    });
    storage.getItem(`notebook-${widget.id}-name`).then(saved => {
      if (saved) setCustomName(saved);
    });

    storage.getItem(REGISTRY_KEY).then(saved => {
      const ids: string[] = saved ? JSON.parse(saved) : [];
      if (!ids.includes(widget.id)) {
        storage.setItem(REGISTRY_KEY, JSON.stringify([...ids, widget.id]));
      }
    });
  }, [storageKey, widget.id]);

  // When viewing a past date, load all registered notepads' content for that date
  useEffect(() => {
    if (viewDate === today) {
      setTabs([]);
      setActiveTabId(widget.id);
      return;
    }

    storage.getItem(REGISTRY_KEY).then(async saved => {
      const ids: string[] = saved ? JSON.parse(saved) : [widget.id];
      const entries = await Promise.all(
        ids.map(async (id, i) => {
          const data = await storage.getItem(`notebook-${id}-dates`);
          const notes: Record<string, string> = data ? JSON.parse(data) : {};
          return { id, num: i + 1, content: notes[viewDate] ?? "" };
        })
      );
      // Only show tabs that have content, but always include this widget's tab
      const filtered = entries.filter(t => t.content || t.id === widget.id);
      setTabs(filtered);
      // Default to this widget's tab if it has content, otherwise first with content
      const ownTab = filtered.find(t => t.id === widget.id);
      const firstWithContent = filtered.find(t => t.content);
      setActiveTabId((firstWithContent ?? ownTab ?? filtered[0])?.id ?? widget.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const updated = { ...notesByDate, [today]: e.target.value };
    setNotesByDate(updated);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      storage.setItem(storageKey, JSON.stringify(updated));
    }, 600);
  }

  const isToday = viewDate === today;
  const currentNote = isToday
    ? (notesByDate[viewDate] ?? "")
    : (tabs.find(t => t.id === activeTabId)?.content ?? "");

  const showTabs = !isToday && tabs.length > 1;

  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const monthLabel = calMonth.toLocaleDateString("en-US", { month: "short", year: "numeric" });

  function saveName() {
    const name = draftName.trim();
    setCustomName(name);
    storage.setItem(`notebook-${widget.id}-name`, name);
    setRenaming(false);
  }

  function prevMonth() {
    setCalMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCalMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}>

      <div className="flex gap-3 flex-1 min-h-0">

        {/* Left: icon + note */}
        <div className="flex flex-col flex-1 min-h-0">
          {renaming ? (
            <div className="flex items-center gap-1.5 mb-3 shrink-0">
              <span className={`opacity-50 shrink-0 ${c.label}`}><NotebookPen size={14} /></span>
              <input
                autoFocus
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setRenaming(false); }}
                placeholder="Name this notepad…"
                className="flex-1 text-xs border border-neutral-200 rounded-lg px-2 py-1 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white min-w-0"
              />
              <button onClick={() => setRenaming(false)} className="text-neutral-400 hover:text-neutral-600 shrink-0"><X size={13} /></button>
              <button onClick={saveName} className="text-neutral-600 hover:text-neutral-900 shrink-0"><Check size={13} /></button>
            </div>
          ) : (
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className={`flex items-center gap-1.5 ${c.label}`}>
                <span className="opacity-50"><NotebookPen size={14} /></span>
                {customName && <span className="text-xs font-medium opacity-60">{customName}</span>}
              </div>
              <button
                onClick={() => { setDraftName(customName); setRenaming(true); }}
                className={`opacity-0 group-hover:opacity-40 [@media(hover:none)]:!opacity-40 hover:!opacity-80 ${c.label}`}
              >
                <Pencil size={12} />
              </button>
            </div>
          )}

          {!isToday && (
            <div className="mb-1.5 shrink-0">
              <p className={`text-xs opacity-50 ${c.label}`}>
                {new Date(viewDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {" · "}
                <button onClick={() => setViewDate(today)} className="underline underline-offset-2">back to today</button>
              </p>
              {showTabs && (
                <div className="flex gap-1 mt-1.5">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTabId(tab.id)}
                      className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${
                        tab.id === activeTabId
                          ? `bg-white/70 ${c.label} opacity-100`
                          : `${c.label} opacity-40 hover:opacity-70`
                      }`}
                    >
                      {tab.num}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <textarea
            value={currentNote}
            onChange={handleChange}
            disabled={!isToday}
            placeholder={isToday ? "write anything..." : "nothing written."}
            className={`flex-1 resize-none outline-none text-sm !bg-transparent leading-relaxed ${c.text} placeholder:opacity-50 disabled:opacity-60 disabled:cursor-default`}
          />
        </div>

        {/* Calendar */}
        <div className="w-28 shrink-0 flex flex-col gap-1.5">

          <div className="flex items-center justify-between">
            <button onClick={prevMonth} className={`text-xs opacity-60 hover:opacity-90 ${c.label}`}>‹</button>
            <span className={`text-xs font-medium ${c.label} opacity-80`}>{monthLabel}</span>
            <button onClick={nextMonth} className={`text-xs opacity-60 hover:opacity-90 ${c.label}`}>›</button>
          </div>

          <div className="grid grid-cols-7 gap-px">
            {["S","M","T","W","T","F","S"].map((d, i) => (
              <span key={i} className={`text-center text-[11px] font-medium opacity-60 ${c.label}`}>{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: firstDay }).map((_, i) => (
              <span key={`e-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const hasNote = !!notesByDate[dateStr];
              const isSelected = dateStr === viewDate;
              const isTodayCell = dateStr === today;

              return (
                <button
                  key={day}
                  onClick={() => setViewDate(dateStr)}
                  className={`
                    relative flex items-center justify-center rounded text-xs aspect-square
                    ${isSelected ? `${c.label} font-semibold opacity-100` : `${c.text} opacity-70 hover:opacity-100`}
                    ${isTodayCell ? "underline underline-offset-2" : ""}
                  `}
                >
                  {day}
                  {hasNote && !isSelected && (
                    <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-0.5 h-0.5 rounded-full ${c.label} opacity-60`} />
                  )}
                </button>
              );
            })}
          </div>

        </div>
      </div>
    </div>
  );
}
