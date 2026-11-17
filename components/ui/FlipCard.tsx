"use client";

import { createContext, useRef, type ReactNode, type RefObject } from "react";
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
  const turned = flipped && !phone;
  return (
    <div
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
          {!phone && <FaceShownContext.Provider value={flipped}>{back}</FaceShownContext.Provider>}
        </div>
      </div>
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
