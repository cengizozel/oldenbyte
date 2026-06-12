// First-run seeding: a fresh install gets two demo-ready dashboards instead of
// a blank grid. "Home" is the daily driver (notes, weather, feeds, tracker,
// chat); "Research" is the learning surface (arXiv+HF tab group, YouTube,
// community-bank widgets, research notes). Widgets arrive configured and with
// believable recent content, so the product demos itself.
//
// Seeding runs ONLY when both the `dashboards` and legacy `widget-layout` keys
// are absent, so existing installs (with or without multiple dashboards) are
// never touched.

import * as storage from "@/lib/storage";
import { DEFAULT_DASHBOARDS, layoutKey, instancesKey, saveDashboards, type DashboardsState } from "@/lib/dashboards";

const dayOffset = (n: number) => {
  const d = new Date(Date.now() + n * 86400000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const GRID = { minW: 1, minH: 1, maxW: 4, maxH: 6 };

export const SEEDED_DASHBOARDS: DashboardsState = {
  list: [
    { id: "default", name: "Home" },
    { id: "research", name: "Research" },
  ],
  activeId: "default",
};

function buildSeed(): Record<string, unknown> {
  const today = dayOffset(0);
  const d1 = dayOffset(-1);
  const d2 = dayOffset(-2);
  const d3 = dayOffset(-3);
  const d4 = dayOffset(-4);

  return {
    // ── Home dashboard ───────────────────────────────────────────────────────
    "widget-layout": [
      { i: "notebook-home", x: 0, y: 0, w: 1, h: 3, ...GRID },
      { i: "weather-home",  x: 1, y: 0, w: 1, h: 3, ...GRID },
      { i: "tracker-home",  x: 2, y: 0, w: 1, h: 4, ...GRID },
      { i: "chat-home",     x: 3, y: 0, w: 1, h: 4, ...GRID },
      { i: "rss-home",      x: 0, y: 3, w: 1, h: 4, ...GRID },
      { i: "reddit-home",   x: 1, y: 3, w: 1, h: 4, ...GRID },
      { i: "text-home",     x: 2, y: 4, w: 1, h: 1, ...GRID },
      { i: "kiwix-home",    x: 3, y: 4, w: 1, h: 3, ...GRID },
      { i: "calendar-home", x: 2, y: 5, w: 1, h: 2, ...GRID },
    ],
    "widget-instances": {
      "notebook-home": { id: "notebook-home", type: "notebook", color: "amber",  title: "Notepad",  description: "A simple place for temporary notes.", digestable: false },
      "weather-home":  { id: "weather-home",  type: "weather",  color: "sky",    title: "Weather",  description: "Current conditions and forecast for a place." },
      "tracker-home":  { id: "tracker-home",  type: "tracker",  color: "teal",   title: "Tracker",  description: "Time how long you spend on each activity.", digestable: false },
      "chat-home":     { id: "chat-home",     type: "chat",     color: "sky",    title: "Chat",     description: "Chat with a local or OpenAI-compatible model.", digestable: false },
      "rss-home":      { id: "rss-home",      type: "rss",      color: "teal",   title: "Feed",     description: "Headlines from any RSS feed." },
      "reddit-home":   { id: "reddit-home",   type: "reddit",   color: "orange", title: "Reddit",   description: "Top posts from your chosen subreddits." },
      "text-home":     { id: "text-home",     type: "text",     color: "rose",   title: "Text",     description: "A word, quote, or live string." },
      "kiwix-home":    { id: "kiwix-home",    type: "kiwix",    color: "teal",   title: "Kiwix",    description: "Search an offline Kiwix library (Wikipedia, etc.).", digestable: false },
      "calendar-home": { id: "calendar-home", type: "calendar", color: "amber",  title: "Calendar", description: "Upcoming events from a CalDAV server (Nextcloud, Radicale)." },
    },

    // ── Research dashboard ───────────────────────────────────────────────────
    [layoutKey("research")]: [
      { i: "notebook-research", x: 0, y: 0, w: 1, h: 4, ...GRID },
      { i: "arxiv-research",    x: 1, y: 0, w: 1, h: 4, ...GRID, tabs: ["hf-research"] },
      { i: "youtube-research",  x: 2, y: 0, w: 1, h: 4, ...GRID },
      { i: "hn-research",       x: 3, y: 0, w: 1, h: 4, ...GRID },
      { i: "xkcd-research",     x: 3, y: 4, w: 1, h: 3, ...GRID },
    ],
    [instancesKey("research")]: {
      "notebook-research": { id: "notebook-research", type: "notebook", color: "amber",  title: "Notepad",  description: "A simple place for temporary notes.", digestable: false },
      "arxiv-research":    { id: "arxiv-research",    type: "arxiv",    color: "sky",    title: "arXiv",    description: "Latest papers from a chosen research field." },
      "hf-research":       { id: "hf-research",       type: "hf",       color: "orange", title: "HF Daily", description: "Trending AI papers curated by Hugging Face." },
      "youtube-research":  { id: "youtube-research",  type: "youtube",  color: "rose",   title: "YouTube",  description: "Latest videos from your chosen channels." },
      "hn-research":       { id: "hn-research",       type: "custom",   bankId: "hacker-news", color: "orange",  title: "Hacker News", description: "Front page stories right now.", digestable: false },
      "xkcd-research":     { id: "xkcd-research",     type: "custom",   bankId: "xkcd", color: "neutral", title: "xkcd", description: "Today's xkcd comic.", digestable: false },
    },

    // ── Widget content: make it look lived-in ────────────────────────────────
    "notepad-registry": ["notebook-home", "notebook-research"],
    "notebook-notebook-home-name": "Daily notes",
    "notebook-notebook-home-dates": {
      [today]: "groceries after work: coffee beans, olive oil, lemons<div>call the bike shop about the rear brake</div>",
      [d1]: "really good walk in the evening, should make that a habit<div>the balcony plants need bigger pots</div>",
      [d3]: "weekend plan: try the new bakery, finish the bookshelf, backup the NAS",
    },
    "notebook-notebook-research-name": "Research notes",
    "notebook-notebook-research-dates": {
      [today]: "reading about retrieval-augmented agents, the tool-use evals look weak<div>idea: compare embedding models on my own notes</div>",
      [d2]: "watched the new 3blue1brown video, the attention visualization is the clearest I have seen<div>queued two papers from HF daily</div>",
      [d4]: "set up a folder for papers to re-read monthly",
    },

    "tracker-config-tracker-home": {
      items: [
        { id: "seed-read",  name: "reading" },
        { id: "seed-move",  name: "exercise" },
        { id: "seed-build", name: "side project" },
      ],
      activeId: null,
      since: null,
    },
    "tracker-days-tracker-home": {
      [d4]: { "seed-read": 1860, "seed-build": 3540 },
      [d3]: { "seed-read": 2400, "seed-move": 1500 },
      [d2]: { "seed-read": 1740, "seed-move": 1320, "seed-build": 4920 },
      [d1]: { "seed-read": 2940, "seed-build": 2280 },
      [today]: { "seed-read": 900 },
    },

    "weather-widget-weather-home": { name: "Istanbul", region: "Türkiye", lat: 41.0082, lon: 28.9784, unit: "c" },
    "rss-widget-rss-home": { url: "https://feeds.bbci.co.uk/news/rss.xml", limit: 5, name: "BBC News" },
    "reddit-widget-reddit-home": {
      subreddits: [
        { name: "selfhosted", limit: 5, period: "week" },
        { name: "programming", limit: 5, period: "week" },
      ],
    },
    "text-widget-text-home": { source: { type: "text", value: "make something small every day" }, font: "serif" },

    "arxiv-widget-arxiv-research": { category: "cs.AI" },
    "hf-widget-hf-research": { limit: 25 },
    "youtube-widget-youtube-research": {
      channels: [
        { channelId: "UCYO_jab_esuFRV4b17AJtAw", name: "3Blue1Brown", limit: 5 },
        { channelId: "UCbfYPyITQ-7l4upoX8nvctg", name: "Two Minute Papers", limit: 5 },
      ],
    },
  };
}

/**
 * Seed the demo dashboards on a true first run. Returns the seeded dashboards
 * state, or null when the install already has data (nothing is touched).
 */
export async function maybeSeedFirstRun(): Promise<DashboardsState | null> {
  const [dashboards, legacyLayout] = await Promise.all([
    storage.getItem("dashboards"),
    storage.getItem("widget-layout"),
  ]);
  if (dashboards !== null || legacyLayout !== null) return null;

  const seed = buildSeed();
  await Promise.all(
    Object.entries(seed).map(([key, value]) =>
      storage.setItem(key, typeof value === "string" ? value : JSON.stringify(value))
    )
  );
  await saveDashboards(SEEDED_DASHBOARDS);
  return SEEDED_DASHBOARDS;
}

export { DEFAULT_DASHBOARDS };
