// First-run seeding: a fresh install gets two demo-ready dashboards instead of
// a blank grid. "Home" is the daily driver: a motto, daily notes, weather, F1,
// the week's calendar, the tracker and upkeep siblings, and a feed group
// (YouTube with Reddit and BBC News as tabs). "Study" is the learning surface:
// study notes, reference bookmarks, a papers group (arXiv with HF Daily and
// Hacker News as tabs), the weekly schedule with the typing trainer behind it,
// the chat and a rhythm habit log. Both grids are 4 columns by 7 rows with
// cards of different shapes (1x3, 1x4, 2x1, 2x3, 2x4), and every widget arrives
// configured and with believable recent content, so the product demos itself.
//
// Demo mode (lib/demo.ts) shows exactly this seed from memory, plus a fake
// calendar account that the Calendar widget answers with a synthesized agenda.
//
// Seeding runs ONLY when both the `dashboards` and legacy `widget-layout` keys
// are absent, so existing installs (with or without multiple dashboards) are
// never touched.

import * as storage from "@/lib/storage";
import { DEFAULT_DASHBOARDS, layoutKey, instancesKey, saveDashboards, type DashboardsState } from "@/lib/dashboards";
import { widgets, instanceOf, type Widget, type WidgetType } from "@/lib/widgets";

