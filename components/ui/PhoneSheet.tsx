"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The sheet that rises from the bottom of a phone-width screen
// (docs/mobile.md, Sheets): settings open in it instead of inside a card, so
// they get the room they need, not the card's. It is as tall as its content,
// up to just under the page title, and scrolls inside past that. Dragging the
// handle down, or a tap outside, asks to close (onClose), which the content
// treats as cancel.
//
// It stays mounted while closed (off screen and inert) when keepMounted is
// set, like a flip card's back face, so content that holds state keeps it.

let locks = 0;
function lockScroll(on: boolean) {
  locks += on ? 1 : -1;
  document.documentElement.style.overflow = locks > 0 ? "hidden" : "";
}

const CLOSE_PX = 90; // dragged this far down: close

export default function PhoneSheet({ open, onClose, label, className = "", keepMounted = false, children }: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string; // the fill and text color
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [dragY, setDragY] = useState<number | null>(null);
  const start = useRef(0);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    if (!open) return;
    lockScroll(true);
    return () => lockScroll(false);
  }, [open]);

  if (!ready || (!open && !keepMounted)) return null;

  const handle = {
    onTouchStart: (e: React.TouchEvent) => { start.current = e.touches[0].clientY; setDragY(0); },
    onTouchMove: (e: React.TouchEvent) => setDragY(Math.max(0, e.touches[0].clientY - start.current)),
    onTouchEnd: () => { const y = dragY ?? 0; setDragY(null); if (y > CLOSE_PX) onClose(); },
    onTouchCancel: () => setDragY(null),
  };

  return createPortal(
    <div className={`fixed inset-0 z-[65] ${open ? "" : "pointer-events-none"}`} inert={!open}>
      <div
        aria-hidden
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`ob-sheet absolute left-0 right-0 bottom-0 flex flex-col rounded-t-[20px] border-t border-x shadow-2xl max-h-[calc(100dvh-64px)] min-h-[32dvh] ${
          dragY === null ? "transition-transform duration-250 ease-out" : ""
        } ${className}`}
        style={{
          transform: open ? `translateY(${dragY ?? 0}px)` : "translateY(105%)",
          visibility: open || dragY !== null ? undefined : "hidden",
          transitionProperty: dragY === null ? "transform, visibility" : undefined,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div {...handle} className="shrink-0 pt-2.5 pb-2 touch-none" aria-hidden>
          <div className="mx-auto w-10 h-1 rounded-full bg-current opacity-30" />
        </div>
        <div className="flex-1 min-h-0 flex flex-col gap-3 px-5 pb-5 overflow-hidden">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
