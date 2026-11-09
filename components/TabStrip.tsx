"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Widget } from "@/lib/widgets";
import { colorMap } from "@/lib/widgets";

// The tab row of a tab group. Clicking a tab shows it. In layout edit mode a
// tab can be dragged along the row to reorder the group (Shift with the left
// or right arrow key does the same from the keyboard), and every tab after the
// first has a cross that ungroups it back into its own cell.
type Props = {
  order: string[];                // the cell's own widget first, then its tabs
  activeId: string;
  instances: Record<string, Widget>;
  editing: boolean;
  className: string;              // the row's background and bottom border
  onSelect: (id: string) => void;
  onUngroup: (id: string) => void;
  onReorder: (order: string[]) => void;
};

// Pointer travel before a press on a tab counts as a drag rather than a click.
const DRAG_THRESHOLD = 5;

// A reorder that makes another tab first renames the cell, which remounts the
// whole tile (and this strip), so the tab to refocus is remembered outside the
// component and picked up by whichever strip renders it next.
const pendingFocus: { id: string | null } = { id: null };

function movedTo(order: string[], id: string, index: number): string[] {
  const rest = order.filter(x => x !== id);
  rest.splice(Math.max(0, Math.min(rest.length, index)), 0, id);
  return rest;
}

export default function TabStrip({ order, activeId, instances, editing, className, onSelect, onUngroup, onReorder }: Props) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const press = useRef<{ id: string; x: number; y: number; dragging: boolean; order: string[] } | null>(null);
  const latest = useRef<string[] | null>(null);
  const skipClick = useRef(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const shown = preview ?? order;

  useEffect(() => {
    const id = pendingFocus.id;
    if (id && buttons.current.has(id)) {
      pendingFocus.id = null;
      buttons.current.get(id)?.focus();
    }
  });

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    skipClick.current = false;
    if (!editing || e.button !== 0) return;
    press.current = { id, x: e.clientX, y: e.clientY, dragging: false, order };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    if (!p) return;
    if (!p.dragging) {
      if (Math.abs(e.clientX - p.x) < DRAG_THRESHOLD && Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
      p.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragId(p.id);
    }
    // The dragged tab goes after every other tab whose middle the pointer has
    // passed. The others keep their relative order, so counting them works
    // whatever order the row is currently drawn in.
    let index = 0;
    for (const id of p.order) {
      if (id === p.id) continue;
      const r = buttons.current.get(id)?.getBoundingClientRect();
      if (r && e.clientX > r.left + r.width / 2) index++;
    }
    const next = movedTo(p.order, p.id, index);
    if (next.join("|") !== (latest.current ?? p.order).join("|")) {
      latest.current = next;
      setPreview(next);
    }
  }

  function endDrag(commit: boolean) {
    const p = press.current;
    press.current = null;
    if (!p?.dragging) return;
    const next = latest.current;
    latest.current = null;
    setDragId(null);
    setPreview(null);
    skipClick.current = true;
    if (commit && next && next.join("|") !== order.join("|")) onReorder(next);
  }

  function onClick(id: string) {
    if (skipClick.current) { skipClick.current = false; return; }
    onSelect(id);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, id: string) {
    if (!editing || !e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const from = order.indexOf(id);
    const to = from + (e.key === "ArrowLeft" ? -1 : 1);
    if (to < 0 || to >= order.length) return;
    pendingFocus.id = id;
    onReorder(movedTo(order, id, to));
  }

  return (
    <div className={`shrink-0 flex gap-1 px-2 pt-1.5 pb-1 overflow-x-auto ${className}`}>
      {shown.map((tabId, index) => {
        const w = instances[tabId];
        const c = colorMap[w?.color ?? "neutral"];
        const isActive = tabId === activeId;
        const isDragging = tabId === dragId;
        return (
          <button
            key={tabId}
            ref={el => { if (el) buttons.current.set(tabId, el); else buttons.current.delete(tabId); }}
            data-tab-index={index}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => onPointerDown(e, tabId)}
            onPointerMove={onPointerMove}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            onClick={() => onClick(tabId)}
            onKeyDown={e => onKeyDown(e, tabId)}
            style={{ touchAction: editing ? "none" : undefined }}
            title={editing ? "Drag to reorder" : undefined}
            className={`flex items-center gap-1 px-2 min-h-6 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
              editing ? (isDragging ? "cursor-grabbing" : "cursor-grab") : ""
            } ${
              isActive || isDragging
                ? `${c.bg} ${c.border} opacity-100`
                : "bg-transparent border-transparent opacity-70 hover:opacity-100"
            } ${isDragging ? "shadow-md scale-105" : ""}`}
          >
            <span className={c.label}>{w?.title ?? tabId}</span>
            {editing && tabId !== order[0] && (
              <span
                role="button"
                aria-label="Ungroup"
                onMouseDown={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onUngroup(tabId); }}
                className="ml-0.5 leading-none text-neutral-400 hover:text-neutral-700"
              >×</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
