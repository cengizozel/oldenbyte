import { safeFetch, readCappedText } from "@/lib/ssrf";

// Football (soccer) data for the Football widget, from ESPN's public site API
// (no key): a league's teams, its fixtures with live state, its table, and a
// team's matches across every competition it plays in.

import { leagueName, type Match, type Side, type Table, type TableRow, type TeamRef } from "@/lib/footballLeagues";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer";

/* eslint-disable @typescript-eslint/no-explicit-any */

function side(c: any, homeAway: "home" | "away", state: string): Side {
  const x = (c?.competitors ?? []).find((k: any) => k.homeAway === homeAway) ?? {};
  const t = x.team ?? {};
  const raw = typeof x.score === "object" && x.score !== null ? x.score.displayValue ?? x.score.value : x.score;
  const n = Number(raw);
  return {
    id: String(t.id ?? x.id ?? ""),
    name: String(t.displayName ?? t.name ?? t.location ?? ""),
    short: String(t.shortDisplayName ?? t.abbreviation ?? t.displayName ?? ""),
    logo: String(t.logo ?? t.logos?.[0]?.href ?? ""),
    // A match that has not started reports 0 to 0; that is not a score.
    score: state === "pre" || raw === undefined || raw === null || raw === "" || !Number.isFinite(n) ? null : n,
  };
}

// One ESPN event to a Match. Exported for tests.
export function mapEvent(e: any, fallbackCompetition = ""): Match {
  const c = e?.competitions?.[0] ?? {};
  const type = (c.status ?? e.status ?? {}).type ?? {};
  const state: Match["state"] = type.state === "in" ? "in" : type.state === "post" ? "post" : "pre";
  return {
    id: String(e?.id ?? ""),
    date: String(e?.date ?? c.date ?? ""),
    state,
    detail: String(type.shortDetail ?? type.detail ?? ""),
    home: side(c, "home", state),
    away: side(c, "away", state),
    competition: String(e?.league?.name ?? e?.league?.abbreviation ?? fallbackCompetition),
    venue: String(c.venue?.fullName ?? ""),
  };
}

// ESPN's standings to tables: one for a league, several for a group stage.
// Exported for tests.
export function mapStandings(d: any): Table[] {
  const groups: any[] = d?.children?.length ? d.children : d?.standings ? [d] : [];
  return groups.map(g => ({
    name: String(g.name ?? ""),
    rows: ((g.standings?.entries ?? []) as any[]).map(r => {
      const stat = (name: string) => (r.stats ?? []).find((s: any) => s.name === name);
      const num = (name: string) => Number(stat(name)?.value ?? 0) || 0;
      const t = r.team ?? {};
      return {
        id: String(t.id ?? ""),
        name: String(t.displayName ?? t.name ?? ""),
        short: String(t.shortDisplayName ?? t.abbreviation ?? t.displayName ?? ""),
        logo: String(t.logos?.[0]?.href ?? t.logo ?? ""),
        rank: num("rank"), played: num("gamesPlayed"), won: num("wins"), drawn: num("ties"), lost: num("losses"),
        gd: String(stat("pointDifferential")?.displayValue ?? num("pointDifferential")),
        points: num("points"),
        note: String(r.note?.description ?? ""),
        noteColor: /^#[0-9a-f]{6}$/i.test(r.note?.color ?? "") ? r.note.color : "",
      };
    }).sort((a, b) => a.rank - b.rank),
  })).filter(t => t.rows.length);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// A short cache of its own, not the feed cache: scores must be fresh while a
// match is on (30 seconds) and can rest otherwise (5 minutes); team lists
// barely change (a day).
const cache = new Map<string, { at: number; ttl: number; value: unknown }>();
const LIVE_MS = 30_000, IDLE_MS = 5 * 60_000, DAY_MS = 24 * 60 * 60_000;

async function cached<T>(key: string, ttlFor: (value: T) => number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T;
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), ttl: ttlFor(value), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    return value;
  } catch (err) {
    if (hit) return hit.value as T;   // the source is down: the last answer beats none
    throw err;
  }
}

