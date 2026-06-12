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

export function buildSeed(): Record<string, unknown> {
  const today = dayOffset(0);
  const d1 = dayOffset(-1);
  const d2 = dayOffset(-2);
  const d3 = dayOffset(-3);
  const d4 = dayOffset(-4);
  const now = Date.now();
  const H = 3600000;
  const M = 60000;

  return {
    // ── Home dashboard: a clean 4x2 grid of equal cells ─────────────────────
    "widget-layout": [
      { i: "notebook-home", x: 0, y: 0, w: 1, h: 3, ...GRID },
      { i: "weather-home",  x: 1, y: 0, w: 1, h: 3, ...GRID },
      { i: "tracker-home",  x: 2, y: 0, w: 1, h: 3, ...GRID },
      { i: "chat-home",     x: 3, y: 0, w: 1, h: 3, ...GRID },
      { i: "rss-home",      x: 0, y: 3, w: 1, h: 3, ...GRID },
      { i: "reddit-home",   x: 1, y: 3, w: 1, h: 3, ...GRID },
      { i: "text-home",     x: 2, y: 3, w: 1, h: 3, ...GRID },
      { i: "calendar-home", x: 3, y: 3, w: 1, h: 3, ...GRID },
    ],
    "widget-instances": {
      "notebook-home": { id: "notebook-home", type: "notebook", color: "amber",  title: "Notepad",  description: "A simple place for temporary notes.", digestable: false },
      "weather-home":  { id: "weather-home",  type: "weather",  color: "sky",    title: "Weather",  description: "Current conditions and forecast for a place." },
      "tracker-home":  { id: "tracker-home",  type: "tracker",  color: "teal",   title: "Tracker",  description: "Time how long you spend on each activity.", digestable: false },
      "chat-home":     { id: "chat-home",     type: "chat",     color: "sky",    title: "Chat",     description: "Chat with a local or OpenAI-compatible model.", digestable: false },
      "rss-home":      { id: "rss-home",      type: "rss",      color: "teal",   title: "Feed",     description: "Headlines from any RSS feed." },
      "reddit-home":   { id: "reddit-home",   type: "reddit",   color: "orange", title: "Reddit",   description: "Top posts from your chosen subreddits." },
      "text-home":     { id: "text-home",     type: "text",     color: "rose",   title: "Text",     description: "A word, quote, or live string." },
      "calendar-home": { id: "calendar-home", type: "calendar", color: "amber",  title: "Calendar", description: "Upcoming events from a CalDAV server (Nextcloud, Radicale)." },
    },

    // ── Research dashboard: a clean 4x2 grid of equal cells ─────────────────
    [layoutKey("research")]: [
      { i: "notebook-research", x: 0, y: 0, w: 1, h: 3, ...GRID },
      { i: "arxiv-research",    x: 1, y: 0, w: 1, h: 3, ...GRID, tabs: ["hf-research"] },
      { i: "youtube-research",  x: 2, y: 0, w: 1, h: 3, ...GRID },
      { i: "hn-research",       x: 3, y: 0, w: 1, h: 3, ...GRID },
      { i: "xkcd-research",     x: 0, y: 3, w: 1, h: 3, ...GRID },
      { i: "kiwix-research",    x: 1, y: 3, w: 1, h: 3, ...GRID },
      { i: "anytype-research",  x: 2, y: 3, w: 1, h: 3, ...GRID },
      { i: "text-research",     x: 3, y: 3, w: 1, h: 3, ...GRID },
    ],
    [instancesKey("research")]: {
      "notebook-research": { id: "notebook-research", type: "notebook", color: "amber",  title: "Notepad",  description: "A simple place for temporary notes.", digestable: false },
      "arxiv-research":    { id: "arxiv-research",    type: "arxiv",    color: "sky",    title: "arXiv",    description: "Latest papers from a chosen research field." },
      "hf-research":       { id: "hf-research",       type: "hf",       color: "orange", title: "HF Daily", description: "Trending AI papers curated by Hugging Face." },
      "youtube-research":  { id: "youtube-research",  type: "youtube",  color: "rose",   title: "YouTube",  description: "Latest videos from your chosen channels." },
      "hn-research":       { id: "hn-research",       type: "custom",   bankId: "hacker-news", color: "orange",  title: "Hacker News", description: "Front page stories right now.", digestable: false },
      "xkcd-research":     { id: "xkcd-research",     type: "custom",   bankId: "xkcd", color: "neutral", title: "xkcd", description: "Today's xkcd comic.", digestable: false },
      "kiwix-research":    { id: "kiwix-research",    type: "kiwix",    color: "teal",   title: "Kiwix",   description: "Search an offline Kiwix library (Wikipedia, etc.).", digestable: false },
      "anytype-research":  { id: "anytype-research",  type: "anytype",  color: "sky",    title: "Anytype", description: "Browse and search your Anytype spaces.", digestable: false },
      "text-research":     { id: "text-research",     type: "text",     color: "rose",   title: "Text",    description: "A word, quote, or live string." },
    },

    // ── Widget content: make it look lived-in ────────────────────────────────
    "notepad-registry": ["notebook-home", "notebook-research"],
    "notebook-notebook-home-name": "Daily notes",
    "notebook-notebook-home-dates": {
      [today]: "groceries after work: <b>coffee beans</b>, olive oil, lemons<div>call the bike shop about the <u>rear brake</u></div>",
      [d1]: "really good walk in the evening, <i>should make that a habit</i><div>the balcony plants need bigger pots</div>",
      [d3]: "weekend plan:<ul><li>try the new bakery</li><li>finish the bookshelf</li><li><b>backup the NAS</b></li></ul>",
    },
    "notebook-notebook-research-name": "Research notes",
    "notebook-notebook-research-dates": {
      [today]: "reading about <b>retrieval-augmented agents</b>, the tool-use evals look weak<div><i>idea: compare embedding models on my own notes</i></div>",
      [d2]: "watched the new 3blue1brown video, the attention visualization is <u>the clearest I have seen</u><div>queued two papers from HF daily</div>",
      [d4]: "to re-read monthly:<ul><li>attention is all you need</li><li>lost in the middle</li></ul>",
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
        { name: "technology", limit: 5, period: "week" },
        { name: "MachineLearning", limit: 5, period: "week" },
        { name: "dataisbeautiful", limit: 5, period: "week" },
        { name: "todayilearned", limit: 5, period: "week" },
      ],
    },
    "chat-widget-chat-home": {
      config: { sourcesVersion: 2 },
      activeId: "seed-chat-2",
      conversations: [
        {
          id: "seed-chat-1",
          title: "Sourdough troubleshooting",
          renamed: true,
          updatedAt: now - 25 * H,
          messages: [
            { role: "user", at: now - 26 * H, content: "my first sourdough came out dense and the crumb is tight at the bottom, what went wrong?" },
            { role: "assistant", at: now - 26 * H + 1 * M, content: "Dense with a tight bottom crumb usually points to underproofing. Two checks: did the dough roughly double during bulk fermentation, and did it pass the poke test before shaping? A young starter can also lack strength. Try extending bulk by an hour and adding one more fold." },
            { role: "user", at: now - 25 * H, content: "starter is two weeks old, doubles in about 5 hours" },
            { role: "assistant", at: now - 25 * H + 1 * M, content: "That is on the slower side but workable. Feed it twice a day for a few days and bake once it doubles in 3 to 4 hours. For the next loaf, push bulk longer and shape only when the dough feels airy throughout, not just on top." },
          ],
        },
        {
          id: "seed-chat-2",
          title: "Lisbon long weekend",
          renamed: true,
          updatedAt: now - 2 * H,
          messages: [
            { role: "user", at: now - 3 * H, content: "thinking about a long weekend in lisbon in early july, worth it?" },
            { role: "assistant", at: now - 3 * H + 1 * M, content: "Definitely. Early July is warm but not peak August heat. Three days covers a lot: Alfama and the castle one day, Belem and the MAAT another, and a day trip to Sintra if you start early.", memory: ["Planning a long weekend in Lisbon in early July"] },
            { role: "user", at: now - 2 * H, content: "how do i get around, is the metro enough?" },
            { role: "assistant", at: now - 2 * H + 1 * M, content: "Metro plus walking covers the center, and tram 28 is worth one ride even if it is touristy. Get a Viva Viagem card and load it with zapping credit, it works on the metro, trams, buses and the Sintra train." },
          ],
        },
      ],
    },
    "text-widget-text-home": { source: { type: "text", value: "make something small every day" }, font: "serif" },
    "text-widget-text-research": { source: { type: "text", value: "read greedily, take notes, connect things" }, font: "serif" },

    "arxiv-widget-arxiv-research": { category: "cs.AI" },
    "hf-widget-hf-research": { limit: 25 },
    "youtube-widget-youtube-research": {
      channels: [
        { channelId: "UCYO_jab_esuFRV4b17AJtAw", name: "3Blue1Brown", limit: 3 },
        { channelId: "UCbfYPyITQ-7l4upoX8nvctg", name: "Two Minute Papers", limit: 3 },
        { channelId: "UCHnyfMqiRRG1u-2MsSQLbXA", name: "Veritasium", limit: 3 },
        { channelId: "UC9-y-6csu5WGm29I7JiwpnA", name: "Computerphile", limit: 3 },
        { channelId: "UCsBjURrPoezykLs9EqgamOA", name: "Fireship", limit: 3 },
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
