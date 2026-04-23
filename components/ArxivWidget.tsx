"use client";

import { useState, useEffect, useRef } from "react";
import { BookOpen, Pencil, Check, X, ExternalLink, ChevronLeft, Loader } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

const CATEGORY_GROUPS = [
  {
    label: "Computer Science",
    subs: [
      { value: "cs.AI",  label: "Artificial Intelligence" },
      { value: "cs.LG",  label: "Machine Learning" },
      { value: "cs.CV",  label: "Computer Vision" },
      { value: "cs.CL",  label: "Computation & Language (NLP)" },
      { value: "cs.RO",  label: "Robotics" },
      { value: "cs.NE",  label: "Neural & Evolutionary Computing" },
      { value: "cs.CR",  label: "Cryptography & Security" },
      { value: "cs.DS",  label: "Data Structures & Algorithms" },
      { value: "cs.DC",  label: "Distributed & Parallel Computing" },
      { value: "cs.SE",  label: "Software Engineering" },
      { value: "cs.PL",  label: "Programming Languages" },
      { value: "cs.IR",  label: "Information Retrieval" },
      { value: "cs.HC",  label: "Human-Computer Interaction" },
      { value: "cs.GR",  label: "Graphics" },
      { value: "cs.GT",  label: "Computer Science & Game Theory" },
      { value: "cs.SY",  label: "Systems & Control" },
      { value: "cs.MA",  label: "Multiagent Systems" },
      { value: "cs.DB",  label: "Databases" },
      { value: "cs.NI",  label: "Networking & Internet Architecture" },
      { value: "cs.SI",  label: "Social & Information Networks" },
    ],
  },
  {
    label: "Mathematics",
    subs: [
      { value: "math.CO", label: "Combinatorics" },
      { value: "math.NT", label: "Number Theory" },
      { value: "math.PR", label: "Probability" },
      { value: "math.ST", label: "Statistics Theory" },
      { value: "math.OC", label: "Optimization & Control" },
      { value: "math.NA", label: "Numerical Analysis" },
      { value: "math.AG", label: "Algebraic Geometry" },
      { value: "math.AT", label: "Algebraic Topology" },
      { value: "math.AP", label: "Analysis of PDEs" },
      { value: "math.DS", label: "Dynamical Systems" },
      { value: "math.FA", label: "Functional Analysis" },
      { value: "math.GR", label: "Group Theory" },
      { value: "math.GT", label: "Geometric Topology" },
      { value: "math.LO", label: "Logic" },
      { value: "math.DG", label: "Differential Geometry" },
      { value: "math.MP", label: "Mathematical Physics" },
    ],
  },
  {
    label: "Physics",
    subs: [
      { value: "quant-ph",         label: "Quantum Physics" },
      { value: "gr-qc",            label: "General Relativity & Quantum Cosmology" },
      { value: "hep-th",           label: "High Energy Physics – Theory" },
      { value: "hep-ph",           label: "High Energy Physics – Phenomenology" },
      { value: "hep-ex",           label: "High Energy Physics – Experiment" },
      { value: "cond-mat.stat-mech", label: "Statistical Mechanics" },
      { value: "cond-mat.mtrl-sci", label: "Materials Science" },
      { value: "cond-mat.supr-con", label: "Superconductivity" },
      { value: "cond-mat.soft",    label: "Soft Condensed Matter" },
      { value: "physics.flu-dyn",  label: "Fluid Dynamics" },
      { value: "physics.optics",   label: "Optics" },
      { value: "physics.bio-ph",   label: "Biological Physics" },
      { value: "physics.chem-ph",  label: "Chemical Physics" },
      { value: "physics.comp-ph",  label: "Computational Physics" },
      { value: "physics.geo-ph",   label: "Geophysics" },
      { value: "physics.med-ph",   label: "Medical Physics" },
      { value: "physics.atom-ph",  label: "Atomic Physics" },
      { value: "physics.plasm-ph", label: "Plasma Physics" },
    ],
  },
  {
    label: "Astrophysics",
    subs: [
      { value: "astro-ph.CO", label: "Cosmology & Nongalactic Astrophysics" },
      { value: "astro-ph.GA", label: "Astrophysics of Galaxies" },
      { value: "astro-ph.HE", label: "High Energy Astrophysical Phenomena" },
      { value: "astro-ph.EP", label: "Earth & Planetary Astrophysics" },
      { value: "astro-ph.SR", label: "Solar & Stellar Astrophysics" },
      { value: "astro-ph.IM", label: "Instrumentation & Methods" },
    ],
  },
  {
    label: "Biology",
    subs: [
      { value: "q-bio.NC", label: "Neurons & Cognition" },
      { value: "q-bio.GN", label: "Genomics" },
      { value: "q-bio.PE", label: "Populations & Evolution" },
      { value: "q-bio.BM", label: "Biomolecules" },
      { value: "q-bio.CB", label: "Cell Behavior" },
      { value: "q-bio.MN", label: "Molecular Networks" },
      { value: "q-bio.QM", label: "Quantitative Methods" },
      { value: "q-bio.TO", label: "Tissues & Organs" },
    ],
  },
  {
    label: "Statistics",
    subs: [
      { value: "stat.ML", label: "Machine Learning" },
      { value: "stat.ME", label: "Methodology" },
      { value: "stat.AP", label: "Applications" },
      { value: "stat.TH", label: "Statistics Theory" },
      { value: "stat.CO", label: "Computation" },
    ],
  },
  {
    label: "Electrical Engineering",
    subs: [
      { value: "eess.SP", label: "Signal Processing" },
      { value: "eess.IV", label: "Image & Video Processing" },
      { value: "eess.AS", label: "Audio & Speech Processing" },
      { value: "eess.SY", label: "Systems & Control" },
    ],
  },
  {
    label: "Economics",
    subs: [
      { value: "econ.EM", label: "Econometrics" },
      { value: "econ.TH", label: "Theoretical Economics" },
      { value: "econ.GN", label: "General Economics" },
    ],
  },
];

