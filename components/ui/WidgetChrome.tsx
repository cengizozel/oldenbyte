"use client";

import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { FaceShownContext } from "./FlipCard";
import { createPortal } from "react-dom";
import { useTabGroup } from "@/lib/tabGroup";
import { useT } from "@/lib/useT";
import { useWidgetFrame } from "@/lib/widgetFrame";
import { Plus, Check, X, RotateCcw, Loader, RefreshCw, ChevronLeft, Maximize2, Minimize2, SlidersHorizontal, type LucideIcon, Palette } from "lucide-react";
import { colorMap, type ColorClasses, type WidgetColor } from "@/lib/widgets";
import { currentTheme, THEME_EVENT } from "@/lib/theme";
import { FOCUS_RING, HIT_AREA, SettingsInput } from "./Field";

// Small shared pieces of widget chrome: the hover pencil, scroll fades, the
// loading spinner, empty-state copy, and the settings save/cancel row.

// Settings entry point. Hidden until the card is hovered or the button gets
// keyboard focus (always visible on touch devices), matching the pattern every
// widget previously inlined.
// The one settings control, drawn by WidgetHeader for every widget that has a
// settings face (its `onSettings`), at the far right after full screen: same icon, same
// spot, found by the keyboard layer through data-widget-settings.
export function SettingsButton({ c, onClick }: { c: ColorClasses; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("common.settings")}
      aria-label={t("common.settings")}
      data-widget-settings
      className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
    >
      <SlidersHorizontal size={14} />
    </button>
  );
}

// Force-refresh for feed widgets: the server caches feeds (admin-set TTL) and
// serves pages from that cache; this button asks for a real upstream fetch now.
export function RefreshButton({ c, onClick, busy }: { c: ColorClasses; onClick: () => void; busy?: boolean }) {
  const t = useT();
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={t("common.refreshNow")}
      aria-label={t("common.refreshNow")}
      data-widget-refresh
      className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 disabled:opacity-40 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
    >
      <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
    </button>
  );
}

// Gradient overlays for scrollable lists; pair with useScrollFade().
// The back control of a detail view. It sits on the left of the first block
// (the thumbnail, or the title when there is none) and stretches to its
// height, so on a phone it is a large target rather than a 14px chevron.
export function BackButton({ c, onClick, label = "Back to list" }: { c: ColorClasses; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`shrink-0 self-stretch min-h-9 w-9 rounded-xl flex items-center justify-center bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-colors ${c.label} ${FOCUS_RING}`}
    >
      <ChevronLeft size={16} />
    </button>
  );
}

export function ScrollFades({ c, top, bottom }: { c: ColorClasses; top: boolean; bottom: boolean }) {
  return (
    <>
      {top && <div className={`absolute top-0 left-0 right-0 h-12 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />}
      {bottom && <div className={`absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />}
    </>
  );
}

export function LoadingState({ c }: { c: ColorClasses }) {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
    </div>
  );
}

// Standard empty-state copy, one style everywhere: centered in the widget
// body, lowercase, no trailing punctuation. Pass `action` for the canonical
// the action phrase alone ("add bookmarks"), or children for custom
// copy (which should follow the same casing rules).
export function EmptyState({ c, action, children }: { c: ColorClasses; action?: string; children?: ReactNode }) {
  return (
    <div className="flex-1 h-full min-h-0 flex items-center justify-center text-center px-4">
      <p className={`text-sm opacity-70 ${c.text}`}>
        {children ?? action}
      </p>
    </div>
  );
}

