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

// OpenAI's /models endpoint needs a key and is noisy, so offer a curated list.
const OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"];
const defaultModelsFor = (url: string) => (/openai\.com/i.test(url) ? OPENAI_MODELS : []);

export default function DigestPage() {
  const [mode] = useState<"digest" | "full" | "ai">("ai");
  const [sections, setSections]   = useState<Section[]>([]);
  const [loading, setLoading]     = useState(true);
  // Any OpenAI-compatible endpoint (local Ollama/LM Studio/llama.cpp or a hosted
  // provider). Stored in localStorage, like the original key was.
  const [baseUrl, setBaseUrl]   = useState("https://api.openai.com/v1");
  const [model, setModel]       = useState("gpt-4o-mini");
  const [apiKey, setApiKey]     = useState("");
  const [draft, setDraft]       = useState({ baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [models, setModels]     = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [sectionSummaries, setSectionSummaries] = useState<{ label: string; prose: string; refs: Ref[] }[]>([]);
  const [aiLoading, setAiLoading]       = useState(false);
  const [generating, setGenerating]     = useState(false); // true while sections stream in
  const [aiError, setAiError]           = useState("");
  const [streamingMode, setStreamingMode] = useState(false);
  const summaryRequestedRef             = useRef(false);
  // Aborts the in-flight compose when a new one starts or the page unmounts.
  const composeAbortRef                 = useRef<AbortController | null>(null);
  useEffect(() => () => composeAbortRef.current?.abort(), []);

  const today = new Date().toISOString().split("T")[0];
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  useEffect(() => {
    const savedUrl = localStorage.getItem("digest-base-url") || "https://api.openai.com/v1";
    const savedModel = localStorage.getItem("digest-model") || "gpt-4o-mini";
    const savedKey = localStorage.getItem("digest-openai-key") ?? "";
    setBaseUrl(savedUrl); setModel(savedModel); setApiKey(savedKey);
    setDraft({ baseUrl: savedUrl, model: savedModel, apiKey: savedKey });
    setModels(defaultModelsFor(savedUrl));
    setStreamingMode(localStorage.getItem("digest-streaming") === "true");
    loadAll().then(s => { setSections(s); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hosted providers need a key; local servers don't.
  const NEEDS_KEY = /(openai|anthropic|googleapis)\.com/i;
  const configured = Boolean(baseUrl && model && (apiKey || !NEEDS_KEY.test(baseUrl)));

  // Auto-generate when AI tab is selected, configured, sections loaded, no summary yet
  useEffect(() => {
    if (mode !== "ai" || !configured || loading || !sections.length || sectionSummaries.length || aiLoading) return;
    if (summaryRequestedRef.current) return;
    storage.getItem(`digest-ai-sections-${today}`).then(cached => {
      if (cached) {
        setSectionSummaries(JSON.parse(cached));
        return;
      }
      generateSummary();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, configured, loading, sections]);

  // Load an endpoint's models, then select `preferred` if it's in the list,
  // otherwise the first. OpenAI uses a curated list (its /models needs a key).
  // While searching, the model is cleared so the field shows empty/loading.
  async function loadModelsFor(url: string, key: string, preferred: string) {
    if (!url) { setModels([]); return; }
    const pick = (list: string[]) => (list.includes(preferred) ? preferred : (list[0] ?? ""));
    if (/openai\.com/i.test(url)) {
      setModels(OPENAI_MODELS);
      setDraft(d => ({ ...d, model: pick(OPENAI_MODELS) }));
      return;
    }
    setLoadingModels(true);
    setModels([]);
    setDraft(d => ({ ...d, model: "" })); // empty while searching
    try {
      const params = new URLSearchParams({ baseUrl: url });
      if (key) params.set("apiKey", key);
      const res = await fetch(`/api/chat?${params.toString()}`);
      const data = await res.json();
      const list: string[] = res.ok && Array.isArray(data.models) ? data.models : [];
      setModels(list);
      setDraft(d => ({ ...d, model: pick(list) }));
    } catch {
      setModels([]);
      setDraft(d => ({ ...d, model: "" }));
    } finally {
      setLoadingModels(false);
    }
  }

  // Switching endpoint (preset) auto-loads its models, keeping your saved model
  // if that server has it, else the first.
  function setEndpoint(url: string) {
    setDraft(d => ({ ...d, baseUrl: url, model: "" }));
    loadModelsFor(url, draft.apiKey, model);
  }

  function openSettings() {
    setDraft({ baseUrl, model, apiKey });
    setShowSettings(true);
    loadModelsFor(baseUrl, apiKey, model); // re-list for the saved endpoint, keep your model
  }

  function saveSettings(recompose = false) {
    const next = { baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), apiKey: draft.apiKey.trim() };
    setBaseUrl(next.baseUrl); setModel(next.model); setApiKey(next.apiKey);
    localStorage.setItem("digest-base-url", next.baseUrl);
    localStorage.setItem("digest-model", next.model);
    localStorage.setItem("digest-openai-key", next.apiKey);
    setShowSettings(false);

    const nowConfigured = Boolean(next.baseUrl && next.model && (next.apiKey || !NEEDS_KEY.test(next.baseUrl)));
    if (recompose && nowConfigured) {
      setSectionSummaries([]);
      summaryRequestedRef.current = false;
      storage.removeItem(`digest-ai-sections-${today}`);
      generateSummary(next);
    }
  }

  const PRESETS = [
    { label: "OpenAI", url: "https://api.openai.com/v1" },
    { label: "Ollama", url: "http://localhost:11434/v1" },
    { label: "LM Studio", url: "http://localhost:1234/v1" },
  ];

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

  // `cfg` lets a caller pass freshly-saved settings (state updates are async, so
  // we can't rely on the baseUrl/model/apiKey state right after setting them).
  async function generateSummary(cfg?: { baseUrl: string; apiKey: string; model: string }) {
    const ep = cfg ?? { baseUrl, apiKey, model };

    // Cancel any compose already running, then own the new one. `active()` is
    // true only while this run is the latest — so a superseded run never writes
    // state or persists stale results over the newer one.
    composeAbortRef.current?.abort();
    const controller = new AbortController();
    composeAbortRef.current = controller;
    const signal = controller.signal;
    const active = () => composeAbortRef.current === controller && !signal.aborted;

    summaryRequestedRef.current = true;
    setAiLoading(true);
    setGenerating(true);
    setAiError("");

    if (streamingMode) {
      // Pre-populate sections so they appear immediately and fill in real-time
      const initial = sections.map(s => ({ label: s.label, prose: "", refs: [] as Ref[] }));
      setSectionSummaries(initial);
      setAiLoading(false);

      const finalSummaries = [...initial];

      await Promise.allSettled(sections.map(async (section, idx) => {
        const { content, refs } = buildSectionContent(section);
        try {
          const res = await fetch("/api/digest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: ep.model, content, stream: true }),
            signal,
          });
          if (!res.ok || !res.body) return;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let prose = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            prose += decoder.decode(value, { stream: true });
            if (active()) setSectionSummaries(prev => {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], prose, refs };
              return updated;
            });
          }
          finalSummaries[idx] = { label: section.label, prose, refs };
        } catch { /* aborted or failed — leave this section as-is */ }
      }));

      if (active()) {
        await storage.setItem(`digest-ai-sections-${today}`, JSON.stringify(finalSummaries));
        setGenerating(false);
      }
    } else {
      try {
        const results = await Promise.allSettled(
          sections.map(async section => {
            const { content, refs } = buildSectionContent(section);
            const res = await fetch("/api/digest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: ep.model, content }),
              signal,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Unknown error");
            return { label: section.label, prose: data.summary as string, refs };
          })
        );
        if (!active()) return;
        const newSectionSummaries = results
          .filter(r => r.status === "fulfilled")
          .map(r => (r as PromiseFulfilledResult<{ label: string; prose: string; refs: Ref[] }>).value);
        setSectionSummaries(newSectionSummaries);
        await storage.setItem(`digest-ai-sections-${today}`, JSON.stringify(newSectionSummaries));
      } catch (err) {
        if (!active()) return;
        setAiError(String(err));
        summaryRequestedRef.current = false;
      } finally {
        if (active()) { setAiLoading(false); setGenerating(false); }
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
            <span suppressHydrationWarning className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
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
            <div className="flex items-center gap-4">
              <button onClick={() => (showSettings ? setShowSettings(false) : openSettings())} className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">{showSettings ? "close" : "model"}</button>
              {configured && !aiLoading && !generating && (
                <button onClick={() => { setSectionSummaries([]); summaryRequestedRef.current = false; storage.removeItem(`digest-ai-sections-${today}`); generateSummary(); }} className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">regenerate</button>
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
          </div>

          {/* Model config — base URL + model (+ optional key) */}
          {(showSettings || !configured) && (
            <div className="border-b border-[var(--surface-border)] py-3 flex flex-col gap-2.5 text-[var(--text-primary)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] w-20 shrink-0">endpoint</span>
                <input
                  value={draft.baseUrl}
                  onChange={e => { const v = e.target.value; setDraft(d => ({ ...d, baseUrl: v })); setModels(defaultModelsFor(v)); }}
                  placeholder="http://localhost:11434/v1"
                  className="flex-1 min-w-[12rem] text-[12px] bg-transparent border-b border-[var(--surface-border)] focus:border-[var(--text-muted)] outline-none py-0.5 placeholder:text-[var(--text-placeholder)] font-[family-name:var(--font-dm-mono)]"
                />
                {PRESETS.map(p => (
                  <button key={p.label} onClick={() => setEndpoint(p.url)} className="text-[9px] font-[family-name:var(--font-dm-mono)] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)]">{p.label}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] w-20 shrink-0">model</span>
                {loadingModels ? (
                  <span className="flex-1 min-w-[12rem] text-[12px] italic text-[var(--text-muted)] py-0.5 font-[family-name:var(--font-dm-mono)] animate-pulse">searching models…</span>
                ) : models.length > 0 ? (
                  <select value={draft.model} onChange={e => setDraft(d => ({ ...d, model: e.target.value }))} className="flex-1 min-w-[12rem] text-[12px] bg-transparent border-b border-[var(--surface-border)] focus:border-[var(--text-muted)] outline-none py-0.5 font-[family-name:var(--font-dm-mono)]">
                    <option value="" disabled>select a model…</option>
                    {draft.model && !models.includes(draft.model) && <option value={draft.model}>{draft.model}</option>}
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input value={draft.model} onChange={e => setDraft(d => ({ ...d, model: e.target.value }))} placeholder="e.g. gpt-4o-mini or llama3.2" className="flex-1 min-w-[12rem] text-[12px] bg-transparent border-b border-[var(--surface-border)] focus:border-[var(--text-muted)] outline-none py-0.5 placeholder:text-[var(--text-placeholder)] font-[family-name:var(--font-dm-mono)]" />
                )}
                {!loadingModels && (
                  <button onClick={() => loadModelsFor(draft.baseUrl, draft.apiKey, draft.model || model)} className="text-[9px] font-[family-name:var(--font-dm-mono)] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)]">load models</button>
                )}
              </div>
              {/* API key — only for hosted providers that need one */}
              {NEEDS_KEY.test(draft.baseUrl) && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] w-20 shrink-0">api key</span>
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && saveSettings(false)}
                    placeholder="sk-..."
                    className="flex-1 min-w-[12rem] text-[12px] bg-transparent border-b border-[var(--surface-border)] focus:border-[var(--text-muted)] outline-none py-0.5 placeholder:text-[var(--text-placeholder)] font-[family-name:var(--font-dm-mono)]"
                  />
                </div>
              )}
              <div className="flex justify-end gap-4">
                {Boolean(draft.baseUrl && draft.model && (draft.apiKey || !NEEDS_KEY.test(draft.baseUrl))) && (
                  <button onClick={() => saveSettings(true)} className="text-[10px] font-[family-name:var(--font-dm-mono)] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)]">save &amp; recompose</button>
                )}
                <button onClick={() => saveSettings(false)} className="text-[10px] font-[family-name:var(--font-dm-mono)] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)]">save</button>
              </div>
            </div>
          )}
        </header>

        {/* Body */}
        <main className="mt-8">
          {!configured ? (
            <p className="font-[family-name:var(--font-playfair)] text-base italic text-[var(--text-muted)] text-center mt-16">
              Set a model above to generate today&apos;s briefing — a local one (Ollama, LM Studio) or a hosted provider with an API key.
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
                  {/* Prose — or a per-section composing indicator while it streams in */}
                  <div className="flex flex-col gap-4">
                    {s.prose
                      ? renderProse(s.prose, s.refs)
                      : generating
                        ? <p className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] animate-pulse">composing…</p>
                        : <p className="font-[family-name:var(--font-playfair)] text-sm italic text-[var(--text-muted)]">no content.</p>}
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
