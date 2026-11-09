"use client";

import type { ReactNode,
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

// Settings drawer layout: a titled section of rows, each row a label (with an
// optional one-line hint under it) on the left and its control on the right,
// separated by hairlines. Rows are at least 40px tall so they are easy targets.
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="text-sm text-[var(--text-muted)] pt-5 pb-1">{title}</h3>
      <div className="flex flex-col divide-y divide-[var(--surface-border)]">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-10 py-1.5">
      <div className="min-w-0 flex flex-col">
        <span className="text-sm text-[var(--text-primary)] truncate">{label}</span>
        {hint && <span className="text-sm text-[var(--text-muted)] leading-snug">{hint}</span>}
      </div>
      {children && <div className="shrink-0 flex items-center gap-2">{children}</div>}
    </div>
  );
}