// Bottom row of a settings face: reset on the left (back to defaults, asked
// first), cancel and save on the right. Real 28px buttons on a fill, 16px
// glyphs, so they read as the face's actions and not as stray marks.
const FACE_BUTTON = `w-7 h-7 flex items-center justify-center rounded-lg transition-colors bg-black/5 dark:bg-white/10 ${FOCUS_RING}`;
export function SaveCancelRow({
  c,
  onSave,
  onCancel,
  onReset,
  saving = false,
  saveDisabled = false,
}: {
  c: ColorClasses;
  onSave: () => void;
  onCancel: () => void;
  onReset?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
}) {
  // Reset is destructive, so it asks first: the icon turns into a short
  // question with a confirming button, and disarms by itself.
  const t = useT();
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 5000);
    return () => clearTimeout(t);
  }, [confirmReset]);
  return (
    <div className="flex items-center justify-between gap-3 mt-auto min-h-6">
      {onReset ? (
        confirmReset ? (
          <span className={`flex items-center gap-2 text-sm min-w-0 ${c.label}`}>
            <span className="opacity-70 truncate">{t("common.resetQuestion")}</span>
            <button type="button" onClick={() => { setConfirmReset(false); onReset(); }} className={`shrink-0 h-7 px-2.5 rounded-lg text-sm font-medium bg-black/10 dark:bg-white/15 text-red-600 dark:text-red-400 hover:bg-black/15 dark:hover:bg-white/20 ${FOCUS_RING}`}>{t("common.reset")}</button>
            <button type="button" onClick={() => setConfirmReset(false)} className={`shrink-0 h-7 px-2.5 rounded-lg text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 ${FOCUS_RING}`}>{t("common.keep")}</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} className={`${FACE_BUTTON} ${c.label} opacity-70 hover:opacity-100`} title={t("common.backToDefaults")} aria-label={t("common.backToDefaults")}>
            <RotateCcw size={16} />
          </button>
        )
      ) : <span />}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} title={t("common.cancel")} aria-label={t("common.cancel")} data-face-cancel className={`${FACE_BUTTON} ${c.label} opacity-70 hover:opacity-100`}>
          <X size={16} />
        </button>
        <button type="button" onClick={onSave} disabled={saving || saveDisabled} title={t("common.save")} aria-label={t("common.save")} data-face-save className={`${FACE_BUTTON} bg-black/10 dark:bg-white/15 hover:bg-black/15 dark:hover:bg-white/20 ${c.text} disabled:opacity-40`}>
          {saving ? <Loader size={16} className="animate-spin" /> : <Check size={16} />}
        </button>
      </div>
    </div>
  );
}

// The one widget header: icon, title, and a right-hand slot for counts and
// small actions (docs/design.md). In a tab group it renders into the tab row
// instead, see lib/tabGroup.ts. `after` renders inline after the title, for
// a badge such as the arXiv category.
// ── The header ───────────────────────────────────────────────────────────────
// Every widget header, single or in a tab group, reads the same way: the
// widget's identity (icon and name, or the tabs) on the left and one toggle
// at the right end, the same glyph everywhere. The toggle swaps the identity
// for the widget's options in the same row (its `after` and `right` content,
// then a full-screen button every widget gets from the grid), and back. So
// nothing else sits in a header by default: no always-on buttons, nothing
// hover-only, no status text. Once the options are asked for, hover-only
// buttons (the `opacity-0 group-hover:` chrome) show in full. In layout edit
// mode the same toggle swaps in the tile's controls (move, group, remove)
// instead, so every operation on a tile is in the one place.

