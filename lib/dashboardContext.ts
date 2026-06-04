// Gathers a plain-text snapshot of everything on the dashboard so the Chat
// widget can answer questions about the user's own data ("what's new on arXiv",
// "what did I note last Tuesday"). It reads the same storage keys and /api
// endpoints the widgets and the /digest page use.
//
// Unlike the digest gatherer, this INCLUDES the full note history (notebook is
// digestable:false, so the digest skips it) because past notes are a primary
// thing users want to ask about.

import * as storage from "@/lib/storage";

type TabLayoutItem = { i: string; tabs?: string[] };
type WidgetInstance = { id: string; type: string; title: string };

// Widget types worth feeding to the model as text. Notebook is handled
// separately (full history); reader/chess/chat/empty have no useful text.
const FEED_TYPES = new Set(["text", "f1", "rss", "reddit", "youtube", "arxiv", "hf", "tracker"]);

const today = () => new Date().toISOString().split("T")[0];

function stripTags(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, " ");
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

function decodeEntities(raw: string): string {
  if (typeof document === "undefined") return raw;
  const ta = document.createElement("textarea");
  ta.innerHTML = raw;
  return ta.value;
}

function clean(html: string): string {
  return stripTags(decodeEntities(html)).replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`;
}

function parseArxiv(raw: string) {
  const text = stripTags(raw);
  const authors = text.match(/Authors?:\s*(.+?)(?:\s*Abstract:|$)/i)?.[1]?.trim() ?? "";
  const abstract = text.match(/Abstract:\s*([\s\S]+)/i)?.[1]?.trim() ?? "";
  return { authors, abstract };
}

async function readJSON<T>(key: string): Promise<T | null> {
  const raw = await storage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// ── Notes: full history across every notepad instance, newest first ──────────
async function gatherNotes(): Promise<string | null> {
  const ids = (await readJSON<string[]>("notepad-registry")) ?? [];
  if (!ids.length) return null;

  const perId = await Promise.all(
    ids.map(async (id, i) => {
      const [dates, name] = await Promise.all([
        readJSON<Record<string, string>>(`notebook-${id}-dates`),
        storage.getItem(`notebook-${id}-name`),
      ]);
      return { name: name?.trim() || `Notepad ${i + 1}`, dates: dates ?? {} };
    })
  );

  const entries: { date: string; name: string; text: string }[] = [];
  for (const { name, dates } of perId) {
    for (const [date, html] of Object.entries(dates)) {
      const text = clean(html);
      if (text) entries.push({ date, name, text });
    }
  }
  if (!entries.length) return null;

  entries.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const body = entries
    .map(e => `### ${e.date} · ${e.name}\n${truncate(e.text, 1500)}`)
    .join("\n\n");
  return `## Notes (${entries.length} entries)\n${body}`;
}

// ── Per-widget feed snapshots ────────────────────────────────────────────────
async function gatherText(id: string, title: string): Promise<string | null> {
  const config = await readJSON<{ source: { type: string; value: string } }>(`text-widget-${id}`);
  if (!config) return null;
  if (config.source.type === "text") {
    return config.source.value ? `## ${title} (Text)\n${config.source.value}` : null;
  }
  try {
    const res = await fetch(`/api/proxy?url=${encodeURIComponent(config.source.value)}`);
    const text = res.ok ? (await res.text()).trim() : "";
    return text ? `## ${title} (Text)\n${truncate(text, 500)}` : null;
  } catch { return null; }
}

async function gatherF1(title: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = await readJSON(`f1-cache-${new Date().toISOString().slice(0, 13)}`);
  if (!data) {
    const res = await fetch("/api/f1");
    if (!res.ok) return null;
    data = await res.json();
  }
  const lines: string[] = [];
  if (data.race) {
    const { raceName, date, time, Circuit } = data.race;
    const raceDate = new Date(`${date}T${time ?? "12:00:00Z"}`);
    const days = Math.ceil((raceDate.getTime() - Date.now()) / 86400000);
    const when = days <= 0 ? "race day" : days === 1 ? "tomorrow" : `in ${days} days`;
    lines.push(`Next race: ${raceName} — ${Circuit?.circuitName}, ${Circuit?.Location?.country} (${date}, ${when})`);
  }
  if (data.standings?.length) {
    lines.push("Standings:");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of data.standings.slice(0, 5)) {
      lines.push(`  ${s.position}. ${s.Driver?.givenName} ${s.Driver?.familyName} — ${s.points} pts (${s.Constructors?.[0]?.name})`);
    }
  }
  return lines.length ? `## ${title} (F1)\n${lines.join("\n")}` : null;
}

