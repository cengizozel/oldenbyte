"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Widget } from "@/lib/widgets";
import { colorMap } from "@/lib/widgets";
import { FOCUS_RING } from "@/components/ui/Field";
import type { TabGroupHosts } from "@/lib/tabGroup";

// The header row of a tab group. It sits exactly where a single widget's
// header sits (same title baseline, same gap to the content, header actions on
// the right): the shown tab is drawn as the title, with its widget's icon in
// front and a 2px underline that marks it as the open tab, and the other tabs
// follow as dimmed icon and name pairs in the same color, so the row reads as
// one palette. Every member's header renders its icon (and the shown one its
// actions) into this row through lib/tabGroup.ts.
//
// Clicking a tab shows it. In layout edit mode a tab can be dragged along the
// row to reorder the group, with the same live preview as the dashboard list
// and the bookmarks: the other tabs slide out of the way while the browser's
// drag image follows the cursor, and the move commits on drop. Shift with the
// left or right arrow key does the same from the keyboard. Every tab after the
// first has a cross that ungroups it back into its own cell.
type Props = {
  order: string[];                // the cell's own widget first, then its tabs
  activeId: string;
  instances: Record<string, Widget>;
  editing: boolean;
  className?: string;
  onSelect: (id: string) => void;
  onUngroup: (id: string) => void;
  onReorder: (order: string[]) => void;
  onHosts: (hosts: TabGroupHosts) => void;   // where the members' icons and the shown tab's actions go
};

// The row's gap between tabs (gap-3), part of the distance a tab slides.
const GAP = 12;

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
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const c = colorMap[instances[activeId]?.color ?? "neutral"];

  // Drag state: the index being dragged, and the slot (index among the other
  // tabs) it would land in. The slot comes from the pointer against the row's
  // geometry at drag start, not from the tab under the cursor, because the
  // tabs move away as the preview updates.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const rects = useRef<DOMRect[]>([]);

  function shiftFor(i: number): number {
    if (dragIdx === null || overIdx === null || i === dragIdx) return 0;
    const w = (rects.current[dragIdx]?.width ?? 0) + GAP;
    if (dragIdx < i && i <= overIdx) return -w;
    if (overIdx <= i && i < dragIdx) return w;
    return 0;
  }

  function slotFromPointer(x: number): number {
    let slot = 0;
    rects.current.forEach((r, i) => { if (i !== dragIdx && x > r.left + r.width / 2) slot++; });
    return slot;
  }

  function onDragStart(e: ReactDragEvent, i: number) {
    rects.current = order.map(id => buttons.current.get(id)?.getBoundingClientRect() ?? new DOMRect());
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", order[i]);
    setDragIdx(i);
    setOverIdx(i);
  }

  function onDragOver(e: ReactDragEvent) {
    if (dragIdx === null) return;
    e.preventDefault();
    const slot = slotFromPointer(e.clientX);
    if (slot !== overIdx) setOverIdx(slot);
  }

  function onDrop() {
    if (dragIdx !== null && overIdx !== null) {
      const next = movedTo(order, order[dragIdx], overIdx);
      if (next.join("|") !== order.join("|")) onReorder(next);
    }
    setDragIdx(null);
    setOverIdx(null);
  }

  // Host elements for the members' header parts: an icon slot in every tab
  // and the actions slot at the right end. The ref callbacks are stable (one
  // per tab) so React only calls them when the element itself changes.
  const hosts = useRef<TabGroupHosts>({ icons: {}, titles: {}, actions: null });
  const onHostsRef = useRef(onHosts);
  useEffect(() => { onHostsRef.current = onHosts; }, [onHosts]);
  const slotRefs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const slotHost = useCallback((kind: "icons" | "titles", tabId: string) => {
    const key = `${kind}:${tabId}`;
    let fn = slotRefs.current.get(key);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        hosts.current = { ...hosts.current, [kind]: { ...hosts.current[kind], [tabId]: el } };
        onHostsRef.current(hosts.current);
      };
      slotRefs.current.set(key, fn);
    }
    return fn;
  }, []);
  const actionsHost = useCallback((el: HTMLElement | null) => { hosts.current = { ...hosts.current, actions: el }; onHostsRef.current(hosts.current); }, []);

  useEffect(() => {
    const id = pendingFocus.id;
    if (id && buttons.current.has(id)) {
      pendingFocus.id = null;
      buttons.current.get(id)?.focus();
    }
  });

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
    <div className={`shrink-0 flex items-center gap-3 px-5 pt-[18px] pb-2.5 ${className}`}>
      <div
        className="flex items-center gap-3 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {order.map((tabId, index) => {
          const w = instances[tabId];
          const isActive = tabId === activeId;
          const shift = shiftFor(index);
          return (
            <div
              key={tabId}
              draggable={editing}
              onDragStart={e => onDragStart(e, index)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              style={{ transform: shift ? `translateX(${shift}px)` : undefined }}
              className={`shrink-0 transition-transform duration-150 ${dragIdx === index ? "opacity-40" : ""} ${editing ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              <button
                ref={el => { if (el) buttons.current.set(tabId, el); else buttons.current.delete(tabId); }}
                data-tab-index={index}
                aria-pressed={isActive}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => onSelect(tabId)}
                onKeyDown={e => onKeyDown(e, tabId)}
                title={editing ? "Drag to reorder" : undefined}
                className={`relative flex items-center gap-1.5 h-6 px-1 rounded-md text-sm whitespace-nowrap transition-opacity [&:has([data-slot=title]:not(:empty))_[data-fallback]]:hidden ${c.label} ${FOCUS_RING} ${
                  isActive
                    ? "font-medium opacity-100 after:absolute after:left-1 after:right-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-current"
                    : "opacity-70 hover:opacity-100 after:absolute after:left-1 after:right-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-current after:opacity-0 hover:after:opacity-30 after:transition-opacity"
                }`}
              >
                <span ref={slotHost("icons", tabId)} className="flex items-center shrink-0 empty:hidden" />
                {/* The header's title lands in the first span; the instance
                    title stands in until it does. */}
                <span ref={slotHost("titles", tabId)} data-slot="title" className="truncate empty:hidden" />
                <span data-fallback className="truncate">{w?.title ?? tabId}</span>
                {editing && tabId !== order[0] && (
                  <span
                    role="button"
                    aria-label="Ungroup"
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); onUngroup(tabId); }}
                    className="ml-0.5 leading-none opacity-70 hover:opacity-100"
                  >×</span>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <div ref={actionsHost} className="ml-auto flex items-center gap-2 shrink-0 empty:hidden" />
    </div>
  );
}
