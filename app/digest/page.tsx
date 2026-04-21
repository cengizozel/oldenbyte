"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import * as storage from "@/lib/storage";

type TabLayoutItem = { i: string; tabs?: string[] };
type WidgetInstance = { id: string; type: string; title: string };

type Entry = {
  text?: string;
  title?: string;
  body?: string;
  meta?: string;
  link?: string;
};

type Section = {
  id: string;
  label: string;
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
  const [mode, setMode]       = useState<"digest" | "full">("digest");
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().split("T")[0];
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  useEffect(() => {
    loadAll().then(s => { setSections(s); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      return w && w.type !== "ebook" && w.type !== "empty";
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
      case "text":     return loadText(id);
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
    return { id, label: rawName ?? widget.title, entries: [{ text }] };
  }

  async function loadText(id: string): Promise<Section | null> {
    const raw = await storage.getItem(`text-widget-${id}`);
    if (!raw) return null;
    const config: { source: { type: string; value: string } } = JSON.parse(raw);
    if (config.source.type === "text") {
      return { id, label: "Text", entries: [{ text: config.source.value }] };
    }
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(config.source.value)}`);
      const text = res.ok ? (await res.text()).trim() : null;
      if (!text) return null;
      return { id, label: "Text", entries: [{ text }] };
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
    return { id: "f1", label: widget.title, entries };
  }

  async function loadRss(id: string, widget: WidgetInstance): Promise<Section | null> {
    const raw = await storage.getItem(`rss-widget-${id}`);
    if (!raw) return null;
    const config: { url: string; limit: number; name?: string } = JSON.parse(raw);
    const res = await fetch(`/api/rss?url=${encodeURIComponent(config.url)}&limit=${config.limit}`);
    if (!res.ok) return null;
    const items: { title: string; link: string; pubDate?: string; content?: string }[] = await res.json();
    if (!Array.isArray(items) || !items.length) return null;
    return {
      id,
      label: config.name ?? widget.title,
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
    const raw = await storage.getItem(`reddit-widget-${id}`);
    if (!raw) return null;
    const config = JSON.parse(raw);
    const subreddits: { name: string; limit: number; period: string }[] = config.subreddits ?? [];

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

    const entries: Entry[] = [];
    const maxLen = Math.max(...lists.map(l => l.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const list of lists) {
        if (list[i]) entries.push(list[i]);
      }
    }

    if (!entries.length) return null;
    return { id, label: widget.title, entries };
  }

  async function loadYoutube(id: string, widget: WidgetInstance): Promise<Section | null> {
    const raw = await storage.getItem(`youtube-widget-${id}`);
    if (!raw) return null;
    const config: { channels: { channelId: string; name: string; limit: number }[] } = JSON.parse(raw);

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

    const entries: Entry[] = [];
    const maxLen = Math.max(...lists.map(l => l.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const list of lists) {
        if (list[i]) entries.push(list[i]);
      }
    }

    if (!entries.length) return null;
    return { id, label: widget.title, entries };
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
      label: `${widget.title} — ${category}`,
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
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-start justify-between mb-12">
          <div>
            <Link
              href="/"
              className="text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors"
            >
              ← back
            </Link>
            <h1 className="font-[family-name:var(--font-dm-mono)] text-base font-medium mt-2">
              oldenbyte
            </h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">{dateLabel}</p>
          </div>
          <div className="flex items-center gap-5 pt-6">
            <button
              onClick={() => setMode("digest")}
              className={`text-sm font-[family-name:var(--font-dm-mono)] transition-colors ${
                mode === "digest"
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              digest
            </button>
            <button
              onClick={() => setMode("full")}
              className={`text-sm font-[family-name:var(--font-dm-mono)] transition-colors ${
                mode === "full"
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              full
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <p className="text-[var(--text-muted)] text-sm font-[family-name:var(--font-dm-mono)]">
            loading...
          </p>
        ) : sections.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">nothing to show today.</p>
        ) : (
          <div className="flex flex-col">
            {sections.map((section, si) => (
              <div key={section.id} className={si > 0 ? "mt-10 pt-10 border-t border-[var(--surface-border)]" : ""}>
                <p className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-4">
                  {section.label}
                </p>
                <div className="flex flex-col gap-4">
                  {section.entries.map((entry, i) => (
                    <div key={i}>
                      {entry.text ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {entry.text}
                        </p>
                      ) : (
                        <div>
                          {entry.link ? (
                            <a
                              href={entry.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm leading-snug hover:opacity-60 transition-opacity"
                            >
                              {entry.title}
                            </a>
                          ) : (
                            <p className="text-sm leading-snug">{entry.title}</p>
                          )}
                          {entry.meta && (
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                              {entry.meta}
                            </p>
                          )}
                          {mode === "full" && entry.body && (
                            <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed whitespace-pre-wrap">
                              {entry.body}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
