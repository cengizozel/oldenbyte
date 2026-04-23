"use client";

import { useState, useEffect, useRef } from "react";
import { Check, Loader, X, RotateCcw, LayoutGrid, Newspaper, Settings } from "lucide-react";
import * as storage from "@/lib/storage";

// ── EditableField ─────────────────────────────────────────────────────────

type FieldConfig = { type: "text" | "url"; value: string };

const URL_EXAMPLES = [
  { label: "Public IP address", url: "https://icanhazip.com" },
  { label: "Weather",           url: "https://wttr.in/Istanbul?format=3" },
];

function EditableField({
  storageKey,
  defaultValue,
  className,
  align = "left",
}: {
  storageKey: string;
  defaultValue: string;
  className?: string;
  align?: "left" | "right";
}) {
  const [display, setDisplay] = useState(defaultValue);
  const [config, setConfig] = useState<FieldConfig>({ type: "text", value: defaultValue });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FieldConfig>({ type: "text", value: defaultValue });
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (!saved) return;
      try {
        const parsed: FieldConfig = JSON.parse(saved);
        setConfig(parsed);
        setDraft(parsed);
        if (parsed.type === "text") {
          setDisplay(parsed.value || defaultValue);
        } else {
          fetchAndSet(parsed.value);
        }
      } catch {}
    });
  }, [storageKey]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
        setError("");
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function fetchAndSet(url: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error("non-200");
      const text = (await res.text()).trim();
      if (!text) throw new Error("empty");
      const clipped = text.slice(0, 120);
      setDisplay(clipped);
      return clipped;
    } catch {
      return null;
    }
  }

  async function handleSave(): Promise<void> {
    setError("");
    if (draft.type === "url") {
      if (!draft.value.startsWith("http")) {
        setError("Must be a valid URL starting with http.");
        return;
      }
      setTesting(true);
      const result = await fetchAndSet(draft.value);
      setTesting(false);
      if (result === null) {
        setError("URL failed or returned empty.");
        return;
      }
    } else {
      setDisplay(draft.value.trim() || defaultValue);
    }
    const next = { type: draft.type, value: draft.value };
    setConfig(next);
    await storage.setItem(storageKey, JSON.stringify(next));
    setOpen(false);
  }

  return (
    <div className="relative" ref={popoverRef}>
      <span
        className={`${className} cursor-pointer`}
        onClick={() => { setDraft(config); setOpen(o => !o); setError(""); }}
      >
        {display}
      </span>

      {open && (
        <div className={`absolute top-full mt-2 z-50 bg-[var(--surface)] border border-[var(--surface-border)] rounded-2xl shadow-lg p-4 w-64 ${align === "right" ? "right-0" : "left-0"}`}>
          <div className="flex gap-1 mb-3">
            {(["text", "url"] as const).map(t => (
              <button
                key={t}
                onClick={() => setDraft(d => ({ ...d, type: t }))}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  draft.type === t ? "bg-[var(--surface-border)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {t === "text" ? "Text" : "API URL"}
              </button>
            ))}
          </div>

          <input
            autoFocus
            type={draft.type === "url" ? "url" : "text"}
            value={draft.value}
            onChange={e => setDraft(d => ({ ...d, value: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder={draft.type === "url" ? "https://..." : defaultValue}
            className="w-full text-sm border border-[var(--surface-border)] rounded-xl px-3 py-2 outline-none focus:border-[var(--surface-border-focus)] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] bg-[var(--surface)]"
          />

          {draft.type === "url" && (
            <div className="mt-2 flex flex-col gap-0.5">
              {URL_EXAMPLES.map(ex => (
                <button
                  key={ex.url}
                  onClick={() => setDraft(d => ({ ...d, value: ex.url }))}
                  className="text-left px-2 py-1 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-border)] transition-colors"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}

          <div className="flex items-center justify-between mt-3">
            <button
              onClick={async () => {
                await storage.removeItem(storageKey);
                setDisplay(defaultValue);
                setConfig({ type: "text", value: defaultValue });
                setOpen(false);
              }}
              className="text-neutral-300 hover:text-neutral-500"
              title="Reset to default"
            >
              <RotateCcw size={13} />
            </button>
            <div className="flex gap-3">
              <button onClick={() => { setOpen(false); setError(""); }} className="text-neutral-400 hover:text-neutral-600" title="Cancel">
                <X size={14} />
              </button>
              <button
                onClick={handleSave}
                disabled={testing}
                className="text-neutral-600 hover:text-neutral-900 disabled:opacity-40"
                title={draft.type === "url" ? "Test & Save" : "Save"}
              >
                {testing ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DateDisplay ───────────────────────────────────────────────────────────

type DateFormat =
  | "date-long"
  | "date-medium"
  | "date-short"
  | "time-12"
  | "time-24"
  | "datetime-12"
  | "datetime-24"
  | "analog";

function fmt(date: Date, format: DateFormat): string {
  switch (format) {
    case "date-long":
      return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    case "date-medium":
      return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    case "date-short":
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    case "time-12":
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    case "time-24":
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    case "datetime-12":
      return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
    case "datetime-24":
      return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    default:
      return "";
  }
}

function AnalogClock({ time, size }: { time: Date; size: number }) {
  const h = time.getHours() % 12;
  const m = time.getMinutes();
  const s = time.getSeconds();

  const hourAngle   = ((h + m / 60 + s / 3600) / 12) * 360 - 90;
  const minuteAngle = ((m + s / 60) / 60) * 360 - 90;
  const secondAngle = (s / 60) * 360 - 90;

  const cx = 50, cy = 50;
  function pt(deg: number, len: number) {
    const r = (deg * Math.PI) / 180;
    return [cx + Math.cos(r) * len, cy + Math.sin(r) * len] as [number, number];
  }

  const [hx, hy] = pt(hourAngle, 26);
  const [mx, my] = pt(minuteAngle, 36);
  const [sx, sy] = pt(secondAngle, 40);

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0">
      <circle cx={cx} cy={cy} r={46} fill="none" style={{ stroke: "var(--clock-face)" }} strokeWidth="4" />
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * 360 - 90;
        const [x1, y1] = pt(a, i % 3 === 0 ? 34 : 39);
        const [x2, y2] = pt(a, 44);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: "var(--clock-face)" }} strokeWidth={i % 3 === 0 ? 4 : 2} strokeLinecap="round" />;
      })}
      <line x1={cx} y1={cy} x2={hx} y2={hy} style={{ stroke: "var(--clock-hour)" }} strokeWidth="7" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={mx} y2={my} style={{ stroke: "var(--clock-minute)" }} strokeWidth="5" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={sx} y2={sy} style={{ stroke: "var(--clock-second)" }} strokeWidth="2" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} style={{ fill: "var(--clock-center)" }} />
    </svg>
  );
}

const FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: "date-long",    label: "Monday, April 14, 2026" },
  { value: "date-medium",  label: "April 14, 2026" },
  { value: "date-short",   label: "Apr 14" },
  { value: "time-12",      label: "2:30 PM" },
  { value: "time-24",      label: "14:30" },
  { value: "datetime-12",  label: "Apr 14 · 2:30 PM" },
  { value: "datetime-24",  label: "Apr 14 · 14:30" },
  { value: "analog",       label: "Analog clock" },
];

const NEEDS_SECONDS: DateFormat[] = ["time-12", "time-24", "datetime-12", "datetime-24", "analog"];

function DateDisplay() {
  const [format, setFormat] = useState<DateFormat>("date-long");
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateFormat>("date-long");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    storage.getItem("topbar-date-format").then(saved => {
      if (saved) { setFormat(saved as DateFormat); setDraft(saved as DateFormat); }
    });
  }, []);

  useEffect(() => {
    const ms = NEEDS_SECONDS.includes(format) ? 1000 : 60_000;
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [format]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleSave() {
    setFormat(draft);
    await storage.setItem("topbar-date-format", draft);
    setOpen(false);
  }

  async function handleReset() {
    setFormat("date-long");
    setDraft("date-long");
    await storage.removeItem("topbar-date-format");
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative flex items-center justify-center">
      <button
        onClick={() => { setDraft(format); setOpen(o => !o); }}
        className="flex items-center cursor-pointer"
        title="Change format"
      >
        {format === "analog"
          ? <AnalogClock time={now} size={48} />
          : <span className="text-sm md:text-lg text-[var(--text-secondary)] text-center [font-family:var(--font-dm-mono)]" suppressHydrationWarning>{fmt(now, format)}</span>
        }
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface)] border border-[var(--surface-border)] rounded-2xl shadow-lg p-3 w-52">
          <div className="flex flex-col gap-0.5">
            {FORMAT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setDraft(opt.value)}
                className={`flex items-center gap-2 text-left px-3 py-1.5 rounded-xl text-xs transition-colors ${
                  draft === opt.value
                    ? "bg-[var(--surface-border)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-border)]"
                }`}
              >
                {opt.value === "analog"
                  ? <><AnalogClock time={now} size={18} /><span>Analog clock</span></>
                  : fmt(now, opt.value)
                }
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between mt-3 pt-2 border-t border-neutral-100">
            <button onClick={handleReset} className="text-neutral-300 hover:text-neutral-500" title="Reset">
              <RotateCcw size={13} />
            </button>
            <div className="flex gap-3">
              <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-600" title="Cancel">
                <X size={14} />
              </button>
              <button onClick={handleSave} className="text-neutral-600 hover:text-neutral-900" title="Save">
                <Check size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SettingsPanel ──────────────────────────────────────────────────────────

function SettingsPanel({
  open,
  onClose,
  dark,
  onToggleDark,
}: {
  open: boolean;
  onClose: () => void;
  dark: boolean;
  onToggleDark: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />
      <div
        className={`fixed top-0 right-0 h-full w-72 z-50 bg-[var(--surface)] border-l border-[var(--surface-border)] shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[var(--surface-border)]">
          <span className="text-sm font-medium text-[var(--text-primary)]">Settings</span>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <span className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">Appearance</span>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Dark mode</span>
              <button
                onClick={onToggleDark}
                className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${dark ? "bg-[var(--text-muted)]" : "bg-[var(--surface-border-focus)]"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${dark ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

// ── TopBar ─────────────────────────────────────────────────────────────────

export default function TopBar({
  editing = false,
  onToggleEdit,
}: {
  editing?: boolean;
  onToggleEdit?: () => void;
}) {
  const [dark, setDark] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    storage.getItem("theme").then(saved => {
      const isDark = saved ? saved === "dark" : document.documentElement.classList.contains("dark");
      setDark(isDark);
      document.documentElement.classList.toggle("dark", isDark);
      localStorage.setItem("theme", isDark ? "dark" : "light");
    });
  }, []);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    const value = next ? "dark" : "light";
    localStorage.setItem("theme", value);
    storage.setItem("theme", value);
  }

  return (
    <>
    <div className="grid grid-cols-3 items-center min-h-14 md:min-h-16">
      <div className="flex items-center">
        <EditableField
          storageKey="topbar-phrase"
          defaultValue="oldenbyte"
          className="text-lg md:text-2xl text-[var(--text-primary)] font-medium leading-none [font-family:var(--font-playfair)]"
        />
      </div>
      <div className="flex flex-col items-center justify-center gap-1.5">
        <DateDisplay />
        <div className="flex items-center gap-3">
          <a
            href="/digest"
            className="transition-opacity text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title="Morning digest"
          >
            <Newspaper size={14} />
          </a>
          <button
            onClick={onToggleEdit}
            className="transition-opacity text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title={editing ? "Done editing" : "Edit layout"}
          >
            {editing ? <Check size={14} /> : <LayoutGrid size={14} />}
          </button>
          <button
            onClick={() => setSettingsOpen(o => !o)}
            className="transition-colors text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title="Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
      <div className="flex justify-end items-center group/right">
        <EditableField
          storageKey="topbar-mood"
          defaultValue="feeling quiet"
          className="text-lg md:text-2xl text-[var(--text-primary)] font-medium leading-none [font-family:var(--font-playfair)]"
          align="right"
        />
      </div>
    </div>
    <SettingsPanel
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      dark={dark}
      onToggleDark={toggleDark}
    />
    </>
  );
}
