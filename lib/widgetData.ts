// Server-side, on-demand widget readers for the chat's read_widget and
// search_dashboard tools. Each call fetches the widget's CURRENT content,
// so nothing is pre-gathered or shipped with the request: the model makes an
// explicit call per widget (visible in the chat's research trail) and gets a
// self-contained snapshot back.
//
// Reads go straight to the Setting table (prisma) and to the external sources
// the widgets use; /api/* routes can't be called from here (the auth
// middleware would bounce a cookie-less server-side fetch).

import { prisma } from "@/lib/prisma";
import { fetchFeed } from "@/lib/rss";
import { listEvents, type CalDAVCalendar } from "@/lib/caldav";
import { summarizeForecast } from "@/lib/weather";

async function read(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function readJSON<T>(key: string): Promise<T | null> {
  const raw = await read(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

const today = () => new Date().toISOString().split("T")[0];

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
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

// ── Per-type readers ─────────────────────────────────────────────────────────

async function readNotebook(id: string, title: string): Promise<string> {
  const [dates, name] = await Promise.all([
    readJSON<Record<string, string>>(`notebook-${id}-dates`),
    read(`notebook-${id}-name`),
  ]);
  if (!dates) return "This notepad has no entries.";
  const entries = Object.entries(dates)
    .map(([date, html]) => ({ date, text: stripTags(html) }))
    .filter(e => e.text)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!entries.length) return "This notepad has no entries.";
  const label = name?.trim() || title;
  return `## ${label} (Notes, ${entries.length} entries)\n` +
    entries.map(e => `### ${e.date}\n${truncate(e.text, 1500)}`).join("\n\n");
}

async function readText(id: string, title: string): Promise<string> {
  const config = await readJSON<{ source: { type: string; value: string } }>(`text-widget-${id}`);
  if (!config?.source?.value) return "This text widget is empty.";
  if (config.source.type === "text") return `## ${title} (Text)\n${config.source.value}`;
  try {
    const res = await fetch(config.source.value, { headers: { "User-Agent": "curl/8" } });
    const text = res.ok ? (await res.text()).trim() : "";
    return text ? `## ${title} (Text, live from URL)\n${truncate(text, 500)}` : "The text widget's URL returned nothing.";
  } catch {
    return "The text widget's URL could not be fetched.";
  }
}

async function readWeather(id: string, title: string): Promise<string> {
  const cfg = await readJSON<{ name: string; lat: number; lon: number; unit?: "c" | "f" }>(`weather-widget-${id}`);
  if (!cfg || !isFinite(cfg.lat) || !isFinite(cfg.lon)) return "The weather widget has no location configured.";
  const params = new URLSearchParams({
    latitude: String(cfg.lat), longitude: String(cfg.lon),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto", forecast_days: "6",
    temperature_unit: cfg.unit === "f" ? "fahrenheit" : "celsius",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { next: { revalidate: 1800 } });
  if (!res.ok) return "Weather service unavailable right now.";
  const data = await res.json();
  const shaped = {
    current: {
      temp: data.current?.temperature_2m, feelsLike: data.current?.apparent_temperature,
      humidity: data.current?.relative_humidity_2m, windKmh: data.current?.wind_speed_10m,
      code: data.current?.weather_code,
    },
    daily: (data.daily?.time ?? []).map((date: string, i: number) => ({
      date, code: data.daily.weather_code?.[i], max: data.daily.temperature_2m_max?.[i],
      min: data.daily.temperature_2m_min?.[i], rainPct: data.daily.precipitation_probability_max?.[i],
    })),
  };
  return `## ${title} (Weather)\n${summarizeForecast(cfg.name, cfg.unit ?? "c", shaped).join("\n")}`;
}

async function readCalendar(id: string, title: string): Promise<string> {
  const cfg = await readJSON<{
    baseUrl: string; username: string; password: string;
    calendars: CalDAVCalendar[]; days?: number;
  }>(`calendar-widget-${id}`);
  if (!cfg?.baseUrl || !cfg.username || !cfg.calendars?.length) return "The calendar widget is not connected.";
  const days = cfg.days ?? 7;
  const start = today();
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const account = { baseUrl: cfg.baseUrl, username: cfg.username, password: cfg.password };
  const settled = await Promise.allSettled(cfg.calendars.slice(0, 20).map(c => listEvents(account, c, start, end)));
  const events = settled.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  events.sort((a, b) => a.start.localeCompare(b.start));
  if (!events.length) return `## ${title} (Calendar)\nToday is ${start}. No events in the next ${days} days.`;
  return `## ${title} (Calendar, next ${days} days; today is ${start})\n` + events
    .map(e => `- ${e.allDay ? `${e.start} (all day)` : e.start.replace("T", " ")}: ${e.title} [${e.calendar}]${e.location ? ` @ ${e.location}` : ""}`)
    .join("\n");
}

async function readTracker(id: string, title: string): Promise<string> {
  const [config, daysMap] = await Promise.all([
    readJSON<{ items: { id: string; name: string }[] }>(`tracker-config-${id}`),
    readJSON<Record<string, Record<string, number>>>(`tracker-days-${id}`),
  ]);
  if (!config?.items?.length || !daysMap) return "The tracker has no recorded time.";
  const name = Object.fromEntries(config.items.map(i => [i.id, i.name]));
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const dates = Object.keys(daysMap)
    .filter(d => Object.values(daysMap[d]).some(v => v > 0))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 7);
  if (!dates.length) return "The tracker has no recorded time.";
  return `## ${title} (Tracker, time spent)\n` + dates.map(d => {
    const rows = Object.entries(daysMap[d])
      .filter(([, secs]) => secs > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([aid, secs]) => `  ${name[aid] ?? "(removed)"}: ${fmt(secs)}`);
    return `### ${d}\n${rows.join("\n")}`;
  }).join("\n");
}

async function readF1(title: string): Promise<string> {
  // The F1 widget caches hourly; read today's freshest snapshot.
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: `f1-cache-${today()}` } },
    orderBy: { key: "desc" },
    take: 1,
  });
  if (!rows.length) return "The F1 widget hasn't loaded today; open the dashboard to refresh it.";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try { data = JSON.parse(rows[0].value); } catch { return "F1 data unreadable."; }
  const lines: string[] = [];
  if (data.race) {
    const { raceName, date, Circuit } = data.race;
    lines.push(`Next race: ${raceName} at ${Circuit?.circuitName}, ${Circuit?.Location?.country} (${date})`);
  }
  if (data.standings?.length) {
    lines.push("Standings:");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of data.standings.slice(0, 5)) {
      lines.push(`  ${s.position}. ${s.Driver?.givenName} ${s.Driver?.familyName}: ${s.points} pts (${s.Constructors?.[0]?.name})`);
    }
  }
  return lines.length ? `## ${title} (F1)\n${lines.join("\n")}` : "No F1 data available.";
}

