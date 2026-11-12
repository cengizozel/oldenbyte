"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

// The body of a tab group: one panel per tab, the active one shown, and a
// sideways swipe to the neighbouring tab, the way phone apps page between
// tabs. While a finger drags, the neighbouring tab rides in beside the shown
// one, its real content already there (every tab stays mounted); on release
// the tab is chosen at once (the tab row's underline sets off with the slide)
// while both panels finish the move together, so nothing reloads or fades. A trackpad's two-finger sideways swipe
// plays the same slide. A mouse drag never swipes: on a computer that gesture
// selects text and drags things. Choosing a tab in the tab row stays an
// instant switch.
//
// A swipe never starts on something that uses the gesture itself: text
// fields, editors, sliders, canvases, video, draggable items, anything that
// scrolls sideways, and any element marked data-no-swipe (the chess board, the
// schedule grid, a reading surface, a chart you scrub). Custom widgets run in
// their own frame, so their gestures never reach this at all.

const BLOCK = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], canvas, video, [draggable="true"], [data-no-swipe]';
const LOCK = 12;          // px of movement before deciding the direction
const COMMIT = 0.25;      // share of the width that switches on release
const FLICK = 0.5;        // px/ms that switches on release whatever the distance
const DURATION = 220;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)"; // fast start, soft landing
const GAP = 12;           // px between the two panels while they move

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

  // The tab a finishing swipe is sliding away from: kept on screen until the
  // slide ends, though the new tab is already the chosen one.
  const [hold, setHold] = useState<string | null>(null);
  const holdRef = useRef<string | null>(null);

  // After any switch, before the browser paints: drop the inline styles a
  // swipe left on the panels, so React's display (shown or hidden) is all
  // that applies and nothing flashes. Not while a swipe is still sliding.
  useLayoutEffect(() => {
    if (holdRef.current) return;
    rootRef.current?.querySelectorAll<HTMLElement>("[data-tab-panel]").forEach(p => {
      p.style.transform = "";
      p.style.transition = "";
      p.style.willChange = "";
      if (p.dataset.tabPanel !== activeId) p.style.display = "none";
    });
  }, [activeId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    const neighbor = (dir: number) => {
      const { ids: list, activeId: cur } = live.current;
      return list[list.indexOf(cur) + dir];
    };
    const panelOf = (id: string | undefined) => (id ? root.querySelector<HTMLElement>(`[data-tab-panel="${CSS.escape(id)}"]`) : null);
    const width = () => root.clientWidth + GAP;

    // The shown panel and, beside it, the neighbour in the drag's direction.
    let cur: HTMLElement | null = null;
    let peek: HTMLElement | null = null;
    let peekDir = 0;
    // The slide still finishing, so a new swipe can complete it at once and
    // carry on from the next tab without waiting.
    let pending: { timer: number; done: () => void } | null = null;
    const fastForward = () => {
      if (!pending) return;
      window.clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      p.done();
    };

    const place = (offset: number, dir: number) => {
      if (dir !== peekDir) {
        if (peek) { peek.style.display = "none"; peek.style.transform = ""; }
        peek = dir ? panelOf(neighbor(dir)) : null;
        peekDir = dir;
        if (peek) { peek.style.display = "block"; peek.style.willChange = "transform"; peek.style.transition = "none"; }
      }
      if (cur) cur.style.transform = `translateX(${offset}px)`;
      if (peek) peek.style.transform = `translateX(${offset + peekDir * width()}px)`;
    };
    const begin = () => {
      cur = panelOf(live.current.activeId);
      peek = null;
      peekDir = 0;
      if (cur) { cur.style.willChange = "transform"; cur.style.transition = "none"; }
    };
    // Finish the move: to the neighbour (dir) or back to where it started (0).
    const finish = (dir: number) => {
      const to = dir && peekDir === dir ? dir : 0;
      const next = to ? neighbor(to) : undefined;
      for (const el of [cur, peek]) if (el) el.style.transition = `transform ${DURATION}ms ${EASE}`;
      if (cur) cur.style.transform = `translateX(${-to * width()}px)`;
      if (peek) peek.style.transform = `translateX(${(peekDir - to) * width()}px)`;
      const leaving = cur, arriving = peek;
      if (next && leaving) {
        // Choose the tab now, keeping the old panel shown for the slide.
        holdRef.current = leaving.dataset.tabPanel ?? null;
        setHold(holdRef.current);
        live.current.onSelect(next);
        // A swipe right after this one continues from the new tab, even
        // before React has re-rendered.
        live.current = { ...live.current, activeId: next };
      }
      const clear = (el: HTMLElement | null) => { if (el) { el.style.transform = ""; el.style.transition = ""; el.style.willChange = ""; } };
      const done = () => {
        pending = null;
        if (next) {
          // Hide the old panel first, then drop the offsets, so it never
          // jumps back into view for a frame.
          holdRef.current = null;
          flushSync(() => setHold(null));
          if (leaving) leaving.style.display = "none";
          clear(leaving);
          clear(arriving);
        } else {
          if (arriving) arriving.style.display = "none";
          clear(arriving);
          clear(leaving);
        }
      };
      cur = null; peek = null; peekDir = 0;
      pending = { timer: window.setTimeout(done, DURATION), done };
    };

    // ── Touch ───────────────────────────────────────────────────────────────
    // Touch events, not pointer events: most widget bodies scroll vertically,
    // and inside a scroller the browser would claim a sideways drag and cancel
    // the pointer. A non-passive touchmove can tell it not to, once the
    // gesture is clearly sideways; a vertical one is left to scroll.
    let start: { x: number; y: number; t: number } | null = null;
    let locked = false;
    let dx = 0;
    let swallowClick = false;
    let frame = 0;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || blocked(e.target, root)) { start = null; return; }
      fastForward(); // a swipe during the last one's slide finishes it now
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: performance.now() };
      locked = false;
      dx = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) { if (locked) finish(0); start = null; locked = false; return; } // a pinch
      const t = e.touches[0];
      dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!locked) {
        if (Math.abs(dy) > LOCK && Math.abs(dy) >= Math.abs(dx)) { start = null; return; } // a scroll
        if (Math.abs(dx) < LOCK || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        locked = true;
        begin();
      }
      if (e.cancelable) e.preventDefault();
      const dir = dx < 0 ? 1 : -1;
      // Past the first or last tab it only gives a little, like a rubber band.
      const offset = neighbor(dir) ? dx : dx * 0.25;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => place(offset, neighbor(dir) ? dir : 0));
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const wasLocked = locked;
      const speed = Math.abs(dx) / Math.max(1, performance.now() - start.t);
      start = null;
      locked = false;
      if (!wasLocked) return;
      cancelAnimationFrame(frame);
      swallowClick = true; // the release ends a swipe, not a tap on what is under it
      window.setTimeout(() => { swallowClick = false; }, 350);
      const dir = dx < 0 ? 1 : -1;
      const commit = e.type === "touchend" && !!neighbor(dir) && (Math.abs(dx) > root.clientWidth * COMMIT || speed > FLICK);
      // The panels already sit where the last move put them, so the slide
      // and the choice of tab can start right away.
      place(neighbor(dir) ? dx : dx * 0.25, neighbor(dir) ? dir : 0);
      finish(commit ? dir : 0);
    };
    const onClick = (e: MouseEvent) => { if (swallowClick) { e.preventDefault(); e.stopPropagation(); } };

    // ── Trackpad ────────────────────────────────────────────────────────────
    // One sideways two-finger swipe plays the whole slide to the next tab.
    let acc = 0;
    let spent = false;
    let idle = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) || blocked(e.target, root)) return;
      window.clearTimeout(idle);
      idle = window.setTimeout(() => { acc = 0; spent = false; }, 160); // one gesture, one switch
      if (spent) return;
      fastForward();
      acc += e.deltaX;
      if (Math.abs(acc) < 70) return;
      spent = true;
      const dir = acc > 0 ? 1 : -1;
      if (!neighbor(dir)) return;
      begin();
      place(0, dir);
      requestAnimationFrame(() => finish(dir));
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
      cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return (
    // overscroll-x-contain: a sideways trackpad swipe never turns into the
    // browser's back gesture.
    <div ref={rootRef} className={`flex-1 min-h-0 relative overflow-hidden ${enabled ? "overscroll-x-contain" : ""}`}>
      {ids.map(id => (
        <div key={id} data-tab-panel={id} className="absolute inset-0" style={{ display: id === activeId || id === hold ? "block" : "none" }}>
          {render(id)}
        </div>
      ))}
    </div>
  );
}
