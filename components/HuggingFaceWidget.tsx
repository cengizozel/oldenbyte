"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, ChevronLeft, ExternalLink, Loader, Pencil, Check, X } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

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
  const [listTopFade, setListTopFade]         = useState(false);
  const [listBottomFade, setListBottomFade]   = useState(false);
  const [detailTopFade, setDetailTopFade]     = useState(false);
  const [detailBottomFade, setDetailBottomFade] = useState(false);
  const listScrollRef   = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);

  function checkFade(el: HTMLDivElement, setTop: (v: boolean) => void, setBottom: (v: boolean) => void) {
    const overflows = el.scrollHeight > el.clientHeight + 1;
    setTop(overflows && el.scrollTop > 20);
    setBottom(overflows && el.scrollHeight - el.scrollTop - el.clientHeight > 20);
  }

  useEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    checkFade(el, setListTopFade, setListBottomFade);
    const ro = new ResizeObserver(() => checkFade(el, setListTopFade, setListBottomFade));
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papers]);

  useEffect(() => {
    const el = detailScrollRef.current;
    if (!el) return;
    checkFade(el, setDetailTopFade, setDetailBottomFade);
    const ro = new ResizeObserver(() => checkFade(el, setDetailTopFade, setDetailBottomFade));
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

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
    <div
      className={`rounded-2xl border h-full relative group ${c.bg} ${c.border} ${c.glow} ${className}`}
      style={{ perspective: "1200px" }}
    >
      <div
        className="relative w-full h-full transition-transform duration-300 ease-in-out"
        style={{ transformStyle: "preserve-3d", WebkitTransformStyle: "preserve-3d", transform: settingsOpen ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        {/* Front */}
        <div className={`absolute inset-0 p-5 flex flex-col rounded-2xl overflow-clip ${c.bg}`} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", pointerEvents: settingsOpen ? "none" : "auto" }}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 ${c.label}`}>
              <span className="opacity-50"><Sparkles size={14} /></span>
              <span className="text-xs font-medium opacity-60">HF Daily</span>
            </div>
            {!selected && (
              <button
                onClick={() => { setDraft(config); setSettingsOpen(true); }}
                className={`opacity-0 group-hover:opacity-40 [@media(hover:none)]:!opacity-40 hover:!opacity-80 ${c.label}`}
              >
                <Pencil size={12} />
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 relative overflow-hidden">
            {/* Paper list */}
            <div className={`absolute inset-0 transition-transform duration-300 ease-in-out ${selected ? "-translate-x-full" : "translate-x-0"}`}>
              <div
                ref={listScrollRef}
                className="absolute inset-0 overflow-y-auto pr-3"
                onScroll={e => checkFade(e.currentTarget, setListTopFade, setListBottomFade)}
              >
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
                  </div>
                ) : papers.length ? (
                  <ul className="flex flex-col">
                    {papers.map((p, i) => (
                      <li key={p.id} className={`py-2.5 ${i > 0 ? "border-t border-black/10" : ""}`}>
                        <div className="flex items-start gap-1 group/title">
                          <button
                            onClick={() => setSelected(p)}
                            className={`flex-1 text-left text-sm leading-snug ${c.text} hover:opacity-70 transition-opacity`}
                          >
                            {p.title}
                          </button>
                          <a
                            href={p.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className={`shrink-0 mt-0.5 opacity-0 group-hover/title:opacity-40 hover:!opacity-80 transition-opacity ${c.label}`}
                          >
                            <ExternalLink size={11} />
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Loader size={16} className={`animate-spin opacity-40 ${c.label}`} />
                  </div>
                )}
              </div>
              {listTopFade && <div className={`absolute top-0 left-0 right-0 h-8 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />}
              {listBottomFade && <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />}
            </div>

            {/* Paper detail */}
            <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${selected ? "translate-x-0" : "translate-x-full"}`}>
              {selected && (
                <>
                  <div className={`flex items-center gap-1.5 mb-3 shrink-0 ${c.text}`}>
                    <button onClick={() => setSelected(null)} className="shrink-0 opacity-60 hover:opacity-100">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="flex-1 text-xs font-medium truncate opacity-80">{selected.title}</span>
                    <a href={selected.link} target="_blank" rel="noopener noreferrer" className="shrink-0 opacity-40 hover:opacity-80">
                      <ExternalLink size={11} />
                    </a>
                  </div>
                  <div
                    ref={detailScrollRef}
                    className="flex-1 min-h-0 overflow-y-auto pr-3"
                    onScroll={e => checkFade(e.currentTarget, setDetailTopFade, setDetailBottomFade)}
                  >
                    <div className="flex flex-col gap-2">
                      {selected.authors.length > 0 && (
                        <p className={`text-xs opacity-55 leading-snug ${c.text}`}>
                          {selected.authors.join(", ")}
                        </p>
                      )}
                      <div className={`flex items-center gap-2 text-xs opacity-35 ${c.text}`}>
                        {selected.publishedAt && (
                          <span>{new Date(selected.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                        )}
                        {selected.upvotes > 0 && (
                          <>
                            <span>·</span>
                            <span>▲ {selected.upvotes}</span>
                          </>
                        )}
                      </div>
                      {selected.abstract && (
                        <>
                          <div className="border-t border-black/5" />
                          <p className={`text-xs leading-relaxed opacity-75 ${c.text}`}>{selected.abstract}</p>
                        </>
                      )}
                    </div>
                  </div>
                  {detailTopFade && <div className={`absolute top-0 left-0 right-0 h-8 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />}
                  {detailBottomFade && <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Back (settings) */}
        <div className={`absolute inset-0 p-5 flex flex-col gap-3 rounded-2xl overflow-clip ${c.bg}`} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)", pointerEvents: settingsOpen ? "auto" : "none" }}>
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
          <div className="flex items-center justify-end gap-3 mt-auto">
            <button onClick={() => setSettingsOpen(false)} className="text-neutral-400 hover:text-neutral-600">
              <X size={14} />
            </button>
            <button onClick={handleSave} className="text-neutral-600 hover:text-neutral-900">
              <Check size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
