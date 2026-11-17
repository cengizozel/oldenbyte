# Football Widget

Football, the sport most of the world calls by that name and the US calls soccer. Settings start with what to follow.

- A team: its place in its league's table, then the match being played or the next one as the main card (opponent, kick-off in your time zone, competition, venue, and the live score and minute while it is on), the next three fixtures, and the last five results with won, drew or lost. Matches come from every competition the team plays in: league, cups, Europe, friendlies.
- A league: two views. Matches lists three days of results and ten days of fixtures by day, live scores included, opening at today. Table is the standings, with a colored mark for what a position means (Champions League, relegation) and a legend under it. A competition with groups shows one table per group; a cup with no table says so.

## Storage Keys

| Key | Value |
|---|---|
| `football-widget-{id}` | JSON: `{ mode, league, team, teamName, view }` |

- `mode` - `team` or `league`
- `league` - the competition's code (`eng.1`, `tur.1`, `uefa.champions`); for a team, the league it plays its league matches in
- `team`, `teamName` - the team's id and name, in team mode
- `view` - `matches` or `table`, in league mode

The competitions on offer are the list in `lib/footballLeagues.ts`; adding one is one line there.

## Behaviour

- Data comes from ESPN's public site API through `/api/football` (no API key). The server keeps answers for 30 seconds while a match is being played and five minutes otherwise; team lists for a day. If the source is down, the last answer is served.
- The widget asks again every 30 seconds while a match it shows is live, every five minutes otherwise, and only while its dashboard is on screen.
- Kick-off times are shown in the dashboard's time zone.
- Crests are loaded by the browser from `secure.espn.com`, resized to what is shown. ESPN's usual image hosts (`espncdn.com`) are blocked on some networks, Turkey's among them; this host serves the same files.
- The scoreboard endpoint takes a whole month, not a range of days, so a league's matches are read by month and trimmed to the window.

Not digestable.

(component: `components/FootballWidget.tsx`, server: `lib/football.ts`, shared: `lib/footballLeagues.ts`)
