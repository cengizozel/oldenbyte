"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Full-viewport image viewer: scroll wheel or pinch to zoom, drag to pan when
// zoomed, double-click to toggle, Escape / X / backdrop click to leave.
export default function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale(s => Math.min(6, Math.max(1, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => { if (scale === 1) setPos({ x: 0, y: 0 }); }, [scale]);

  const dist = () => {
    const pts = [...pointers.current.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  return createPortal(
    <div
      ref={wrapRef}
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center touch-none overscroll-contain"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onPointerDown={e => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) pinchStart.current = { dist: dist(), scale };
        else if (scale > 1) drag.current = { x: pos.x, y: pos.y, px: e.clientX, py: e.clientY };
      }}
      onPointerMove={e => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2 && pinchStart.current) {
          setScale(Math.min(6, Math.max(1, pinchStart.current.scale * (dist() / pinchStart.current.dist))));
        } else if (drag.current) {
          setPos({ x: drag.current.x + e.clientX - drag.current.px, y: drag.current.y + e.clientY - drag.current.py });
        }
      }}
      onPointerUp={e => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinchStart.current = null;
        if (pointers.current.size === 0) drag.current = null;
      }}
      onPointerCancel={e => {
        pointers.current.delete(e.pointerId);
        pinchStart.current = null;
        drag.current = null;
      }}
      onDoubleClick={() => setScale(s => (s > 1 ? 1 : 2.5))}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="attachment"
        draggable={false}
        className="max-w-[92vw] max-h-[92vh] select-none rounded-lg shadow-2xl"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          cursor: scale > 1 ? "grab" : "zoom-in",
          transition: pinchStart.current || drag.current ? "none" : "transform 120ms",
        }}
      />
      <button onClick={onClose} title="Close" className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20">
        <X size={18} />
      </button>
    </div>,
    document.body
  );
}
