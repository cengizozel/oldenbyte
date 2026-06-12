"use client";

import { useMemo, useRef, useState } from "react";
import { GripVertical, Download, Upload, Search, Undo2, Redo2, Trash2 } from "lucide-react";
import type { Widget } from "@/lib/widgets";
import { colorMap, WIDGET_CATEGORIES } from "@/lib/widgets";

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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [query, setQuery] = useState("");

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
    const matches = templates.filter(match);
    const built = WIDGET_CATEGORIES
      .map(cat => ({ id: cat.id as string, label: cat.label, items: matches.filter(t => (t.category ?? "tools") === cat.id) }));
    // Community widgets come from the widget bank (JSON defs, not code).
    built.push({ id: "community", label: "Community", items: bankTemplates.filter(match) });
    return built.filter(g => g.items.length > 0);
  }, [templates, bankTemplates, query]);

  return (
    <div
      ref={panelRef}
      className={`fixed z-50 w-72 flex flex-col bg-[var(--shelf-bg)] backdrop-blur-sm border border-[var(--surface-border)] rounded-2xl shadow-lg select-none ${pos === null ? "bottom-6 left-1/2 -translate-x-1/2" : ""}`}
      style={pos !== null ? { left: pos.x, top: pos.y } : undefined}
    >
      {/* Drag handle + search */}
      <div
        className="flex items-center gap-2 px-3 pt-2.5 pb-2 cursor-grab active:cursor-grabbing"
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
        <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-[var(--surface)] border border-[var(--surface-border)] rounded-lg px-2 py-1">
          <Search size={12} className="text-[var(--text-muted)] shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search widgets"
            className="w-full bg-transparent text-xs outline-none text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)]"
          />
        </div>
      </div>

      {/* Catalog */}
      <div className="flex-1 max-h-[50vh] overflow-y-auto px-3 pb-2 flex flex-col gap-2.5">
        {groups.map(group => (
          <div key={group.id}>
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] font-[family-name:var(--font-dm-mono)] mb-1.5">
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
                    className={`px-2.5 py-2 rounded-xl border cursor-grab select-none min-w-0 ${c.bg} ${c.border}`}
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
          <Undo2 size={13} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-25"
          title="Redo layout change"
        >
          <Redo2 size={13} />
        </button>
        <div className="w-px h-4 bg-[var(--surface-border)] mx-0.5" />
        <button
          onClick={onExport}
          disabled={backupDisabled}
          className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-25"
          title={backupDisabled ? "Not available in demo mode" : "Export backup"}
        >
          <Download size={13} />
        </button>
        <button
          onClick={() => importRef.current?.click()}
          disabled={backupDisabled}
          className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-25"
          title={backupDisabled ? "Not available in demo mode" : "Import backup"}
        >
          <Upload size={13} />
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
          onClick={onWipe}
          className="p-2 rounded-xl text-[var(--text-muted)] hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title="Clear the dashboard (undoable)"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