async function readRss(id: string, title: string): Promise<string> {
  const config = await readJSON<{ url: string; limit: number; name?: string }>(`rss-widget-${id}`);
  if (!config?.url) return "This feed widget has no URL configured.";
  const items = await fetchFeed(config.url, config.limit || 5);
  if (!items.length) return "The feed returned no items.";
  return `## ${config.name ?? title} (Feed)\n` + formatItems(items.map(it => ({
    title: it.title, link: it.link,
    meta: it.pubDate ? new Date(it.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : undefined,
  })));
}

async function readReddit(id: string, title: string): Promise<string> {
  const config = await readJSON<{ subreddits: { name: string; limit: number; period: string }[] }>(`reddit-widget-${id}`);
  if (!config?.subreddits?.length) return "The Reddit widget has no subreddits configured.";
  const settled = await Promise.allSettled(config.subreddits.map(async sub => {
    const items = await fetchFeed(`https://www.reddit.com/r/${sub.name}/top.rss?t=${sub.period}&limit=${sub.limit}`, sub.limit);
    return items.map(it => ({ title: it.title, link: it.link, meta: `r/${sub.name}`, body: it.content ? stripTags(it.content) : undefined }));
  }));
  const items = settled.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  return items.length ? `## ${title} (Reddit)\n${formatItems(items)}` : "Reddit returned no posts.";
}

async function readYoutube(id: string, title: string): Promise<string> {
  const config = await readJSON<{ channels: { channelId: string; name: string; limit: number }[] }>(`youtube-widget-${id}`);
  if (!config?.channels?.length) return "The YouTube widget has no channels configured.";
  const settled = await Promise.allSettled(config.channels.map(async ch => {
    const items = await fetchFeed(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`, ch.limit || 5);
    return items.map(it => ({ title: it.title, link: it.link, meta: `${ch.name}${it.pubDate ? ` · ${it.pubDate.slice(0, 10)}` : ""}` }));
  }));
  const items = settled.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  return items.length ? `## ${title} (YouTube)\n${formatItems(items)}` : "No videos found.";
}

async function readArxiv(id: string, title: string): Promise<string> {
  const config = await readJSON<{ category?: string }>(`arxiv-widget-${id}`);
  const category = config?.category ?? "cs.AI";
  const papers = await fetchFeed(`https://rss.arxiv.org/rss/${category}`, 20);
  if (!papers.length) return "arXiv returned no papers.";
  return `## ${title} (arXiv ${category})\n` + formatItems(papers.map(p => {
    const text = stripTags(p.content);
    const abstract = text.match(/Abstract:\s*([\s\S]+)/i)?.[1]?.trim() ?? "";
    return { title: p.title, link: p.link, body: abstract || undefined };
  }));
}

async function readHf(id: string, title: string): Promise<string> {
  const config = await readJSON<{ limit?: number }>(`hf-widget-${id}`);
  const limit = config?.limit ?? 25;
  const res = await fetch("https://huggingface.co/api/daily_papers", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
    cache: "no-store",
  });
  if (!res.ok) return "Hugging Face papers unavailable right now.";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = await res.json();
  const papers = raw
    .map(p => ({
      title: p.paper?.title ?? "",
      abstract: p.paper?.summary ?? "",
      upvotes: p.paper?.upvotes ?? 0,
      link: `https://huggingface.co/papers/${p.paper?.id ?? ""}`,
    }))
    .filter(p => p.title)
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, limit);
  if (!papers.length) return "No trending papers today.";
  return `## ${title} (HF Daily)\n` + formatItems(papers.map(p => ({
    title: p.title, link: p.link, meta: `▲ ${p.upvotes}`, body: p.abstract || undefined,
  })));
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function readWidgetData(id: string, type: string, title: string): Promise<string> {
  try {
    switch (type) {
      case "notebook": return await readNotebook(id, title);
      case "text":     return await readText(id, title);
      case "weather":  return await readWeather(id, title);
      case "calendar": return await readCalendar(id, title);
      case "tracker":  return await readTracker(id, title);
      case "f1":       return await readF1(title);
      case "rss":      return await readRss(id, title);
      case "reddit":   return await readReddit(id, title);
      case "youtube":  return await readYoutube(id, title);
      case "arxiv":    return await readArxiv(id, title);
      case "hf":       return await readHf(id, title);
      default:         return `Widget type "${type}" has no readable data.`;
    }
  } catch (err) {
    return `Could not read this widget: ${String(err instanceof Error ? err.message : err)}`;
  }
}
