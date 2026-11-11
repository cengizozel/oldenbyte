"use client";

import { createContext, type ReactNode } from "react";
import type { ColorClasses } from "@/lib/widgets";
import { useTabGroup } from "@/lib/tabGroup";

// Whether the face a component sits on is the one showing. The back face is
// always mounted (for the flip), so a settings face reads this to know when
// it is really open. Null outside a flip card: an overlay face is mounted
// only while open.
export const FaceShownContext = createContext<boolean | null>(null);

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
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* The faces carry no fill of their own (the card behind them has it):
            a filled 3D layer can land a fraction of a pixel wide at some card
            widths and paint over the card's right border. */}
        <div
          className={`absolute inset-0 p-5 flex flex-col rounded-2xl overflow-clip ${inGroup ? "!pt-0" : ""} ${frontClassName}`}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            pointerEvents: flipped ? "none" : "auto",
          }}
          // The hidden face stays in the DOM for the flip animation; inert keeps
          // it out of the tab order and the accessibility tree.
          inert={flipped}
        >
          <FaceShownContext.Provider value={!flipped}>{front}</FaceShownContext.Provider>
        </div>
        <div
          className={`absolute inset-0 p-5 flex flex-col gap-3 rounded-2xl overflow-clip ${backClassName}`}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            pointerEvents: flipped ? "auto" : "none",
          }}
          inert={!flipped}
        >
          <FaceShownContext.Provider value={flipped}>{back}</FaceShownContext.Provider>
        </div>
      </div>
    </div>
  );
}