// The two faces of a header row and how they trade places.
// A widget's own header options, in a row that can be narrower than they
// are: they scroll sideways (finger, trackpad, mouse wheel, or a mouse drag
// that carries on a little after letting go, like the tab row), with a
// soft fade at an edge that has more, and stay right-aligned when they fit.
// The standard options after them (color, full screen, settings) sit outside
// it, pinned, so they never scroll out of reach.
export function OptionsScroller({ start, end, className = "" }: { start?: ReactNode; end?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 };
      setEdges(e => (e.left === next.left && e.right === next.right ? e : next));
    };
    // Most mice have no sideways wheel: an up or down turn scrolls the row
    // when it has more to show that way.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
      if (next === el.scrollLeft) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    // A mouse drag scrolls the row and does not press the button it started
    // on; letting go mid-drag keeps it gliding and slowing to a stop.
    let drag: { x: number; left: number; moved: boolean; id: number } | null = null;
    let samples: { t: number; x: number }[] = [];
    let glide = 0;
    let swallow = false;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
      cancelAnimationFrame(glide);
      drag = { x: e.clientX, left: el.scrollLeft, moved: false, id: e.pointerId };
      samples = [{ t: e.timeStamp, x: e.clientX }];
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved) {
        if (Math.abs(dx) < 5) return;
        drag.moved = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* moves still arrive over the row */ }
      }
      el.scrollLeft = drag.left - dx;
      samples.push({ t: e.timeStamp, x: e.clientX });
      while (samples.length > 2 && e.timeStamp - samples[0].t > 80) samples.shift();
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      if (!moved) return;
      swallow = true;
      window.setTimeout(() => { swallow = false; }, 0);
      // Glide only if the pointer was still moving when it let go: speed from
      // the last 80ms before the release, nothing if it had paused, capped.
      const recent = samples.filter(p => e.timeStamp - p.t <= 80);
      const a = recent[0], b = recent[recent.length - 1];
      let v = recent.length >= 2 && b.t > a.t ? -(b.x - a.x) / (b.t - a.t) : 0; // px/ms in scroll direction
      v = Math.max(-2, Math.min(2, v));
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.max(0, now - last);
        last = now;
        if (Math.abs(v) < 0.02) return;
        el.scrollLeft += v * dt;
        v *= Math.pow(0.995, dt); // friction
        glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    };
    const onClick = (e: MouseEvent) => { if (swallow) { e.preventDefault(); e.stopPropagation(); } };

    measure();
    el.addEventListener("scroll", measure, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("click", onClick, true);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClick, true);
      cancelAnimationFrame(glide);
      ro.disconnect();
    };
  }, []);
  const fade = 16;
  const mask = edges.left || edges.right
    ? `linear-gradient(to right, ${edges.left ? "transparent" : "black"}, black ${fade}px, black calc(100% - ${fade}px), ${edges.right ? "transparent" : "black"})`
    : undefined;
  return (
    <div
      ref={ref}
      className={`flex-1 min-w-0 flex overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {/* At least the row's width, so while everything fits the header
          content stays left and the widget's buttons right; wider than that,
          the row scrolls from its start. The padding leaves room for the
          buttons' enlarged hit areas and focus rings. */}
      <div className="min-w-full w-max shrink-0 flex items-center gap-2 px-1.5 py-1">
        {start}
        {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
      </div>
    </div>
  );
}

export const HEADER_SWAP = {
  main: "transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none",
  mainHidden: "opacity-0 -translate-x-2 pointer-events-none",
  pane: "absolute inset-0 flex items-center gap-2 min-w-0 transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none [&_.opacity-0:not(:hover)]:!opacity-90 dark:[&_.opacity-0:not(:hover)]:!opacity-70",
  paneHidden: "opacity-0 translate-x-2 pointer-events-none",
};

// The oldenbyte mark (public/logo.svg) reduced to one color and 16px: the
// dashed rounded square with the solid square inside, in the header's label
// color. The toggle wears it on every widget, so the brand is the one piece
// of chrome every header shares.
export function LogoGlyph({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2.2" />
      <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1.5" fill="currentColor" />
    </svg>
  );
}

// The toggle: the mark, which turns into a close cross with a turn and a
// fade. 24px tall in a 20px header line, so it takes no extra height.
export function HeaderToggle({ c, open, onToggle, className = "" }: { c: ColorClasses; open: boolean; onToggle: () => void; className?: string }) {
  const face = "absolute inset-0 transition-[opacity,rotate,scale] duration-200 ease-out motion-reduce:transition-none";
  const t = useT();
  return (
    <button
      type="button"
      aria-expanded={open}
      data-header-toggle
      aria-label={open ? t("common.closeOptions") : t("common.options")}
      title={open ? t("common.closeOptions") : t("common.options")}
      onMouseDown={e => e.stopPropagation()}
      onClick={onToggle}
      className={`shrink-0 w-6 h-6 -my-0.5 flex items-center justify-center rounded-md transition-opacity ${c.label} ${FOCUS_RING} ${open ? "opacity-100" : "opacity-70 hover:opacity-100"} ${className}`}
    >
      <span className="relative block w-4 h-4" aria-hidden>
        <LogoGlyph className={`${face} ${open ? "opacity-0 rotate-45 scale-75" : "opacity-100 rotate-0 scale-100"}`} />
        <X size={16} className={`${face} ${open ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-45 scale-75"}`} />
      </span>
    </button>
  );
}

// Between a widget's own actions and the pair every widget has (settings,
// full screen): a hairline with a little air, so the eye splits the two.
export function HeaderDivider({ c }: { c: ColorClasses }) {
  return <span aria-hidden className={`w-px h-4 mx-1 shrink-0 bg-current opacity-25 ${c.label}`} />;
}

// The palette picker: a third common action, left of full screen, in the
// light and dark themes (grey draws every widget in the neutral palette, so
// there is nothing to pick). A widget stores only its palette's name; each
// theme defines that palette's colors, so a choice carries across themes.
const PALETTES: WidgetColor[] = ["neutral", "amber", "orange", "rose", "sky", "teal"];
export function ColorButton({ c, widgetId }: { c: ColorClasses; widgetId?: string }) {
  const frame = useWidgetFrame();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<string>("light");
  useEffect(() => {
    setTheme(currentTheme());
    const on = (e: Event) => setTheme((e as CustomEvent<string>).detail);
    window.addEventListener(THEME_EVENT, on);
    return () => window.removeEventListener(THEME_EVENT, on);
  }, []);
  const id = widgetId ?? frame?.widgetId;
  if (!frame?.setColor || !id || theme === "grey") return null;
  const current = frame.colorOf?.(id);
  return (
    <span className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title={t("common.color")}
        aria-label={t("common.color")}
        className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
      >
        <Palette size={14} />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <span role="radiogroup" aria-label={t("common.color")} className="absolute right-0 top-full mt-2 z-50 flex items-center gap-1.5 p-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-md">
            {PALETTES.map(name => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={current === name}
                aria-label={name}
                title={name}
                onClick={() => { frame.setColor!(id, name); setOpen(false); }}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${colorMap[name].bg} ${current === name ? "border-[var(--text-primary)]" : colorMap[name].border} ${FOCUS_RING}`}
              >
                <span className={`w-2.5 h-2.5 rounded-full bg-current ${colorMap[name].label}`} />
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

// Full screen for the tile this widget sits in (lib/widgetFrame.ts). Nothing
// outside a grid tile (the digest page, previews).
export function ExpandButton({ c }: { c: ColorClasses }) {
  const frame = useWidgetFrame();
  const t = useT();
  if (!frame) return null;
  const label = frame.expanded ? t("common.exitFullScreen") : t("common.fullScreen");
  return (
    <button
      type="button"
      onClick={() => frame.setExpanded(!frame.expanded)}
      title={label}
      aria-label={label}
      data-widget-fullscreen
      className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
    >
      {frame.expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
}

export function WidgetHeader({
  c, icon: Icon, title, after, right, onSettings, onClose, panel = false, className = "",
}: {
  c: ColorClasses;
  icon: LucideIcon;
  title: string;
  after?: ReactNode;
  right?: ReactNode;
  // Opens the widget's settings face: the header draws the settings control
  // for it, last in the row, after full screen.
  onSettings?: () => void;
  // The header of an overlay panel (a widget's history, insights, or an
  // editor) rather than the widget's own: it draws in place, with its
  // buttons always visible, even inside a tab group, where the tab keeps the
  // widget's name and the panel's title and buttons head the panel below it.
  panel?: boolean;
  // A panel's close: drawn by the header, pinned at the row's right end, so
  // it is the same on every panel and never scrolls out of reach.
  onClose?: () => void;
  className?: string;
}) {
  const group = useTabGroup();
  const frame = useWidgetFrame();
  const editing = frame?.editing ?? false;
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [editing]); // back to the identity on any mode change

  if (panel) {
    // Same rule as a widget's header: the panel's own buttons scroll sideways
    // when the card is too narrow for them, and its close stays pinned.
    return (
      <div className={`flex items-center gap-2 mb-4 shrink-0 ${className}`}>
        <div className={`flex items-center gap-1.5 min-w-0 max-w-[60%] shrink-0 ${c.label}`}>
          <Icon size={14} className="opacity-50 shrink-0" />
          <span className="text-sm font-medium truncate">{title}</span>
          {after}
        </div>
        {right ? <OptionsScroller end={right} /> : <div className="flex-1" />}
        {onClose && (
          <button type="button" onClick={onClose} title="Close" aria-label="Close" className={`shrink-0 opacity-70 hover:opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.label}`}>
            <X size={14} />
          </button>
        )}
      </div>
    );
  }
  if (group) {
    // Inside a tab group the tab row is the header: every tab carries its
    // widget's icon and title, and the shown tab's options go to the row's
    // options pane (components/TabStrip.tsx adds the toggle and full screen).
    return (
      <>
        {group.iconHost && createPortal(<Icon size={14} className="opacity-50 shrink-0" />, group.iconHost)}
        {group.titleHost && createPortal(<>{title}</>, group.titleHost)}
        {group.active && group.actionsHost && (after || right) && createPortal(
          <OptionsScroller className={className} start={after} end={right} />,
          group.actionsHost
        )}
        {group.active && group.settingsHost && onSettings && createPortal(<SettingsButton c={c} onClick={onSettings} />, group.settingsHost)}
      </>
    );
  }
  const expand = !editing ? <><ColorButton c={c} /><ExpandButton c={c} /></> : null;
  const settings = onSettings ? <SettingsButton c={c} onClick={() => { setOpen(false); onSettings(); }} /> : null;
  const controls = editing ? frame?.controls : null;
  const hasOptions = editing ? !!controls : !!(after || right || settings || expand);
  return (
    <div className={`flex items-center gap-3 mb-4 shrink-0 min-h-5 ${className}`}>
      <div className="relative flex-1 min-w-0 flex items-center">
        <div inert={open} className={`flex items-center gap-1.5 min-w-0 ${c.label} ${HEADER_SWAP.main} ${open ? HEADER_SWAP.mainHidden : ""}`}>
          <Icon size={14} className="opacity-50 shrink-0" />
          <span className="text-sm font-medium truncate">{title}</span>
        </div>
        {/* In edit mode the tile's content sits, non-interactive, under the
            grid's drag overlay (z-10); the toggle and this pane rise above it
            and take the pointer, like the corner buttons they replace. */}
        {hasOptions && (
          <div inert={!open} className={`${HEADER_SWAP.pane} ${editing ? "z-20" : ""} ${open ? (editing ? "pointer-events-auto" : "") : HEADER_SWAP.paneHidden}`}>
            {editing ? (
              <div className="ml-auto flex items-center gap-2 shrink-0">{controls}</div>
            ) : (
              <>
                {(after || right) && <OptionsScroller start={after} end={right} />}
                {(after || right) && (settings || expand) && <HeaderDivider c={c} />}
                {(settings || expand) && (
                  <div className={`${after || right ? "" : "ml-auto "}flex items-center gap-2 shrink-0`}>
                    {expand}
                    {settings}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {hasOptions && <HeaderToggle c={c} open={open} onToggle={() => setOpen(v => !v)} className={editing ? "relative z-20 pointer-events-auto" : ""} />}
    </div>
  );
}

// ── Settings faces ───────────────────────────────────────────────────────────
// Every widget's settings share one shape (docs/design.md, Settings faces):
// the frame below (header, scrolling body, save row, Escape cancels), fields
// with a label above the control, chips for a few choices and a select for
// many, the Toggle for on/off, the Stepper for numbers you tune and a typed
// field for numbers you know, and one neutral row style for collections.

export function SettingsFace({
  c, title, children, onSave, onCancel, onReset, saving = false, saveDisabled = false, bodyRef, scroll = true,
}: {
  c: ColorClasses;
  title?: string;
  children: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  onReset?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  scroll?: boolean;
}) {
  const t = useT();
  const faceRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  // In a tab group the row steps aside while this face shows.
  const group = useTabGroup();
  const shown = useContext(FaceShownContext) ?? true;
  const setFaceOpen = group?.setFaceOpen;
  useEffect(() => {
    if (!setFaceOpen) return;
    setFaceOpen(shown);
    return () => setFaceOpen(false);
  }, [setFaceOpen, shown]);
  // Escape cancels, like the cross: only for a face that is shown (a flip
  // card's hidden back is mounted but inert) and that holds the focus, or
  // when nothing in particular does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const face = faceRef.current;
      if (!face || face.closest("[inert]")) return;
      const active = document.activeElement;
      if (active && active !== document.body && !face.contains(active)) return;
      e.preventDefault();
      cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div ref={faceRef} className="flex flex-col gap-3 flex-1 min-h-0">
      <WidgetHeader panel c={c} icon={SlidersHorizontal} title={title ?? t("common.settings")} />
      <div ref={bodyRef} className={`@container flex flex-col gap-3 flex-1 min-h-0 ${scroll ? "overflow-y-auto pr-3" : ""}`}>{children}</div>
      <SaveCancelRow c={c} onSave={onSave} onCancel={onCancel} onReset={onReset} saving={saving} saveDisabled={saveDisabled} />
    </div>
  );
}

// A labelled control: the label above (or beside, for a short control like
// chips or a toggle), an optional hint under it.
// Hierarchy: the label is medium weight at full strength, the hint under it
// is light, and the control stands on its own fill, so the three never read
// as the same thing.
export const SETTINGS_LABEL = "text-sm font-medium";
export const SETTINGS_HINT = "text-sm opacity-70 leading-snug";
export function SettingsField({ c, label, hint, children, inline = false }: { c: ColorClasses; label: ReactNode; hint?: ReactNode; children: ReactNode; inline?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {inline ? (
        <div className="flex items-center justify-between gap-x-3 gap-y-1.5 min-h-7 flex-wrap">
          <span className={`${SETTINGS_LABEL} shrink-0 ${c.text}`}>{label}</span>
          {/* Narrow cards (the face is a size container): any group of options
              takes its own line under the label, left-aligned like text; a
              single control (a toggle, a stepper) stays beside the label. */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap justify-end ml-auto @max-[26rem]:[&:has(>*:nth-child(2))]:basis-full @max-[26rem]:[&:has(>*:nth-child(2))]:justify-start @max-[26rem]:[&:has(>*:nth-child(2))]:ml-0">{children}</div>
        </div>
      ) : (
        <span className={`${SETTINGS_LABEL} ${c.text}`}>{label}</span>
      )}
      {hint && <p className={`${SETTINGS_HINT} ${c.label} ${inline ? "-mt-1" : ""}`}>{hint}</p>}
      {!inline && children}
    </div>
  );
}

// A collapsible group of related settings (a connection, an optional
// integration): one row with the name, a one-line summary of its state and a
// chevron; the fields open under it. Closed by default, so a face stays short.
export function SettingsGroup({ c, label, summary, hint, children, defaultOpen = false }: { c: ColorClasses; label: ReactNode; summary?: ReactNode; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={`flex items-center justify-between gap-3 min-h-7 text-left rounded-md ${FOCUS_RING}`}>
        <span className={`${SETTINGS_LABEL} shrink-0 ${c.text}`}>{label}</span>
        <span className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
          {!open && summary && <span className="text-sm opacity-70 truncate">{summary}</span>}
          <ChevronLeft size={14} className={`shrink-0 opacity-70 transition-transform ${open ? "rotate-90" : "-rotate-90"}`} />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 pl-3 border-l border-black/10 dark:border-white/10">
          {hint && <p className={`${SETTINGS_HINT} ${c.label}`}>{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

// Explanatory copy and errors inside a face.
export function SettingsNote({ c, children }: { c: ColorClasses; children: ReactNode }) {
  return <p className={`${SETTINGS_HINT} ${c.label}`}>{children}</p>;
}
// The row that adds an item to a collection: a field, then the one "Add"
// button (plus glyph and the word). Enter adds too. Every collection uses
// this, so the row cannot differ between widgets.
export function SettingsAddRow({
  c, value, onChange, onAdd, placeholder, busy = false, inputRef,
}: {
  c: ColorClasses;
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
  busy?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1.5">
      <SettingsInput
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") onAdd(); }}
        placeholder={placeholder}
        className="flex-1 min-w-0"
      />
      <SmallButton c={c} onClick={onAdd} disabled={busy} title={t("common.add")}>
        {busy ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
        {t("common.add")}
      </SmallButton>
    </div>
  );
}

// Read-only information inside a face (a status, a list of things found):
// an inset block with its own small heading and bullets, so it never reads
// as another setting.
export function SettingsInfo({ c, title, items, more }: { c: ColorClasses; title: ReactNode; items?: ReactNode[]; more?: ReactNode }) {
  return (
    <div className={`rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 flex flex-col gap-1.5 ${c.label}`}>
      <p className="text-sm font-medium">{title}</p>
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-1 list-disc pl-4 text-sm marker:opacity-50">
          {items.map((it, i) => <li key={i} className="min-w-0 break-words">{it}</li>)}
        </ul>
      )}
      {more && <p className="text-sm opacity-70">{more}</p>}
    </div>
  );
}
export function SettingsError({ children }: { children: ReactNode }) {
  return <p className="text-sm text-red-400 break-words">{children}</p>;
}

// One item of an editable collection, laid out like a grouped list: a neutral
// card (no palette color of its own) whose first row is the item itself, a
// leading slot (drag handle, icon, color dot), the name and trailing icon
// actions, and whose further rows are its controls, each a label on the left
// and a control on the right (SettingsListControl). Rows are the same
// height and a hairline apart, so every card reads as one table.
export function SettingsListRow({
  leading, title, actions, children, className = "", style, rowRef,
}: {
  leading?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  rowRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={rowRef} style={style} className={`flex flex-col px-3 rounded-lg bg-black/5 dark:bg-white/10 divide-y divide-black/10 dark:divide-white/10 [&>*:nth-child(2)]:border-t-0 ${className}`}>
      {/* The item's own row is a header band (the band itself separates it
          from the first control, so no hairline under it): a darker strip with the name in
          semibold, so it never reads as one more control. */}
      <div className="flex items-center gap-2 min-h-9 py-1 -mx-3 px-3 rounded-t-lg bg-black/5 dark:bg-white/10 last:rounded-b-lg">
        {leading}
        <div className="flex-1 min-w-0 flex items-center text-sm font-semibold [&_input]:font-semibold">{title}</div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// A control row inside a SettingsListRow (or any grouped list): the label on
// the left at the meta level, the control on the right, 36px tall.
export function SettingsListControl({ c, label, children }: { c: ColorClasses; label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-9 py-1">
      <span className={`text-sm min-w-0 truncate ${c.text}`} title={typeof label === "string" ? label : undefined}>{label}</span>
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end max-w-[70%]">{children}</div>
    </div>
  );
}

// A bare field as a row of a list card (an address, an icon): the same 36px
// row as a control, the field filling it.
export function SettingsListField({ children }: { children: ReactNode }) {
  return <div className="flex items-center min-h-9 py-1">{children}</div>;
}

// The field that sits in a list row's title slot: borderless, so the row
// reads as a name, and a text field when you look for one.
export const LIST_TITLE_INPUT = "flex-1 min-w-0 bg-transparent dark:!bg-transparent text-sm outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--text-muted)]";
// A small icon action in a row (remove, hide): 70% at rest, full on hover.
export const ROW_ACTION = `opacity-70 hover:opacity-100 ${HIT_AREA} ${FOCUS_RING}`;

// A small toggle for modes and options: the chosen one is inverted (a solid
// dark chip in light themes, a solid light one in dark), far past 3:1 against
// its neighbours; the rest sit on a faint fill. Was: the active one has the translucent
// fill, the rest sit at 70% and brighten on hover.
export function Chip({
  c, active = false, onClick, title, children, className = "",
}: {
  c: ColorClasses;
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`h-7 px-2.5 rounded-md text-sm leading-none whitespace-nowrap shrink-0 transition-colors ${FOCUS_RING} ${
        active ? "bg-black/75 text-white dark:bg-white/85 dark:text-black font-medium" : `bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 ${c.text}`
      } ${className}`}
    >
      {children}
    </button>
  );
}

// The standard small action button (new game, load models, add).
export function SmallButton({
  c, onClick, title, disabled, children, className = "",
}: {
  c: ColorClasses;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40 transition-colors ${FOCUS_RING} ${c.label} ${className}`}
    >
      {children}
    </button>
  );
}

// Shows the active "only this source" filter in a widget header; the x clears it.
export function FilterChip({ c, label, onClear }: { c: ColorClasses; label: string; onClear: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-full text-sm bg-black/10 dark:bg-white/15 ${c.text} min-w-0`}>
      <span className="truncate">{label}</span>
      <button type="button" onClick={onClear} aria-label="Clear filter" title="Show everything (Esc)" className={`shrink-0 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/15 ${FOCUS_RING}`}>
        <X size={12} />
      </button>
    </span>
  );
}
