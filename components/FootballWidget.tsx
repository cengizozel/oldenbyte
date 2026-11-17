"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { useT } from "@/lib/useT";
import { colorMap, type ColorClasses, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { activeTimezone } from "@/lib/timezone";
import { useScrollFade } from "@/lib/useScrollFade";
import { useWidgetActive, usePageVisible } from "@/lib/activeDashboard";
import { LEAGUES, leagueName, type Match, type Side, type Table, type TableRow, type TeamRef } from "@/lib/footballLeagues";
import FlipCard from "@/components/ui/FlipCard";
import { SettingsSelect } from "@/components/ui/Field";
import { WidgetHeader, Chip, EmptyState, ErrorState, LoadingState, ScrollFades, SettingsFace, SettingsField, SettingsError } from "@/components/ui/WidgetChrome";

// Football, the sport most of the world calls by that name and the US calls
// soccer (docs/widgets/football.md). Follow a team: its place in the table,
// the match being played or the next one, then fixtures and results in every
// competition. Or follow a league: its matches by day, live scores included,
// and its table.

type Mode = "team" | "league";
type Config = { mode: Mode; league: string; team: string; teamName: string; view: "matches" | "table" };
type TeamData = { team: TeamRef | null; live: Match | null; next: Match[]; results: Match[]; standing: TableRow | null; leagueName: string };
type LeagueData = { league: string; name: string; matches: Match[]; tables: Table[] };
const DEFAULT: Config = { mode: "team", league: "eng.1", team: "", teamName: "", view: "matches" };
const LIVE_MS = 30_000, IDLE_MS = 5 * 60_000;

// ESPN serves crests at 500px from a.espncdn.com. Ask its resizer for what is
// shown, at 2x, through secure.espn.com: the same files, and reachable on
// networks where the espncdn.com image hosts are blocked (they are in Turkey).
// Exported for tests.
export function crest(logo: string, px: number): string {
  try {
    const u = new URL(logo);
    if (!/(^|\.)espncdn\.com$|(^|\.)espn\.com$/.test(u.hostname)) return logo;
    return `https://secure.espn.com/combiner/i?img=${encodeURIComponent(u.pathname)}&w=${px * 2}&h=${px * 2}`;
  } catch { return ""; }
}

// "1st", "2nd", "3rd", "11th". Exported for tests.
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

// A result from one team's side: won, drew or lost. Exported for tests.
export function outcome(m: Match, teamId: string): "W" | "D" | "L" | null {
  const mine = m.home.id === teamId ? m.home : m.away.id === teamId ? m.away : null;
  const theirs = mine === m.home ? m.away : m.home;
  if (!mine || mine.score === null || theirs.score === null) return null;
  return mine.score > theirs.score ? "W" : mine.score < theirs.score ? "L" : "D";
}

const dayKey = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

// "Today", "Tomorrow", "Yesterday", else "Sat, Nov 21", in the user's zone.
function dayLabel(iso: string, tz: string): string {
  const key = dayKey(iso, tz), now = Date.now();
  if (key === dayKey(new Date(now).toISOString(), tz)) return "Today";
  if (key === dayKey(new Date(now + 86_400_000).toISOString(), tz)) return "Tomorrow";
  if (key === dayKey(new Date(now - 86_400_000).toISOString(), tz)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

function Crest({ side, px }: { side: Pick<Side, "logo" | "name">; px: number }) {
  const src = crest(side.logo, px);
  if (!src) return <span className="shrink-0 rounded-full bg-black/10 dark:bg-white/10" style={{ width: px, height: px }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={px} height={px} loading="lazy" className="shrink-0 object-contain" style={{ width: px, height: px }} onError={e => { e.currentTarget.style.visibility = "hidden"; }} />;
}

// The red dot and the minute of a match being played.
function LiveTag({ detail }: { detail: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600 dark:text-rose-400">
      <span aria-hidden className="w-2 h-2 rounded-full bg-rose-500 animate-pulse motion-reduce:animate-none" />
      Live{detail ? ` · ${detail}` : ""}
    </span>
  );
}

// The match on show: the one being played, else the next one. The two crests
// face each other with the kickoff time (or the score) between them, the way
// a fixture is drawn everywhere.
function Featured({ c, m, tz }: { c: ColorClasses; m: Match; tz: string }) {
  const live = m.state === "in";
  const scored = m.home.score !== null && m.away.score !== null;
  const name = (s: Side) => <span className={`min-w-0 text-sm font-medium leading-snug text-center line-clamp-2 ${c.text}`}>{s.name}</span>;
  return (
    <div className="rounded-xl bg-black/5 dark:bg-white/10 p-3 flex flex-col gap-2">
      <p className={`text-sm opacity-70 truncate text-center ${c.label}`}>{live ? m.competition : `${dayLabel(m.date, tz)} · ${m.competition}`}</p>
      {/* Crests in the outer thirds, so each sits over the middle of its
          team's name below, which gets a full half of the card. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex justify-center"><Crest side={m.home} px={40} /></div>
        <div className="flex flex-col items-center text-center">
          <span className={`text-xl font-semibold tabular-nums leading-tight ${c.text}`}>
            {scored ? <>{m.home.score} <span className="opacity-50">-</span> {m.away.score}</> : timeOf(m.date, tz)}
          </span>
          {live && <LiveTag detail={m.detail} />}
        </div>
        <div className="flex justify-center"><Crest side={m.away} px={40} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {name(m.home)}
        {name(m.away)}
      </div>
      {m.venue && <p className={`text-sm opacity-70 truncate text-center ${c.label}`}>{m.venue}</p>}
    </div>
  );
}

export default function FootballWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const t = useT();
  const active = useWidgetActive();
  const visible = usePageVisible();
  const storageKey = `football-widget-${widget.id}`;
  const tz = activeTimezone();
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [draft, setDraft] = useState<Config>(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [league, setLeague] = useState<LeagueData | null>(null);
  const [failed, setFailed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teams, setTeams] = useState<TeamRef[]>([]);
  const [teamsBusy, setTeamsBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useRef(0);
  const todayRef = useRef<HTMLLIElement>(null);
  const scrolledFor = useRef("");
  const configured = config.mode === "league" ? !!config.league : !!(config.league && config.team);
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([team, league, config.view]);

  const load = useCallback(async (cfg: Config) => {
    const ok = cfg.mode === "league" ? !!cfg.league : !!(cfg.league && cfg.team);
    if (!ok) return;
    const mine = ++run.current;
    try {
      const q = cfg.mode === "league" ? `op=league&league=${encodeURIComponent(cfg.league)}` : `op=team&league=${encodeURIComponent(cfg.league)}&team=${encodeURIComponent(cfg.team)}`;
      const res = await fetch(`/api/football?${q}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (run.current !== mine) return;
      if (cfg.mode === "league") setLeague(data); else setTeam(data);
      setFailed(false);
    } catch {
      if (run.current === mine) setFailed(true);
    }
  }, []);

  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (saved) {
        try {
          const parsed = { ...DEFAULT, ...JSON.parse(saved) } as Config;
          setConfig(parsed);
          setDraft(parsed);
        } catch {}
      }
      setLoaded(true);
    });
  }, [storageKey]);

  // Scores every 30 seconds while a match is on, every five minutes
  // otherwise, and only while the dashboard is on screen.
  const liveNow = config.mode === "league" ? !!league?.matches.some(m => m.state === "in") : !!team?.live;
  useEffect(() => {
    if (!active || !visible || !configured) return;
    load(config);
    const id = setInterval(() => load(config), liveNow ? LIVE_MS : IDLE_MS);
    return () => clearInterval(id);
  }, [active, visible, configured, config, liveNow, load]);

  // Settings: the league's teams, for the team picker.
  useEffect(() => {
    if (!settingsOpen || draft.mode !== "team" || !draft.league) return;
    let stale = false;
    setTeamsBusy(true);
    fetch(`/api/football?op=teams&league=${encodeURIComponent(draft.league)}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((list: TeamRef[]) => { if (!stale) { setTeams(list); setError(""); } })
      .catch(() => { if (!stale) { setTeams([]); setError("Could not load that league's teams."); } })
      .finally(() => { if (!stale) setTeamsBusy(false); });
    return () => { stale = true; };
  }, [settingsOpen, draft.mode, draft.league]);

  // A league's matches open at today, with the results above.
  useEffect(() => {
    if (config.mode !== "league" || config.view !== "matches" || !league) return;
    if (scrolledFor.current === league.league) return;
    scrolledFor.current = league.league;
    const el = todayRef.current, box = ref.current;
    if (el && box) box.scrollTop = Math.max(0, el.offsetTop - 4);
  }, [league, config.mode, config.view, ref]);

  function handleSave() {
    setError("");
    if (draft.mode === "team" && !draft.team) { setError("Pick a team."); return; }
    const picked = teams.find(x => x.id === draft.team);
    const next = { ...draft, teamName: draft.mode === "team" ? picked?.name ?? draft.teamName : "" };
    setConfig(next);
    setDraft(next);
    setTeam(null);
    setLeague(null);
    scrolledFor.current = "";
    storage.setItem(storageKey, JSON.stringify(next));
    setSettingsOpen(false);
  }

  function setView(view: Config["view"]) {
    const next = { ...config, view };
    setConfig(next);
    storage.setItem(storageKey, JSON.stringify(next));
  }

  const title = !configured ? widget.title : config.mode === "league" ? leagueName(config.league) : team?.team?.name ?? config.teamName ?? widget.title;
  const hairline = (i: number) => (i > 0 ? "border-t border-black/10 dark:border-white/10" : "");

  function teamBody(d: TeamData) {
    const featured = d.live ?? d.next[0] ?? null;
    const upcoming = d.next.filter(m => m !== featured).slice(0, 3);
    const opponent = (m: Match) => (m.home.id === config.team ? m.away : m.home);
    const where = (m: Match) => (m.home.id === config.team ? "home" : "away");
    return (
      <div className="flex flex-col gap-3">
        {d.standing && (
          <p className={`text-sm ${c.label}`}>
            <span className={`font-medium ${c.text}`}>{ordinal(d.standing.rank)}</span> in {d.leagueName}
            <span className="opacity-70"> · {d.standing.points} pts from {d.standing.played}</span>
          </p>
        )}
        {featured ? <Featured c={c} m={featured} tz={tz} /> : <p className={`text-sm opacity-70 ${c.label}`}>No match scheduled.</p>}
        {upcoming.length > 0 && (
          <div>
            <p className={`text-sm font-medium opacity-70 pb-1 ${c.label}`}>Next</p>
            <ul className="flex flex-col">
              {upcoming.map((m, i) => (
                <li key={m.id} className={`flex items-center gap-2 py-1.5 ${hairline(i)}`} title={`${m.competition}${m.venue ? ` · ${m.venue}` : ""}`}>
                  <Crest side={opponent(m)} px={18} />
                  <span className={`flex-1 min-w-0 truncate text-sm ${c.text}`}>{opponent(m).name}<span className={`opacity-70 ${c.label}`}> · {where(m)}</span></span>
                  <span className={`shrink-0 text-sm tabular-nums opacity-70 ${c.label}`}>{dayLabel(m.date, tz)} {timeOf(m.date, tz)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.results.length > 0 && (
          <div>
            <p className={`text-sm font-medium opacity-70 pb-1 ${c.label}`}>Results</p>
            <ul className="flex flex-col">
              {d.results.map((m, i) => {
                const o = outcome(m, config.team);
                const tone = o === "W" ? "bg-emerald-600 text-white" : o === "L" ? "bg-rose-600 text-white" : "bg-black/20 dark:bg-white/25 text-[var(--text-primary)]";
                const word = o === "W" ? "Won" : o === "L" ? "Lost" : o === "D" ? "Drew" : "";
                return (
                  <li key={m.id} className={`flex items-center gap-2 py-1.5 ${hairline(i)}`} title={`${m.competition} · ${dayLabel(m.date, tz)}`}>
                    <span aria-label={word} className={`shrink-0 w-5 h-5 rounded-md text-xs font-medium flex items-center justify-center ${tone}`}>{o ?? ""}</span>
                    <Crest side={opponent(m)} px={18} />
                    <span className={`flex-1 min-w-0 truncate text-sm ${c.text}`}>{opponent(m).name}<span className={`opacity-70 ${c.label}`}> · {where(m)}</span></span>
                    <span className={`shrink-0 text-sm font-medium tabular-nums ${c.text}`}>{m.home.score ?? "-"}:{m.away.score ?? "-"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  }

  function matchesBody(d: LeagueData) {
    if (!d.matches.length) return <EmptyState c={c}>no matches this week</EmptyState>;
    const today = dayKey(new Date().toISOString(), tz);
    const days: { key: string; label: string; list: Match[] }[] = [];
    for (const m of d.matches) {
      const key = dayKey(m.date, tz);
      const last = days[days.length - 1];
      if (last?.key === key) last.list.push(m); else days.push({ key, label: dayLabel(m.date, tz), list: [m] });
    }
    // Where the list opens: today, else the first day still to come.
    const openAt = days.find(x => x.key >= today)?.key ?? days[days.length - 1].key;
    return (
      <ul className="flex flex-col gap-3">
        {days.map(day => (
          <li key={day.key} ref={day.key === openAt ? todayRef : undefined}>
            <p className={`text-sm font-medium pb-1 ${c.label} ${day.key === today ? "" : "opacity-70"}`}>{day.label}</p>
            <ul className="flex flex-col">
              {day.list.map((m, i) => (
                <li key={m.id} className={`flex items-center gap-2 py-1.5 ${hairline(i)}`} title={m.venue || undefined}>
                  <span className={`shrink-0 w-12 text-sm tabular-nums ${m.state === "in" ? "font-medium text-rose-600 dark:text-rose-400" : `opacity-70 ${c.label}`}`}>
                    {m.state === "pre" ? timeOf(m.date, tz) : m.detail || (m.state === "in" ? "Live" : "FT")}
                  </span>
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    {[m.home, m.away].map(s => (
                      <div key={s.id || s.name} className="flex items-center gap-1.5 min-w-0">
                        <Crest side={s} px={16} />
                        <span className={`flex-1 min-w-0 truncate text-sm ${c.text}`}>{s.name}</span>
                        {s.score !== null && <span className={`shrink-0 text-sm font-medium tabular-nums ${c.text}`}>{s.score}</span>}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  function tableBody(d: LeagueData) {
    if (!d.tables.length) return <EmptyState c={c}>this competition has no table</EmptyState>;
    // What the colored marks mean, once, under the tables.
    const notes = new Map<string, string>();
    for (const tb of d.tables) for (const r of tb.rows) if (r.note && r.noteColor && !notes.has(r.note)) notes.set(r.note, r.noteColor);
    const cell = `text-sm tabular-nums text-right ${c.text}`;
    return (
      <div className="flex flex-col gap-3">
        {d.tables.map(tb => (
          <div key={tb.name}>
            {d.tables.length > 1 && <p className={`text-sm font-medium opacity-70 pb-1 ${c.label}`}>{tb.name}</p>}
            <table className="w-full border-collapse">
              <thead>
                <tr className={`text-sm opacity-70 ${c.label}`}>
                  <th scope="col" className="text-left font-normal pb-1" colSpan={2}>Team</th>
                  <th scope="col" className="text-right font-normal pb-1 w-8" title="Played">P</th>
                  <th scope="col" className="text-right font-normal pb-1 w-10" title="Goal difference">GD</th>
                  <th scope="col" className="text-right font-normal pb-1 w-9" title="Points">Pts</th>
                </tr>
              </thead>
              <tbody>
                {tb.rows.map(r => (
                  <tr key={r.id} className="border-t border-black/10 dark:border-white/10" title={r.note || undefined}>
                    <td className={`py-1.5 pr-1.5 w-7 text-sm tabular-nums opacity-70 ${c.label}`} style={r.noteColor ? { boxShadow: `inset 3px 0 0 ${r.noteColor}`, paddingLeft: 7 } : { paddingLeft: 7 }}>{r.rank}</td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Crest side={r} px={16} />
                        <span className={`truncate text-sm ${c.text}`}>{r.short || r.name}</span>
                      </div>
                    </td>
                    <td className={cell}>{r.played}</td>
                    <td className={cell}>{r.gd}</td>
                    <td className={`${cell} font-medium`}>{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {notes.size > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {[...notes].map(([note, color]) => (
              <li key={note} className={`flex items-center gap-1.5 text-sm opacity-70 ${c.label}`}>
                <span aria-hidden className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />{note}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const data = config.mode === "league" ? league : team;

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader onSettings={() => { setDraft(config); setError(""); setSettingsOpen(true); }} c={c} icon={Trophy} title={title} />
          {!loaded ? null : !configured ? (
            <EmptyState c={c} action={t("empty.football")} />
          ) : failed && !data ? (
            <ErrorState c={c} onRetry={() => load(config)}>could not load the football</ErrorState>
          ) : !data ? (
            <LoadingState c={c} />
          ) : (
            <>
              {config.mode === "league" && (
                <div className="flex gap-1.5 mb-3 shrink-0">
                  <Chip c={c} active={config.view === "matches"} onClick={() => setView("matches")}>Matches</Chip>
                  <Chip c={c} active={config.view === "table"} onClick={() => setView("table")}>Table</Chip>
                </div>
              )}
              <div className="flex-1 min-h-0 relative">
                <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
                  {config.mode === "team" ? teamBody(team!) : config.view === "table" ? tableBody(league!) : matchesBody(league!)}
                </div>
                <ScrollFades c={c} top={topFade} bottom={bottomFade} />
              </div>
            </>
          )}
        </>
      }
      back={
        <SettingsFace c={c} onReset={() => setDraft(DEFAULT)} onSave={handleSave} onCancel={() => { setSettingsOpen(false); setError(""); }}>
          <SettingsField c={c} label="Follow" inline>
            <Chip c={c} active={draft.mode === "team"} onClick={() => setDraft(d => ({ ...d, mode: "team" }))}>A team</Chip>
            <Chip c={c} active={draft.mode === "league"} onClick={() => setDraft(d => ({ ...d, mode: "league" }))}>A league</Chip>
          </SettingsField>
          <SettingsField c={c} label={draft.mode === "team" ? "Its league" : "League"} hint={draft.mode === "team" ? "Where the team plays its league matches. Its cup and European matches are shown too." : undefined}>
            <SettingsSelect value={draft.league} onChange={e => setDraft(d => ({ ...d, league: e.target.value, team: "", teamName: "" }))} aria-label="League">
              {[...new Set(LEAGUES.map(l => l.group))].map(group => (
                <optgroup key={group} label={group}>
                  {LEAGUES.filter(l => l.group === group).map(l => <option key={l.slug} value={l.slug}>{l.name}</option>)}
                </optgroup>
              ))}
            </SettingsSelect>
          </SettingsField>
          {draft.mode === "team" && (
            <SettingsField c={c} label="Team">
              <SettingsSelect value={draft.team} onChange={e => setDraft(d => ({ ...d, team: e.target.value }))} disabled={teamsBusy || !teams.length} aria-label="Team">
                <option value="">{teamsBusy ? "Loading teams" : "Choose a team"}</option>
                {teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </SettingsSelect>
            </SettingsField>
          )}
          {error && <SettingsError>{error}</SettingsError>}
        </SettingsFace>
      }
    />
  );
}