function findGroup(categoryValue: string): string {
  return CATEGORY_GROUPS.find(g => g.subs.some(s => s.value === categoryValue))?.label
    ?? CATEGORY_GROUPS[0].label;
}


type ArxivConfig = { category: string };
type Paper = { title: string; link: string; pubDate: string; content: string };
type Cache = { papers: Paper[] };

const DEFAULT: ArxivConfig = { category: "cs.AI" };

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseContent(raw: string): { authors: string; abstract: string } {
  const text = stripHtml(raw);
  const authorsMatch = text.match(/^Authors?:\s*(.+?)(?:\s*Abstract:|$)/i);
  const abstractMatch = text.match(/Abstract:\s*([\s\S]+)/i);
  return {
    authors: authorsMatch?.[1]?.trim() ?? "",
    abstract: abstractMatch?.[1]?.trim() ?? (authorsMatch ? "" : text),
  };
}

export default function ArxivWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const today = new Date().toISOString().split("T")[0];
  const configKey = `arxiv-widget-${widget.id}`;
  const cacheKey  = `arxiv-widget-${widget.id}-${today}`;

  const [config, setConfig]             = useState<ArxivConfig>(DEFAULT);
  const [cache, setCache]               = useState<Cache | null>(null);
  const [loading, setLoading]           = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft]               = useState<ArxivConfig>(DEFAULT);
  const [selected, setSelected]         = useState<Paper | null>(null);
  const [listTopFade, setListTopFade]     = useState(false);
  const [listBottomFade, setListBottomFade] = useState(false);
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
  }, [cache]);

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
      const cfg: ArxivConfig = saved ? JSON.parse(saved) : DEFAULT;
      setConfig(cfg);
      setDraft(cfg);
      const cachedRaw = await storage.getItem(cacheKey);
      if (cachedRaw) {
        const parsed: Cache = JSON.parse(cachedRaw);
        if (parsed.papers?.length) setCache(parsed);
      }
      fetchPapers(cfg);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchPapers(cfg: ArxivConfig) {
    setLoading(true);
    try {
      const url = `https://rss.arxiv.org/rss/${cfg.category}`;
      const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}&limit=25`);
      if (!res.ok) throw new Error();
      const papers: Paper[] = await res.json();
      if (!papers.length) throw new Error();
      const newCache: Cache = { papers };
      setCache(newCache);
      await storage.setItem(cacheKey, JSON.stringify(newCache));
    } catch {
      /* leave existing cache */
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setConfig(draft);
    await storage.setItem(configKey, JSON.stringify(draft));
    setSettingsOpen(false);
    await storage.removeItem(cacheKey);
    setCache(null);
    setSelected(null);
    fetchPapers(draft);
  }

  const draftGroup = CATEGORY_GROUPS.find(g => g.label === findGroup(draft.category)) ?? CATEGORY_GROUPS[0];

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
        <div className={`absolute inset-0 p-5 flex flex-col rounded-2xl overflow-hidden ${c.bg}`} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className={`flex items-center gap-1.5 ${c.label}`}>
              <span className="opacity-50"><BookOpen size={14} /></span>
              <span className="text-xs font-medium opacity-60">arXiv</span>
              <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-md opacity-60 ${c.bg} border ${c.border}`}>
                {config.category}
              </span>
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
                ) : cache?.papers.length ? (
                  <ul className="flex flex-col">
                    {cache.papers.map((p, i) => (
                      <li key={i} className={`py-2.5 ${i > 0 ? `border-t border-black/10` : ""}`}>
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
                  <p className={`text-xs opacity-45 ${c.text}`}>
                    hover and click the pencil to choose a category
                  </p>
                )}
              </div>
              {listTopFade && <div className={`absolute top-0 left-0 right-0 h-8 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />}
              {listBottomFade && <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />}
            </div>

            {/* Paper detail */}
            <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${selected ? "translate-x-0" : "translate-x-full"}`}>
              {selected && (() => {
                const p = parseContent(selected.content);
                return (
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
                        {p.authors && (
                          <p className={`text-xs opacity-55 leading-snug ${c.text}`}>{p.authors}</p>
                        )}
                        {selected.pubDate && (
                          <p className={`text-xs opacity-35 ${c.text}`}>
                            {new Date(selected.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            {" · "}{config.category}
                          </p>
                        )}
                        {p.abstract && (
                          <>
                            <div className="border-t border-black/5" />
                            <p className={`text-xs leading-relaxed opacity-75 ${c.text}`}>{p.abstract}</p>
                          </>
                        )}
                      </div>
                    </div>
                    {detailTopFade && <div className={`absolute top-0 left-0 right-0 h-8 bg-gradient-to-b ${c.fade} to-transparent pointer-events-none`} />}
                    {detailBottomFade && <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t ${c.fade} to-transparent pointer-events-none`} />}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Back (settings) */}
        <div className={`absolute inset-0 p-5 flex flex-col gap-3 rounded-2xl overflow-hidden ${c.bg}`} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
          <div className="flex flex-col gap-1.5">
            <label className={`text-[10px] font-semibold uppercase tracking-widest opacity-50 ${c.label}`}>
              Field
            </label>
            <select
              value={draftGroup.label}
              onChange={e => {
                const group = CATEGORY_GROUPS.find(g => g.label === e.target.value) ?? CATEGORY_GROUPS[0];
                setDraft({ category: group.subs[0].value });
              }}
              className="text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none text-neutral-700 bg-white"
            >
              {CATEGORY_GROUPS.map(g => (
                <option key={g.label} value={g.label}>{g.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={`text-[10px] font-semibold uppercase tracking-widest opacity-50 ${c.label}`}>
              Topic
            </label>
            <select
              value={draft.category}
              onChange={e => setDraft({ category: e.target.value })}
              className="text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none text-neutral-700 bg-white"
            >
              {draftGroup.subs.map(sub => (
                <option key={sub.value} value={sub.value}>{sub.label}</option>
              ))}
            </select>
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
