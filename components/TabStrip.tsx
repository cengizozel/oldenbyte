"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Widget } from "@/lib/widgets";
import { colorMap } from "@/lib/widgets";
import { FOCUS_RING } from "@/components/ui/Field";
import type { TabGroupHosts } from "@/lib/tabGroup";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
// Clicking a tab (its icon or its name) shows it, and the row scrolls so the
// whole tab is in view when the row is wider than the card. The row scrolls by
// dragging (with momentum on release) and by the mouse wheel. Past either end
// it glows the way Android's edge effect does: pulling further while held
// grows the glow and keeps it there, letting go fades it, and a fling into the
// end gives a burst in proportion to its speed. The glow sits at the edge of
// the tab list itself, inside the header actions. In layout
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
// Header actions that only show on hover (the dashboard-wide `opacity-0
// group-hover:` chrome, see docs/design.md) would still take their full width
// in the tab row while invisible, squeezing the tabs. Inside the row they
// collapse to nothing at rest and open to their 24px box when the tile is
// hovered or focused, or always where there is no hover; the negative margin
// swallows the flex gap before a collapsed one.
const COLLAPSE_HIDDEN_ACTIONS = [
  "[&_.opacity-0]:overflow-hidden [&_.opacity-0]:transition-[max-width,padding,margin,opacity] [&_.opacity-0]:duration-150",
  "[&_.opacity-0]:!max-w-0 [&_.opacity-0]:!px-0 [&_.opacity-0]:!mr-0 [&_.opacity-0]:!-ml-2",
  "group-hover:[&_.opacity-0]:!max-w-6 group-hover:[&_.opacity-0]:!px-[5px] group-hover:[&_.opacity-0]:!-mx-[5px]",
  "focus-within:[&_.opacity-0]:!max-w-6 focus-within:[&_.opacity-0]:!px-[5px] focus-within:[&_.opacity-0]:!-mx-[5px]",
  "[@media(hover:none)]:[&_.opacity-0]:!max-w-6 [@media(hover:none)]:[&_.opacity-0]:!px-[5px] [@media(hover:none)]:[&_.opacity-0]:!-mx-[5px]",
].join(" ");

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
  const bgVar = /var\((--[\w-]+)\)/.exec(c.bg)?.[1] ?? "--surface";

  // Drag state: the index being dragged, how far the pointer has moved, and
  // the slot (index among the other tabs) it would land in. The slot comes
  // from the pointer against the row's geometry at drag start, not from the
  // tab under the cursor, because the tabs move away as the preview updates.
  type Drag = { idx: number; over: number; dx: number };
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // `scroll` is set when a press scrolls the row (view mode) instead of
  // reordering (edit mode): the row's scrollLeft when the press began.
  // `startScroll` is the row's scrollLeft when a reorder press began, so the
  // geometry taken then can be corrected while the row auto-scrolls.
  const press = useRef<{ idx: number; x: number; dragging: boolean; scroll?: number; startScroll: number; samples?: { t: number; x: number }[] } | null>(null);
  const fling = useRef<number | null>(null);
  function stopFling() {
    if (fling.current) { cancelAnimationFrame(fling.current); fling.current = null; }
  }

  // The edge glow, after Android's EdgeEffect: onPull grows it with the
  // distance pulled past the end and keeps it while the pointer is down,
  // onRelease fades it, onAbsorb bursts it in proportion to a fling's speed.
  type Glow = { side: "left" | "right"; alpha: number; size: number; held: boolean };
  const [glow, setGlow] = useState<Glow | null>(null);
  const glowHeld = useRef(false);
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearGlowLater() {
    if (glowTimer.current) clearTimeout(glowTimer.current);
    glowTimer.current = setTimeout(() => setGlow(null), 400);
  }
  function pullGlow(side: "left" | "right", distance: number) {
    if (glowTimer.current) { clearTimeout(glowTimer.current); glowTimer.current = null; }
    const d = Math.min(distance, 160);
    glowHeld.current = true;
    setGlow({ side, alpha: 0.12 + (d / 160) * 0.45, size: 8 + d * 0.2, held: true });
  }
  function releaseGlow() {
    if (!glowHeld.current) return;
    glowHeld.current = false;
    setGlow(g => (g ? { ...g, alpha: 0, held: false } : g));
    clearGlowLater();
  }
  function absorbGlow(side: "left" | "right", speed: number) {
    glowHeld.current = false;
    setGlow({ side, alpha: Math.min(0.55, 0.15 + speed * 0.5), size: 14 + Math.min(speed, 1) * 20, held: false });
    requestAnimationFrame(() => requestAnimationFrame(() => setGlow(g => (g && !g.held ? { ...g, alpha: 0 } : g))));
    clearGlowLater();
  }
  // Scroll the row by hand, clamped. `held` means a finger or button is down
  // (a pull), otherwise the motion is a fling or a wheel tick.
  function scrollRow(list: HTMLDivElement, to: number, speed: number, held: boolean) {
    const max = list.scrollWidth - list.clientWidth;
    if (to < 0) { list.scrollLeft = 0; if (held) pullGlow("left", -to); else if (speed > 0.15) absorbGlow("left", speed); return false; }
    if (to > max) { list.scrollLeft = max; if (held) pullGlow("right", to - max); else if (speed > 0.15) absorbGlow("right", speed); return false; }
    list.scrollLeft = to;
    if (held) releaseGlow(); // pulled back inside the row while still holding
    return true;
  }
  // Auto-scroll while a tab is dragged near either end of the row.
  const auto = useRef<{ dir: number; raf: number | null; x: number; speed: number; pos: number }>({ dir: 0, raf: null, x: 0, speed: 0, pos: 0 });
  function stopAuto() {
    if (auto.current.raf) cancelAnimationFrame(auto.current.raf);
    auto.current = { dir: 0, raf: null, x: 0, speed: 0, pos: 0 };
  }
  const rects = useRef<DOMRect[]>([]);
  const skipClick = useRef(false);

  function shiftFor(i: number): number {
    if (!drag || i === drag.idx) return 0;
    const w = (rects.current[drag.idx]?.width ?? 0) + GAP;
    if (drag.idx < i && i <= drag.over) return -w;
    if (drag.over <= i && i < drag.idx) return w;
    return 0;
  }

  // The slot for a dragged tab whose left edge sits at `left` (in the
  // coordinates the rects were taken in): the one whose resting position is
  // nearest, the way Chrome's tab strip places a dragged tab. A neighbor
  // steps aside only once the tab has travelled half the neighbor's width,
  // whatever its own width and wherever it was grabbed, so nothing flips
  // back and forth around the pointer.
  function slotFor(left: number, idx: number): number {
    const r = rects.current;
    if (!r.length) return 0;
    let x = r[0].left, slot = 0, best = 0, bestDist = Infinity;
    for (let i = 0; i <= r.length; i++) {
      if (i < r.length && i === idx) continue;
      const dist = Math.abs(left - x);
      if (dist < bestDist) { bestDist = dist; best = slot; }
      if (i < r.length) { x += r[i].width + GAP; slot++; }
    }
    return best;
  }

  // Pointer handling lives on the row, so a press in the gap between tabs
  // still scrolls it; a press on a tab carries its index for reordering.
  function onPointerDown(e: PointerEvent) {
    skipClick.current = false;
    if (e.button !== 0) return;
    const i = Number((e.target as Element).closest("[data-tab-index]")?.getAttribute("data-tab-index") ?? -1);
    // Edit mode: only a press on a tab is ours (it reorders); a press on the
    // row's empty space is left to the grid, which moves the whole tile.
    const list = listRef.current;
    if (!list) return;
    stopFling();
    if (editing) { if (i >= 0) press.current = { idx: i, x: e.clientX, dragging: false, startScroll: list.scrollLeft }; return; }
    if (list.scrollWidth > list.clientWidth + 1) press.current = { idx: i, x: e.clientX, dragging: false, scroll: list.scrollLeft, startScroll: list.scrollLeft, samples: [{ t: e.timeStamp, x: e.clientX }] };
  }

  function onPointerMove(e: PointerEvent) {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (p.scroll !== undefined) {
      // View mode: the press drags the row sideways.
      if (!p.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        p.dragging = true;
        listRef.current?.setPointerCapture(e.pointerId);
      }
      const list = listRef.current;
      if (list) {
        const before = list.scrollLeft;
        scrollRow(list, p.scroll - dx, Math.abs(before - (p.scroll - dx)) / 16, true);
      }
      p.samples!.push({ t: e.timeStamp, x: e.clientX });
      if (p.samples!.length > 6) p.samples!.shift();
      return;
    }
    if (!p.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      p.dragging = true;
      rects.current = order.map(id => buttons.current.get(id)?.getBoundingClientRect() ?? new DOMRect());
      listRef.current?.setPointerCapture(e.pointerId);
    }
    updateReorder(e.clientX);
    // Near either end of a row that can scroll, keep scrolling while the
    // pointer stays there, so a tab can be carried past the edge.
    const list = listRef.current;
    if (list) {
      const lr = list.getBoundingClientRect(), zone = 32, max = list.scrollWidth - list.clientWidth;
      const dir = e.clientX < lr.left + zone && list.scrollLeft > 0 ? -1 : e.clientX > lr.right - zone && list.scrollLeft < max ? 1 : 0;
      // Slow enough to aim with: a creep just inside the zone, rising toward
      // the edge (about 25 to 110 px/s), and the speed follows the pointer.
      const depth = dir < 0 ? (lr.left + zone - e.clientX) / zone : dir > 0 ? (e.clientX - (lr.right - zone)) / zone : 0;
      auto.current.x = e.clientX;
      auto.current.speed = 0.4 + Math.min(1, Math.max(0, depth)) * 1.4;
      if (dir !== auto.current.dir) {
        if (auto.current.raf) cancelAnimationFrame(auto.current.raf);
        auto.current.dir = dir; auto.current.raf = null;
        if (dir) {
          auto.current.pos = list.scrollLeft; // kept as a float: sub-pixel steps add up
          const tick = () => {
            const l = listRef.current, pr = press.current;
            if (!l || !pr?.dragging || !auto.current.dir) { auto.current.raf = null; return; }
            const m = l.scrollWidth - l.clientWidth;
            auto.current.pos = Math.max(0, Math.min(m, auto.current.pos + auto.current.dir * auto.current.speed));
            l.scrollLeft = Math.round(auto.current.pos);
            updateReorder(auto.current.x);
            if ((auto.current.dir < 0 && l.scrollLeft <= 0) || (auto.current.dir > 0 && l.scrollLeft >= m)) { auto.current.dir = 0; auto.current.raf = null; return; }
            auto.current.raf = requestAnimationFrame(tick);
          };
          auto.current.raf = requestAnimationFrame(tick);
        }
      }
    }
  }

  // The reorder preview for a pointer at x: the dragged tab follows the
  // pointer (plus whatever the row scrolled since the press, since that moved
  // its resting spot), clamped to the span of the row, and the others part.
  function updateReorder(x: number) {
    const p = press.current, list = listRef.current;
    if (!p || !list) return;
    const scrolled = list.scrollLeft - p.startScroll;
    const r = rects.current;
    const me = r[p.idx];
    // The tab's travel in rect coordinates: pointer travel plus the scroll
    // since the press (that moved its resting spot), kept within the row.
    const lo = (r[0]?.left ?? me.left) - me.left;
    const hi = (r[r.length - 1]?.right ?? me.right) - me.right;
    const travel = Math.max(lo, Math.min(hi, x - p.x + scrolled));
    const next = { idx: p.idx, over: slotFor(me.left + travel, p.idx), dx: travel };
    dragRef.current = next;
    setDrag(next);
  }

  function endDrag(commit: boolean) {
    const p = press.current;
    press.current = null;
    stopAuto();
    if (!p?.dragging) return;
    skipClick.current = true;
    if (p.scroll !== undefined) {
      releaseGlow();
      // Release: keep going at the pointer's last speed and coast to a stop.
      const list = listRef.current, s = p.samples ?? [];
      if (!commit || !list || s.length < 2) return;
      const a = s[0], b = s[s.length - 1];
      let v = -(b.x - a.x) / Math.max(1, b.t - a.t); // px per ms, in scroll direction
      if (Math.abs(v) < 0.05) return;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(32, now - last); last = now;
        v *= Math.exp(-dt / 180);
        const went = scrollRow(list, list.scrollLeft + v * dt, Math.abs(v), false);
        if (!went || Math.abs(v) < 0.02) { fling.current = null; return; }
        fling.current = requestAnimationFrame(step);
      };
      fling.current = requestAnimationFrame(step);
      return;
    }
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
  // The shown widget's actions float over the row's right end (view mode)
  // rather than taking row space, so hovering, which opens the hidden
  // buttons, never shifts or clips a tab by layout. The list is padded by
  // their width underneath, so a tab they cover can be scrolled out from
  // under them and the chosen tab always lands clear of them.
  const [actionsW, setActionsW] = useState(0);
  const actionsWRef = useRef(0);
  const actionsRO = useRef<ResizeObserver | null>(null);
  const actionsHost = useCallback((el: HTMLElement | null) => {
    hosts.current = { ...hosts.current, actions: el };
    onHostsRef.current(hosts.current);
    actionsRO.current?.disconnect();
    actionsRO.current = null;
    const set = (w: number) => { w = Math.round(w); if (w !== actionsWRef.current) { actionsWRef.current = w; setActionsW(w); } };
    if (!el) { set(0); return; }
    actionsRO.current = new ResizeObserver(() => set(el.getBoundingClientRect().width));
    actionsRO.current.observe(el);
    set(el.getBoundingClientRect().width);
  }, []);

  useEffect(() => {
    const id = pendingFocus.id;
    if (id && buttons.current.has(id)) {
      pendingFocus.id = null;
      buttons.current.get(id)?.focus();
    }
  });

  // The wheel scrolls the row sideways when it can scroll (vertical wheels
  // too, as horizontal lists usually do).
  function onWheel(e: WheelEvent) {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth + 1) return;
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!d) return;
    e.preventDefault();
    stopFling();
    scrollRow(list, list.scrollLeft + d, 0, false);
  }
  // A click anywhere on a tab (icon, name, gap inside it) shows it. Handled
  // natively, like the pointer events, because the icon and name are portals.
  function onListClick(e: MouseEvent) {
    const t = e.target as Element;
    if (t.closest('[aria-label="Ungroup"]')) return;
    const b = t.closest("[data-tab-index]");
    if (!b) return;
    const id = order[Number(b.getAttribute("data-tab-index"))];
    if (id) onClick(id);
  }
  const handlers = useRef({ onPointerDown, onPointerMove, endDrag, onWheel, onListClick });
  handlers.current = { onPointerDown, onPointerMove, endDrag, onWheel, onListClick };
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const down = (e: PointerEvent) => handlers.current.onPointerDown(e);
    const move = (e: PointerEvent) => handlers.current.onPointerMove(e);
    const up = () => handlers.current.endDrag(true);
    const cancel = () => handlers.current.endDrag(false);
    const wheel = (e: WheelEvent) => handlers.current.onWheel(e);
    const click = (e: MouseEvent) => handlers.current.onListClick(e);
    list.addEventListener("pointerdown", down);
    list.addEventListener("pointermove", move);
    list.addEventListener("pointerup", up);
    list.addEventListener("pointercancel", cancel);
    list.addEventListener("wheel", wheel, { passive: false });
    list.addEventListener("click", click);
    return () => {
      list.removeEventListener("pointerdown", down);
      list.removeEventListener("pointermove", move);
      list.removeEventListener("pointerup", up);
      list.removeEventListener("pointercancel", cancel);
      list.removeEventListener("wheel", wheel);
      list.removeEventListener("click", click);
    };
  }, []);

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
    stopFling();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A row wider than the card scrolls so the whole open tab shows, with a
    // little room on the side it came in from.
    const pad = 12;
    const from = st.l.target - 4, to = st.r.target + 4;
    let scroll = list.scrollLeft;
    if (from - pad < scroll) scroll = Math.max(0, from - pad);
    else if (to + pad > scroll + list.clientWidth - actionsWRef.current) scroll = to + pad - (list.clientWidth - actionsWRef.current);
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
  // In edit mode a press on a tab reorders and a press on the row's empty
  // space moves the tile, so the row cannot be dragged sideways: arrows at
  // either end take over whenever tabs are cut off (view mode drags and
  // flings instead, and the shown tab scrolls itself into view).
  const [cut, setCut] = useState({ left: false, right: false });
  useEffect(() => {
    const list = listRef.current;
    if (!list || !editing) return;
    const measure = () => {
      const max = list.scrollWidth - list.clientWidth;
      const next = { left: list.scrollLeft > 1, right: list.scrollLeft < max - 1 };
      setCut(c => c.left === next.left && c.right === next.right ? c : next);
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => { list.removeEventListener("scroll", measure); ro.disconnect(); };
  }, [editing, orderKey]);
  function page(dir: -1 | 1) {
    const list = listRef.current;
    if (!list) return;
    stopFling();
    list.scrollTo({ left: list.scrollLeft + dir * Math.max(80, list.clientWidth * 0.6), behavior: "smooth" });
  }

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
    <div className={`relative shrink-0 flex items-center gap-3 pl-5 pt-[18px] pb-2.5 ${editing ? "pr-24 cursor-grab" : "pr-5"} ${className}`}>
      <div className="relative flex-1 min-w-0 flex items-center">
      <div
        ref={listRef}
        style={{ touchAction: editing ? "none" : undefined, paddingRight: actionsW || undefined, scrollPaddingRight: actionsW || undefined }}
        className={`relative flex items-center gap-3 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${editing ? "cursor-grab" : "cursor-default"}`}
      >
        {order.map((tabId, index) => {
          const isActive = tabId === activeId;
          const isDragged = drag?.idx === index;
          const shift = isDragged ? drag.dx : shiftFor(index);
          return (
            <div
              key={tabId}
              style={{ transform: shift ? `translateX(${shift}px)` : undefined }}
              className={`shrink-0 ${isDragged ? "relative z-10 cursor-grabbing" : `transition-transform duration-200 ease-out ${editing ? "cursor-grab" : ""}`}`}
            >
              <button
                ref={el => { if (el) buttons.current.set(tabId, el); else buttons.current.delete(tabId); }}
                data-tab-index={index}
                aria-pressed={isActive}
                onMouseDown={e => e.stopPropagation()}
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
      {glow && (
        <span
          aria-hidden
          className={`pointer-events-none absolute top-0 bottom-0 ${c.label} ${glow.side === "left" ? "left-0" : ""}`}
          style={{
            right: glow.side === "right" ? actionsW : undefined,
            width: glow.size,
            opacity: glow.alpha,
            background: `radial-gradient(${glow.size}px 400% at ${glow.side} center, currentColor, transparent 100%)`,
            transition: glow.held ? "opacity 60ms linear, width 60ms linear" : "opacity 320ms ease-out, width 320ms ease-out",
          }}
        />
      )}
      {editing && (cut.left || cut.right) && (["left", "right"] as const).map(side => {
        const Icon = side === "left" ? ChevronLeft : ChevronRight;
        return (
          <button
            key={side}
            type="button"
            data-tab-nav
            aria-label={side === "left" ? "Earlier tabs" : "More tabs"}
            title={side === "left" ? "Earlier tabs" : "More tabs"}
            disabled={!cut[side]}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onClick={() => page(side === "left" ? -1 : 1)}
            className={`absolute top-0 bottom-0 ${side === "left" ? "left-0" : "right-0"} w-6 flex items-center justify-center rounded-md transition-opacity ${c.label} ${c.bg} ${FOCUS_RING} ${
              cut[side] ? "opacity-100 cursor-pointer" : "opacity-0 pointer-events-none"
            }`}
          >
            <Icon size={16} strokeWidth={2.25} />
          </button>
        );
      })}
      </div>
      {/* The shown widget's header actions, in view mode only: edit mode is for
          arranging, and the tile's own controls sit in this corner then. They
          get at most half the row so a long label cannot push the tabs out. */}
      {!editing && (
        <div
          ref={actionsHost}
          className={`absolute right-5 top-[18px] bottom-2.5 pl-8 flex items-center gap-2 max-w-[50%] empty:hidden pointer-events-none [&>*]:pointer-events-auto [&_.truncate]:max-w-16 ${COLLAPSE_HIDDEN_ACTIONS}`}
          style={{ background: `linear-gradient(to right, transparent, var(${bgVar}) 32px)` }}
        />
      )}
    </div>
  );
}
