"use client";

import type { ReactNode } from "react";
import { Pencil, Check, X, RotateCcw, Loader } from "lucide-react";
import type { ColorClasses } from "@/lib/widgets";

// Small shared pieces of widget chrome: the hover pencil, scroll fades, the
// loading spinner, empty-state copy, and the settings save/cancel row.

// Settings entry point. Hidden until the card is hovered (always visible on
// touch devices), matching the pattern every widget previously inlined.
export function PencilButton({ c, onClick, title }: { c: ColorClasses; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`}
    >
      <Pencil size={14} />
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

// Standard empty-state copy: pass `action` to get the canonical
// "hover and click the pencil to {action}" phrasing, or children for
// fully custom copy (e.g. Notepad's placeholder).
export function EmptyState({ c, action, children }: { c: ColorClasses; action?: string; children?: ReactNode }) {
  return (
    <p className={`text-xs opacity-45 ${c.text}`}>
      {children ?? `hover and click the pencil to ${action}`}
    </p>
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
          <RotateCcw size={13} />
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
