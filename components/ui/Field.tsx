"use client";

import type {
  InputHTMLAttributes,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

// Canonical settings-form field styling. Same metrics as the class string that
// was previously copy-pasted across widgets, but driven by theme CSS vars so it
// matches both modes without the global `.dark input` override doing the work.
export const FIELD_CLASS =
  "w-full text-sm border border-[var(--surface-border)] rounded-xl px-3 py-2 outline-none " +
  "focus:border-[var(--surface-border-focus)] text-[var(--text-primary)] " +
  "placeholder:text-[var(--text-placeholder)] bg-[var(--surface)]";

// Keyboard focus ring for icon buttons and switches: shown only for keyboard
// focus (focus-visible), in the muted text tone so it reads in both modes.
// A 24px hit area around a small icon button without changing how it looks or
// sits: the padding enlarges the click/tap target and the matching negative
// margin cancels it out in the layout.
export const HIT_AREA = "p-[5px] -m-[5px] rounded-md";

export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-muted)]";

export function SettingsInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input {...props} className={`${FIELD_CLASS} ${className}`} />;
}

export function SettingsSelect({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD_CLASS} ${className}`} />;
}

export function SettingsTextarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD_CLASS} resize-none ${className}`} />;
}
