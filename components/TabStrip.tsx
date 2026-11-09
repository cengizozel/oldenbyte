"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Widget } from "@/lib/widgets";
import { colorMap } from "@/lib/widgets";
import { FOCUS_RING } from "@/components/ui/Field";
import type { TabGroupHosts } from "@/lib/tabGroup";

// The header row of a tab group. It sits exactly where a single widget's
// header sits (card padding, 14px medium title, header actions on the right):
// the shown tab is drawn as the title, with its widget's icon in front, and
// the other tabs follow as dimmed names. The shown widget's header renders its
// icon and actions into this row through lib/tabGroup.ts.
//
// Clicking a tab shows it. In layout edit mode a tab can be dragged along the
// row to reorder the group (Shift with the left or right arrow key does the
// same from the keyboard), and every tab after the first has a cross that
// ungroups it back into its own cell.
type Props = {
  order: string[];                // the cell's own widget first, then its tabs
  activeId: string;
  instances: Record<string, Widget>;
  editing: boolean;
  className?: string;
  onSelect: (id: string) => void;
  onUngroup: (id: string) => void;
  onReorder: (order: string[]) => void;
  onHosts: (hosts: TabGroupHosts) => void;   // where the shown widget's icon and actions go
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

export default function TabStrip({ order, activeId, instances, editing, className = "", onSelect, onUngroup, onReorder, onHosts }: Props) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const press = useRef<{ id: string; x: number; y: number; dragging: boolean; order: string[] } | null>(null);
  const latest = useRef<string[] | null>(null);
  const skipClick = useRef(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const shown = preview ?? order;

  // Host elements for the shown widget's header parts. The callbacks are
  // stable so React only calls them when the element itself changes.
  const hosts = useRef<TabGroupHosts>({ icon: null, actions: null });
  const onHostsRef = useRef(onHosts);
  useEffect(() => { onHostsRef.current = onHosts; }, [onHosts]);
  const iconHost = useCallback((el: HTMLElement | null) => { hosts.current = { ...hosts.current, icon: el }; onHostsRef.current(hosts.current); }, []);
  const actionsHost = useCallback((el: HTMLElement | null) => { hosts.current = { ...hosts.current, actions: el }; onHostsRef.current(hosts.current); }, []);

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
    <div className={`shrink-0 flex items-center gap-3 px-5 pt-5 pb-3 ${className}`}>
      <div className="flex items-center gap-3 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              aria-pressed={isActive}
              onMouseDown={e => e.stopPropagation()}
              onPointerDown={e => onPointerDown(e, tabId)}
              onPointerMove={onPointerMove}
              onPointerUp={() => endDrag(true)}
              onPointerCancel={() => endDrag(false)}
              onClick={() => onClick(tabId)}
              onKeyDown={e => onKeyDown(e, tabId)}
              style={{ touchAction: editing ? "none" : undefined }}
              title={editing ? "Drag to reorder" : undefined}
              className={`flex items-center gap-1.5 h-6 px-1 rounded-md text-sm whitespace-nowrap transition-[opacity,background-color] ${c.label} ${FOCUS_RING} ${
                editing ? (isDragging ? "cursor-grabbing" : "cursor-grab") : ""
              } ${isActive ? "font-medium opacity-100" : "opacity-70 hover:opacity-100"} ${isDragging ? "bg-black/5 dark:bg-white/10" : ""}`}
            >
              {isActive && <span ref={iconHost} className="flex items-center shrink-0 empty:hidden" />}
              <span className="truncate">{w?.title ?? tabId}</span>
              {editing && tabId !== order[0] && (
                <span
                  role="button"
                  aria-label="Ungroup"
                  onMouseDown={e => e.stopPropagation()}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onUngroup(tabId); }}
                  className="ml-0.5 leading-none opacity-70 hover:opacity-100"
                >×</span>
              )}
            </button>
          );
        })}
      </div>
      <div ref={actionsHost} className="ml-auto flex items-center gap-2 shrink-0 empty:hidden" />
    </div>
  );
}
