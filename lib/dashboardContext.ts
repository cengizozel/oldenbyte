// Gathers a plain-text snapshot of everything on the dashboard so the Chat
// widget can answer questions about the user's own data ("what's new on arXiv",
// "what did I note last Tuesday"). It reads the same storage keys and /api
// endpoints the widgets and the /digest page use.
//
// Unlike the digest gatherer, this INCLUDES the full note history (notebook is
// digestable:false, so the digest skips it) because past notes are a primary
// thing users want to ask about.

import * as storage from "@/lib/storage";
import { getActiveDataKeys } from "@/lib/dashboards";
import { summarizeForecast } from "@/lib/weather";

type TabLayoutItem = { i: string; tabs?: string[] };
type WidgetInstance = { id: string; type: string; title: string };

// Widget types worth feeding to the model as text. Notebook is handled
// separately (full history); reader/chess/chat/empty have no useful text.
const FEED_TYPES = new Set(["text", "f1", "weather", "calendar", "rss", "reddit", "youtube", "arxiv", "hf", "tracker", "rhythm", "upkeep"]);

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

// ── Notes: full history of one notepad instance, newest first ────────────────
async function gatherNotebook(id: string, title: string): Promise<string | null> {
  const [dates, name] = await Promise.all([
    readJSON<Record<string, string>>(`notebook-${id}-dates`),
    storage.getItem(`notebook-${id}-name`),
  ]);
  if (!dates) return null;
  const entries = Object.entries(dates)
    .map(([date, html]) => ({ date, text: clean(html) }))
    .filter(e => e.text)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!entries.length) return null;
  const label = name?.trim() || title;
  const body = entries.map(e => `### ${e.date}\n${truncate(e.text, 1500)}`).join("\n\n");
  return `## ${label} (Notes, ${entries.length} entries)\n${body}`;
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

async function gatherWeather(id: string, title: string): Promise<string | null> {
  const config = await readJSON<{ name: string; lat: number; lon: number; unit?: "c" | "f" }>(`weather-widget-${id}`);
  if (!config || !isFinite(config.lat) || !isFinite(config.lon)) return null;
  try {
    const res = await fetch(`/api/weather?lat=${config.lat}&lon=${config.lon}&unit=${config.unit ?? "c"}`);
    if (!res.ok) return null;
    const lines = summarizeForecast(config.name, config.unit ?? "c", await res.json());
    return lines.length ? `## ${title} (Weather)\n${lines.join("\n")}` : null;
  } catch { return null; }
}

