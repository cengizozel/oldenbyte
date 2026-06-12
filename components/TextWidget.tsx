"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Type } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsInput } from "@/components/ui/Field";
import { PencilButton, EmptyState, SaveCancelRow } from "@/components/ui/WidgetChrome";

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
  const settingsBodyRef = useRef<HTMLDivElement>(null);

  // Restore the old open-settings autofocus. The input is always mounted on
  // FlipCard's back face, so `autoFocus` would steal focus at page load;
  // instead focus it when the card flips to settings.
  useEffect(() => {
    if (settingsOpen) settingsBodyRef.current?.querySelector("input")?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (!saved) return;
      try {
        const parsed: TextWidgetConfig = JSON.parse(saved);
        setConfig(parsed);
        setDraft(parsed);
        if (parsed.source.type === "text") {
          setDisplay(parsed.source.value);
        } else {
          fetchAndSet(parsed.source.value);
        }
      } catch {}
    });
  }, [storageKey]);

  async function fetchAndSet(url: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error();
      const text = (await res.text()).trim().slice(0, 300);
      if (!text) throw new Error();
      setDisplay(text);
      return text;
    } catch {
      return null;
    }
  }

  // Binary search for largest font size that fits the container.
  // Deferred to rAF so the browser finishes layout before we measure.
  const fitText = useCallback(() => {
    requestAnimationFrame(() => {
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

      let lo = 8, hi = 150;
      while (lo < hi - 1) {
        const mid = Math.floor((lo + hi) / 2);
        el.style.fontSize = `${mid}px`;
        if (el.scrollHeight <= maxH) {
          lo = mid;
        } else {
          hi = mid;
        }
      }

      // Apply the result before making the element visible again
      el.style.fontSize = `${lo}px`;
      el.style.width = "";
      el.style.position = "";
      el.style.visibility = "";
      setFontSize(lo);
    });
  }, [display, config.font]);

  useEffect(() => { fitText(); }, [fitText]);
  useEffect(() => { if (!settingsOpen) fitText(); }, [settingsOpen, fitText]);

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
    await storage.setItem(storageKey, JSON.stringify(draft));
    setSettingsOpen(false);
  }

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          {/* Header */}
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className={`opacity-50 ${c.label}`}><Type size={14} /></span>
            <PencilButton
              c={c}
              onClick={() => { setDraft(config); setSettingsOpen(true); setError(""); }}
            />
          </div>

          {/* Auto-fit text display */}
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
              <EmptyState c={c} action="add text" />
            )}
          </div>
        </>
      }
      back={
        <>
          {/* Header */}
          <div className="flex items-center justify-between shrink-0">
            <span className={`opacity-50 ${c.label}`}><Type size={14} /></span>
          </div>

          <div ref={settingsBodyRef} className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-3">

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
            <SettingsInput
              type={draft.source.type === "url" ? "url" : "text"}
              value={draft.source.value}
              onChange={e => setDraft(d => ({ ...d, source: { ...d.source, value: e.target.value } }))}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder={draft.source.type === "url" ? "https://..." : "Enter any text…"}
            />

            {/* Font picker */}
            <div>
              <p className={`text-xs mb-1.5 opacity-50 ${c.label}`}>Font</p>
              <div className="flex gap-1.5">
                {(["sans", "serif", "mono"] as FontFamily[]).map(f => (
                  <div key={f} className="flex flex-col items-center gap-1">
                    <button
                      onClick={() => setDraft(d => ({ ...d, font: f }))}
                      className={`px-3 py-1.5 rounded-xl text-xs border transition-colors ${FONT_PREVIEW_CLASS[f]} ${
                        draft.font === f
                          ? `border-neutral-300 bg-white text-neutral-700`
                          : `border-neutral-200 text-neutral-400 hover:border-neutral-300`
                      }`}
                    >
                      Aa
                    </button>
                    <span className={`text-[10px] text-neutral-400 ${FONT_PREVIEW_CLASS[f]}`}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {error && <p className="text-red-400 text-xs">{error}</p>}

          </div>

          <SaveCancelRow
            c={c}
            onSave={handleSave}
            onCancel={() => { setSettingsOpen(false); setError(""); }}
            saving={testing}
          />
        </>
      }
    />
  );
}
