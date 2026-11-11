"use client";

import { Minus, Plus } from "lucide-react";

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

// A number with minus and plus: the modern face of a number field, used where
// a value is stepped rather than typed (seconds, counts). Buttons are the
// usual 24px round targets; the value sits between them with its unit, and
// the arrow keys step it too.
export function Stepper({
  value, min, max, step = 1, unit = "", onChange, label, disabled = false, className = "",
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (next: number) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const btn = `w-6 h-6 flex items-center justify-center rounded-full bg-black/10 dark:bg-white/15 text-current hover:bg-black/15 dark:hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-black/10 dark:disabled:hover:bg-white/15 transition-colors ${FOCUS_RING}`;
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (
    <div
      role="spinbutton"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${shown}${unit ? " " + unit : ""}`}
      aria-disabled={disabled || undefined}
      onKeyDown={e => {
        if (disabled) return;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); onChange(clamp(value + step)); }
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); onChange(clamp(value - step)); }
      }}
      className={`flex items-center gap-1.5 shrink-0 rounded-md ${disabled ? "opacity-40" : ""} ${FOCUS_RING} ${className}`}
    >
      <button type="button" tabIndex={-1} aria-label={`Less ${label}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))} className={btn}>
        <Minus size={12} />
      </button>
      <span className="min-w-8 text-center text-sm tabular-nums">{shown}{unit && <span className="opacity-70 ml-0.5">{unit}</span>}</span>
      <button type="button" tabIndex={-1} aria-label={`More ${label}`} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))} className={btn}>
        <Plus size={12} />
      </button>
    </div>
  );
}

// Settings drawer layout: a titled section of rows, each row a label (with an
// optional one-line hint under it) on the left and its control on the right,
// separated by hairlines. Rows are at least 40px tall so they are easy targets.
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      {/* An overline, so a section title never reads like a row's hint. */}
      <h3 className="text-sm font-semibold text-[var(--text-primary)] pt-6 pb-1.5">{title}</h3>
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
