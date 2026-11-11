"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Widget } from "@/lib/widgets";
import { colorMap } from "@/lib/widgets";
import { FOCUS_RING } from "@/components/ui/Field";
import type { TabGroupHosts } from "@/lib/tabGroup";

// The header row of a tab group. It sits exactly where a single widget's
// header sits (same title baseline, same gap to the content, header actions on
// the right): the shown tab is drawn as the title, with its widget's icon in
// front and a 2px underline that marks it as the open tab, and the other tabs
// follow as dimmed icon and name pairs in the same color and weight (so nothing
// shifts when the open tab changes), and the row reads as one palette. The
// underline is one element that travels to the open tab on a spring: the
// leading edge sets off at full strength and the trailing edge lags, so it
// stretches toward the target and settles with a little overshoot. Reduced
// motion gets a plain short slide. Every member's header renders its icon (and the shown one its
// actions) into this row through lib/tabGroup.ts.
//
// Clicking a tab shows it, and the row scrolls so the whole tab is in view
// when the row is wider than the card; dragging the row scrolls it. In layout
// edit mode a drag reorders instead, the way browser tabs move: the tab itself travels
// under the pointer, the others slide out of its way (the same live preview
// as the dashboard list and the bookmarks), and the move commits on release.
// Shift with the left or right arrow key does the same from the keyboard.
// Every tab after the first has a cross that ungroups it back into its own
// cell.
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
// Pointer travel before a press on a tab counts as a drag rather than a click.
const DRAG_THRESHOLD = 5;

