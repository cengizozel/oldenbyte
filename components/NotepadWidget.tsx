"use client";

import { useState, useEffect, useRef } from "react";
import { NotebookPen, Pencil, Check, X, Bold, Italic, Underline, List, History, Trash2 } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { formatDate, localDateStr } from "@/lib/format";
import { decodeEntities, parseJson } from "@/lib/text";

const REGISTRY_KEY = "notepad-registry";

// Rich text helpers: notes are stored as HTML. Older notes were saved as plain
// text; those are detected and converted on display, then re-saved as HTML on edit.
// A one-line note the editor saved has no tags but can still contain entities
// ("&nbsp;" for a leading space), so entities count as HTML too; otherwise
// the note is escaped on display and shows the raw "&nbsp;".
function isHtml(s: string) {
  return /<\/?[a-z][\s\S]*>|&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s);
}

function plainToHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

// Treat content with no visible text (only formatting tags / breaks) as empty,
// so the calendar dot and placeholder behave like the old plain-text version.
function normalizeHtml(html: string) {
  const text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
  return text === "" ? "" : html;
}

// Plain-text preview of a note's HTML, for the history list.
function stripHtml(html: string) {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// Noon time avoids timezone day-shift for bare YYYY-MM-DD strings.
function fmtDate(date: string) {
  return formatDate(`${date}T12:00:00`);
}

const FORMATS = [
  { cmd: "bold", Icon: Bold, label: "Bold" },
  { cmd: "italic", Icon: Italic, label: "Italic" },
  { cmd: "underline", Icon: Underline, label: "Underline" },
  { cmd: "insertUnorderedList", Icon: List, label: "Bullet list" },
];

function RichTextEditor({
  docKey,
  html,
  editable,
  placeholder,
  onChange,
  textClass,
  labelClass,
}: {
  docKey: string;
  html: string;
  editable: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  textClass: string;
  labelClass: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Sync DOM from props when the document identity or stored value changes, but
  // never while the user is actively typing (that would reset the caret).
  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    const next = isHtml(html) ? html : plainToHtml(html);
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [html, docKey]);

  function emit() {
    if (ref.current) onChange(normalizeHtml(ref.current.innerHTML));
  }

  function applyFormat(cmd: string) {
    document.execCommand(cmd, false);
    ref.current?.focus();
    emit();
  }

  function closestLi(node: Node | null): HTMLLIElement | null {
    let n: Node | null = node;
    while (n && n !== ref.current) {
      if (n.nodeName === "LI") return n as HTMLLIElement;
      n = n.parentNode;
    }
    return null;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // ⌘/Ctrl + B / I / U
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === "b" || k === "i" || k === "u") {
        e.preventDefault();
        applyFormat(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
        return;
      }
    }

    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    // Enter on an empty list item exits the list
    if (e.key === "Enter") {
      const li = closestLi(range.startContainer);
      if (li && (li.textContent ?? "").trim() === "") {
        e.preventDefault();
        const ordered = li.parentElement?.nodeName === "OL";
        document.execCommand(ordered ? "insertOrderedList" : "insertUnorderedList", false);
        emit();
      }
      return;
    }

    // Typing "- ", "* " or "1. " at the start of a line starts a list
    if (e.key === " ") {
      const node = range.startContainer;
      const before = node.nodeType === Node.TEXT_NODE
        ? (node.textContent ?? "").slice(0, range.startOffset)
        : "";
      const ordered = before === "1.";
      if (before === "-" || before === "*" || ordered) {
        e.preventDefault();
        const del = document.createRange();
        del.setStart(node, 0);
        del.setEnd(node, range.startOffset);
        del.deleteContents();
        document.execCommand(ordered ? "insertOrderedList" : "insertUnorderedList", false);
        emit();
      }
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {editable && (
        <div className="flex items-center gap-0.5 mb-1.5 shrink-0">
          {FORMATS.map(({ cmd, Icon, label }) => (
            <button
              key={cmd}
              title={label}
              onMouseDown={e => e.preventDefault()}
              onClick={() => applyFormat(cmd)}
              className={`p-1 rounded opacity-40 hover:opacity-90 hover:bg-white/40 transition-opacity ${labelClass}`}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      )}
      <div
        ref={ref}
        contentEditable={editable}
        suppressContentEditableWarning
        data-ph={placeholder}
        onInput={emit}
        onKeyDown={handleKeyDown}
        onPaste={e => {
          if (!editable) return;
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        className={`flex-1 min-h-0 overflow-y-auto outline-none text-sm leading-relaxed break-words ${textClass} ${editable ? "" : "opacity-60"} empty:before:content-[attr(data-ph)] empty:before:opacity-50 empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4`}
      />
    </div>
  );
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

// Storage layout, per notepad id:
//   notebook-${id}-days          JSON array of the dates that have a note
//   notebook-${id}-day-${date}   that day's note (HTML, or plain text from older versions)
//   notebook-${id}-name          custom name
// Older versions kept every day in one `notebook-${id}-dates` object that was
// rewritten on each edit; loadIndex migrates it the first time it is seen.
const indexKey = (id: string) => `notebook-${id}-days`;
const dayKey = (id: string, date: string) => `notebook-${id}-day-${date}`;
const legacyKey = (id: string) => `notebook-${id}-dates`;

// Copy a legacy blob into per-day keys plus the index, and only remove the
// blob once every write is confirmed. Returns the index, or null when the blob
// is unreadable (left untouched) or a write failed (retried on the next load).
async function migrateLegacy(id: string, raw: string): Promise<string[] | null> {
  const parsed = parseJson<unknown>(raw, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, html]) => typeof html !== "string")) return null;
  const withContent = entries.filter(([, html]) => html !== "") as [string, string][];
  const written = await Promise.all(withContent.map(([date, html]) => storage.setItem(dayKey(id, date), html)));
  if (written.includes(false)) return null;
  const dates = withContent.map(([date]) => date).sort();
  if (!(await storage.setItem(indexKey(id), JSON.stringify(dates)))) return null;
  await storage.removeItem(legacyKey(id));
  return dates;
}

// The dates a notepad has notes for, or null when that could not be read
// reliably (a failed read must never look like an empty notepad). Concurrent
// calls for one id share a single load, so a migration never runs twice.
const indexLoads = new Map<string, Promise<string[] | null>>();
function loadIndex(id: string): Promise<string[] | null> {
  let p = indexLoads.get(id);
  if (!p) {
    p = (async () => {
      const idx = await storage.getItemResult(indexKey(id));
      if (!idx.ok) return null;
      if (idx.value !== null) {
        const dates = parseJson<unknown>(idx.value, null);
        return Array.isArray(dates) && dates.every(d => typeof d === "string") ? dates : null;
      }
      const legacy = await storage.getItemResult(legacyKey(id));
      if (!legacy.ok) return null;
      if (legacy.value === null) return [];
      return migrateLegacy(id, legacy.value);
    })().finally(() => indexLoads.delete(id));
    indexLoads.set(id, p);
  }
  return p.then(d => (d ? [...d] : null));
}

// One day's note; "" when missing.
async function loadDay(id: string, date: string): Promise<string> {
  return (await storage.getItem(dayKey(id, date))) ?? "";
}

export default function NotebookWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color];
  const today = localDateStr();

  // This notepad's notes loaded so far (today's, plus any edited this session),
  // and the set of dates that have a note (calendar dots).
  const [ownNotes, setOwnNotes] = useState<Record<string, string>>({});
  const [ownDates, setOwnDates] = useState<string[]>([]);
  // Nothing is written until the initial load succeeded; after a failed load
  // the editor stays read-only so a blank editor can never overwrite notes.
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [saveError, setSaveError] = useState("");
  // The index as last stored, and a queue so saves land in order.
  const indexRef = useRef<string[]>([]);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
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
    let cancelled = false;
    setLoadState("loading");
    (async () => {
      const dates = await loadIndex(widget.id);
      if (cancelled) return;
      if (!dates) { setLoadState("error"); return; }
      const day = localDateStr();
      let todayHtml = "";
      if (dates.includes(day)) {
        const res = await storage.getItemResult(dayKey(widget.id, day));
        if (cancelled) return;
        if (!res.ok) { setLoadState("error"); return; }
        todayHtml = res.value ?? "";
      }
      indexRef.current = dates;
      setOwnDates(dates);
      setOwnNotes({ [day]: todayHtml });
      setLoadState("ready");
    })();
    storage.getItem(`notebook-${widget.id}-name`).then(saved => {
      if (saved) setCustomName(saved);
    });

    // Only register after a successful read, so a failed read never rewrites
    // the registry with just this widget.
    storage.getItemResult(REGISTRY_KEY).then(res => {
      if (!res.ok) return;
      const ids = parseJson<string[]>(res.value, []);
      if (!ids.includes(widget.id)) {
        storage.setItem(REGISTRY_KEY, JSON.stringify([...ids, widget.id]));
      }
    });
    return () => { cancelled = true; };
  }, [widget.id]);

  // When viewing a past date, load all registered notepads' content for that date
  useEffect(() => {
    if (viewDate === today) {
      setTabs([]);
      setActiveTabId(widget.id);
      return;
    }

    storage.getItem(REGISTRY_KEY).then(async saved => {
      const ids = parseJson<string[]>(saved, [widget.id]);
      const entries = await Promise.all(
        ids.map(async (id, i) => {
          const dates = await loadIndex(id);
          const content = dates?.includes(viewDate) ? await loadDay(id, viewDate) : "";
          return { id, num: i + 1, content };
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

  // Queue a storage job behind earlier ones so writes never land out of order.
  function enqueue(job: () => Promise<void>) {
    saveChain.current = saveChain.current.then(job, job);
    return saveChain.current;
  }

  // Store a new index; false when the write failed.
  async function writeIndex(next: string[]): Promise<boolean> {
    if (!(await storage.setItem(indexKey(widget.id), JSON.stringify(next)))) return false;
    indexRef.current = next;
    return true;
  }

  // Write one day: only that day's key, plus the index when the day gains or
  // loses its note. The day key is written before it is indexed and unindexed
  // before it is removed, so the index never points at a missing note.
  async function persistDay(date: string, html: string) {
    const listed = indexRef.current.includes(date);
    let ok = true;
    if (html) {
      ok = await storage.setItem(dayKey(widget.id, date), html);
      if (ok && !listed) ok = await writeIndex([...indexRef.current, date].sort());
    } else if (listed) {
      ok = await writeIndex(indexRef.current.filter(d => d !== date));
      if (ok) await storage.removeItem(dayKey(widget.id, date));
    }
    setSaveError(ok ? "" : "Could not save. Your last edit is not stored yet.");
  }

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function handleChange(value: string) {
    if (loadState !== "ready") return;
    const date = today;
    setOwnNotes(prev => ({ ...prev, [date]: value }));
    setOwnDates(prev => {
      const has = prev.includes(date);
      if (value && !has) return [...prev, date];
      if (!value && has) return prev.filter(d => d !== date);
      return prev;
    });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { enqueue(() => persistDay(date, value)); }, 600);
  }

  const isToday = viewDate === today;
  const currentNote = isToday
    ? (ownNotes[viewDate] ?? "")
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

  // History: every dated note across all registered notepads (a date can hold
  // several, one per notepad instance), newest first.
  type HistoryEntry = { id: string; name: string; date: string; snippet: string };
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  async function openHistory() {
    setHistoryOpen(true);
    const reg = await storage.getItem(REGISTRY_KEY);
    const ids = parseJson<string[]>(reg, [widget.id]);
    const perId = await Promise.all(
      ids.map(async (id, i) => {
        const [dates, nameRaw] = await Promise.all([
          loadIndex(id),
          storage.getItem(`notebook-${id}-name`),
        ]);
        const notes = await Promise.all((dates ?? []).map(async date => [date, await loadDay(id, date)] as const));
        const name = nameRaw && nameRaw.trim() ? nameRaw.trim() : `Notepad ${i + 1}`;
        return { id, name, notes };
      })
    );
    const entries: HistoryEntry[] = [];
    for (const { id, name, notes } of perId) {
      for (const [date, html] of notes) {
        const text = stripHtml(html);
        if (!text) continue;
        entries.push({ id, name, date, snippet: text.slice(0, 80) });
      }
    }
    entries.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    setHistory(entries);
  }

  // Unindex the day first, then drop its key; on a failed index write nothing
  // is removed.
  async function deleteEntry(id: string, date: string) {
    if (id === widget.id && loadState === "ready") {
      if (date === today) clearTimeout(saveTimer.current);
      let ok = false;
      await enqueue(async () => {
        ok = await writeIndex(indexRef.current.filter(d => d !== date));
        if (ok) await storage.removeItem(dayKey(id, date));
      });
      if (!ok) { setSaveError("Could not delete the note."); return; }
      setOwnDates(prev => prev.filter(d => d !== date));
      setOwnNotes(prev => { const n = { ...prev }; delete n[date]; return n; });
    } else {
      const dates = await loadIndex(id);
      if (!dates) return;
      if (!(await storage.setItem(indexKey(id), JSON.stringify(dates.filter(d => d !== date))))) return;
      await storage.removeItem(dayKey(id, date));
    }
    setHistory(prev => prev.filter(e => !(e.id === id && e.date === date)));
  }

  function openDate(date: string) {
    setViewDate(date);
    setCalMonth(new Date(`${date}T12:00:00`));
    setHistoryOpen(false);
  }

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}>

      <div className="flex gap-3 flex-1 min-h-0">

        {/* Left: icon + note */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          {renaming ? (
            <div className="flex items-center gap-1.5 mb-3 shrink-0">
              <span className={`opacity-50 shrink-0 ${c.label}`}><NotebookPen size={14} /></span>
              <input
                autoFocus
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setRenaming(false); }}
                placeholder="Name this notepad…"
                className="flex-1 min-w-0 text-xs border border-[var(--surface-border)] rounded-lg px-2 py-1 outline-none focus:border-[var(--surface-border-focus)] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] bg-[var(--surface)]"
              />
              <button onClick={() => setRenaming(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"><X size={13} /></button>
              <button onClick={saveName} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"><Check size={13} /></button>
            </div>
          ) : (
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
                <span className="opacity-50 shrink-0"><NotebookPen size={14} /></span>
                {customName && <span className="text-xs font-medium opacity-60 truncate">{customName}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={openHistory}
                  title="All notes"
                  className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`}
                >
                  <History size={14} />
                </button>
                <button
                  onClick={() => { setDraftName(customName); setRenaming(true); }}
                  title="Rename"
                  className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`}
                >
                  <Pencil size={14} />
                </button>
              </div>
            </div>
          )}

          {!isToday && (
            <div className="mb-1.5 shrink-0">
              <p className={`text-xs opacity-50 ${c.label}`}>
                {fmtDate(viewDate)}
                {" · "}
                <button onClick={() => setViewDate(today)} className="underline underline-offset-2">back to today</button>
              </p>
              {showTabs && (
                <div className="flex flex-wrap gap-1 mt-1.5">
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

          {isToday && (loadState === "error" || saveError) && (
            <p className="mb-1.5 shrink-0 text-red-400 text-xs">
              {loadState === "error" ? "Could not load notes. Editing is off until a reload." : saveError}
            </p>
          )}

          <RichTextEditor
            docKey={isToday ? "today" : `${activeTabId}-${viewDate}`}
            html={currentNote}
            editable={isToday && loadState === "ready"}
            placeholder={isToday ? (loadState === "loading" ? "loading..." : "write anything...") : "nothing written."}
            onChange={handleChange}
            textClass={c.text}
            labelClass={c.label}
          />
        </div>

        {/* Calendar */}
        <div className="w-28 min-w-0 flex flex-col gap-1.5">

          <div className="flex items-center justify-between">
            <button onClick={prevMonth} className={`text-xs opacity-60 hover:opacity-90 ${c.label}`}>‹</button>
            <span className={`text-xs font-medium ${c.label} opacity-80`}>{monthLabel}</span>
            <button onClick={nextMonth} className={`text-xs opacity-60 hover:opacity-90 ${c.label}`}>›</button>
          </div>

          <div className="grid grid-cols-7 gap-px">
            {["S","M","T","W","T","F","S"].map((d, i) => (
              <span key={i} className={`text-center text-[12px] font-medium opacity-60 ${c.label}`}>{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: firstDay }).map((_, i) => (
              <span key={`e-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const hasNote = ownDates.includes(dateStr);
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

      {/* History overlay: all dated notes across every notepad */}
      {historyOpen && (
        <div className={`absolute inset-0 z-30 rounded-2xl p-5 flex flex-col ${c.bg}`}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 ${c.label}`}>
              <span className="opacity-50"><History size={14} /></span>
              <span className="text-xs font-medium opacity-60">All notes</span>
            </div>
            <button onClick={() => setHistoryOpen(false)} className={`opacity-50 hover:opacity-90 ${c.label}`} title="Close">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pr-3 flex flex-col gap-1">
            {history.length === 0 ? (
              <p className={`text-xs opacity-60 ${c.text}`}>no notes yet</p>
            ) : history.map(e => (
              <div key={`${e.id}-${e.date}`} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-white/40 transition-colors">
                <button onClick={() => openDate(e.date)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium shrink-0 ${c.label}`}>{fmtDate(e.date)}</span>
                    <span className={`text-[12px] px-1.5 py-0.5 rounded-full bg-white/50 truncate ${c.label} opacity-70`}>{e.name}</span>
                  </div>
                  <p className={`text-xs opacity-50 truncate mt-0.5 ${c.text}`}>{e.snippet}</p>
                </button>
                <button
                  onClick={() => deleteEntry(e.id, e.date)}
                  title="Delete note"
                  className={`shrink-0 mt-0.5 opacity-40 hover:opacity-100 hover:text-red-500 ${c.label}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
