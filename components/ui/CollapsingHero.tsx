"use client";

import { useEffect, useRef, useState, type ReactNode, type UIEvent, type WheelEvent, type TouchEvent } from "react";

// A widget whose body is one large figure (a ring with a number in it) above
// a list: Upkeep, Tracker. The figure is worth its room when the card is
// tall, and in the way when it is not, so it has two sizes:
//
//   large    the figure centered, its status line under it;
//   compact  the figure small at the left, its number and status beside it
//            on one row, and the list gets the rest.
//
// Compact is used when the card is short to begin with, and when the list is
// scrolled: scrolling down shrinks the figure and slides it left, so more of
// the list fits. Scrolling back to the top of the list brings it back. One
// case is different: when the list fits entirely once the figure has shrunk,
// there is no "top" to scroll back to (it is already there), and returning
// by itself would make the figure grow and shrink in turns. Then an upward
// scroll or pull at the top brings it back.

const COMPACT = 44;          // the figure's size when compact
const ROW = 48;              // the compact row's height
const SHORT_BODY = 300;      // a body shorter than this starts compact
const MOVE = "transition-[left,transform,opacity,height] duration-300 ease-out motion-reduce:transition-none";

export type HeroList = {
  onScroll: (e: UIEvent<HTMLElement>) => void;
  onWheel: (e: WheelEvent<HTMLElement>) => void;
  onTouchStart: (e: TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: TouchEvent<HTMLElement>) => void;
};

export default function CollapsingHero({ figure, size, summary, status, children }: {
  // The figure, drawn at `size`. It gets `compact` so it can leave out what
  // would be too small to read (the text inside a ring).
  figure: (compact: boolean) => ReactNode;
  size: number;
  // Beside the figure when compact: what its center said, at a readable size.
  summary: ReactNode;
  // One line: under the figure when large, after the summary when compact.
  status?: ReactNode;
  // The list. Spread the handlers on the element that scrolls.
  children: (list: HeroList) => ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [short, setShort] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const touchY = useRef(0);
  const collapsedAt = useRef(0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setShort(el.clientHeight < SHORT_BODY);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = short || scrolled;
  const list: HeroList = {
    onScroll: e => {
      const el = e.currentTarget;
      if (el.scrollTop > 16) { if (!scrolled) { collapsedAt.current = performance.now(); setScrolled(true); } return; }
      // Back at the top: the figure returns, as long as the list still has
      // more than fits (so it was scrolled back up, not pushed to the top by
      // growing) and the shrink has finished.
      if (scrolled && el.scrollTop <= 0 && el.scrollHeight > el.clientHeight + 1 && performance.now() - collapsedAt.current > 400) setScrolled(false);
    },
    onWheel: e => { if (e.deltaY < 0 && e.currentTarget.scrollTop <= 0) setScrolled(false); },
    onTouchStart: e => { touchY.current = e.touches[0]?.clientY ?? 0; },
    onTouchMove: e => { if ((e.touches[0]?.clientY ?? 0) - touchY.current > 24 && e.currentTarget.scrollTop <= 0) setScrolled(false); },
  };
  const largeHeight = size + (status ? 32 : 0);

  return (
    <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col gap-3">
      <div className={`relative shrink-0 ${MOVE}`} style={{ height: compact ? ROW : largeHeight }}>
        <div
          className={`absolute top-0 ${MOVE}`}
          style={{
            width: size, height: size,
            left: compact ? 0 : "50%",
            transformOrigin: "0 0",
            transform: compact ? `translateY(${(ROW - COMPACT) / 2}px) scale(${COMPACT / size})` : "translateX(-50%)",
          }}
        >
          {figure(compact)}
        </div>
        <div
          aria-hidden={!compact}
          className={`absolute top-0 right-0 flex items-center gap-2 min-w-0 ${MOVE} ${compact ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          style={{ left: COMPACT + 12, height: ROW }}
        >
          <span className="shrink-0 flex items-baseline gap-1.5">{summary}</span>
          {status && <span className="min-w-0 flex-1 truncate">{status}</span>}
        </div>
        {status && (
          <div
            aria-hidden={compact}
            className={`absolute left-0 right-0 flex justify-center ${MOVE} ${compact ? "opacity-0 pointer-events-none" : "opacity-100"}`}
            style={{ top: size + 8 }}
          >
            <span className="min-w-0 truncate px-2">{status}</span>
          </div>
        )}
      </div>
      {children(list)}
    </div>
  );
}
