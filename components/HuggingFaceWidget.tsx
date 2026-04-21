"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, ChevronLeft, ExternalLink, Loader } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

type HFPaper = {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string;
  link: string;
};

export default function HuggingFaceWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `hf-papers-${today}`;

  const [papers, setPapers]             = useState<HFPaper[]>([]);
  const [loading, setLoading]           = useState(false);
  const [selected, setSelected]         = useState<HFPaper | null>(null);
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
    storage.getItem(cacheKey).then(async cached => {
      if (cached) { setPapers(JSON.parse(cached)); return; }
      setLoading(true);
      try {
        const res = await fetch("/api/hf");
        if (!res.ok) throw new Error();
        const data: HFPaper[] = await res.json();
        setPapers(data);
        await storage.setItem(cacheKey, JSON.stringify(data));
      } catch {}
      finally { setLoading(false); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${className}`}>

      {/* Header */}
      <div className={`flex items-center gap-1.5 mb-3 shrink-0 ${c.label}`}>
        <span className="opacity-50"><Sparkles size={14} /></span>
        <span className="text-xs font-medium opacity-60">HF Daily Papers</span>
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
                  {selected.publishedAt && (
                    <p className={`text-xs opacity-35 ${c.text}`}>
                      {new Date(selected.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  )}
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
  );
}
