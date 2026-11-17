import { describe, expect, it } from "vitest";
import { searchTarget } from "@/components/SearchWidget";
import { cityOf, offsetText, resolveZone, wallClock } from "@/components/ClockWidget";

describe("search widget", () => {
  it("sends a query to the chosen engine, encoded", () => {
    expect(searchTarget("a b&c", { engine: "duckduckgo", custom: "" })).toBe("https://duckduckgo.com/?q=a%20b%26c");
  });
  it("opens an address as it is", () => {
    expect(searchTarget(" https://example.com/x?y=1 ", { engine: "google", custom: "" })).toBe("https://example.com/x?y=1");
  });
  it("uses a custom address with %s, and refuses one without", () => {
    expect(searchTarget("cats", { engine: "custom", custom: "https://s.example/search?q=%s" })).toBe("https://s.example/search?q=cats");
    expect(searchTarget("cats", { engine: "custom", custom: "https://s.example/" })).toBeNull();
  });
  it("does nothing for an empty query", () => {
    expect(searchTarget("   ", { engine: "google", custom: "" })).toBeNull();
  });
});

describe("clock widget", () => {
  const zones = ["Asia/Tokyo", "Europe/Istanbul", "America/Argentina/Buenos_Aires"];
  it("names a city from its zone id", () => {
    expect(cityOf("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });
  it("resolves a city name or an id, in any case", () => {
    expect(resolveZone("tokyo", zones)).toBe("Asia/Tokyo");
    expect(resolveZone("buenos aires", zones)).toBe("America/Argentina/Buenos_Aires");
    expect(resolveZone("europe/istanbul", zones)).toBe("Europe/Istanbul");
    expect(resolveZone("Nowhere/Land", zones)).toBeNull();
  });
  it("words the difference", () => {
    expect(offsetText(0)).toBe("same time");
    expect(offsetText(180)).toBe("3h ahead");
    expect(offsetText(-330)).toBe("5h 30m behind");
    expect(offsetText(45)).toBe("45m ahead");
  });
  it("measures the gap between two zones", () => {
    const at = new Date("2026-01-15T12:00:00Z");
    expect((wallClock("Asia/Tokyo", at) - wallClock("UTC", at)) / 60000).toBe(540);
    expect((wallClock("Asia/Kolkata", at) - wallClock("UTC", at)) / 60000).toBe(330);
  });
});

import { parseChart } from "@/lib/markets";
import { formatPrice } from "@/components/MarketsWidget";
import { normalizeRepo, releasesFeed, repoName } from "@/components/ReleasesWidget";

describe("markets", () => {
  const payload = { chart: { result: [{ meta: { symbol: "AAPL", shortName: "Apple Inc.", currency: "USD", regularMarketPrice: 110, chartPreviousClose: 100 }, indicators: { quote: [{ close: [101, null, 105, 110] }] } }] } };
  it("reads price, change and the trend points", () => {
    const q = parseChart(payload, "aapl")!;
    expect(q.symbol).toBe("AAPL");
    expect(q.change).toBe(10);
    expect(q.changePct).toBeCloseTo(10);
    expect(q.points).toEqual([101, 105, 110]);
  });
  it("returns null without a price", () => {
    expect(parseChart({ chart: { result: null, error: { code: "Not Found" } } }, "NOPE")).toBeNull();
  });
  it("formats ordinary and small prices", () => {
    expect(formatPrice(1234.5)).toBe("1,234.50");
    expect(formatPrice(0.05123)).toBe("0.0512");
  });
});

describe("releases", () => {
  it("accepts owner/repo and repository addresses", () => {
    expect(normalizeRepo("immich-app/immich")).toBe("immich-app/immich");
    expect(normalizeRepo("https://github.com/go-gitea/gitea/")).toBe("go-gitea/gitea");
    expect(normalizeRepo("https://github.com/go-gitea/gitea/releases")).toBe("go-gitea/gitea");
    expect(normalizeRepo("https://codeberg.org/forgejo/forgejo.git")).toBe("https://codeberg.org/forgejo/forgejo");
    expect(normalizeRepo("just words")).toBeNull();
  });
  it("builds the releases feed for each forge", () => {
    expect(releasesFeed("a/b")).toBe("https://github.com/a/b/releases.atom");
    expect(releasesFeed("https://gitlab.com/g/p")).toBe("https://gitlab.com/g/p/-/releases.atom");
    expect(releasesFeed("https://codeberg.org/f/f")).toBe("https://codeberg.org/f/f/releases.atom");
  });
  it("names a repository owner/repo", () => {
    expect(repoName("https://gitlab.com/group/sub/project")).toBe("sub/project");
  });
});

import { busyPercent, parseMeminfo } from "@/lib/serverStats";
import { formatBytes, formatUptime } from "@/components/ServerWidget";
import { normalizeSite } from "@/components/MonitorWidget";
import { mapContainers } from "@/lib/docker";
import { containerRank } from "@/components/DockerWidget";
import { fromAdGuard, fromPiholeV5, fromPiholeV6 } from "@/lib/dnsStats";
import { embedProblem } from "@/components/EmbedWidget";

describe("server stats", () => {
  it("measures the busy share between two readings", () => {
    expect(busyPercent({ idle: 100, total: 200 }, { idle: 150, total: 400 })).toBe(75);
    expect(busyPercent({ idle: 1, total: 1 }, { idle: 1, total: 1 })).toBe(0);
  });
  it("counts available memory, not just free", () => {
    expect(parseMeminfo("MemTotal:       1000 kB\nMemFree:         100 kB\nMemAvailable:    600 kB\n")).toEqual({ used: 400 * 1024, total: 1000 * 1024 });
    expect(parseMeminfo("nothing")).toBeNull();
  });
  it("words sizes and uptime", () => {
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatBytes(5.12 * 1024 ** 3)).toBe("5.1 GB");
    expect(formatUptime(86400 * 12 + 5)).toBe("12 days");
    expect(formatUptime(3600)).toBe("1 hour");
    expect(formatUptime(30)).toBe("1 minute");
  });
});

describe("monitor", () => {
  it("accepts addresses with or without a scheme", () => {
    expect(normalizeSite("example.com")).toBe("https://example.com/");
    expect(normalizeSite("http://192.168.1.10:8080/x")).toBe("http://192.168.1.10:8080/x");
    expect(normalizeSite("not an address")).toBeNull();
    expect(normalizeSite("justaword")).toBeNull();
  });
});

describe("docker", () => {
  it("maps Docker's container list", () => {
    expect(mapContainers([{ Id: "abcdef1234567890", Names: ["/web"], Image: "nginx", State: "running", Status: "Up 2 hours" }]))
      .toEqual([{ id: "abcdef123456", name: "web", image: "nginx", state: "running", status: "Up 2 hours" }]);
    expect(mapContainers("nope")).toEqual([]);
  });
  it("puts trouble first, then running, then stopped", () => {
    expect(containerRank({ state: "restarting", status: "Restarting (1) 3 seconds ago" })).toBe(0);
    expect(containerRank({ state: "running", status: "Up 1 hour (unhealthy)" })).toBe(0);
    expect(containerRank({ state: "running", status: "Up 1 hour (healthy)" })).toBe(1);
    expect(containerRank({ state: "exited", status: "Exited (0) 2 days ago" })).toBe(3);
  });
});

describe("dns stats", () => {
  it("reads AdGuard Home", () => {
    expect(fromAdGuard({ num_dns_queries: 10, num_blocked_filtering: 4, avg_processing_time: 0.036 })).toEqual({ queries: 10, blocked: 4, percent: 40, avgMs: 36, blocklist: null });
  });
  it("reads Pi-hole 6 and 5", () => {
    expect(fromPiholeV6({ queries: { total: 12, blocked: 4, percent_blocked: 33.3 }, gravity: { domains_being_blocked: 76100 } })).toEqual({ queries: 12, blocked: 4, percent: 33.3, avgMs: null, blocklist: 76100 });
    expect(fromPiholeV5({ dns_queries_today: 5, ads_blocked_today: 1, ads_percentage_today: 20, domains_being_blocked: 9 })).toEqual({ queries: 5, blocked: 1, percent: 20, avgMs: null, blocklist: 9 });
  });
});

describe("embed", () => {
  const here = { origin: "https://dash.example", https: true };
  it("refuses the dashboard itself, http inside https, and non-web addresses", () => {
    expect(embedProblem("https://dash.example/digest", here)).toMatch(/embed itself/);
    expect(embedProblem("http://status.example", here)).toMatch(/https/);
    expect(embedProblem("javascript:alert(1)", here)).toMatch(/http/);
    expect(embedProblem("nonsense", here)).toMatch(/not a web address/);
  });
  it("accepts another https page, and http when the dashboard is on http", () => {
    expect(embedProblem("https://status.example", here)).toBeNull();
    expect(embedProblem("http://192.168.1.5:3000", { origin: "http://192.168.1.9:3847", https: false })).toBeNull();
  });
});

import { mapEvent, mapStandings } from "@/lib/football";
import { crest, ordinal, outcome } from "@/components/FootballWidget";

describe("football", () => {
  const event = (state: string, hs: unknown, as: unknown) => ({
    id: "1", date: "2026-11-21T13:00Z", league: { name: "Super Lig" },
    competitions: [{ status: { type: { state, shortDetail: state === "in" ? "67'" : "FT" } }, venue: { fullName: "RAMS Park" },
      competitors: [{ homeAway: "home", score: hs, team: { id: "432", displayName: "Galatasaray", shortDisplayName: "Galatasaray", logos: [{ href: "https://a.espncdn.com/i/teamlogos/soccer/500/432.png" }] } },
        { homeAway: "away", score: as, team: { id: "9", displayName: "Samsunspor", logo: "https://a.espncdn.com/i/teamlogos/soccer/500/9.png" } }] }],
  });
  it("reads a finished match, with either score shape", () => {
    const m = mapEvent(event("post", { displayValue: "2", value: 2 }, "1"));
    expect(m.state).toBe("post");
    expect([m.home.score, m.away.score]).toEqual([2, 1]);
    expect(m.competition).toBe("Super Lig");
    expect(m.venue).toBe("RAMS Park");
  });
  it("gives no score to a match that has not started", () => {
    const m = mapEvent(event("pre", "0", "0"));
    expect([m.home.score, m.away.score]).toEqual([null, null]);
  });
  it("keeps the minute of a match being played", () => {
    const m = mapEvent(event("in", "1", "0"));
    expect(m.state).toBe("in");
    expect(m.detail).toBe("67'");
  });
  it("judges a result from the team's side", () => {
    const m = mapEvent(event("post", "2", "1"));
    expect(outcome(m, "432")).toBe("W");
    expect(outcome(m, "9")).toBe("L");
    expect(outcome(mapEvent(event("post", "1", "1")), "9")).toBe("D");
    expect(outcome(m, "nobody")).toBeNull();
  });
  it("reads a table, sorted by rank, with what a position means", () => {
    const row = (id: string, rank: number, pts: number, note?: object) => ({ team: { id, displayName: `T${id}`, logos: [{ href: "x" }] }, note,
      stats: [{ name: "rank", value: rank }, { name: "gamesPlayed", value: 11 }, { name: "points", value: pts }, { name: "pointDifferential", value: 3, displayValue: "+3" }] });
    const [t] = mapStandings({ children: [{ name: "League", standings: { entries: [row("b", 2, 20), row("a", 1, 28, { description: "Champions League", color: "#81D6AC" })] } }] });
    expect(t.rows.map(r => r.id)).toEqual(["a", "b"]);
    expect(t.rows[0]).toMatchObject({ rank: 1, points: 28, played: 11, gd: "+3", note: "Champions League", noteColor: "#81D6AC" });
    expect(mapStandings({})).toEqual([]);
  });
  it("words positions and resizes crests through a reachable host", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
    expect(crest("https://a.espncdn.com/i/teamlogos/soccer/500/432.png", 16)).toBe("https://secure.espn.com/combiner/i?img=%2Fi%2Fteamlogos%2Fsoccer%2F500%2F432.png&w=32&h=32");
    expect(crest("", 16)).toBe("");
  });
});

import { resolveValue, validateDef } from "@/lib/widgetBank";
import lobsters from "../widget-bank/lobsters.json";

describe("widget files", () => {
  it("falls back to the next alternative when a field is empty", () => {
    const post = { url: "", comments_url: "https://lobste.rs/s/x", name: null };
    expect(resolveValue("$.url || $.comments_url", post)).toBe("https://lobste.rs/s/x");
    expect(resolveValue("$.url || $.comments_url", { url: "https://a.example", comments_url: "c" })).toBe("https://a.example");
    expect(resolveValue("$.name || unnamed", post)).toBe("unnamed");
    expect(resolveValue("$.missing || $.also", post)).toBeUndefined();
  });
  it("still applies transforms inside an alternative", () => {
    expect(resolveValue("$.n | count || none", { n: 1234 })).toBe("1.2K");
  });
  it("accepts the Lobsters definition", () => {
    expect(validateDef(lobsters)).toEqual([]);
  });
});

import { mapRepo } from "@/lib/github";
import { mapWatches } from "@/lib/changedetection";
import { buildFrame } from "@/components/HtmlWidget";

describe("repository", () => {
  it("combines the repository with its open pull requests and issues", () => {
    const info = mapRepo(
      { full_name: "o/r", description: "d", html_url: "https://github.com/o/r", stargazers_count: 10, forks_count: 2, pushed_at: "2026-11-17T00:00:00Z", archived: false },
      { total_count: 3, items: [{ number: 7, title: "Fix", html_url: "u", created_at: "2026-11-16T00:00:00Z", user: { login: "ann" } }] },
      { total_count: 1, items: [{ number: 0, title: "" }] },
    );
    expect(info).toMatchObject({ name: "o/r", stars: 10, forks: 2, pulls: 3, issues: 1 });
    expect(info.openPulls).toEqual([{ number: 7, title: "Fix", url: "u", at: "2026-11-16T00:00:00Z", user: "ann" }]);
    expect(info.openIssues).toEqual([]);
  });
});

describe("changes", () => {
  it("names each watch and puts the newest change first", () => {
    const rows = mapWatches({
      a: { url: "https://a.example", title: null, page_title: "A page", last_changed: 0, last_checked: 5, last_error: false, viewed: false },
      b: { url: "https://b.example", title: "Mine", last_changed: 100, last_checked: 100, last_error: false, viewed: false },
      c: { url: "https://c.example/x", last_changed: 50, last_checked: 60, last_error: "timeout", viewed: true },
    }, "http://cd.local/");
    expect(rows.map(r => r.title)).toEqual(["Mine", "c.example/x", "A page"]);
    expect(rows[0]).toMatchObject({ unseen: true, diff: "http://cd.local/diff/b" });
    expect(rows[1]).toMatchObject({ unseen: false, error: "timeout" });
    expect(rows[2].unseen).toBe(false);   // never changed: nothing unseen
    expect(mapWatches([], "x")).toEqual([]);
  });
});

describe("html widget", () => {
  const look = { text: "rgb(1, 2, 3)", muted: "rgb(4, 5, 6)", dark: true };
  it("keeps the frame off the network unless allowed", () => {
    const off = buildFrame("<p>hi</p>", look, false);
    expect(off).toContain("default-src 'none'");
    expect(off).not.toContain("connect-src");
    expect(off).toContain("<p>hi</p>");
    expect(buildFrame("", look, true)).toContain("connect-src https: http:");
  });
  it("gives the frame the card's colors and scheme", () => {
    const doc = buildFrame("", look, false);
    expect(doc).toContain("--text: rgb(1, 2, 3)");
    expect(doc).toContain("color-scheme: dark");
  });
});

import { mapChannels, mapGames } from "@/lib/twitch";
import { normalizeChannel } from "@/components/TwitchWidget";

describe("twitch", () => {
  const users = { data: [{ login: "alpha", display_name: "Alpha", profile_image_url: "a.png" }, { login: "beta", display_name: "Beta", profile_image_url: "b.png" }] };
  const streams = { data: [{ user_login: "beta", title: "Playing", game_name: "Chess", viewer_count: 120, started_at: "2026-11-17T10:00:00Z" }] };
  it("marks who is live, keeps the order asked, and drops names Twitch does not know", () => {
    const rows = mapChannels(["Alpha", "ghost", "beta"], users, streams);
    expect(rows.map(r => r.login)).toEqual(["alpha", "beta"]);
    expect(rows[0]).toMatchObject({ name: "Alpha", live: false, viewers: 0 });
    expect(rows[1]).toMatchObject({ name: "Beta", live: true, game: "Chess", viewers: 120, title: "Playing" });
  });
  it("sizes the box art", () => {
    expect(mapGames({ data: [{ id: "1", name: "Chess", box_art_url: "https://x/ttv-boxart/1-{width}x{height}.jpg" }] }))
      .toEqual([{ id: "1", name: "Chess", art: "https://x/ttv-boxart/1-104x144.jpg" }]);
  });
  it("accepts a channel name or its address", () => {
    expect(normalizeChannel("TwitchDev")).toBe("twitchdev");
    expect(normalizeChannel("https://www.twitch.tv/TwitchDev/videos")).toBe("twitchdev");
    expect(normalizeChannel("@some_one")).toBe("some_one");
    expect(normalizeChannel("not a channel")).toBeNull();
  });
});
