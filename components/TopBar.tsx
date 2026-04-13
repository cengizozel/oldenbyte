"use client";

import { useState, useEffect, useRef } from "react";
import { Pencil, Check, Loader, X, RotateCcw } from "lucide-react";

type FieldConfig = { type: "text" | "url"; value: string };

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
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed: FieldConfig = JSON.parse(saved);
      setConfig(parsed);
      setDraft(parsed);
      if (parsed.type === "text") {
        setDisplay(parsed.value || defaultValue);
      } else {
        fetchAndSet(parsed.value);
      }
    } catch {}
  }, [storageKey]);

  // Close popover on outside click
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
      const res = await fetch(url);
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

  async function handleSave() {
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
    localStorage.setItem(storageKey, JSON.stringify(next));
    setOpen(false);
  }

  return (
    <div className="relative flex items-center gap-1 group" ref={popoverRef}>
      <span className={className}>{display}</span>

      <button
        onClick={() => { setDraft(config); setOpen(o => !o); setError(""); }}
        className="opacity-0 group-hover:opacity-40 hover:!opacity-70 text-neutral-400 transition-opacity"
        title="Edit"
      >
        <Pencil size={12} />
      </button>

      {open && (
        <div className={`absolute top-full mt-2 z-50 bg-white border border-neutral-200 rounded-2xl shadow-lg p-4 w-64 ${align === "right" ? "right-0" : "left-0"}`}>

          {/* Type toggle */}
          <div className="flex gap-1 mb-3">
            {(["text", "url"] as const).map(t => (
              <button
                key={t}
                onClick={() => setDraft(d => ({ ...d, type: t }))}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  draft.type === t
                    ? "bg-neutral-100 text-neutral-700"
                    : "text-neutral-400 hover:text-neutral-600"
                }`}
              >
                {t === "text" ? "Text" : "API URL"}
              </button>
            ))}
          </div>

          {/* Input */}
          <input
            autoFocus
            type={draft.type === "url" ? "url" : "text"}
            value={draft.value}
            onChange={e => setDraft(d => ({ ...d, value: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder={draft.type === "url" ? "https://..." : defaultValue}
            className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300"
          />

          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}

          {/* Actions */}
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => {
                localStorage.removeItem(storageKey);
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
              <button
                onClick={() => { setOpen(false); setError(""); }}
                className="text-neutral-400 hover:text-neutral-600"
                title="Cancel"
              >
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

export default function TopBar() {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="grid grid-cols-3 items-center py-1">
      <EditableField
        storageKey="topbar-phrase"
        defaultValue="a place to rest"
        className="text-sm text-neutral-600"
      />
      <p className="text-sm text-neutral-600 text-center" suppressHydrationWarning>{date}</p>
      <div className="flex justify-end">
        <EditableField
          storageKey="topbar-mood"
          defaultValue="feeling quiet"
          className="text-sm text-neutral-600"
          align="right"
        />
      </div>
    </div>
  );
}
