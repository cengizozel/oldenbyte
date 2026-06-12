"use client";

import type { ReactNode } from "react";
import type { ColorClasses } from "@/lib/widgets";

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
        <div
          className={`absolute inset-0 p-5 flex flex-col rounded-2xl overflow-clip ${c.bg} ${frontClassName}`}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            pointerEvents: flipped ? "none" : "auto",
          }}
        >
          {front}
        </div>
        <div
          className={`absolute inset-0 p-5 flex flex-col gap-3 rounded-2xl overflow-clip ${c.bg} ${backClassName}`}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            pointerEvents: flipped ? "auto" : "none",
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
}
