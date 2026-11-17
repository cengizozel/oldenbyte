"use client";

import { useEffect, useRef } from "react";
import { FOCUS_RING } from "@/components/ui/Field";

// The one modal confirmation: a short title, a line of detail, a safe choice
// that is focused first (Escape picks it too), and the destructive one in red.
// For a question that would lose work, like discarding layout changes.
export default function ConfirmDialog({
  title, detail, cancelLabel, confirmLabel, onCancel, onConfirm,
}: {
  title: string;
  detail: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const safeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    safeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm bg-[var(--surface)] border border-[var(--surface-border)] rounded-2xl shadow-2xl p-5 flex flex-col gap-2"
      >
        <h2 id="confirm-title" className="text-base font-medium text-[var(--text-primary)]">{title}</h2>
        <p className="text-sm text-[var(--text-secondary)]">{detail}</p>
        <div className="flex justify-end gap-2 mt-3">
          <button
            ref={safeRef}
            type="button"
            onClick={onCancel}
            className={`h-8 px-3 rounded-lg text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[var(--text-primary)] ${FOCUS_RING}`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-8 px-3 rounded-lg text-sm font-medium bg-black/10 dark:bg-white/15 hover:bg-black/15 dark:hover:bg-white/20 text-red-600 dark:text-red-400 ${FOCUS_RING}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
