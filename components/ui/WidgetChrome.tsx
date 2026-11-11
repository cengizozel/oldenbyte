"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTabGroup } from "@/lib/tabGroup";
import { useWidgetFrame } from "@/lib/widgetFrame";
import { Pencil, Check, X, RotateCcw, Loader, RefreshCw, ChevronLeft, Maximize2, Minimize2, type LucideIcon } from "lucide-react";
import type { ColorClasses } from "@/lib/widgets";
import { FOCUS_RING, HIT_AREA } from "./Field";

// Small shared pieces of widget chrome: the hover pencil, scroll fades, the
// loading spinner, empty-state copy, and the settings save/cancel row.

// Settings entry point. Hidden until the card is hovered or the button gets
// keyboard focus (always visible on touch devices), matching the pattern every
// widget previously inlined.
export function PencilButton({ c, onClick, title }: { c: ColorClasses; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title ?? "Settings"}
      data-widget-settings
      className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
    >
      <Pencil size={14} />
    </button>
  );
}

// Force-refresh for feed widgets: the server caches feeds (admin-set TTL) and
// serves pages from that cache; this button asks for a real upstream fetch now.
export function RefreshButton({ c, onClick, busy }: { c: ColorClasses; onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Refresh now"
      aria-label="Refresh now"
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
// "hover and click the pencil to {action}" phrasing, or children for custom
// copy (which should follow the same casing rules).
export function EmptyState({ c, action, children }: { c: ColorClasses; action?: string; children?: ReactNode }) {
  return (
    <div className="flex-1 h-full min-h-0 flex items-center justify-center text-center px-4">
      <p className={`text-sm opacity-70 ${c.text}`}>
        {children ?? `hover and click the pencil to ${action}`}
      </p>
    </div>
  );
}

// Bottom row of a settings face: optional reset on the left, cancel/save on
// the right. Matches the icon-pair pattern from the feed widgets.
export function SaveCancelRow({
  c,
  onSave,
  onCancel,
  onReset,
  saving = false,
}: {
  c: ColorClasses;
  onSave: () => void;
  onCancel: () => void;
  onReset?: () => void;
  saving?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mt-auto">
      {onReset ? (
        <button onClick={onReset} className={`${c.label} opacity-40 hover:opacity-70`} title="Reset">
          <RotateCcw size={14} />
        </button>
      ) : <span />}
      <div className="flex gap-3">
        <button onClick={onCancel} title="Cancel" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <X size={14} />
        </button>
        <button onClick={onSave} disabled={saving} title="Save" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40">
          {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
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
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? "Close options" : "Options"}
      title={open ? "Close options" : "Options"}
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

// Full screen for the tile this widget sits in (lib/widgetFrame.ts). Nothing
// outside a grid tile (the digest page, previews).
export function ExpandButton({ c }: { c: ColorClasses }) {
  const frame = useWidgetFrame();
  if (!frame) return null;
  const label = frame.expanded ? "Exit full screen (Esc)" : "Full screen";
  return (
    <button
      type="button"
      onClick={() => frame.setExpanded(!frame.expanded)}
      title={label}
      aria-label={label}
      className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
    >
      {frame.expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
}

export function WidgetHeader({
  c, icon: Icon, title, after, right, panel = false, className = "",
}: {
  c: ColorClasses;
  icon: LucideIcon;
  title: string;
  after?: ReactNode;
  right?: ReactNode;
  // The header of an overlay panel (a widget's history, insights, or an
  // editor) rather than the widget's own: it draws in place, with its
  // buttons always visible, even inside a tab group, where the tab keeps the
  // widget's name and the panel's title and buttons head the panel below it.
  panel?: boolean;
  className?: string;
}) {
  const group = useTabGroup();
  const frame = useWidgetFrame();
  const editing = frame?.editing ?? false;
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [editing]); // back to the identity on any mode change

  if (panel) {
    return (
      <div className={`flex items-center justify-between gap-2 mb-3 shrink-0 ${className}`}>
        <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
          <Icon size={14} className="opacity-50 shrink-0" />
          <span className="text-sm font-medium truncate">{title}</span>
          {after}
        </div>
        {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
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
          <div className={`flex-1 flex items-center gap-2 min-w-0 ${className}`}>
            {after}
            {right && <div className="ml-auto flex items-center gap-2 shrink-0">{right}</div>}
          </div>,
          group.actionsHost
        )}
      </>
    );
  }
  const expand = !editing ? <ExpandButton c={c} /> : null;
  const controls = editing ? frame?.controls : null;
  const hasOptions = editing ? !!controls : !!(after || right || expand);
  return (
    <div className={`flex items-center gap-3 mb-3 shrink-0 min-h-5 ${className}`}>
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
                {after}
                {(right || expand) && <div className="ml-auto flex items-center gap-2 shrink-0">{right}{expand}</div>}
              </>
            )}
          </div>
        )}
      </div>
      {hasOptions && <HeaderToggle c={c} open={open} onToggle={() => setOpen(v => !v)} className={editing ? "relative z-20 pointer-events-auto" : ""} />}
    </div>
  );
}

// A small toggle for modes and options: the active one has the translucent
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
      className={`h-7 px-2.5 rounded-md text-sm leading-none transition-colors ${FOCUS_RING} ${
        active ? `bg-black/10 dark:bg-white/15 ${c.text}` : `${c.label} opacity-70 hover:opacity-100`
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
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40 transition-colors ${FOCUS_RING} ${c.label} ${className}`}
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
