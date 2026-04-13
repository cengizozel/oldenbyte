"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Pencil } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";

type FontFamily = "sans" | "serif" | "mono";
type SourceConfig = { type: "text" | "url"; value: string };
type TextWidgetConfig = { source: SourceConfig; font: FontFamily };

const FONT_CLASS: Record<FontFamily, string> = {
  sans: "font-sans",
  serif: "font-serif",
  mono: "font-mono",
};

// Full class strings for Tailwind to detect
const FONT_PREVIEW_CLASS: Record<FontFamily, string> = {
  sans:  "font-sans",
  serif: "font-serif",
  mono:  "font-mono",
};

const DEFAULT: TextWidgetConfig = {
  source: { type: "text", value: "" },
  font: "sans",
};

export default function TextWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color];
  const storageKey = `text-widget-${widget.id}`;

  const [config, setConfig] = useState<TextWidgetConfig>(DEFAULT);
  const [display, setDisplay] = useState("");
  const [fontSize, setFontSize] = useState(48);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<TextWidgetConfig>(DEFAULT);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed: TextWidgetConfig = JSON.parse(saved);
      setConfig(parsed);
      setDraft(parsed);
      if (parsed.source.type === "text") {
        setDisplay(parsed.source.value);
      } else {
        fetchAndSet(parsed.source.value);
      }
    } catch {}
  }, [storageKey]);

  async function fetchAndSet(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const text = (await res.text()).trim().slice(0, 300);
      if (!text) throw new Error();
      setDisplay(text);
      return text;
    } catch {
      return null;
    }
  }

  // Binary search for largest font size that fits the container
  const fitText = useCallback(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!container || !el || !el.textContent?.trim()) return;

    const maxH = container.clientHeight;
    const maxW = container.clientWidth;
    if (maxH === 0 || maxW === 0) return;

    // Pin the element width so it can't stretch the container
    el.style.width = `${maxW}px`;
    el.style.position = "absolute";
    el.style.visibility = "hidden";

    let lo = 10, hi = 150;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      el.style.fontSize = `${mid}px`;
      if (el.scrollHeight <= maxH) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    el.style.width = "";
    el.style.position = "";
    el.style.visibility = "";
    setFontSize(lo);
  }, [display, config.font]);

  useEffect(() => { fitText(); }, [fitText]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(fitText);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fitText]);

  async function handleSave() {
    setError("");
    if (draft.source.type === "url") {
      if (!draft.source.value.startsWith("http")) {
        setError("Must be a valid URL starting with http.");
        return;
      }
      setTesting(true);
      const result = await fetchAndSet(draft.source.value);
      setTesting(false);
      if (result === null) {
        setError("URL failed or returned empty.");
        return;
      }
    } else {
      setDisplay(draft.source.value);
    }
    setConfig(draft);
    localStorage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
  }

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${className}`}>

      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <p className={`text-xs font-semibold tracking-widest uppercase ${c.label}`}>
          {widget.title}
        </p>
        {!settingsOpen && (
          <button
            onClick={() => { setDraft(config); setSettingsOpen(true); setError(""); }}
            className={`opacity-0 group-hover:opacity-40 hover:!opacity-80 ${c.label}`}
          >
            <Pencil size={12} />
          </button>
        )}
      </div>

      {settingsOpen ? (
        /* Settings panel */
        <div className="flex flex-col gap-3 flex-1 min-h-0">

          {/* Source type toggle */}
          <div className="flex gap-1">
            {(["text", "url"] as const).map(t => (
              <button
                key={t}
                onClick={() => setDraft(d => ({ ...d, source: { ...d.source, type: t } }))}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  draft.source.type === t
                    ? "bg-white text-neutral-700 shadow-sm"
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
            type={draft.source.type === "url" ? "url" : "text"}
            value={draft.source.value}
            onChange={e => setDraft(d => ({ ...d, source: { ...d.source, value: e.target.value } }))}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder={draft.source.type === "url" ? "https://..." : "Enter any text…"}
            className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-300 text-neutral-700 placeholder:text-neutral-300 bg-white"
          />

          {/* Font picker */}
          <div>
            <p className={`text-xs mb-1.5 opacity-50 ${c.label}`}>Font</p>
            <div className="flex gap-1.5">
              {(["sans", "serif", "mono"] as FontFamily[]).map(f => (
                <button
                  key={f}
                  onClick={() => setDraft(d => ({ ...d, font: f }))}
                  className={`px-3 py-1.5 rounded-xl text-xs border transition-colors ${FONT_PREVIEW_CLASS[f]} ${
                    draft.font === f
                      ? `border-neutral-300 bg-white text-neutral-700`
                      : `border-neutral-200 text-neutral-400 hover:border-neutral-300`
                  }`}
                >
                  Aa
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 mt-1">
              {(["sans", "serif", "mono"] as FontFamily[]).map(f => (
                <span key={f} className={`px-3 text-xs text-neutral-400 w-[52px] text-center ${FONT_PREVIEW_CLASS[f]}`}>
                  {f}
                </span>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2 mt-auto">
            <button
              onClick={handleSave}
              disabled={testing}
              className="flex-1 text-xs font-medium bg-white hover:bg-neutral-50 text-neutral-700 rounded-xl py-1.5 border border-neutral-200 disabled:opacity-40"
            >
              {testing ? "Testing…" : draft.source.type === "url" ? "Test & Save" : "Save"}
            </button>
            <button
              onClick={() => { setSettingsOpen(false); setError(""); }}
              className="text-xs text-neutral-400 hover:text-neutral-600 px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Auto-fit text display */
        <div ref={containerRef} className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
          {display ? (
            <div
              ref={textRef}
              style={{ fontSize: `${fontSize}px` }}
              className={`${FONT_CLASS[config.font]} ${c.text} text-center leading-tight break-words w-full`}
            >
              {display}
            </div>
          ) : (
            <p className={`text-xs opacity-45 ${c.text}`}>hover and click the pencil to add text</p>
          )}
        </div>
      )}
    </div>
  );
}