async function get(url: string): Promise<unknown> {
  const res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; oldenbyte dashboard)", Accept: "application/json" }, timeoutMs: 10_000 });
  if (!res.ok) throw new Error(`The football source answered HTTP ${res.status}`);
  return JSON.parse(await readCappedText(res, 6 * 1024 * 1024));
}

const anyLive = (matches: Match[]) => matches.some(m => m.state === "in");
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export function leagueTeams(league: string): Promise<TeamRef[]> {
  return cached(`teams|${league}`, () => DAY_MS, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await get(`${SITE}/${league}/teams?limit=200`) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const teams: any[] = d?.sports?.[0]?.leagues?.[0]?.teams ?? [];
    return teams.map(x => x.team ?? {}).map(t => ({
      id: String(t.id ?? ""), name: String(t.displayName ?? t.name ?? ""), short: String(t.shortDisplayName ?? t.abbreviation ?? ""), logo: String(t.logos?.[0]?.href ?? ""),
    })).filter(t => t.id && t.name).sort((a, b) => a.name.localeCompare(b.name));
  });
}

function leagueTables(league: string): Promise<Table[]> {
  return cached(`table|${league}`, () => IDLE_MS, async () => mapStandings(await get(`${STANDINGS}/${league}/standings`)));
}

// A league: its matches from three days back to ten ahead, and its table.
export async function leagueData(league: string): Promise<{ league: string; name: string; matches: Match[]; tables: Table[] }> {
  const name = leagueName(league);
  const matches = await cached(`matches|${league}`, (v: Match[]) => (anyLive(v) ? LIVE_MS : IDLE_MS), async () => {
    // The scoreboard takes a whole month (YYYYMM), not a range of days: ask
    // for the month or two the window touches and keep what falls inside it.
    const now = Date.now(), from = now - 3 * DAY_MS, to = now + 10 * DAY_MS;
    const months = [...new Set([from, now, to].map(t => ymd(new Date(t)).slice(0, 6)))];
    const pages = await Promise.all(months.map(async m => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await get(`${SITE}/${league}/scoreboard?dates=${m}&limit=400`) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((d?.events ?? []) as any[]).map(e => mapEvent(e, name));
    }));
    const byId = new Map<string, Match>();
    for (const m of pages.flat()) {
      const at = Date.parse(m.date);
      if (m.id && at >= from && at <= to) byId.set(m.id, m);
    }
    return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  });
  // A cup has no table: that is not an error.
  const tables = await leagueTables(league).catch(() => [] as Table[]);
  return { league, name, matches, tables };
}

// A team: the match being played, the next ones and the latest results, in
// every competition, plus its row in its league's table.
export async function teamData(league: string, teamId: string): Promise<{
  team: TeamRef | null; live: Match | null; next: Match[]; results: Match[]; standing: TableRow | null; leagueName: string;
}> {
  const matches = await cached(`team|${teamId}`, (v: Match[]) => (anyLive(v) ? LIVE_MS : IDLE_MS), async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grab = async (q: string) => (((await get(`${SITE}/all/teams/${encodeURIComponent(teamId)}/schedule${q}`)) as any)?.events ?? []) as any[];
    const [past, upcoming] = await Promise.all([grab(""), grab("?fixture=true")]);
    const byId = new Map<string, Match>();
    for (const e of [...past, ...upcoming]) { const m = mapEvent(e); if (m.id) byId.set(m.id, m); }
    return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  });
  const [teams, tables] = await Promise.all([leagueTeams(league).catch(() => []), leagueTables(league).catch(() => [] as Table[])]);
  const standing = tables.flatMap(t => t.rows).find(r => r.id === teamId) ?? null;
  return {
    team: teams.find(t => t.id === teamId) ?? null,
    live: matches.find(m => m.state === "in") ?? null,
    next: matches.filter(m => m.state === "pre").slice(0, 4),
    results: matches.filter(m => m.state === "post").slice(-5).reverse(),
    standing,
    leagueName: leagueName(league),
  };
}