async function gatherCalendar(id: string, title: string): Promise<string | null> {
  const cfg = await readJSON<CalendarAccount & { days?: number }>(`calendar-widget-${id}`);
  if (!cfg?.baseUrl || !cfg.username || !cfg.calendars?.length) return null;
  try {
    const start = new Date();
    const end = new Date(start.getTime() + (cfg.days ?? 7) * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const res = await fetch("/api/caldav", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "events", baseUrl: cfg.baseUrl, username: cfg.username, password: cfg.password, calendars: cfg.calendars, start: fmt(start), end: fmt(end) }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    type Ev = { start: string; end: string; allDay: boolean; title: string; calendar: string; location?: string };
    const events: Ev[] = data.events ?? [];
    if (!events.length) return `## ${title} (Calendar)\nNo events in the next ${cfg.days ?? 7} days.`;
    const lines = events.map(e =>
      `- ${e.allDay ? `${e.start} (all day)` : e.start.replace("T", " ")}: ${e.title} [${e.calendar}]${e.location ? ` @ ${e.location}` : ""}`
    );
    return `## ${title} (Calendar, next ${cfg.days ?? 7} days)\n${lines.join("\n")}`;
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

async function gatherRhythm(id: string, title: string): Promise<string | null> {
  type Item = { id: string; name: string; kind?: "moment" | "session"; mode?: "build" | "reduce"; target?: number };
  const [config, logData] = await Promise.all([
    readJSON<{ items: Item[] }>(`rhythm-config-${id}`),
    readJSON<{ events?: Record<string, number[]>; sessions?: Record<string, [number, number][]> }>(`rhythm-log-${id}`),
  ]);
  if (!config?.items?.length) return null;
  const events = logData?.events ?? {};
  const sessions = logData?.sessions ?? {};
  const DAY = 86400000;
  const windowStart = Date.now() - 30 * DAY;
  const minutesOfDay = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  const meanTime = (mins: number[]): string | null => {
    if (!mins.length) return null;
    let sx = 0, sy = 0;
    for (const m of mins) { const a = (m / 1440) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); }
    let mean = Math.atan2(sy / mins.length, sx / mins.length);
    if (mean < 0) mean += 2 * Math.PI;
    const t = Math.round((mean / (2 * Math.PI)) * 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };
  const since = (ms: number) => {
    const h = Math.floor((Date.now() - ms) / 3600000);
    if (h < 1) return "under an hour ago";
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };
  const lines = config.items.map(it => {
    const goal = it.mode === "reduce" ? "reducing" : "building";
    if ((it.kind ?? "moment") === "session") {
      const sess = (sessions[it.id] ?? []).filter(s => s[0] >= windowStart);
      if (!sess.length) return `- ${it.name} (session, ${goal}): nothing logged in 30 days`;
      const avg = sess.reduce((a, s) => a + (s[1] - s[0]), 0) / sess.length / 1000;
      const h = Math.floor(avg / 3600), m = Math.floor((avg % 3600) / 60);
      return `- ${it.name} (session, ${goal}): ${sess.length} in 30 days, average ${h}h ${m}m, typically ${meanTime(sess.map(s => minutesOfDay(s[0])))} to ${meanTime(sess.map(s => minutesOfDay(s[1])))}, last ended ${since(Math.max(...sess.map(s => s[1])))}`;
    }
    const evs = (events[it.id] ?? []).filter(t => t >= windowStart);
    if (!evs.length) return `- ${it.name} (${goal}): nothing logged in 30 days`;
    const last7 = evs.filter(t => t >= Date.now() - 7 * DAY).length;
    const tgt = it.target != null ? `, ${it.mode === "reduce" ? "limit" : "target"} ${it.target}/day` : "";
    return `- ${it.name} (${goal}${tgt}): ${(last7 / 7).toFixed(1)}x/day over the last week, ${evs.length} in 30 days, last ${since(Math.max(...evs))}`;
  });
  return `## ${title} (Rhythm — habit logging)\nToday is ${today()}. Times are local.\n${lines.join("\n")}`;
}

async function gatherUpkeep(id: string, title: string): Promise<string | null> {
  type Item = { id: string; name: string; weight: number };
  const [config, daysMap] = await Promise.all([
    readJSON<{ items: Item[] }>(`upkeep-config-${id}`),
    readJSON<Record<string, string[]>>(`upkeep-days-${id}`),
  ]);
  if (!config?.items?.length) return null;
  const items = config.items.map(i => ({ ...i, weight: i.weight > 0 ? i.weight : 1 }));
  const days = daysMap ?? {};
  const createdDay = (iid: string) => {
    const ms = parseInt(iid.split("-")[0], 10);
    return Number.isFinite(ms) ? new Date(ms).toISOString().split("T")[0] : "1970-01-01";
  };
  const score = (date: string): number | null => {
    const active = items.filter(it => createdDay(it.id) <= date);
    const total = active.reduce((a, it) => a + it.weight, 0);
    if (total <= 0) return null;
    const checked = new Set(days[date] ?? []);
    const done = active.filter(it => checked.has(it.id)).reduce((a, it) => a + it.weight, 0);
    return Math.round((done / total) * 100);
  };
  const t = today();
  const checkedToday = new Set(days[t] ?? []);
  const todayLines = items.map(it => `  ${it.name} (${it.weight}pts): ${checkedToday.has(it.id) ? "done" : "not yet"}`);
  const recent = Object.keys(days).filter(d => d < t).sort((a, b) => b.localeCompare(a)).slice(0, 6)
    .map(d => `  ${d}: ${score(d) ?? "—"}/100`);
  const recentBlock = recent.length ? `\n### Recent days\n${recent.join("\n")}` : "";
  return `## ${title} (Upkeep — daily essentials score)\nToday is ${t}. Score ${score(t) ?? "—"}/100.\n${todayLines.join("\n")}${recentBlock}`;
}

async function gatherWidget(id: string, w: WidgetInstance): Promise<string | null> {
  switch (w.type) {
    case "notebook": return gatherNotebook(id, w.title);
    case "text":    return gatherText(id, w.title);
    case "weather": return gatherWeather(id, w.title);
    case "calendar": return gatherCalendar(id, w.title);
    case "f1":      return gatherF1(w.title);
    case "rss":     return gatherRss(id, w.title);
    case "reddit":  return gatherReddit(id, w.title);
    case "youtube": return gatherYoutube(id, w.title);
    case "arxiv":   return gatherArxiv(id, w.title);
    case "hf":      return gatherHf(id, w.title);
    case "tracker": return gatherTracker(id, w.title);
    case "rhythm":  return gatherRhythm(id, w.title);
    case "upkeep":  return gatherUpkeep(id, w.title);
    default:        return null;
  }
}

export type DashboardContext = { text: string; chars: number; sections: number };
export type WidgetEntry = { id: string; title: string; type: string; text: string };

// Types that can produce queryable text. Notebook included: each notepad on
// the active dashboard becomes its own entry (so it gets its own checkbox in
// the chat's data sources).
const ENTRY_TYPES = new Set([...FEED_TYPES, "notebook"]);

export type WidgetRosterItem = { id: string; title: string; type: string };

export type CalendarAccount = {
  baseUrl: string;
  username: string;
  password: string;
  calendars: { name: string; url: string; readOnly?: boolean; source?: string }[];
};
export type CalendarSource = { widgetId: string; account: CalendarAccount };

/**
 * The first configured Calendar widget's CalDAV account on the active
 * dashboard, so the chat can read/write the calendar without storing a second
 * copy of the credentials.
 */
export async function getCalendarAccount(): Promise<CalendarSource | null> {
  const keys = await getActiveDataKeys();
  const [layout, instances] = await Promise.all([
    readJSON<TabLayoutItem[]>(keys.layout),
    readJSON<Record<string, WidgetInstance>>(keys.instances),
  ]);
  if (!layout || !instances) return null;
  const ids: string[] = [];
  for (const item of layout) {
    ids.push(item.i);
    for (const tab of item.tabs ?? []) ids.push(tab);
  }
  for (const id of ids) {
    if (instances[id]?.type !== "calendar") continue;
    const cfg = await readJSON<CalendarAccount>(`calendar-widget-${id}`);
    if (cfg?.baseUrl && cfg.username && cfg.calendars?.length) return { widgetId: id, account: cfg };
  }
  return null;
}

/**
 * Just the roster of data-bearing widgets on the active dashboard (no content
 * fetching). Drives the chat's data-source checkbox list.
 */
export async function listDashboardWidgets(): Promise<WidgetRosterItem[]> {
  const keys = await getActiveDataKeys();
  const [layout, instances] = await Promise.all([
    readJSON<TabLayoutItem[]>(keys.layout),
    readJSON<Record<string, WidgetInstance>>(keys.instances),
  ]);
  if (!layout || !instances) return [];
  const ids: string[] = [];
  for (const item of layout) {
    ids.push(item.i);
    for (const tab of item.tabs ?? []) ids.push(tab);
  }
  return ids
    .filter(id => instances[id] && ENTRY_TYPES.has(instances[id].type))
    .map(id => ({ id, title: instances[id].title, type: instances[id].type }));
}

/**
 * Gather one entry per data-bearing widget on the active dashboard, in layout
 * order (tab-grouped widgets included). `include` lets the caller filter by
 * instance id before any fetching happens (the chat's checkbox list).
 */
export async function gatherWidgetEntries(
  include?: (id: string, type: string) => boolean
): Promise<WidgetEntry[]> {
  const keys = await getActiveDataKeys();
  const [layout, instances] = await Promise.all([
    readJSON<TabLayoutItem[]>(keys.layout),
    readJSON<Record<string, WidgetInstance>>(keys.instances),
  ]);
  if (!layout || !instances) return [];

  const ids: string[] = [];
  for (const item of layout) {
    ids.push(item.i);
    for (const tab of item.tabs ?? []) ids.push(tab);
  }

  const settled = await Promise.allSettled(
    ids
      .filter(id => instances[id] && ENTRY_TYPES.has(instances[id].type))
      .filter(id => !include || include(id, instances[id].type))
      .map(async id => ({
        id,
        title: instances[id].title,
        type: instances[id].type,
        text: (await gatherWidget(id, instances[id])) ?? "",
      }))
  );
  return settled
    .filter((r): r is PromiseFulfilledResult<WidgetEntry> => r.status === "fulfilled")
    .map(r => r.value)
    .filter(e => e.text);
}

/**
 * Build a single text block describing the current dashboard, one section per
 * widget in layout order. Returns empty text when nothing is configured.
 */
export async function gatherDashboardContext(): Promise<DashboardContext> {
  const entries = await gatherWidgetEntries();
  const text = entries.map(e => e.text).join("\n\n");
  return { text, chars: text.length, sections: entries.length };
}