// The underline's spring: stiffness, damping, and how much the trailing edge
// lags the leading one (the "smooth" tuning from the try-out page).
const SPRING = { k: 260, c: 26, stretch: 0.45 };
type Edge = { x: number; v: number; target: number };
function integrate(s: Edge, k: number, c: number, h: number) {
  s.v += (-k * (s.x - s.target) - c * s.v) * h;
  s.x += s.v * h;
}

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

  // Drag state: the index being dragged, how far the pointer has moved, and
  // the slot (index among the other tabs) it would land in. The slot comes
  // from the pointer against the row's geometry at drag start, not from the
  // tab under the cursor, because the tabs move away as the preview updates.
  type Drag = { idx: number; over: number; dx: number };
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // `scroll` is set when a press scrolls the row (view mode) instead of
  // reordering (edit mode): the row's scrollLeft when the press began.
  const press = useRef<{ idx: number; x: number; dragging: boolean; scroll?: number } | null>(null);
  const rects = useRef<DOMRect[]>([]);
  const skipClick = useRef(false);

  function shiftFor(i: number): number {
    if (!drag || i === drag.idx) return 0;
    const w = (rects.current[drag.idx]?.width ?? 0) + GAP;
    if (drag.idx < i && i <= drag.over) return -w;
    if (drag.over <= i && i < drag.idx) return w;
    return 0;
  }

  function slotFromPointer(x: number, idx: number): number {
    let slot = 0;
    rects.current.forEach((r, i) => { if (i !== idx && x > r.left + r.width / 2) slot++; });
    return slot;
  }

  // Pointer handling lives on the row, so a press in the gap between tabs
  // still scrolls it; a press on a tab carries its index for reordering.
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    skipClick.current = false;
    if (e.button !== 0) return;
    const i = Number((e.target as Element).closest("[data-tab-index]")?.getAttribute("data-tab-index") ?? -1);
    if (editing) { if (i >= 0) press.current = { idx: i, x: e.clientX, dragging: false }; return; }
    const list = listRef.current;
    if (list && list.scrollWidth > list.clientWidth + 1) press.current = { idx: i, x: e.clientX, dragging: false, scroll: list.scrollLeft };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (p.scroll !== undefined) {
      // View mode: the press drags the row sideways.
      if (!p.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        p.dragging = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (listRef.current) listRef.current.scrollLeft = p.scroll - dx;
      return;
    }
    if (!p.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      p.dragging = true;
      rects.current = order.map(id => buttons.current.get(id)?.getBoundingClientRect() ?? new DOMRect());
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // The tab stays inside the row: no further left than the first tab's
    // edge, no further right than the last tab's.
    const r = rects.current;
    const me = r[p.idx];
    const lo = (r[0]?.left ?? me.left) - me.left;
    const hi = (r[r.length - 1]?.right ?? me.right) - me.right;
    const next = { idx: p.idx, over: slotFromPointer(e.clientX, p.idx), dx: Math.max(lo, Math.min(hi, dx)) };
    dragRef.current = next;
    setDrag(next);
  }

  function endDrag(commit: boolean) {
    const p = press.current;
    press.current = null;
    if (!p?.dragging) return;
    skipClick.current = true;
    if (p.scroll !== undefined) return;
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (commit && d) {
      const next = movedTo(order, order[d.idx], d.over);
      if (next.join("|") !== order.join("|")) onReorder(next);
    }
  }

  function onClick(id: string) {
    if (skipClick.current) { skipClick.current = false; return; }
    onSelect(id);
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

  // The travelling underline. Edges are measured against the tab list, the
  // first paint is instant, every later change of open tab or order animates.
  const listRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const edges = useRef<{ l: Edge; r: Edge; raf: number | null; painted: boolean }>({
    l: { x: 0, v: 0, target: 0 }, r: { x: 0, v: 0, target: 0 }, raf: null, painted: false,
  });
  const orderKey = order.join("|");
  useLayoutEffect(() => {
    const ink = inkRef.current, list = listRef.current, btn = buttons.current.get(activeId);
    if (!ink || !list || !btn) return;
    const st = edges.current;
    const measure = () => {
      const b = btn.getBoundingClientRect(), base = list.getBoundingClientRect();
      st.l.target = b.left - base.left + list.scrollLeft + 4;
      st.r.target = b.right - base.left + list.scrollLeft - 4;
    };
    const paint = () => {
      ink.style.transform = `translateX(${st.l.x}px)`;
      ink.style.width = `${Math.max(2, st.r.x - st.l.x)}px`;
    };
    measure();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A row wider than the card scrolls so the whole open tab shows, with a
    // little room on the side it came in from.
    const pad = 12;
    const from = st.l.target - 4, to = st.r.target + 4;
    let scroll = list.scrollLeft;
    if (from - pad < scroll) scroll = Math.max(0, from - pad);
    else if (to + pad > scroll + list.clientWidth) scroll = to + pad - list.clientWidth;
    if (Math.round(scroll) !== Math.round(list.scrollLeft)) list.scrollTo({ left: scroll, behavior: !st.painted || reduced ? "auto" : "smooth" });
    if (!st.painted || reduced) {
      // First paint, or reduced motion: no spring. Reduced motion still gets a
      // short CSS slide between positions.
      ink.style.transition = st.painted ? "transform 150ms ease-out, width 150ms ease-out" : "none";
      st.l.x = st.l.target; st.r.x = st.r.target; st.l.v = st.r.v = 0;
      paint();
      st.painted = true;
      return;
    }
    ink.style.transition = "none";
    if (st.raf) cancelAnimationFrame(st.raf);
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000) || 0.016;
      last = now;
      const forward = st.r.target - st.r.x + (st.l.target - st.l.x) >= 0;
      const lead = forward ? st.r : st.l, trail = forward ? st.l : st.r;
      const h = dt / 4;
      for (let i = 0; i < 4; i++) {
        integrate(lead, SPRING.k, SPRING.c, h);
        integrate(trail, SPRING.k * (1 - SPRING.stretch), SPRING.c * (1 - SPRING.stretch * 0.5), h);
      }
      const settled = [st.l, st.r].every(e => Math.abs(e.x - e.target) < 0.05 && Math.abs(e.v) < 0.5);
      if (settled) { st.l.x = st.l.target; st.r.x = st.r.target; st.l.v = st.r.v = 0; paint(); st.raf = null; return; }
      paint();
      st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
    return () => { if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; } };
    // orderKey and the instance titles change where the tabs sit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, orderKey, editing]);
  // Re-measure when the row changes size (fonts, titles arriving, resizes).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(() => {
      const st = edges.current, btn = buttons.current.get(activeId), ink = inkRef.current;
      if (!btn || !ink || st.raf) return;
      const b = btn.getBoundingClientRect(), base = list.getBoundingClientRect();
      st.l.x = st.l.target = b.left - base.left + list.scrollLeft + 4;
      st.r.x = st.r.target = b.right - base.left + list.scrollLeft - 4;
      ink.style.transition = "none";
      ink.style.transform = `translateX(${st.l.x}px)`;
      ink.style.width = `${Math.max(2, st.r.x - st.l.x)}px`;
    });
    ro.observe(list);
    for (const b of buttons.current.values()) ro.observe(b);
    return () => ro.disconnect();
  }, [activeId, orderKey]);

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
        ref={listRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        style={{ touchAction: editing ? "none" : undefined }}
        className={`relative flex items-center gap-3 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${editing ? "" : "cursor-default"}`}
      >
        {order.map((tabId, index) => {
          const isActive = tabId === activeId;
          const isDragged = drag?.idx === index;
          const shift = isDragged ? drag.dx : shiftFor(index);
          return (
            <div
              key={tabId}
              style={{ transform: shift ? `translateX(${shift}px)` : undefined }}
              className={`shrink-0 ${isDragged ? "relative z-10 cursor-grabbing" : `transition-transform duration-150 ${editing ? "cursor-grab" : ""}`}`}
            >
              <button
                ref={el => { if (el) buttons.current.set(tabId, el); else buttons.current.delete(tabId); }}
                data-tab-index={index}
                aria-pressed={isActive}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => onClick(tabId)}
                onKeyDown={e => onKeyDown(e, tabId)}
                title={editing ? "Drag to reorder" : undefined}
                className={`flex items-center gap-1.5 h-6 px-1 rounded-md text-sm font-medium whitespace-nowrap transition-opacity ${c.label} ${FOCUS_RING} ${
                  isActive ? "opacity-100" : "opacity-70 hover:opacity-100"
                }`}
              >
                <span ref={slotHost("icons", tabId)} className="flex items-center shrink-0 empty:hidden" />
                {/* The widget's header renders its title here (every widget has one). */}
                <span ref={slotHost("titles", tabId)} className="truncate" />
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
            </div>
          );
        })}
        <span
          ref={inkRef}
          aria-hidden
          className={`absolute bottom-0 left-0 h-0.5 w-10 rounded-full bg-current pointer-events-none ${c.label} ${drag ? "opacity-0" : "opacity-100"} transition-opacity`}
        />
      </div>
      <div ref={actionsHost} className="ml-auto flex items-center gap-2 shrink-0 empty:hidden" />
    </div>
  );
}
