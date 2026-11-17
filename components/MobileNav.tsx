"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogoGlyph } from "@/components/ui/WidgetChrome";
import Toggle from "@/components/ui/Toggle";
import { SettingsRow, SettingsSection } from "@/components/ui/Field";
import * as storage from "@/lib/storage";
import { MOBILE_JUMP_KEY, MOBILE_JUMP_EVENT } from "@/lib/dashboards";

// Phone navigation (docs/mobile.md): the floating jump button. The overview it
// opens lives in WidgetGrid, which owns the layout.

// A phone-width window. The layout bands in WidgetGrid follow the grid's own
// width; this follows the real viewport, which the overview needs because it
// lays the grid out wider than the screen.
export function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 599px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

export type JumpItem = { id: string; label: string; member: boolean };

type Pos = { side: "left" | "right"; y: number }; // y: fraction of the viewport height
const POS_KEY = "oldenbyte-jump-pos";
const SIZE = 48;
const MARGIN = 10;
const HOLD_MS = 260;   // press this long without moving: the name list opens
const MOVE_PX = 10;    // moving this far first: the button is being dragged
const DEAD_PX = 14;    // in the list, sliding less than this picks nothing

function loadPos(): Pos {
  try {
    const p = JSON.parse(window.localStorage.getItem(POS_KEY) ?? "null");
    if (p && (p.side === "left" || p.side === "right") && typeof p.y === "number") return { side: p.side, y: Math.min(1, Math.max(0, p.y)) };
  } catch {}
  return { side: "right", y: 0.72 };
}

