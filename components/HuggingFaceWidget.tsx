"use client";

import { useState, useEffect } from "react";
import { Sparkles, ChevronLeft, ExternalLink } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { formatCount, formatDate } from "@/lib/format";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { PencilButton, ScrollFades, LoadingState, SaveCancelRow } from "@/components/ui/WidgetChrome";

type HFPaper = {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string;
  upvotes: number;
  link: string;
};

type HFConfig = { limit: number };

const DEFAULT: HFConfig = { limit: 25 };

export default function HuggingFaceWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const today = new Date().toISOString().split("T")[0];
  const configKey = `hf-widget-${widget.id}`;

  const [config, setConfig]             = useState<HFConfig>(DEFAULT);
  const [papers, setPapers]             = useState<HFPaper[]>([]);
  const [loading, setLoading]           = useState(false);
  const [selected, setSelected]         = useState<HFPaper | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft]               = useState<HFConfig>(DEFAULT);
  const listFade   = useScrollFade<HTMLDivElement>([papers]);
  const detailFade = useScrollFade<HTMLDivElement>([selected]);

  useEffect(() => {
    storage.getItem(configKey).then(async saved => {
      const cfg: HFConfig = saved ? JSON.parse(saved) : DEFAULT;
      setConfig(cfg);
      setDraft(cfg);
      const cacheKey = `hf-papers-${cfg.limit}-${today}`;
      const cached = await storage.getItem(cacheKey);
      if (cached) setPapers(JSON.parse(cached));
      fetchPapers(cfg);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchPapers(cfg: HFConfig) {
    setLoading(true);
    try {
      const res = await fetch(`/api/hf?limit=${cfg.limit}`);
      if (!res.ok) throw new Error();
      const data: HFPaper[] = await res.json();
      setPapers(data);
      await storage.setItem(`hf-papers-${cfg.limit}-${today}`, JSON.stringify(data));
    } catch {}
    finally { setLoading(false); }
  }

  function handleSave() {
    setConfig(draft);
    setSettingsOpen(false);
    setSelected(null);
    setPapers([]);
    storage.setItem(configKey, JSON.stringify(draft));
    fetchPapers(draft);
  }

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 ${c.label}`}>
              <span className="opacity-50"><Sparkles size={14} /></span>
              <span className="text-xs font-medium opacity-60">HF Daily</span>
            </div>
            {!selected && (
              <PencilButton c={c} onClick={() => { setDraft(config); setSettingsOpen(true); }} />
            )}
          </div>

          <div className="flex-1 min-h-0 relative overflow-hidden">
            {/* Paper list */}
            <div className={`absolute inset-0 transition-transform duration-300 ease-in-out ${selected ? "-translate-x-full" : "translate-x-0"}`}>
              <div
                ref={listFade.ref}
                className="absolute inset-0 overflow-y-auto pr-3"
                onScroll={listFade.onScroll}
              >
                {loading || !papers.length ? (
                  <LoadingState c={c} />
                ) : (
                  <ul className="flex flex-col">
                    {papers.map((p, i) => (
                      <li key={p.id} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                        <div className="flex items-start gap-1 group/title">
                          <button
                            onClick={() => setSelected(p)}
                            className={`flex-1 min-w-0 text-left text-sm leading-snug break-words ${c.text} hover:opacity-70 transition-opacity`}
                          >
                            {p.title}
                          </button>
                          <a
                            href={p.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className={`shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-90 dark:group-hover/title:opacity-70 hover:!opacity-100 transition-opacity ${c.icon}`}
                          >
                            <ExternalLink size={11} />
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <ScrollFades c={c} top={listFade.topFade} bottom={listFade.bottomFade} />
            </div>

            {/* Paper detail */}
            <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${selected ? "translate-x-0" : "translate-x-full"}`}>
              {selected && (
                <>
                  <div className={`flex items-center gap-1.5 mb-3 shrink-0 ${c.text}`}>
                    <button onClick={() => setSelected(null)} className="shrink-0 opacity-60 hover:opacity-100">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="flex-1 min-w-0 text-xs font-medium truncate opacity-80">{selected.title}</span>
                    <a href={selected.link} target="_blank" rel="noopener noreferrer" className="shrink-0 opacity-40 hover:opacity-80">
                      <ExternalLink size={11} />
                    </a>
                  </div>
                  <div
                    ref={detailFade.ref}
                    className="flex-1 min-h-0 overflow-y-auto pr-3"
                    onScroll={detailFade.onScroll}
                  >
                    <div className="flex flex-col gap-2">
                      {selected.authors.length > 0 && (
                        <p className={`text-xs opacity-55 leading-snug break-words ${c.text}`}>
                          {selected.authors.join(", ")}
                        </p>
                      )}
                      <div className={`flex items-center gap-2 text-xs opacity-35 ${c.text}`}>
                        {selected.publishedAt && (
                          <span>{formatDate(selected.publishedAt)}</span>
                        )}
                        {selected.upvotes > 0 && (
                          <>
                            <span>·</span>
                            <span>▲ {formatCount(selected.upvotes)}</span>
                          </>
                        )}
                      </div>
                      {selected.abstract && (
                        <>
                          <div className="border-t border-black/5" />
                          <p className={`text-xs leading-relaxed opacity-75 break-words ${c.text}`}>{selected.abstract}</p>
                        </>
                      )}
                    </div>
                  </div>
                  <ScrollFades c={c} top={detailFade.topFade} bottom={detailFade.bottomFade} />
                </>
              )}
            </div>
          </div>
        </>
      }
      back={
        <>
          <div className="flex flex-col gap-1.5">
            <label className={`text-[10px] font-semibold uppercase tracking-widest opacity-50 ${c.label}`}>
              Papers to show
            </label>
            <div className="flex gap-2">
              {[10, 25, 50].map(n => (
                <button
                  key={n}
                  onClick={() => setDraft({ limit: n })}
                  className={`flex-1 text-xs py-1.5 rounded-xl border transition-colors ${
                    draft.limit === n
                      ? "border-neutral-300 bg-white text-neutral-700 font-medium"
                      : "border-neutral-200 text-neutral-400 hover:text-neutral-600"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <SaveCancelRow c={c} onSave={handleSave} onCancel={() => setSettingsOpen(false)} />
        </>
      }
    />
  );
}
