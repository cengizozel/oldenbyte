"use client";

import type { ReactNode } from "react";
import { Pencil, Check, X, RotateCcw, Loader, RefreshCw, type LucideIcon } from "lucide-react";
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
      <p className={`text-xs opacity-60 ${c.text}`}>
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
// small actions (docs/design.md). `after` renders inline after the title, for
// a badge such as the arXiv category.
export function WidgetHeader({
  c, icon: Icon, title, after, right, className = "",
}: {
  c: ColorClasses;
  icon: LucideIcon;
  title: string;
  after?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 mb-3 shrink-0 ${className}`}>
      <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
        <Icon size={14} className="opacity-50 shrink-0" />
        <span className="text-xs font-medium truncate">{title}</span>
        {after}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}

// A small toggle for modes and options: the active one has the translucent
// fill, the rest sit at 60% and brighten on hover.
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
      className={`h-6 px-2 rounded-md text-xs leading-none transition-colors ${FOCUS_RING} ${
        active ? `bg-black/10 dark:bg-white/15 ${c.text}` : `${c.label} opacity-60 hover:opacity-100`
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
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40 transition-colors ${FOCUS_RING} ${c.label} ${className}`}
    >
      {children}
    </button>
  );
}
