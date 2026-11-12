"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

// The body of a tab group: one panel per tab, the active one shown, and a
// sideways swipe to the neighbouring tab, the way a phone's photo viewer pages.
//
// What makes it feel stuck to the finger:
// - The tabs on either side of the shown one are kept laid out, off to the
//   side and hidden (inert, so nothing can focus or click them), so a swipe
//   only reveals what is already there instead of building it mid-gesture.
// - The content moves in the same event as the finger, no frame later, and
//   from the moment the gesture is recognised, with no jump.
// - On release the speed is the finger's last ~80ms, not the average, and the
//   finishing slide starts at that speed and decelerates into place, its
//   length set by the distance left, so a flick stays a flick.
// On release the tab is chosen at once (the tab row's underline sets off with
// the slide) while the old panel stays on screen until the slide ends. A
// trackpad's two-finger sideways swipe plays the same slide; a mouse drag
// never swipes, since on a computer that gesture selects text and drags.
// Choosing a tab in the tab row stays an instant switch.
//
// A swipe never starts on something that uses the gesture itself: text
// fields, editors, sliders, canvases, video, draggable items, anything that
// scrolls sideways, and any element marked data-no-swipe (the chess board, the
// schedule grid, a reading surface, a chart you scrub). Custom widgets run in
// their own frame, so their gestures never reach this at all.

const BLOCK = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], canvas, video, [draggable="true"], [data-no-swipe]';
const LOCK = 10;          // px of movement before deciding the direction
const COMMIT = 0.3;       // share of the width that switches on release
const FLICK = 0.35;       // px/ms toward a neighbour that switches whatever the distance
const GAP = 12;           // px between neighbouring panels
const VELOCITY_WINDOW = 80; // ms of finger movement that set the release speed