function formatItems(items: { title: string; meta?: string; body?: string; link?: string }[]): string {
  return items
    .map(it => {
      let line = `- ${it.title}`;
      if (it.meta) line += ` (${it.meta})`;
      if (it.link) line += ` ${it.link}`;
      if (it.body) line += `\n  ${truncate(it.body, 400)}`;
      return line;
    })
    .join("\n");
}

async function gatherRss(id: string, title: string): Promise<string | null> {
  const config = await readJSON<{ url: string; limit: number; name?: string }>(`rss-widget-${id}`);
  if (!config) return null;
  let items = await readJSON<{ title: string; link: string; pubDate?: string }[]>(`rss-widget-${id}-${today()}`);
  if (!items) {
    const res = await fetch(`/api/rss?url=${encodeURIComponent(config.url)}&limit=${config.limit}`);
    if (!res.ok) return null;
    items = await res.json();
  }
  if (!Array.isArray(items) || !items.length) return null;
  const body = formatItems(items.map(it => ({
    title: it.title,
    link: it.link,
    meta: it.pubDate ? new Date(it.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : undefined,
  })));
  return `## ${config.name ?? title} (Feed)\n${body}`;
}

async function gatherReddit(id: string, title: string): Promise<string | null> {
  const config = await readJSON<{ subreddits: { name: string; limit: number; period: string }[] }>(`reddit-widget-${id}`);
  if (!config?.subreddits?.length) return null;
  const results = await Promise.allSettled(
    config.subreddits.map(async sub => {
      const url = `https://www.reddit.com/r/${sub.name}/top.rss?t=${sub.period}&limit=${sub.limit}`;
      const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}&limit=${sub.limit}`);
      if (!res.ok) return [];
      const items: { title: string; link: string; content?: string }[] = await res.json();
      return Array.isArray(items)
        ? items.map(it => ({ title: it.title, link: it.link, meta: `r/${sub.name}`, body: it.content ? clean(it.content) : undefined }))
        : [];
    })
  );
  const items = results.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  return items.length ? `## ${title} (Reddit)\n${formatItems(items)}` : null;
}

async function gatherYoutube(id: string, title: string): Promise<string | null> {
  const config = await readJSON<{ channels: { channelId: string; name: string; limit: number }[] }>(`youtube-widget-${id}`);
  if (!config?.channels?.length) return null;
  const results = await Promise.allSettled(
    config.channels.map(async ch => {
      const res = await fetch(`/api/youtube?channelId=${ch.channelId}&limit=${ch.limit}`);
      if (!res.ok) return [];
      const data = await res.json();
      const videos: { title: string; link: string; published?: string; publishedAt?: string }[] = data.videos ?? [];
      // Pull each video's description so the model knows what it's about, not
      // just its title. Best-effort and in parallel; missing ones just omit it.
      return Promise.all(videos.map(async v => {
        let body: string | undefined;
        try {
          const dRes = await fetch(`/api/youtube?video=${encodeURIComponent(v.link)}`);
          if (dRes.ok) {
            const desc: string = (await dRes.json()).description ?? "";
            body = desc.replace(/\s+/g, " ").trim() || undefined;
          }
        } catch { /* leave description off */ }
        return {
          title: v.title,
          link: v.link,
          meta: `${ch.name} · ${timeAgo(v.published ?? v.publishedAt ?? "")}`,
          body,
        };
      }));
    })
  );
  const items = results.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  return items.length ? `## ${title} (YouTube)\n${formatItems(items)}` : null;
}

async function gatherArxiv(id: string, title: string): Promise<string | null> {
  const [cached, config] = await Promise.all([
    readJSON<{ papers: { title: string; link: string; content: string; pubDate: string }[] }>(`arxiv-widget-${id}-${today()}`),
    readJSON<{ category?: string }>(`arxiv-widget-${id}`),
  ]);
  const category = config?.category ?? "cs.AI";
  let papers = cached?.papers;
  if (!papers) {
    const res = await fetch(`/api/rss?url=${encodeURIComponent(`https://rss.arxiv.org/rss/${category}`)}&limit=20`);
    if (!res.ok) return null;
    papers = await res.json();
  }
  if (!Array.isArray(papers) || !papers.length) return null;
  const body = formatItems(papers.map(p => {
    const { authors, abstract } = parseArxiv(p.content);
    return { title: p.title, link: p.link, body: [authors && `Authors: ${authors}`, abstract].filter(Boolean).join(" — ") || undefined };
  }));
  return `## ${title} (arXiv ${category})\n${body}`;
}

async function gatherHf(id: string, title: string): Promise<string | null> {
  const config = await readJSON<{ limit?: number }>(`hf-widget-${id}`);
  const limit = config?.limit ?? 25;
  let papers = await readJSON<{ title: string; abstract: string; authors: string[]; upvotes: number; link: string }[]>(`hf-papers-${limit}-${today()}`);
  if (!papers) {
    const res = await fetch(`/api/hf?limit=${limit}`);
    if (!res.ok) return null;
    papers = await res.json();
  }
  if (!Array.isArray(papers) || !papers.length) return null;
  const body = formatItems(papers.map(p => ({
    title: p.title,
    link: p.link,
    meta: `▲ ${p.upvotes}`,
    body: [p.authors?.length ? `Authors: ${p.authors.join(", ")}` : "", p.abstract].filter(Boolean).join(" — ") || undefined,
  })));
  return `## ${title} (HF Daily)\n${body}`;
}

async function gatherTracker(id: string, title: string): Promise<string | null> {
  const [config, days] = await Promise.all([
    readJSON<{ items: { id: string; name: string }[] }>(`tracker-config-${id}`),
    readJSON<Record<string, Record<string, number>>>(`tracker-days-${id}`),
  ]);
  if (!config?.items?.length || !days) return null;
  const name = Object.fromEntries(config.items.map(i => [i.id, i.name]));
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  // Most recent 7 days that have any tracked time.
  const dates = Object.keys(days).filter(d => Object.values(days[d]).some(v => v > 0)).sort((a, b) => b.localeCompare(a)).slice(0, 7);
  if (!dates.length) return null;
  const blocks = dates.map(d => {
    const rows = Object.entries(days[d])
      .filter(([, secs]) => secs > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([aid, secs]) => `  ${name[aid] ?? aid}: ${fmt(secs)}`);
    return `### ${d}\n${rows.join("\n")}`;
  });
  return `## ${title} (Tracker — time spent)\n${blocks.join("\n")}`;
}

async function gatherWidget(id: string, w: WidgetInstance): Promise<string | null> {
  switch (w.type) {
    case "text":    return gatherText(id, w.title);
    case "f1":      return gatherF1(w.title);
    case "rss":     return gatherRss(id, w.title);
    case "reddit":  return gatherReddit(id, w.title);
    case "youtube": return gatherYoutube(id, w.title);
    case "arxiv":   return gatherArxiv(id, w.title);
    case "hf":      return gatherHf(id, w.title);
    case "tracker": return gatherTracker(id, w.title);
    default:        return null;
  }
}

export type DashboardContext = { text: string; chars: number; sections: number };

/**
 * Build a single text block describing the current dashboard. Notes (full
 * history) come first, then each feed widget's latest snapshot in layout order.
 * Returns empty text when nothing is configured.
 */
export async function gatherDashboardContext(): Promise<DashboardContext> {
  const [layout, instances] = await Promise.all([
    readJSON<TabLayoutItem[]>("widget-layout"),
    readJSON<Record<string, WidgetInstance>>("widget-instances"),
  ]);

  const blocks: string[] = [];

  const notes = await gatherNotes();
  if (notes) blocks.push(notes);

  if (layout && instances) {
    const ids: string[] = [];
    for (const item of layout) {
      ids.push(item.i);
      for (const tab of item.tabs ?? []) ids.push(tab);
    }
    const feedBlocks = await Promise.allSettled(
      ids
        .filter(id => instances[id] && FEED_TYPES.has(instances[id].type))
        .map(id => gatherWidget(id, instances[id]))
    );
    for (const b of feedBlocks) {
      if (b.status === "fulfilled" && b.value) blocks.push(b.value);
    }
  }

  const text = blocks.join("\n\n");
  return { text, chars: text.length, sections: blocks.length };
}
