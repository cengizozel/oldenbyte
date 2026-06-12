"use client";

import type {
  InputHTMLAttributes,
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

export function SettingsInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD_CLASS} ${className}`} />;
}

export function SettingsSelect({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD_CLASS} ${className}`} />;
}

export function SettingsTextarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD_CLASS} resize-none ${className}`} />;
}
