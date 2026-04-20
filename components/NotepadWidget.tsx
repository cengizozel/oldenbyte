"use client";

import { useState, useEffect, useRef } from "react";
import { NotebookPen } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

function toDateStr(date: Date) {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay(); // 0 = Sun
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

  // notesByDate: { "2026-04-14": "content...", ... }
  const [notesByDate, setNotesByDate] = useState<Record<string, string>>({});
  const [viewDate, setViewDate] = useState(today);
  const [calMonth, setCalMonth] = useState(new Date());

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (saved) setNotesByDate(JSON.parse(saved));
    });
  }, [storageKey]);

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
  const currentNote = notesByDate[viewDate] ?? "";

  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const monthLabel = calMonth.toLocaleDateString("en-US", { month: "short", year: "numeric" });

  function prevMonth() {
    setCalMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCalMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full ${c.bg} ${c.border} ${className}`}>

      {/* Body: textarea + calendar side by side, title above textarea */}
      <div className="flex gap-3 flex-1 min-h-0">

        {/* Left: title + textarea */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className={`mb-3 shrink-0 opacity-50 ${c.label}`}>
            <NotebookPen size={14} />
          </div>
          {!isToday && (
            <p className={`text-xs mb-1.5 opacity-50 ${c.label}`}>
              {new Date(viewDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              {" · "}
              <button onClick={() => setViewDate(today)} className="underline underline-offset-2">back to today</button>
            </p>
          )}
          <textarea
            value={currentNote}
            onChange={handleChange}
            disabled={!isToday}
            placeholder={isToday ? "write anything..." : "nothing written."}
            className={`flex-1 resize-none outline-none text-sm bg-transparent leading-relaxed ${c.text} placeholder:opacity-50 disabled:opacity-60 disabled:cursor-default`}
          />
        </div>

        {/* Calendar */}
        <div className="w-28 shrink-0 flex flex-col gap-1.5">

          {/* Month nav */}
          <div className="flex items-center justify-between">
            <button onClick={prevMonth} className={`text-xs opacity-60 hover:opacity-90 ${c.label}`}>‹</button>
            <span className={`text-xs font-medium ${c.label} opacity-80`}>{monthLabel}</span>
            <button onClick={nextMonth} className={`text-xs opacity-60 hover:opacity-90 ${c.label}`}>›</button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-px">
            {["S","M","T","W","T","F","S"].map((d, i) => (
              <span key={i} className={`text-center text-[11px] font-medium opacity-60 ${c.label}`}>{d}</span>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-px">
            {/* Empty leading cells */}
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
