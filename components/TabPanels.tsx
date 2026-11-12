"use client";

import { useEffect, useRef, type ReactNode } from "react";

// The body of a tab group: one panel per tab, the active one shown, and a
// sideways swipe to the neighbouring tab, the way phone apps page between
// tabs. A finger drag follows the finger and settles on release; a trackpad's
// two-finger sideways scroll does the same on a computer. A mouse drag never
// does: on a computer that gesture selects text and drags things.
//
// A swipe never starts on something that uses the gesture itself: text
// fields, editors, sliders, canvases, draggable items, anything that scrolls
// sideways, and any element marked data-no-swipe (the chess board, the
// schedule grid, a reading surface, a chart you scrub). Custom widgets run in
// their own frame, so their gestures never reach this at all.

const BLOCK = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], canvas, video, [draggable="true"], [data-no-swipe]';
const LOCK = 12;          // px of movement before deciding the direction
const COMMIT = 0.25;      // share of the width that switches on release
const FLICK = 0.5;        // px/ms that switches on release whatever the distance
const DURATION = 170;

function blocked(target: EventTarget | null, root: Element): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(BLOCK)) return true;
  for (let n: Element | null = target; n && n !== root; n = n.parentElement) {
    const x = getComputedStyle(n).overflowX;
    if ((x === "auto" || x === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

export default function TabPanels({ ids, activeId, onSelect, enabled, render }: {
  ids: string[];
  activeId: string;
  onSelect: (id: string) => void;
  enabled: boolean;
  render: (id: string) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const live = useRef({ ids, activeId, onSelect });
  useEffect(() => { live.current = { ids, activeId, onSelect }; });
  // Direction the newly shown tab slides in from, set by a swipe.
  const enter = useRef(0);

  useEffect(() => {
    const dir = enter.current;
    if (!dir) return;
    enter.current = 0;
    const panel = rootRef.current?.querySelector<HTMLElement>(`[data-tab-panel="${CSS.escape(activeId)}"]`);
    panel?.animate(
      [{ transform: `translateX(${dir * 48}px)`, opacity: 0.4 }, { transform: "none", opacity: 1 }],
      { duration: DURATION, easing: "ease-out" },
    );
  }, [activeId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    const neighbor = (dir: number) => {
      const { ids: list, activeId: cur } = live.current;
      return list[list.indexOf(cur) + dir];
    };
    const panelOf = (id: string) => root.querySelector<HTMLElement>(`[data-tab-panel="${CSS.escape(id)}"]`);
    const go = (dir: number) => {
      const next = neighbor(dir);
      if (!next) return false;
      enter.current = dir;
      live.current.onSelect(next);
      return true;
    };

    // ── Touch ───────────────────────────────────────────────────────────────
    // Touch events, not pointer events: most widget bodies scroll vertically,
    // and inside a scroller the browser would claim a sideways drag and cancel
    // the pointer. A non-passive touchmove can tell it not to, once the
    // gesture is clearly sideways; a vertical one is left to scroll.
    let start: { x: number; y: number; t: number } | null = null;
    let locked = false;
    let dx = 0;
    let panel: HTMLElement | null = null;
    let swallowClick = false;

    const settle = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.transition = `transform ${DURATION}ms ease-out`;
      el.style.transform = "";
      window.setTimeout(() => { el.style.transition = ""; }, DURATION);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || blocked(e.target, root)) { start = null; return; }
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: performance.now() };
      locked = false;
      dx = 0;
      panel = panelOf(live.current.activeId);
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) { if (locked) settle(panel); start = null; locked = false; return; } // a pinch
      const t = e.touches[0];
      dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!locked) {
        if (Math.abs(dy) > LOCK && Math.abs(dy) >= Math.abs(dx)) { start = null; return; } // a scroll
        if (Math.abs(dx) < LOCK || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        locked = true;
      }
      if (e.cancelable) e.preventDefault();
      // Past the first or last tab it only gives a little, like a rubber band.
      const shown = neighbor(dx < 0 ? 1 : -1) ? dx : dx * 0.25;
      if (panel) { panel.style.transition = "none"; panel.style.transform = `translateX(${shown}px)`; }
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const wasLocked = locked;
      const speed = Math.abs(dx) / Math.max(1, performance.now() - start.t);
      start = null;
      locked = false;
      if (!wasLocked) return;
      swallowClick = true; // the release ends a swipe, not a tap on what is under it
      window.setTimeout(() => { swallowClick = false; }, 350);
      const dir = dx < 0 ? 1 : -1;
      const out = panel;
      if (neighbor(dir) && e.type === "touchend" && (Math.abs(dx) > root.clientWidth * COMMIT || speed > FLICK)) {
        if (out) { out.style.transition = ""; out.style.transform = ""; }
        go(dir);
      } else {
        settle(out);
      }
    };
    const onClick = (e: MouseEvent) => { if (swallowClick) { e.preventDefault(); e.stopPropagation(); } };

    // ── Trackpad ────────────────────────────────────────────────────────────
    let acc = 0;
    let spent = false;
    let idle = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) || blocked(e.target, root)) return;
      window.clearTimeout(idle);
      idle = window.setTimeout(() => { acc = 0; spent = false; }, 160); // one gesture, one switch
      if (spent) return;
      acc += e.deltaX;
      if (Math.abs(acc) > 70) { spent = true; go(acc > 0 ? 1 : -1); }
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onEnd);
    root.addEventListener("click", onClick, true);
    root.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("wheel", onWheel);
      window.clearTimeout(idle);
    };
  }, [enabled]);

  return (
    // overscroll-x-contain: a sideways trackpad swipe never turns into the
    // browser's back gesture.
    <div ref={rootRef} className={`flex-1 min-h-0 relative overflow-hidden ${enabled ? "overscroll-x-contain" : ""}`}>
      {ids.map(id => (
        <div key={id} data-tab-panel={id} className="absolute inset-0" style={{ display: id === activeId ? "block" : "none" }}>
          {render(id)}
        </div>
      ))}
    </div>
  );
}