// The floating button, like iOS AssistiveTouch:
// - tap: the overview (onTap);
// - drag: move it; it settles on the nearer side edge and remembers the spot;
// - hold: every widget's name appears in a column beside the thumb. Sliding
//   up or down picks the name level with the thumb (the contacts-index
//   gesture, so the name is beside the thumb and not under it), a tick is felt
//   per name where the phone can vibrate, and letting go jumps there. Letting
//   go without sliding, or after sliding well away sideways, cancels.
export function JumpButton({ items, overview, onTap, onJump }: {
  items: JumpItem[];
  overview: boolean;
  onTap: () => void;
  onJump: (id: string) => void;
}) {
  const [pos, setPos] = useState<Pos>({ side: "right", y: 0.72 });
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ index: number | null } | null>(null);
  const st = useRef({ pointer: -1, sx: 0, sy: 0, mode: "none" as "none" | "drag" | "menu", slid: false, timer: null as ReturnType<typeof setTimeout> | null });
  const latest = useRef({ items, onTap, onJump });
  useEffect(() => { latest.current = { items, onTap, onJump }; });

  useEffect(() => {
    setPos(loadPos());
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  if (!vp.w) return null;

  const cx = drag ? drag.x : pos.side === "left" ? MARGIN + SIZE / 2 : vp.w - MARGIN - SIZE / 2;
  const cy = drag ? drag.y : Math.min(vp.h - SIZE / 2 - 12, Math.max(SIZE / 2 + 12, pos.y * vp.h));

  // The name column: beside the button, centered on it, kept on screen. Rows
  // shrink (to a floor) when there are more names than fit.
  const n = items.length;
  const rowH = Math.max(22, Math.min(36, Math.floor((vp.h - 24) / Math.max(1, n))));
  const listH = n * rowH;
  const listTop = Math.min(Math.max(12, vp.h - listH - 12), Math.max(12, cy - listH / 2));
  const listW = Math.min(250, vp.w - (MARGIN + SIZE + 10) - 12);

  function indexAt(x: number, y: number): number | null {
    const s = st.current;
    if (!s.slid && Math.abs(y - s.sy) < DEAD_PX) return null;
    s.slid = true;
    if (Math.abs(x - cx) > listW + 70) return null; // slid away sideways: cancel
    const i = Math.floor((y - listTop) / rowH);
    return i >= 0 && i < n ? i : null;
  }

  function clearTimer() {
    const s = st.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (st.current.pointer !== -1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = st.current;
    s.pointer = e.pointerId; s.sx = e.clientX; s.sy = e.clientY; s.mode = "none"; s.slid = false;
    clearTimer();
    s.timer = setTimeout(() => {
      s.timer = null;
      if (s.mode !== "none" || !latest.current.items.length) return;
      s.mode = "menu";
      setMenu({ index: null });
      try { navigator.vibrate?.(10); } catch {}
    }, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const s = st.current;
    if (e.pointerId !== s.pointer) return;
    if (s.mode === "none" && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > MOVE_PX) {
      clearTimer();
      s.mode = "drag";
    }
    if (s.mode === "drag") {
      setDrag({
        x: Math.min(vp.w - SIZE / 2, Math.max(SIZE / 2, e.clientX)),
        y: Math.min(vp.h - SIZE / 2, Math.max(SIZE / 2, e.clientY)),
      });
    } else if (s.mode === "menu") {
      const index = indexAt(e.clientX, e.clientY);
      setMenu(m => {
        if (m && m.index === index) return m;
        if (index !== null) { try { navigator.vibrate?.(6); } catch {} }
        return { index };
      });
    }
  }

  function onPointerEnd(e: React.PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const s = st.current;
    if (e.pointerId !== s.pointer) return;
    clearTimer();
    const mode = s.mode;
    s.pointer = -1; s.mode = "none";
    if (mode === "drag") {
      const next: Pos = { side: e.clientX < vp.w / 2 ? "left" : "right", y: Math.min(1, Math.max(0, e.clientY / vp.h)) };
      setPos(next);
      setDrag(null);
      try { window.localStorage.setItem(POS_KEY, JSON.stringify(next)); } catch {}
      return;
    }
    if (mode === "menu") {
      const index = cancelled ? null : indexAt(e.clientX, e.clientY);
      setMenu(null);
      const item = index !== null ? latest.current.items[index] : null;
      if (item) latest.current.onJump(item.id);
      return;
    }
    if (!cancelled) latest.current.onTap();
  }

  const active = !!menu || !!drag || overview;
  return createPortal(
    <>
      {menu && (
        <>
          <div aria-hidden className="fixed inset-0 z-[34] bg-black/25 pointer-events-none" />
          <ul
            aria-hidden
            className="fixed z-[35] m-0 p-0 list-none pointer-events-none rounded-2xl overflow-hidden shadow-2xl border border-[var(--surface-border)] bg-[var(--surface)]"
            style={{
              top: listTop,
              width: listW,
              ...(pos.side === "right" ? { right: MARGIN + SIZE + 10 } : { left: MARGIN + SIZE + 10 }),
            }}
          >
            {items.map((it, i) => {
              const on = menu.index === i;
              return (
                <li
                  key={it.id}
                  style={{ height: rowH }}
                  className={`flex items-center gap-2 px-3 text-sm ${it.member ? "pl-6" : ""} ${
                    on ? "bg-[var(--text-primary)] text-[var(--surface)] font-medium" : it.member ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]"
                  }`}
                >
                  <span className="truncate">{it.label}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button
        type="button"
        aria-label={overview ? "Close the overview. Hold and slide to jump to a widget." : "Open the overview. Hold and slide to jump to a widget."}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={e => onPointerEnd(e, false)}
        onPointerCancel={e => onPointerEnd(e, true)}
        onContextMenu={e => e.preventDefault()}
        className={`fixed z-[36] rounded-full flex items-center justify-center border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-primary)] shadow-lg select-none touch-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] ${
          drag ? "" : "transition-[left,top,opacity,scale] duration-200 ease-out"
        } ${active ? "opacity-100" : "opacity-60"} ${menu ? "scale-110" : ""}`}
        style={{ left: cx - SIZE / 2, top: cy - SIZE / 2, width: SIZE, height: SIZE }}
      >
        <LogoGlyph size={22} />
      </button>
    </>,
    document.body,
  );
}

// Settings > Phone.
export function PhoneSettings() {
  const [on, setOn] = useState(true);
  useEffect(() => { storage.getItem(MOBILE_JUMP_KEY).then(v => setOn(v !== "0")); }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    storage.setItem(MOBILE_JUMP_KEY, next ? "1" : "0");
    window.dispatchEvent(new CustomEvent(MOBILE_JUMP_EVENT, { detail: next }));
  };
  return (
    <SettingsSection title="Phone">
      <SettingsRow label="Jump button" hint="A floating button on phones. Tap for the overview of the whole dashboard; hold and slide to jump to a widget; drag to move it.">
        <Toggle checked={on} onChange={toggle} label="Jump button" />
      </SettingsRow>
    </SettingsSection>
  );
}
