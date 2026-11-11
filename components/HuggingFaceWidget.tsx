"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, ExternalLink } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { formatCount, formatDate, localDateStr } from "@/lib/format";
import { parseJson } from "@/lib/text";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { HIT_AREA, FOCUS_RING } from "@/components/ui/Field";
import { RefreshButton, ScrollFades, LoadingState, WidgetHeader, Chip, BackButton, SettingsFace, SettingsField } from "@/components/ui/WidgetChrome";

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
  const today = localDateStr();
  const configKey = `hf-widget-${widget.id}`;

  const [config, setConfig]             = useState<HFConfig>(DEFAULT);
  const [papers, setPapers]             = useState<HFPaper[]>([]);
  const [loading, setLoading]           = useState(false);
  const [selected, setSelected]         = useState<HFPaper | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft]               = useState<HFConfig>(DEFAULT);
  const listFade   = useScrollFade<HTMLDivElement>([papers]);
  const detailFade = useScrollFade<HTMLDivElement>([selected]);
  // Aborts the previous fetch so a slow initial load can never land over a
  // newer limit.
  const fetchAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    storage.getItem(configKey).then(async saved => {
      const cfg = parseJson<HFConfig>(saved, DEFAULT);
      setConfig(cfg);
      setDraft(cfg);
      const cacheKey = `hf-papers-${cfg.limit}-${today}`;
      const cached = await storage.getItem(cacheKey);
      if (cached) setPapers(parseJson<HFPaper[]>(cached, []));
      fetchPapers(cfg);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchPapers(cfg: HFConfig, force = false) {
    fetchAbort.current?.abort();
    const ctrl = new AbortController();
    fetchAbort.current = ctrl;
    setLoading(true);
    try {
      const res = await fetch(`/api/hf?limit=${cfg.limit}${force ? "&refresh=1" : ""}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error();
      const data: HFPaper[] = await res.json();
      setPapers(data);
      await storage.setItem(`hf-papers-${cfg.limit}-${today}`, JSON.stringify(data));
    } catch {}
    finally { if (fetchAbort.current === ctrl) setLoading(false); }
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
          <WidgetHeader
            onSettings={() => { setDraft(config); setSettingsOpen(true); }}
            c={c}
            icon={Sparkles}
            title="HF Daily"
            right={!selected && (
              <>
                <RefreshButton c={c} busy={loading} onClick={() => fetchPapers(config, true)} />
              </>
            )}
          />

          <div className="flex-1 min-h-0 relative overflow-hidden">
            {/* Paper list */}
            <div className={`absolute inset-0 transition-transform duration-300 ease-in-out ${selected ? "-translate-x-full" : "translate-x-0"}`}>
              <div
                ref={listFade.ref}
                className="absolute inset-0 overflow-y-auto pr-3"
                onScroll={listFade.onScroll}
              >
                {!papers.length ? (
                  <LoadingState c={c} />
                ) : (
                  <ul className="flex flex-col">
                    {papers.map((p, i) => (
                      <li key={p.id} className={`py-2 first:pt-0 ${i > 0 ? "border-t border-black/10 dark:border-white/10" : ""}`}>
                        <div className="flex items-start gap-1 group/title">
                          <button
                            onClick={() => setSelected(p)}
                            className={`flex-1 min-w-0 text-left text-sm leading-snug break-words min-h-6 ${c.text} hover:opacity-70 transition-opacity`}
                          >
                            {p.title}
                          </button>
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
                  <div className={`flex items-stretch gap-2 mb-3 shrink-0 ${c.text}`}>
                    <BackButton c={c} onClick={() => setSelected(null)} />
                    <span className="flex-1 min-w-0 self-center text-sm font-medium leading-snug break-words opacity-80">{selected.title}</span>
                    <a href={selected.link} target="_blank" rel="noopener noreferrer" aria-label="Open on Hugging Face" className={`shrink-0 opacity-70 hover:opacity-100 ${HIT_AREA} ${FOCUS_RING}`}>
                      <ExternalLink size={14} />
                    </a>
                  </div>
                  <div
                    ref={detailFade.ref}
                    className="flex-1 min-h-0 overflow-y-auto pr-3"
                    onScroll={detailFade.onScroll}
                  >
                    <div className="flex flex-col gap-2">
                      {selected.authors.length > 0 && (
                        <p className={`text-xs opacity-70 leading-snug break-words ${c.text}`}>
                          {selected.authors.join(", ")}
                        </p>
                      )}
                      <div className={`flex items-center gap-2 text-xs opacity-70 ${c.text}`}>
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
                          <div className="border-t border-black/10 dark:border-white/10" />
                          <p className={`text-xs leading-relaxed opacity-80 break-words ${c.text}`}>{selected.abstract}</p>
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
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => setSettingsOpen(false)}>
          <SettingsField c={c} label="Papers to show" inline>
            {[5, 10, 25, 50].map(n => (
              <Chip key={n} c={c} active={draft.limit === n} onClick={() => setDraft({ limit: n })}>
                {n}
              </Chip>
            ))}
          </SettingsField>
        </SettingsFace>
      }
    />
  );
}