function blocked(target: EventTarget | null, root: Element): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(BLOCK)) return true;
  for (let n: Element | null = target; n && n !== root; n = n.parentElement) {
    const x = getComputedStyle(n).overflowX;
    if ((x === "auto" || x === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Lay the panels out for the shown tab: it in place, its neighbours ready off
// to either side (hidden and inert), the rest not rendered at all.
function arrange(root: HTMLElement | null, list: string[], activeId: string, enabled: boolean) {
  if (!root) return;
  const i = list.indexOf(activeId);
  root.querySelectorAll<HTMLElement>("[data-tab-panel]").forEach(p => {
    const k = list.indexOf(p.dataset.tabPanel ?? "");
    const side = enabled && i >= 0 && Math.abs(k - i) === 1 ? Math.sign(k - i) : 0;
    p.style.transition = "";
    p.style.willChange = "";
    if (k === i) {
      p.style.display = "block";
      p.style.transform = "";
      p.style.visibility = "";
      p.removeAttribute("inert");
      delete p.dataset.offstage;
    } else if (side) {
      p.style.display = "block";
      p.style.transform = `translateX(calc(${side * 100}% + ${side * GAP}px))`;
      p.style.visibility = "hidden";
      p.setAttribute("inert", "");
      p.dataset.offstage = "";
    } else {
      p.style.display = "none";
      p.style.transform = "";
      p.style.visibility = "";
      p.removeAttribute("inert");
      delete p.dataset.offstage;
    }
  });
}

export default function TabPanels({ ids, activeId, onSelect, enabled, render }: {
  ids: string[];
  activeId: string;
  onSelect: (id: string) => void;
  enabled: boolean;
  render: (id: string) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const live = useRef({ ids, activeId, onSelect, enabled });
  useEffect(() => { live.current = { ids, activeId, onSelect, enabled }; });

  // The tab a finishing swipe is sliding away from: kept on screen until the
  // slide ends, though the new tab is already the chosen one.
  const [hold, setHold] = useState<string | null>(null);
  const holdRef = useRef<string | null>(null);

  // After any switch, before the browser paints. Not while a swipe slides.
  const idsKey = ids.join("|");
  useLayoutEffect(() => {
    live.current = { ids, activeId, onSelect, enabled };
    if (!holdRef.current) arrange(rootRef.current, ids, activeId, enabled);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, enabled, idsKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    const neighbor = (dir: number) => {
      const { ids: list, activeId: cur } = live.current;
      return list[list.indexOf(cur) + dir];
    };
    const panelOf = (id: string | undefined) => (id ? root.querySelector<HTMLElement>(`[data-tab-panel="${CSS.escape(id)}"]`) : null);
    const span = () => root.clientWidth + GAP;

    let cur: HTMLElement | null = null;
    let before: HTMLElement | null = null; // the tab to the left
    let after: HTMLElement | null = null;  // the tab to the right
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

    const begin = () => {
      cur = panelOf(live.current.activeId);
      before = panelOf(neighbor(-1));
      after = panelOf(neighbor(1));
      for (const el of [cur, before, after]) {
        if (!el) continue;
        el.style.transition = "none";
        el.style.willChange = "transform";
      }
      for (const el of [before, after]) if (el) { el.style.visibility = "visible"; el.style.display = "block"; }
    };
    const place = (offset: number) => {
      const w = span();
      if (cur) cur.style.transform = `translateX(${offset}px)`;
      if (before) before.style.transform = `translateX(${offset - w}px)`;
      if (after) after.style.transform = `translateX(${offset + w}px)`;
    };
    // Finish the move from `offset`: to the neighbour in `to` (1 or -1) or
    // back (0), starting at `speed` px/ms and decelerating into place.
    const finish = (offset: number, to: number, speed: number) => {
      const w = span();
      const target = -to * w;
      const remaining = Math.abs(target - offset);
      const v = Math.max(Math.abs(speed), 0.6);
      // Twice distance over speed is what a curve that starts at that speed
      // and eases to a stop takes; clamped so nothing crawls or snaps.
      const ms = Math.round(clamp((2 * remaining) / v, to ? 180 : 160, to ? 380 : 300));
      const ease = "cubic-bezier(0.25, 0.6, 0.3, 1)";
      const next = to ? neighbor(to) : undefined;
      for (const el of [cur, before, after]) if (el) el.style.transition = `transform ${ms}ms ${ease}`;
      if (cur) cur.style.transform = `translateX(${target}px)`;
      if (before) before.style.transform = `translateX(${target - w}px)`;
      if (after) after.style.transform = `translateX(${target + w}px)`;
      const leaving = cur;
      if (next && leaving) {
        // Choose the tab now, keeping the old panel shown for the slide.
        holdRef.current = leaving.dataset.tabPanel ?? null;
        setHold(holdRef.current);
        live.current.onSelect(next);
        // A swipe right after this one continues from the new tab, even
        // before React has re-rendered.
        live.current = { ...live.current, activeId: next };
      }
      const done = () => {
        pending = null;
        if (next) {
          holdRef.current = null;
          flushSync(() => setHold(null));
        }
        const { ids: list, activeId: shown, enabled: on } = live.current;
        arrange(root, list, shown, on); // shown tab in place, its new neighbours ready
      };
      cur = null; before = null; after = null;
      pending = { timer: window.setTimeout(done, ms), done };
    };

    // ── Touch ───────────────────────────────────────────────────────────────
    // Touch events, not pointer events: most widget bodies scroll vertically,
    // and inside a scroller the browser would claim a sideways drag and cancel
    // the pointer. A non-passive touchmove can tell it not to, once the
    // gesture is clearly sideways; a vertical one is left to scroll.
    let start: { x: number; y: number } | null = null;
    let origin = 0;           // finger x where the swipe was recognised
    let locked = false;
    let offset = 0;
    let samples: { t: number; x: number }[] = [];
    let swallowClick = false;

    const offsetFor = (dx: number) => {
      // Past the first or last tab it only gives a little, like a rubber band.
      const dir = dx < 0 ? 1 : -1;
      return neighbor(dir) ? dx : dx * 0.25;
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || blocked(e.target, root)) { start = null; return; }
      fastForward(); // a swipe during the last one's slide finishes it now
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      locked = false;
      offset = 0;
      samples = [{ t: e.timeStamp, x: t.clientX }];
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) { if (locked) finish(offset, 0, 0); start = null; locked = false; return; } // a pinch
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!locked) {
        if (Math.abs(dy) > LOCK && Math.abs(dy) >= Math.abs(dx)) { start = null; return; } // a scroll
        if (Math.abs(dx) < LOCK || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        locked = true;
        origin = t.clientX; // the content starts here, so it never jumps
        begin();
      }
      if (e.cancelable) e.preventDefault();
      samples.push({ t: e.timeStamp, x: t.clientX });
      while (samples.length > 2 && e.timeStamp - samples[0].t > VELOCITY_WINDOW) samples.shift();
      offset = offsetFor(t.clientX - origin);
      place(offset);
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const wasLocked = locked;
      start = null;
      locked = false;
      if (!wasLocked) return;
      swallowClick = true; // the release ends a swipe, not a tap on what is under it
      window.setTimeout(() => { swallowClick = false; }, 350);
      const first = samples[0], last = samples[samples.length - 1];
      const speed = last && first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0; // px/ms, signed
      const dir = offset < 0 ? 1 : -1;
      const towards = speed * -dir > 0; // still moving toward the neighbour
      const commit = e.type === "touchend" && !!neighbor(dir) &&
        ((Math.abs(offset) > root.clientWidth * COMMIT && speed * dir <= FLICK) || (towards && Math.abs(speed) > FLICK));
      finish(offset, commit ? dir : 0, commit ? speed : 0);
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
      place(0);
      requestAnimationFrame(() => finish(0, dir, 2));
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
      fastForward();
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