const dayOffset = (n: number) => {
  const d = new Date(Date.now() + n * 86400000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Epoch ms of a local wall-clock time n days from today (n <= 0 for the past).
const atLocal = (n: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};

const GRID = { minW: 1, minH: 1, maxW: 4, maxH: 6 };

// A placed instance from the registry template of a built-in type.
function inst(type: WidgetType, id: string, title?: string): Widget {
  const template = widgets.find(w => w.type === type);
  if (!template) throw new Error(`no widget template for ${type}`);
  return instanceOf(template, id, title);
}

export const SEEDED_DASHBOARDS: DashboardsState = {
  list: [
    { id: "default", name: "Home" },
    { id: "study", name: "Study" },
  ],
  activeId: "default",
};

export function buildSeed(): Record<string, unknown> {
  const today = dayOffset(0);
  const d1 = dayOffset(-1);
  const d2 = dayOffset(-2);
  const d3 = dayOffset(-3);
  const d4 = dayOffset(-4);
  const d5 = dayOffset(-5);
  const d6 = dayOffset(-6);
  const now = Date.now();
  const H = 3600000;
  const M = 60000;

  // Upkeep checks, relative to now so each item's state is predictable: the
  // latest check of every item but the plants is still running, so the score
  // sits a little under 100 and the plants show as due.
  const checks = (latestAgoH: number, everyH: number, count: number) =>
    Array.from({ length: count }, (_, k) => now - (latestAgoH + k * everyH) * H).reverse();

  // Rhythm taps over the last two weeks, at fixed times of day with a small
  // per-day drift, dropping anything still in the future today.
  const past = (ts: number[]) => ts.filter(t => t <= now);
  const drift = (n: number) => ((((n * 7) % 5) + 5) % 5) - 2; // -2..2 minutes, deterministic
  const waterTaps: number[] = [];
  const stretchTaps: number[] = [];
  const coffeeTaps: number[] = [];
  const focusSessions: [number, number][] = [];
  for (let n = -13; n <= 0; n++) {
    const glasses = n % 3 === 0 ? [8.7, 10.5, 12.25, 14.8, 16.3] : [8.7, 10.5, 12.25, 14.8, 16.3, 19.1];
    for (const h of glasses) waterTaps.push(atLocal(n, Math.floor(h), Math.round((h % 1) * 60) + drift(n)));
    stretchTaps.push(atLocal(n, 7, 20 + drift(n)));
    coffeeTaps.push(atLocal(n, 8, 5 + drift(n)), atLocal(n, 13, 40 + drift(n)));
    if (n === -9 || n === -3) coffeeTaps.push(atLocal(n, 16, 30));
    if (n !== -13 && n !== -6) focusSessions.push([atLocal(n, 9, 30 + drift(n)), atLocal(n, 11, 5 + drift(n))]);
    if (n % 2 === 0) focusSessions.push([atLocal(n, 15, 0), atLocal(n, 16, 10)]);
  }

  return {
    // ── Home dashboard: 4 columns by 7 rows ─────────────────────────────────
    //   cols 0-1: text 2x1 over notebook 2x3, then tracker 1x3 and upkeep 1x3
    //   col 2:    weather 1x2, f1 1x2        col 3: calendar 1x4
    //   cols 2-3: youtube 2x3 with reddit and rss as tabs
    "widget-layout": [
      { i: "text-home",     x: 0, y: 0, w: 2, h: 1, ...GRID },
      { i: "notebook-home", x: 0, y: 1, w: 2, h: 3, ...GRID },
      { i: "tracker-home",  x: 0, y: 4, w: 1, h: 3, ...GRID },
      { i: "upkeep-home",   x: 1, y: 4, w: 1, h: 3, ...GRID },
      { i: "weather-home",  x: 2, y: 0, w: 1, h: 2, ...GRID },
      { i: "f1-home",       x: 2, y: 2, w: 1, h: 2, ...GRID },
      { i: "calendar-home", x: 3, y: 0, w: 1, h: 4, ...GRID },
      { i: "youtube-home",  x: 2, y: 4, w: 2, h: 3, ...GRID, tabs: ["reddit-home", "rss-home"] },
    ],
    "widget-instances": {
      "text-home":     inst("text",     "text-home"),
      "notebook-home": inst("notebook", "notebook-home"),
      "tracker-home":  inst("tracker",  "tracker-home"),
      "upkeep-home":   inst("upkeep",   "upkeep-home"),
      "weather-home":  inst("weather",  "weather-home"),
      "f1-home":       inst("f1",       "f1-home"),
      "calendar-home": inst("calendar", "calendar-home"),
      "youtube-home":  inst("youtube",  "youtube-home"),
      "reddit-home":   inst("reddit",   "reddit-home"),
      "rss-home":      inst("rss",      "rss-home"),
    },

    // ── Study dashboard: 4 columns by 7 rows ────────────────────────────────
    //   col 0:    notebook 1x3 over bookmarks 1x4
    //   cols 1-2: arxiv 2x3 (hf and hacker news as tabs) over schedule 2x4 (typing as tab)
    //   col 3:    chat 1x4 over rhythm 1x3
    [layoutKey("study")]: [
      { i: "notebook-study",  x: 0, y: 0, w: 1, h: 3, ...GRID },
      { i: "bookmarks-study", x: 0, y: 3, w: 1, h: 4, ...GRID },
      { i: "arxiv-study",     x: 1, y: 0, w: 2, h: 3, ...GRID, tabs: ["hf-study", "hn-study"] },
      { i: "schedule-study",  x: 1, y: 3, w: 2, h: 4, ...GRID, tabs: ["typing-study"] },
      { i: "chat-study",      x: 3, y: 0, w: 1, h: 4, ...GRID },
      { i: "rhythm-study",    x: 3, y: 4, w: 1, h: 3, ...GRID },
    ],
    [instancesKey("study")]: {
      "notebook-study":  inst("notebook",  "notebook-study"),
      "bookmarks-study": inst("bookmarks", "bookmarks-study"),
      "arxiv-study":     inst("arxiv",     "arxiv-study"),
      "hf-study":        inst("hf",        "hf-study"),
      "hn-study":        { id: "hn-study", type: "custom", bankId: "hacker-news", color: "orange", title: "Hacker News", description: "Front page stories right now.", digestable: false },
      "schedule-study":  inst("schedule",  "schedule-study"),
      "typing-study":    inst("typing",    "typing-study"),
      "chat-study":      inst("chat",      "chat-study"),
      "rhythm-study":    inst("rhythm",    "rhythm-study"),
    },

    // ── Widget content: make it look lived-in ────────────────────────────────
    "notepad-registry": ["notebook-home", "notebook-study"],
    "notebook-notebook-home-name": "Daily notes",
    "notebook-notebook-home-days": [d5, d3, d1, today],
    [`notebook-notebook-home-day-${today}`]:
      "<b>Today</b><div>groceries after work: <b>coffee beans</b>, olive oil, lemons, <i>and flowers for the table</i></div>"
      + "<div>call the bike shop about the <u>rear brake</u>, they close at six</div>"
      + "<div><br></div><div><b>Server</b></div>"
      + "<ul><li>move the photo backup to the new drive</li><li>check why the <i>nightly</i> job skipped Tuesday</li><li><u>rotate the API keys</u> before the weekend</li></ul>"
      + "<div><br></div><div><i>mood: quiet, productive</i></div>",
    [`notebook-notebook-home-day-${d1}`]:
      "really good walk in the evening, <i>should make that a habit</i><div>the balcony plants need bigger pots</div>"
      + "<div><br></div><div><b>Read</b></div><ul><li>finished <i>The Shallows</i>, the chapter on memory is the one to keep</li><li>started <i>Piranesi</i></li></ul>",
    [`notebook-notebook-home-day-${d3}`]:
      "<b>Weekend plan</b><ul><li>try the new bakery on the corner</li><li>finish the bookshelf, <u>two more coats</u></li><li><b>backup the NAS</b></li><li>long run if it stays dry</li></ul>"
      + "<div><br></div><div>ideas for the dashboard: a <i>reading streak</i> widget, a smaller weather card</div>",
    [`notebook-notebook-home-day-${d5}`]:
      "<b>Trip notes</b><div>Lisbon in early July, three days: Alfama and the castle, Belem and the MAAT, a day in Sintra</div>"
      + "<ul><li>book the Sintra train early</li><li><u>Viva Viagem</u> card with zapping credit</li><li>pasteis at the original place, go before nine</li></ul>",
    "notebook-notebook-study-name": "Study notes",
    "notebook-notebook-study-days": [d6, d4, d2, today],
    [`notebook-notebook-study-day-${today}`]:
      "reading about <b>retrieval-augmented agents</b>, the tool-use evals look weak<div><i>idea: compare embedding models on my own notes</i></div>"
      + "<div><br></div><div><b>Questions</b></div><ul><li>does reranking help at small corpus sizes?</li><li>how do they handle <u>stale</u> chunks?</li></ul>",
    [`notebook-notebook-study-day-${d2}`]:
      "watched the new 3blue1brown video, the attention visualization is <u>the clearest I have seen</u><div>queued two papers from HF daily</div>"
      + "<div><br></div><div><i>flashcards to add:</i> softmax temperature, KV cache, rotary embeddings</div>",
    [`notebook-notebook-study-day-${d4}`]:
      "<b>To re-read monthly</b><ul><li>attention is all you need</li><li>lost in the middle</li><li>the bitter lesson</li></ul>",
    [`notebook-notebook-study-day-${d6}`]:
      "<b>Portuguese</b><div>lesson 4: past tense of <i>ir</i> and <i>ser</i> are the same, <u>fui</u></div><ul><li>practice with the restaurant dialogue</li><li>ten new words a day</li></ul>",

    "text-widget-text-home": { source: { type: "text", value: "memento mori" }, font: "serif" },

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

    "upkeep-config-upkeep-home": {
      items: [
        { id: "seed-teeth",   name: "brush teeth",   weight: 10, hours: 12 },
        { id: "seed-shower",  name: "shower",        weight: 10, hours: 36 },
        { id: "seed-plants",  name: "water plants",  weight: 5,  hours: 72 },
        { id: "seed-laundry", name: "laundry",       weight: 5,  hours: 168 },
        { id: "seed-sheets",  name: "change sheets", weight: 5,  hours: 336 },
      ],
      order: "custom",
    },
    "upkeep-log-upkeep-home": {
      "seed-teeth":   checks(3, 12, 20),
      "seed-shower":  checks(20, 34, 7),
      "seed-plants":  checks(80, 70, 5),
      "seed-laundry": checks(96, 168, 4),
      "seed-sheets":  checks(240, 336, 2),
    },

    "weather-widget-weather-home": { name: "Lisbon", region: "Portugal", lat: 38.7223, lon: -9.1393, unit: "c" },
    "rss-widget-rss-home": { url: "https://feeds.bbci.co.uk/news/rss.xml", limit: 8, name: "BBC News" },
    "reddit-widget-reddit-home": {
      subreddits: [
        { name: "selfhosted", limit: 3, period: "week" },
        { name: "programming", limit: 3, period: "week" },
        { name: "technology", limit: 3, period: "week" },
        { name: "MachineLearning", limit: 3, period: "week" },
        { name: "space", limit: 3, period: "week" },
        { name: "todayilearned", limit: 3, period: "week" },
      ],
      images: true,
    },
    "youtube-widget-youtube-home": {
      view: "thumbs",
      channels: [
        { channelId: "UCHnyfMqiRRG1u-2MsSQLbXA", name: "Veritasium", limit: 2 },
        { channelId: "UCsXVk37bltHxD1rDPwtNM8Q", name: "Kurzgesagt", limit: 2 },
        { channelId: "UCYO_jab_esuFRV4b17AJtAw", name: "3Blue1Brown", limit: 2 },
        { channelId: "UCBa659QWEk1AI4Tg--mrJ2A", name: "Tom Scott", limit: 2 },
        { channelId: "UCY1kMZp36IQSyNx_9h4mpCg", name: "Mark Rober", limit: 2 },
        { channelId: "UC9-y-6csu5WGm29I7JiwpnA", name: "Computerphile", limit: 2 },
      ],
    },

    "bookmarks-config-bookmarks-study": {
      view: "grid",
      iconSize: 44,
      bookmarks: [
        { id: "seed-bm-wikipedia", url: "https://en.wikipedia.org",       name: "Wikipedia" },
        { id: "seed-bm-arxiv",     url: "https://arxiv.org",              name: "arXiv" },
        { id: "seed-bm-scholar",   url: "https://scholar.google.com",     name: "Scholar" },
        { id: "seed-bm-github",    url: "https://github.com",             name: "GitHub" },
        { id: "seed-bm-hn",        url: "https://news.ycombinator.com",   name: "Hacker News" },
        { id: "seed-bm-so",        url: "https://stackoverflow.com",      name: "Stack Overflow" },
        { id: "seed-bm-mdn",       url: "https://developer.mozilla.org",  name: "MDN" },
        { id: "seed-bm-hf",        url: "https://huggingface.co",         name: "Hugging Face" },
        { id: "seed-bm-gutenberg", url: "https://www.gutenberg.org",      name: "Gutenberg" },
        { id: "seed-bm-archive",   url: "https://archive.org",            name: "Internet Archive" },
      ],
    },

    "arxiv-widget-arxiv-study": { category: "cs.AI" },
    "hf-widget-hf-study": { limit: 25 },

    "schedule-widget-schedule-study": {
      startHour: 6,
      endHour: 24,
      entries: [
        { id: "seed-sch-gym",      title: "Gym",            days: [0, 2, 4],       start: 7 * 60,       end: 8 * 60,       color: "#7fc8a9" },
        { id: "seed-sch-standup",  title: "Standup",        days: [0, 1, 2, 3, 4], start: 9 * 60 + 30,  end: 9 * 60 + 45,  color: "#8ab4e8" },
        { id: "seed-sch-focus",    title: "Deep work",      description: "phone in the drawer", days: [0, 1, 2, 3, 4], start: 10 * 60, end: 12 * 60, color: "#c39be0" },
        { id: "seed-sch-lunch",    title: "Lunch",          days: [0, 1, 2, 3, 4], start: 12 * 60 + 30, end: 13 * 60 + 15, color: "#d9c26e" },
        { id: "seed-sch-reading",  title: "Reading group",  description: "room 2.14", days: [1], start: 17 * 60, end: 18 * 60, color: "#e8b04b" },
        { id: "seed-sch-language", title: "Portuguese",     days: [0, 2],          start: 19 * 60,      end: 20 * 60,      color: "#e08a9b" },
        { id: "seed-sch-climb",    title: "Climbing",       days: [3],             start: 18 * 60 + 30, end: 20 * 60,      color: "#7fd0d6" },
        { id: "seed-sch-run",      title: "Long run",       days: [6],             start: 8 * 60,       end: 9 * 60 + 30,  color: "#7fd0d6" },
        { id: "seed-sch-dinner",   title: "Family dinner",  days: [6],             start: 18 * 60,      end: 20 * 60,      color: "#a8b0bd" },
      ],
    },

    "typing-config-typing-study": {
      mode: "words", length: 25, drill: "weak", custom: "zxc", customScramble: true, customWords: false,
      pool: "varied", countdown: 3, bpm: 100, sound: true, dynamic: false, endless: false,
    },
    "typing-stats-typing-study": {
      best: 72,
      runs: 14,
      keyHit: {
        e: 1420, t: 1010, a: 910, o: 860, i: 790, n: 760, s: 720, h: 690, r: 680, d: 480, l: 450, u: 310,
        c: 300, m: 270, w: 260, f: 250, g: 220, y: 210, p: 200, b: 160, v: 110, k: 85, j: 18, x: 16, q: 12, z: 9,
      },
      keyMiss: { e: 24, r: 21, t: 15, y: 22, p: 31, b: 19, c: 14, g: 12, w: 11, m: 9, v: 9, n: 8, q: 4, x: 3, z: 3 },
    },

    "rhythm-config-rhythm-study": {
      items: [
        { id: "seed-water",   name: "water",     kind: "moment",  mode: "build",  target: 6 },
        { id: "seed-stretch", name: "stretch",   kind: "moment",  mode: "build",  target: 1 },
        { id: "seed-focus",   name: "deep work", kind: "session", mode: "build" },
        { id: "seed-coffee",  name: "coffee",    kind: "moment",  mode: "reduce", target: 2 },
      ],
      open: {},
    },
    "rhythm-log-rhythm-study": {
      events: {
        "seed-water":   past(waterTaps),
        "seed-stretch": past(stretchTaps),
        "seed-coffee":  past(coffeeTaps),
      },
      sessions: {
        "seed-focus": focusSessions.filter(([, end]) => end <= now),
      },
    },

    "chat-widget-chat-study": {
      config: { sourcesVersion: 3 },
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
  };
}

/**
 * Seed the demo dashboards on a true first run. Returns the seeded dashboards
 * state, or null when the install already has data (nothing is touched).
 */
export async function maybeSeedFirstRun(): Promise<DashboardsState | null> {
  const [dashboards, legacyLayout] = await Promise.all([
    storage.getItemResult("dashboards"),
    storage.getItemResult("widget-layout"),
  ]);
  // Only seed when the store is CONFIRMED empty. If either read failed (server
  // restarting during a deploy, network blip), do nothing: seeding here would
  // overwrite a real dashboard with the demo default.
  if (!dashboards.ok || !legacyLayout.ok) return null;
  if (dashboards.value !== null || legacyLayout.value !== null) return null;

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
