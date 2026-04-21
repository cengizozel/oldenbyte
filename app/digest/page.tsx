"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import * as storage from "@/lib/storage";
import { widgets as widgetDefs } from "@/lib/widgets";

type TabLayoutItem = { i: string; tabs?: string[] };
type WidgetInstance = { id: string; type: string; title: string };

type Entry = {
  text?: string;
  title?: string;
  body?: string;
  meta?: string;
  link?: string;
};

type Ref = { n: number; title: string; link: string };

type Section = {
  id: string;
  label: string;
  type: string;
  entries: Entry[];
};

function stripTags(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, "");
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

function decodeEntities(raw: string): string {
  const ta = document.createElement("textarea");
  ta.innerHTML = raw;
  return ta.value;
}

function parseArxivContent(raw: string) {
  const text = stripTags(raw);
  const authorsMatch = text.match(/Authors?:\s*(.+?)(?:\s*Abstract:|$)/i);
  const abstractMatch = text.match(/Abstract:\s*([\s\S]+)/i);
  return {
    authors: authorsMatch?.[1]?.trim() ?? "",
    abstract: abstractMatch?.[1]?.trim() ?? "",
  };
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

export default function DigestPage() {
  const [mode] = useState<"digest" | "full" | "ai">("ai");
  const [sections, setSections]   = useState<Section[]>([]);
  const [loading, setLoading]     = useState(true);
  const [aiKey, setAiKey]               = useState("");
  const [keyDraft, setKeyDraft]         = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [sectionSummaries, setSectionSummaries] = useState<{ label: string; prose: string; refs: Ref[] }[]>([]);
  const [aiLoading, setAiLoading]       = useState(false);
  const [aiError, setAiError]           = useState("");
  const [streamingMode, setStreamingMode] = useState(false);
  const summaryRequestedRef             = useRef(false);

  const today = new Date().toISOString().split("T")[0];
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  useEffect(() => {
    const saved = localStorage.getItem("digest-openai-key") ?? "";
    setAiKey(saved);
    setKeyDraft(saved);
    setStreamingMode(localStorage.getItem("digest-streaming") === "true");
    loadAll().then(s => { setSections(s); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-generate when AI tab is selected, key exists, sections loaded, no summary yet
  useEffect(() => {
    if (mode !== "ai" || !aiKey || loading || !sections.length || sectionSummaries.length || aiLoading) return;
    if (summaryRequestedRef.current) return;
    storage.getItem(`digest-ai-sections-${today}`).then(cached => {
      if (cached) {
        setSectionSummaries(JSON.parse(cached));
        return;
      }
      generateSummary();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, aiKey, loading, sections]);

  function saveKey() {
    localStorage.setItem("digest-openai-key", keyDraft);
    setAiKey(keyDraft);
    setShowKeyInput(false);
  }

  const CITABLE = new Set(["rss", "reddit", "youtube", "arxiv", "hf"]);

  function buildSectionContent(section: Section): { content: string; refs: Ref[] } {
    const refs: Ref[] = [];
    let n = 1;
    const citable = CITABLE.has(section.type);
    const lines: string[] = [];
    for (const entry of section.entries) {
      if (entry.text) {
        lines.push(entry.text);
      } else {
        if (entry.title) {
          if (citable && entry.link) {
            refs.push({ n, title: entry.title, link: entry.link });
            lines.push(`${entry.title} [${n++}]`);
          } else {
            lines.push(entry.title);
          }
        }
        if (entry.body) lines.push(entry.body);
        if (entry.meta) lines.push(`(${entry.meta})`);
      }
    }
    const refBlock = refs.length
      ? "\n\nREFERENCES\n" + refs.map(r => `[${r.n}] "${r.title}"`).join("\n")
      : "";
    return { content: lines.join("\n") + refBlock, refs };
  }

  async function generateSummary() {
    summaryRequestedRef.current = true;
    setAiLoading(true);
    setAiError("");

    if (streamingMode) {
      // Pre-populate sections so they appear immediately and fill in real-time
      const initial = sections.map(s => ({ label: s.label, prose: "", refs: [] as Ref[] }));
      setSectionSummaries(initial);
      setAiLoading(false);

      const finalSummaries = [...initial];

      await Promise.allSettled(sections.map(async (section, idx) => {
        const { content, refs } = buildSectionContent(section);
        const res = await fetch("/api/digest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: aiKey, content, stream: true }),
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let prose = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          prose += decoder.decode(value, { stream: true });
          setSectionSummaries(prev => {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], prose, refs };
            return updated;
          });
        }
        finalSummaries[idx] = { label: section.label, prose, refs };
      }));

      await storage.setItem(`digest-ai-sections-${today}`, JSON.stringify(finalSummaries));
    } else {
      try {
        const results = await Promise.allSettled(
          sections.map(async section => {
            const { content, refs } = buildSectionContent(section);
            const res = await fetch("/api/digest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: aiKey, content }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Unknown error");
            return { label: section.label, prose: data.summary as string, refs };
          })
        );
        const newSectionSummaries = results
          .filter(r => r.status === "fulfilled")
          .map(r => (r as PromiseFulfilledResult<{ label: string; prose: string; refs: Ref[] }>).value);
        setSectionSummaries(newSectionSummaries);
        await storage.setItem(`digest-ai-sections-${today}`, JSON.stringify(newSectionSummaries));
      } catch (err) {
        setAiError(String(err));
        summaryRequestedRef.current = false;
      } finally {
        setAiLoading(false);
      }
    }
  }

  function renderInline(text: string, refList: Ref[]) {
    // Split on **bold** and [n] citation markers
    const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
    return parts.map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
      }
      const citMatch = part.match(/^\[(\d+)\]$/);
      if (citMatch) {
        const n = parseInt(citMatch[1]);
        const ref = refList.find(r => r.n === n);
        return ref ? (
          <a
            key={j}
            href={ref.link}
            target="_blank"
            rel="noopener noreferrer"
            title={ref.title}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors align-super text-[10px] ml-0.5"
          >
            [{n}]
          </a>
        ) : <span key={j}>[{n}]</span>;
      }
      return part;
    });
  }

  function renderProse(text: string, refList: Ref[]) {
    return text.split(/\n\n+/).map((block, i) => {
      const trimmed = block.trim();
      if (!trimmed) return null;
      return (
        <p key={i} className="font-[family-name:var(--font-playfair)] text-[17px] leading-[1.8] text-[var(--text-primary)]">
          {renderInline(trimmed, refList)}
        </p>
      );
    });
  }

  async function loadAll(): Promise<Section[]> {
    const [rawLayout, rawInstances] = await Promise.all([
      storage.getItem("widget-layout"),
      storage.getItem("widget-instances"),
    ]);
    if (!rawLayout || !rawInstances) return [];

    const layout: TabLayoutItem[] = JSON.parse(rawLayout);
    const instances: Record<string, WidgetInstance> = JSON.parse(rawInstances);

    const orderedIds: string[] = [];
    for (const item of layout) {
      orderedIds.push(item.i);
      for (const tabId of item.tabs ?? []) orderedIds.push(tabId);
    }

    const filtered = orderedIds.filter(id => {
      const w = instances[id];
      if (!w || w.type === "empty") return false;
      const def = widgetDefs.find(d => d.type === w.type);
      return def?.digestable !== false;
    });

    const results = await Promise.allSettled(
      filtered.map(id => loadSection(id, instances[id]))
    );

    return results
      .filter(r => r.status === "fulfilled" && r.value !== null)
      .map(r => (r as PromiseFulfilledResult<Section | null>).value!);
  }

  async function loadSection(id: string, widget: WidgetInstance): Promise<Section | null> {
    switch (widget.type) {
      case "notebook": return loadNotepad(id, widget);
      case "text":     return loadText(id, widget);
      case "f1":       return loadF1(widget);
      case "rss":      return loadRss(id, widget);
      case "reddit":   return loadReddit(id, widget);
      case "youtube":  return loadYoutube(id, widget);
      case "arxiv":    return loadArxiv(id, widget);
      case "hf":       return loadHf(id, widget);
      default:         return null;
    }
  }

  async function loadNotepad(id: string, widget: WidgetInstance): Promise<Section | null> {
    const [rawDates, rawName] = await Promise.all([
      storage.getItem(`notebook-${id}-dates`),
      storage.getItem(`notebook-${id}-name`),
    ]);
    const dates: Record<string, string> = rawDates ? JSON.parse(rawDates) : {};
    const text = dates[today];
    if (!text) return null;
    return { id, label: rawName ?? widget.title, type: "notebook", entries: [{ text }] };
  }

  async function loadText(id: string, widget: WidgetInstance): Promise<Section | null> {
    const raw = await storage.getItem(`text-widget-${id}`);
    if (!raw) return null;
    const config: { source: { type: string; value: string } } = JSON.parse(raw);
    if (config.source.type === "text") {
      return { id, label: widget.title, type: "text", entries: [{ text: config.source.value }] };
    }
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(config.source.value)}`);
      const text = res.ok ? (await res.text()).trim() : null;
      if (!text) return null;
      return { id, label: widget.title, type: "text", entries: [{ text }] };
    } catch {
      return null;
    }
  }

  async function loadF1(widget: WidgetInstance): Promise<Section | null> {
    const cacheKey = `f1-cache-${new Date().toISOString().slice(0, 13)}`;
    const cached = await storage.getItem(cacheKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    if (cached) {
      data = JSON.parse(cached);
    } else {
      const res = await fetch("/api/f1");
      if (!res.ok) return null;
      data = await res.json();
    }

    const entries: Entry[] = [];

    if (data.race) {
      const { raceName, date, time, Circuit } = data.race;
      const raceDate = new Date(`${date}T${time ?? "12:00:00Z"}`);
      const diffDays = Math.ceil((raceDate.getTime() - Date.now()) / 86400000);
      const when = diffDays <= 0 ? "race day" : diffDays === 1 ? "tomorrow" : `in ${diffDays} days`;
      entries.push({
        title: raceName,
        meta: `${Circuit.circuitName} · ${Circuit.Location.country} · ${when}`,
      });
    }

    if (data.standings?.length) {
      entries.push({
        text: data.standings
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .slice(0, 5)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((s: any) => `${s.position}. ${s.Driver.code} ${s.Driver.familyName} — ${s.points}pts`)
          .join("\n"),
      });
    }

    if (!entries.length) return null;
    return { id: "f1", label: widget.title, type: "f1", entries };
  }

  async function loadRss(id: string, widget: WidgetInstance): Promise<Section | null> {
    const [raw, cached] = await Promise.all([
      storage.getItem(`rss-widget-${id}`),
      storage.getItem(`rss-widget-${id}-${today}`),
    ]);
    if (!raw) return null;
    const config: { url: string; limit: number; name?: string } = JSON.parse(raw);
    let items: { title: string; link: string; pubDate?: string; content?: string }[];
    if (cached) {
      items = JSON.parse(cached);
    } else {
      const res = await fetch(`/api/rss?url=${encodeURIComponent(config.url)}&limit=${config.limit}`);
      if (!res.ok) return null;
      items = await res.json();
    }
    if (!Array.isArray(items) || !items.length) return null;
    return {
      id,
      label: config.name ?? widget.title,
      type: "rss",
      entries: items.map(item => ({
        title: item.title,
        link: item.link,
        meta: item.pubDate
          ? new Date(item.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : undefined,
      })),
    };
  }

  async function loadReddit(id: string, widget: WidgetInstance): Promise<Section | null> {
    const storageKey = `reddit-widget-${id}`;
    const raw = await storage.getItem(storageKey);
    if (!raw) return null;
    const config = JSON.parse(raw);
    const subreddits: { name: string; limit: number; period: string }[] = config.subreddits ?? [];

    const cacheKey = `${storageKey}-v2-${today}-${subreddits.map(s => `${s.name}:${s.period}:${s.limit}`).join(",")}`;
    const cached = await storage.getItem(cacheKey);

    let entries: Entry[];
    if (cached) {
      const posts: { title: string; link: string; subreddit: string; content: string }[] = JSON.parse(cached);
      entries = posts.map(p => ({
        title: p.title,
        link: p.link,
        body: p.content ? stripTags(decodeEntities(p.content)).replace(/\s+/g, " ").trim() || undefined : undefined,
        meta: `r/${p.subreddit}`,
      }));
    } else {
      const results = await Promise.allSettled(
        subreddits.map(async sub => {
          const url = `https://www.reddit.com/r/${sub.name}/top.rss?t=${sub.period}&limit=${sub.limit}`;
          const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}&limit=${sub.limit}`);
          if (!res.ok) return [] as Entry[];
          const items: { title: string; link: string; content?: string }[] = await res.json();
          if (!Array.isArray(items)) return [] as Entry[];
          return items.map(item => ({
            title: item.title,
            link: item.link,
            body: item.content
              ? stripTags(decodeEntities(item.content)).replace(/\s+/g, " ").trim() || undefined
              : undefined,
            meta: `r/${sub.name}`,
          })) as Entry[];
        })
      );

      const lists = results
        .filter(r => r.status === "fulfilled")
        .map(r => (r as PromiseFulfilledResult<Entry[]>).value);

      entries = [];
      const maxLen = Math.max(...lists.map(l => l.length), 0);
      for (let i = 0; i < maxLen; i++) {
        for (const list of lists) {
          if (list[i]) entries.push(list[i]);
        }
      }
    }

    if (!entries.length) return null;
    return { id, label: widget.title, type: "reddit", entries };
  }

  async function loadYoutube(id: string, widget: WidgetInstance): Promise<Section | null> {
    const storageKey = `youtube-widget-${id}`;
    const raw = await storage.getItem(storageKey);
    if (!raw) return null;
    const config: { channels: { channelId: string; name: string; limit: number }[] } = JSON.parse(raw);

    const cacheKey = `${storageKey}-${today}-${config.channels.map(ch => `${ch.channelId}:${ch.limit}`).join(",")}`;
    const cached = await storage.getItem(cacheKey);

    let entries: Entry[];
    if (cached) {
      const videos: { title: string; link: string; published: string; channelName: string }[] = JSON.parse(cached);
      entries = videos.map(v => ({
        title: v.title,
        link: v.link,
        meta: `${v.channelName} · ${timeAgo(v.published)}`,
      }));
    } else {
      const results = await Promise.allSettled(
        config.channels.map(async ch => {
          const res = await fetch(`/api/youtube?channelId=${ch.channelId}&limit=${ch.limit}`);
          if (!res.ok) return [] as Entry[];
          const data = await res.json();
          return (data.videos ?? []).map((v: { title: string; link: string; publishedAt: string }) => ({
            title: v.title,
            link: v.link,
            meta: `${ch.name} · ${timeAgo(v.publishedAt)}`,
          })) as Entry[];
        })
      );

      const lists = results
        .filter(r => r.status === "fulfilled")
        .map(r => (r as PromiseFulfilledResult<Entry[]>).value);

      entries = [];
      const maxLen = Math.max(...lists.map(l => l.length), 0);
      for (let i = 0; i < maxLen; i++) {
        for (const list of lists) {
          if (list[i]) entries.push(list[i]);
        }
      }
    }

    if (!entries.length) return null;
    return { id, label: widget.title, type: "youtube", entries };
  }

  async function loadArxiv(id: string, widget: WidgetInstance): Promise<Section | null> {
    const [cachedRaw, configRaw] = await Promise.all([
      storage.getItem(`arxiv-widget-${id}-${today}`),
      storage.getItem(`arxiv-widget-${id}`),
    ]);
    const config: { category?: string } = configRaw ? JSON.parse(configRaw) : {};
    const category = config.category ?? "cs.AI";

    let papers: { title: string; link: string; content: string; pubDate: string }[];
    if (cachedRaw) {
      papers = JSON.parse(cachedRaw).papers ?? [];
    } else {
      const url = `https://rss.arxiv.org/rss/${category}`;
      const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}&limit=20`);
      if (!res.ok) return null;
      const raw: { title: string; link: string; content: string; pubDate: string }[] = await res.json();
      if (!Array.isArray(raw)) return null;
      papers = raw;
    }
    return {
      id,
      label: widget.title,
      type: "arxiv",
      entries: papers.map(p => {
        const parsed = parseArxivContent(p.content);
        return {
          title: p.title,
          link: p.link,
          body: [
            parsed.authors ? `Authors: ${parsed.authors}` : "",
            parsed.abstract,
          ].filter(Boolean).join("\n\n") || undefined,
          meta: p.pubDate
            ? new Date(p.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : undefined,
        };
      }),
    };
  }

  async function loadHf(id: string, widget: WidgetInstance): Promise<Section | null> {
    const configRaw = await storage.getItem(`hf-widget-${id}`);
    const config: { limit?: number } = configRaw ? JSON.parse(configRaw) : {};
    const limit = config.limit ?? 25;
    const cacheKey = `hf-papers-${limit}-${today}`;
    const cached = await storage.getItem(cacheKey);

    let papers: { title: string; abstract: string; authors: string[]; publishedAt: string; upvotes: number; link: string }[];
    if (cached) {
      papers = JSON.parse(cached);
    } else {
      const res = await fetch(`/api/hf?limit=${limit}`);
      if (!res.ok) return null;
      papers = await res.json();
    }

    return {
      id,
      label: widget.title,
      type: "hf",
      entries: papers.map(p => ({
        title: p.title,
        link: p.link,
        body: [
          p.authors.length ? `Authors: ${p.authors.join(", ")}` : "",
          p.abstract,
        ].filter(Boolean).join("\n\n") || undefined,
        meta: `▲ ${p.upvotes}`,
      })),
    };
  }

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--text-primary)]">
      <div className="max-w-3xl mx-auto px-8 py-10">

        {/* Masthead */}
        <header className="mb-1">
          <div className="flex items-baseline justify-between mb-3">
            <Link
              href="/"
              className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              ← back
            </Link>
            <span className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {dateLabel}
            </span>
          </div>
          <div className="border-t-4 border-[var(--text-primary)] pt-3 pb-2">
            <h1 className="font-[family-name:var(--font-playfair)] text-5xl font-bold tracking-tight text-center leading-none">
              oldenbyte
            </h1>
          </div>
          <div className="border-t border-b border-[var(--text-primary)] py-1.5 flex items-center justify-between">
            <span className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              morning briefing
            </span>
            {/* Key controls */}
            {!aiKey || showKeyInput ? (
              <div className="flex items-center gap-3">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={e => setKeyDraft(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveKey()}
                  placeholder="sk-..."
                  className="w-48 text-[11px] bg-transparent border-b border-[var(--surface-border)] focus:border-[var(--text-muted)] outline-none py-0.5 text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] font-[family-name:var(--font-dm-mono)]"
                />
                <button onClick={saveKey} className="text-[10px] font-[family-name:var(--font-dm-mono)] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">save</button>
                {aiKey && <button onClick={() => setShowKeyInput(false)} className="text-[10px] font-[family-name:var(--font-dm-mono)] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">cancel</button>}
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <button onClick={() => setShowKeyInput(true)} className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">edit key</button>
                {sectionSummaries.length > 0 && (
                  <button onClick={() => { setSectionSummaries([]); summaryRequestedRef.current = false; generateSummary(); }} className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">regenerate</button>
                )}
                <button
                  onClick={() => {
                    const next = !streamingMode;
                    setStreamingMode(next);
                    localStorage.setItem("digest-streaming", String(next));
                  }}
                  title={streamingMode ? "Streaming on" : "Streaming off"}
                  className={`transition-colors ${streamingMode ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                >
                  <Zap size={12} fill={streamingMode ? "currentColor" : "none"} />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Body */}
        <main className="mt-8">
          {!aiKey ? (
            <p className="font-[family-name:var(--font-playfair)] text-base italic text-[var(--text-muted)] text-center mt-16">
              Enter your OpenAI API key above to generate today&apos;s briefing.
            </p>
          ) : aiLoading ? (
            <p className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] text-center mt-16 animate-pulse">
              composing briefing…
            </p>
          ) : aiError ? (
            <p className="font-[family-name:var(--font-playfair)] text-sm italic text-[var(--text-muted)] text-center mt-16">{aiError}</p>
          ) : sectionSummaries.length > 0 ? (
            <div>
              {sectionSummaries.map((s, si) => (
                <article key={s.label} className={si > 0 ? "mt-10 pt-8 border-t border-[var(--surface-border)]" : ""}>
                  {/* Section flag */}
                  <div className="flex items-center gap-3 mb-4">
                    <span className="font-[family-name:var(--font-dm-mono)] text-[9px] uppercase tracking-[0.2em] text-[var(--page-bg)] bg-[var(--text-primary)] px-2 py-0.5">
                      {s.label}
                    </span>
                    <div className="flex-1 h-px bg-[var(--surface-border)]" />
                  </div>
                  {/* Prose */}
                  <div className="flex flex-col gap-4">
                    {renderProse(s.prose, s.refs)}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </main>

      </div>
    </div>
  );
}
