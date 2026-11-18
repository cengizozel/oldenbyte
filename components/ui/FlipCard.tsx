"use client";

import { createContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ColorClasses } from "@/lib/widgets";
import { useTabGroup } from "@/lib/tabGroup";
import { usePhone } from "@/lib/usePhone";
import PhoneSheet from "@/components/ui/PhoneSheet";

// Whether the face a component sits on is the one showing. The back face is
// always mounted (for the flip), so a settings face reads this to know when
// it is really open. Null outside a flip card: an overlay face is mounted
// only while open.
export const FaceShownContext = createContext<boolean | null>(null);

// On a phone the settings face opens in a sheet (below). The face puts its
// cancel here, so the sheet's handle and a tap outside can call it. Null when
// the face is on the back of the card.
export const SheetCancelContext = createContext<RefObject<(() => void) | null> | null>(null);

// A card can be made too small to hold its own settings (one row of a busy
// dashboard leaves a few pixels between the face's header and its save row).
// Below this height the face opens over the page instead, in the card's
// colors, and closes like any face: by its own row, Escape, or a click outside.
const FACE_MIN = 220;

function FaceWindow({ c, children, onClose, className = "" }: { c: ColorClasses; children: ReactNode; onClose: () => void; className?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  if (!ready) return null;
  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className={`relative w-[min(26rem,100%)] max-h-[min(34rem,calc(100dvh-2rem))] min-h-[16rem] flex flex-col gap-3 rounded-2xl border shadow-2xl p-5 overflow-hidden ${c.bg} ${c.border} ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

// The height of an element, kept current.
function useHeight<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setHeight(el.offsetHeight);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, height];
}

// The standard widget shell: rounded color card whose front face flips to a
// settings back face with a 3D rotateY transition. Extracted from the pattern
// previously duplicated across ten widgets.
export default function FlipCard({
  c,
  flipped,
  front,
  back,
  className = "",
  frontClassName = "",
  backClassName = "",
}: {
  c: ColorClasses;
  flipped: boolean;
  front: ReactNode;
  back: ReactNode;
  className?: string;
  frontClassName?: string;
  backClassName?: string;
}) {
  // In a tab group the tab row is the header and sits above the card, so the
  // front face drops its own top padding: the first content line then starts
  // at the same height as in a single widget. (The back face keeps it: the
  // row hides while a settings face is open.)
  const inGroup = !!useTabGroup();
  // A phone-width screen: the card does not turn over. Its settings rise in a
  // sheet over the dashboard, with the card's own colors, so they are as tall
  // as they need to be and not as small as the card.
  const phone = usePhone();
  const cancel = useRef<(() => void) | null>(null);
  // On a wide screen, a card too small for its face shows it over the page.
  const [cardRef, cardHeight] = useHeight<HTMLDivElement>();
  const outside = !phone && cardHeight > 0 && cardHeight < FACE_MIN;
  const turned = flipped && !phone && !outside;
  return (
    <div
      ref={cardRef}
      className={`rounded-2xl border h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}
      style={{ perspective: "1200px" }}
    >
      <div
        className="relative w-full h-full transition-transform duration-300 ease-in-out"
        style={{
          transformStyle: "preserve-3d",
          WebkitTransformStyle: "preserve-3d",
          transform: turned ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Each face is opaque (it must hide the other one mid-flip and when
            turned away) and sits one pixel inside the card, so its fill can
            never land on the card's border at fractional widths. The padding
            is 19px to keep content 20px from the card's edge. */}
        <div
          className={`absolute inset-px p-[19px] flex flex-col rounded-[15px] overflow-clip ${inGroup ? "!pt-0" : ""} ${c.bg} ${frontClassName}`}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            // The shown face inherits pointer events rather than forcing
            // them on, so edit mode's pass-through (presses fall to the
            // tile, which drags) reaches the content too.
            pointerEvents: turned ? "none" : undefined,
          }}
          // The hidden face stays in the DOM for the flip animation; inert keeps
          // it out of the tab order and the accessibility tree.
          inert={turned}
        >
          <FaceShownContext.Provider value={!turned}>{front}</FaceShownContext.Provider>
        </div>
        <div
          className={`absolute inset-px p-[19px] flex flex-col gap-3 rounded-[15px] overflow-clip ${c.bg} ${backClassName}`}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            pointerEvents: turned ? undefined : "none",
          }}
          inert={!turned}
        >
          {!phone && !outside && <FaceShownContext.Provider value={flipped}>{back}</FaceShownContext.Provider>}
        </div>
      </div>
      {outside && flipped && (
        <FaceWindow c={c} onClose={() => cancel.current?.()} className={backClassName}>
          <SheetCancelContext.Provider value={cancel}>
            <FaceShownContext.Provider value={true}>{back}</FaceShownContext.Provider>
          </SheetCancelContext.Provider>
        </FaceWindow>
      )}
      {phone && (
        <PhoneSheet open={flipped} onClose={() => cancel.current?.()} label="Settings" keepMounted className={`${c.bg} ${c.border} ${backClassName}`}>
          <SheetCancelContext.Provider value={cancel}>
            <FaceShownContext.Provider value={flipped}>{back}</FaceShownContext.Provider>
          </SheetCancelContext.Provider>
        </PhoneSheet>
      )}
    </div>
  );
}

// A face laid over a card for widgets that do not turn over (their front has
// to stay as it is behind the face: a board, a schedule, a running test). On
// a wide screen it covers the card. On a phone it rises in a sheet like every
// other settings face, so it has the room it needs and its save row is in
// reach (docs/mobile.md, Sheets). `layer` is its place in the card's stack.
export function OverlayFace({ c, children, layer = "z-30", className = "p-5", label = "Settings", inline = false }: {
  c: ColorClasses;
  children: ReactNode;
  layer?: string;
  className?: string;
  label?: string;
  // The face is part of the card's own flow on a wide screen (it replaces
  // the card's content), and only moves on a phone.
  inline?: boolean;
}) {
  const phone = usePhone();
  const cancel = useRef<(() => void) | null>(null);
  // The card this face lies over, to tell when it is too small for it.
  const probe = useRef<HTMLSpanElement | null>(null);
  const [small, setSmall] = useState(false);
  useLayoutEffect(() => {
    const card = probe.current?.closest(".rounded-2xl") as HTMLElement | null;
    if (card) setSmall(card.offsetHeight < FACE_MIN);
  }, []);
  if (phone) {
    return (
      <PhoneSheet open onClose={() => cancel.current?.()} label={label} className={`${c.bg} ${c.border}`}>
        <SheetCancelContext.Provider value={cancel}>
          <FaceShownContext.Provider value={true}>{children}</FaceShownContext.Provider>
        </SheetCancelContext.Provider>
      </PhoneSheet>
    );
  }
  if (small) {
    return (
      <>
        <span ref={probe} hidden />
        <FaceWindow c={c} onClose={() => cancel.current?.()}>
          <SheetCancelContext.Provider value={cancel}>
            <FaceShownContext.Provider value={true}>{children}</FaceShownContext.Provider>
          </SheetCancelContext.Provider>
        </FaceWindow>
      </>
    );
  }
  if (inline) return <><span ref={probe} hidden />{children}</>;
  return <div className={`absolute inset-px rounded-[15px] flex flex-col ${layer} ${className} ${c.bg}`}><span ref={probe} hidden />{children}</div>;
}
