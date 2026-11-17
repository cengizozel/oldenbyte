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
