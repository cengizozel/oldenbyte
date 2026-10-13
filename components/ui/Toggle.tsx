"use client";

import { FOCUS_RING } from "./Field";

// On/off switch used in the settings drawer. `label` is the accessible name
// (the visible text next to it is usually the same words); `title` is the
// optional hover hint.
export default function Toggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      onClick={onChange}
      className={`relative shrink-0 w-9 h-5 transition-colors duration-200 ${FOCUS_RING} !rounded-full focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] ${checked ? "bg-[var(--text-muted)]" : "bg-[var(--surface-border-focus)]"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}
