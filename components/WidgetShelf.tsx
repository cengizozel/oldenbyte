"use client";

import { useMemo, useRef, useState } from "react";
import { GripVertical, Download, Upload, Search, Undo2, Redo2, Trash2, ChevronDown, ChevronUp, Eraser, X } from "lucide-react";
import type { Widget } from "@/lib/widgets";
import { colorMap, WIDGET_CATEGORIES } from "@/lib/widgets";
import { FOCUS_RING } from "@/components/ui/Field";

// Edit-mode widget picker. A draggable floating panel with search and
// category groups, so the catalog stays usable as widget count grows.
// Templates can be dragged into the grid or clicked to add.
export default function WidgetShelf({
  templates,
  bankTemplates = [],
  onAdd,
  onTemplateDragStart,
  onTemplateDragEnd,
  onExport,
  onImportFile,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onWipe,
  backupDisabled = false,
}: {
  templates: Widget[];
  bankTemplates?: Widget[];
  onAdd: (template: Widget) => void;
  onTemplateDragStart: (template: Widget) => void;
  onTemplateDragEnd: () => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onWipe?: () => void;
  backupDisabled?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // Leftover data of widgets removed from every dashboard (lib/gc.ts): listed
  // on demand, removed one widget at a time, never automatically.
  type Leftover = { id: string; keys: number; bytes: number; lastWrite: string };
  const [leftovers, setLeftovers] = useState<Leftover[] | null>(null);
  const [leftoversOpen, setLeftoversOpen] = useState(false);
  async function loadLeftovers() {
    setLeftoversOpen(true);
    setLeftovers(null);
    try {
      const res = await fetch("/api/settings/orphans");
      const data = res.ok ? await res.json() : { orphans: [] };
      setLeftovers(Array.isArray(data.orphans) ? data.orphans : []);
    } catch {
      setLeftovers([]);
    }
  }
  async function removeLeftover(id: string) {
    try {
      const res = await fetch(`/api/settings/orphans?instance=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) setLeftovers(l => (l ?? []).filter(o => o.id !== id));
    } catch {}
  }
  // Remove every listed widget's data, after a confirming second press.
  const [confirmAll, setConfirmAll] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);
  async function removeAllLeftovers() {
    setConfirmAll(false);
    setRemovingAll(true);
    for (const o of leftovers ?? []) await removeLeftover(o.id);
    setRemovingAll(false);
  }
  const fmtBytes = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  // Collapsed = a small draggable pill, so the panel stops covering the grid
  // while arranging widgets. Remembered per device.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("shelf-collapsed") === "1"; } catch { return false; }
  });
  function toggleCollapsed(next: boolean) {
    setCollapsed(next);
    try { localStorage.setItem("shelf-collapsed", next ? "1" : "0"); } catch {}
  }

  function startDrag(clientX: number, clientY: number) {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { x: clientX - rect.left, y: clientY - rect.top };
    if (pos === null) setPos({ x: rect.left, y: rect.top });
    dragging.current = true;

    function onMove(e: MouseEvent | TouchEvent) {
      if (!dragging.current || !panelRef.current) return;
      const p = "touches" in e ? e.touches[0] : e;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - panelRef.current.offsetWidth, p.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - panelRef.current.offsetHeight, p.clientY - dragOffset.current.y)),
      });
      if ("touches" in e) e.preventDefault();
    }
    function onUp() {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (t: Widget) =>
      !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    const byTitle = (a: Widget, b: Widget) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    const matches = templates.filter(match);
    const built = WIDGET_CATEGORIES
      .map(cat => ({ id: cat.id as string, label: cat.label, items: matches.filter(t => (t.category ?? "tools") === cat.id).sort(byTitle) }));
    // Community widgets come from the widget bank (JSON defs, not code).
    built.push({ id: "community", label: "Community", items: bankTemplates.filter(match).sort(byTitle) });
    return built.filter(g => g.items.length > 0);
  }, [templates, bankTemplates, query]);

  return (
    <div
      ref={panelRef}
      className={`fixed z-50 ${collapsed ? "" : "w-72"} flex flex-col bg-[var(--shelf-bg)] backdrop-blur-sm border border-[var(--surface-border)] rounded-2xl shadow-lg select-none ${pos === null ? "bottom-6 left-1/2 -translate-x-1/2" : ""}`}
      style={pos !== null ? { left: pos.x, top: pos.y } : undefined}
    >
      {/* Drag handle + search (or the collapsed pill) */}
      <div
        className={`flex items-center gap-2 px-3 cursor-grab active:cursor-grabbing ${collapsed ? "py-2" : "pt-2.5 pb-2"}`}
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest("input,button")) return;
          e.preventDefault();
          startDrag(e.clientX, e.clientY);
        }}
        onTouchStart={e => {
          if ((e.target as HTMLElement).closest("input,button")) return;
          startDrag(e.touches[0].clientX, e.touches[0].clientY);
        }}
      >
        <GripVertical size={14} className="text-[var(--text-muted)] shrink-0" />
        {collapsed ? (
          <button
            onClick={() => toggleCollapsed(false)}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors pr-0.5"
            title="Expand the widget picker"
          >
            Widgets <ChevronUp size={14} />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-[var(--surface)] border border-[var(--surface-border)] rounded-lg px-2 py-1">
              <Search size={12} className="text-[var(--text-muted)] shrink-0" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search widgets"
                aria-label="Search widgets"
                className="w-full bg-transparent text-xs outline-none text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)]"
              />
            </div>
            <button
              onClick={() => toggleCollapsed(true)}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
              title="Collapse to a pill"
              aria-label="Collapse the widget picker"
            >
              <ChevronDown size={14} />
            </button>
          </>
        )}
      </div>

      {collapsed ? null : (
      <>
      {/* Catalog */}
      <div className="flex-1 max-h-[50vh] overflow-y-auto px-3 pb-2 flex flex-col gap-2.5">
        {groups.map(group => (
          <div key={group.id}>
            <div className="text-sm text-[var(--text-muted)] mb-1.5">
              {group.label}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {group.items.map(template => {
                const c = colorMap[template.color];
                return (
                  <div
                    key={template.id}
                    draggable
                    title={template.description}
                    onDragStart={() => onTemplateDragStart(template)}
                    onDragEnd={onTemplateDragEnd}
                    onClick={() => onAdd(template)}
                    // Keyboard users add with Enter or Space (dragging is mouse only).
                    role="button"
                    tabIndex={0}
                    aria-label={`Add ${template.title}`}
                    onKeyDown={e => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onAdd(template);
                    }}
                    className={`px-2.5 py-2 rounded-xl border cursor-grab select-none min-w-0 ${FOCUS_RING} !rounded-xl ${c.bg} ${c.border}`}
                  >
                    <span className={`block truncate text-xs font-semibold ${c.label}`}>{template.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] py-2">No widgets match.</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 px-3 py-1.5 border-t border-[var(--surface-border)]">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-25"
          title="Undo layout change"
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-25"
          title="Redo layout change"
        >
          <Redo2 size={14} />
        </button>
        <div className="w-px h-4 bg-[var(--surface-border)] mx-0.5" />
        <button
          onClick={onExport}
          disabled={backupDisabled}
          className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-25"
          title={backupDisabled ? "Not available in demo mode" : "Export backup"}
        >
          <Download size={14} />
        </button>
        <button
          onClick={() => importRef.current?.click()}
          disabled={backupDisabled}
          className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-25"
          title={backupDisabled ? "Not available in demo mode" : "Import backup"}
        >
          <Upload size={14} />
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => (leftoversOpen ? setLeftoversOpen(false) : loadLeftovers())}
          disabled={backupDisabled}
          aria-expanded={leftoversOpen}
          className={`p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-25 ${leftoversOpen ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
          title={backupDisabled ? "Not available in demo mode" : "Leftover data from removed widgets"}
        >
          <Eraser size={14} />
        </button>
        <button
          onClick={onWipe}
          className="p-2 rounded-xl text-[var(--text-muted)] hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title="Clear the dashboard (undoable)"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {leftoversOpen && (
        <div className="px-3 pb-3">
          <div className="rounded-xl border border-[var(--surface-border)] p-2 text-sm text-[var(--text-secondary)]">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-medium">Leftover data</span>
              <button onClick={() => setLeftoversOpen(false)} aria-label="Close" className={`text-[var(--text-muted)] hover:text-[var(--text-secondary)] ${FOCUS_RING}`}>
                <X size={12} />
              </button>
            </div>
            <p className="text-[var(--text-muted)] leading-relaxed mb-1.5">
              Data of widgets that are on no dashboard any more. Nothing is removed on its own; a widget added back later starts empty either way.
            </p>
            {leftovers === null ? (
              <div className="text-[var(--text-muted)]">Looking...</div>
            ) : leftovers.length === 0 ? (
              <div className="text-[var(--text-muted)]">Nothing left over.</div>
            ) : (
              <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
                {leftovers.map(o => (
                  <li key={o.id} className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate" title={o.id}>{o.id}</span>
                    <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{o.keys} {o.keys === 1 ? "key" : "keys"}, {fmtBytes(o.bytes)}</span>
                    <button
                      onClick={() => removeLeftover(o.id)}
                      className={`shrink-0 px-1.5 py-0.5 rounded-md text-[var(--text-muted)] hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 ${FOCUS_RING}`}
                      title={`Remove the leftover data of ${o.id}`}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!!leftovers?.length && (
              <div className="flex items-center justify-end gap-1.5 mt-2">
                {confirmAll ? (
                  <>
                    <span className="mr-auto text-[var(--text-primary)]">Remove all {leftovers.length}?</span>
                    <button onClick={removeAllLeftovers} className={`h-7 px-2.5 rounded-lg font-medium bg-black/10 dark:bg-white/15 text-red-600 dark:text-red-400 hover:bg-black/15 dark:hover:bg-white/20 ${FOCUS_RING}`}>Remove</button>
                    <button onClick={() => setConfirmAll(false)} className={`h-7 px-2.5 rounded-lg bg-black/5 dark:bg-white/10 text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/15 ${FOCUS_RING}`}>Keep</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmAll(true)} disabled={removingAll} className={`h-7 px-2.5 rounded-lg bg-black/5 dark:bg-white/10 text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-50 ${FOCUS_RING}`}>
                    {removingAll ? "Removing..." : "Remove all"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
