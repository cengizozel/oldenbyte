// Types and the league list for the Football widget, shared by the browser
// and the server. The fetching lives in lib/football.ts (server only).

export type Side = { id: string; name: string; short: string; logo: string; score: number | null };
export type Match = {
  id: string;
  date: string;                    // ISO, UTC
  state: "pre" | "in" | "post";    // not started, being played, finished
  detail: string;                  // "FT", "HT", "67'", or a kick-off note
  home: Side;
  away: Side;
  competition: string;
  venue: string;
};
export type TableRow = {
  id: string; name: string; short: string; logo: string;
  rank: number; played: number; won: number; drawn: number; lost: number; gd: string; points: number;
  note: string; noteColor: string;   // what the position means ("Champions League"), and its color
};
export type Table = { name: string; rows: TableRow[] };
export type TeamRef = { id: string; name: string; short: string; logo: string };

// The competitions offered in settings. `slug` is ESPN's code.
export const LEAGUES: { slug: string; name: string; group: string }[] = [
  { slug: "eng.1", name: "Premier League", group: "England" },
  { slug: "eng.2", name: "Championship", group: "England" },
  { slug: "eng.fa", name: "FA Cup", group: "England" },
  { slug: "esp.1", name: "La Liga", group: "Spain" },
  { slug: "ger.1", name: "Bundesliga", group: "Germany" },
  { slug: "ita.1", name: "Serie A", group: "Italy" },
  { slug: "fra.1", name: "Ligue 1", group: "France" },
  { slug: "tur.1", name: "Süper Lig", group: "Turkey" },
  { slug: "ned.1", name: "Eredivisie", group: "Netherlands" },
  { slug: "por.1", name: "Primeira Liga", group: "Portugal" },
  { slug: "sco.1", name: "Scottish Premiership", group: "Scotland" },
  { slug: "bel.1", name: "Belgian Pro League", group: "Belgium" },
  { slug: "usa.1", name: "MLS", group: "Americas" },
  { slug: "mex.1", name: "Liga MX", group: "Americas" },
  { slug: "bra.1", name: "Brasileirão", group: "Americas" },
  { slug: "arg.1", name: "Liga Profesional", group: "Americas" },
  { slug: "conmebol.libertadores", name: "Copa Libertadores", group: "Americas" },
  { slug: "ksa.1", name: "Saudi Pro League", group: "Asia" },
  { slug: "uefa.champions", name: "Champions League", group: "Europe" },
  { slug: "uefa.europa", name: "Europa League", group: "Europe" },
  { slug: "uefa.europa.conf", name: "Conference League", group: "Europe" },
  { slug: "uefa.nations", name: "Nations League", group: "International" },
  { slug: "uefa.euro", name: "European Championship", group: "International" },
  { slug: "fifa.world", name: "World Cup", group: "International" },
];
export const isLeague = (slug: string) => LEAGUES.some(l => l.slug === slug);
export const leagueName = (slug: string) => LEAGUES.find(l => l.slug === slug)?.name ?? slug;
