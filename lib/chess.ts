import { Chess, type Move } from "chess.js";

// Pure chess helpers shared by the Chess widget, the daily puzzle route and
// the Assistant's reader (lib/widgetData.ts). No React, no workers.

export type Color = "w" | "b";
export type Score = { cp?: number; mate?: number }; // from White's point of view
export type Mark = { ply: number; kind: "inaccuracy" | "mistake" | "blunder"; loss: number; best: string; bestUci: string };
export type Result = "w" | "d" | "l"; // win, draw, loss, for the player

export type ChessRecord = {
  byElo: Record<string, { w: number; d: number; l: number }>;
  last: Result[];          // newest last, up to 30
  streak: number;          // current run of wins
  best: number;            // longest run of wins
  puzzleDays: string[];    // days a daily puzzle was solved, newest last, up to 60
};

export type Saved = {
  pgn?: string;
  elo?: number;
  playerColor?: Color;
  evalBar?: boolean;
  coach?: boolean;
  counted?: boolean;                                   // this game's result is in the record
  analysis?: { fen: string } & Score & { best?: string }; // engine view of the live position
  review?: { pgn: string; marks: Mark[] };
  record?: ChessRecord;
};

export const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const GLYPHS: Record<string, string> = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" };

export function emptyRecord(): ChessRecord {
  return { byElo: {}, last: [], streak: 0, best: 0, puzzleDays: [] };
}

// Material on the board, White minus Black.
export function materialBalance(game: Chess): number {
  let sum = 0;
  for (const row of game.board()) for (const sq of row) if (sq) sum += (sq.color === "w" ? 1 : -1) * VALUES[sq.type];
  return sum;
}

// Pieces each side has taken, as glyphs sorted by value (pawns first).
export function capturedBy(history: Move[]): Record<Color, string> {
  const out: Record<Color, string[]> = { w: [], b: [] };
  for (const m of history) if (m.captured) out[m.color].push(m.captured);
  const fmt = (list: string[]) => list.sort((a, b) => VALUES[a] - VALUES[b]).map(p => GLYPHS[p] ?? "").join("");
  return { w: fmt(out.w), b: fmt(out.b) };
}

// A UCI score is from the side to move; flip it to White's view.
export function toWhite(score: Score, fen: string): Score {
  const black = fen.split(" ")[1] === "b";
  if (!black) return score;
  return { cp: score.cp === undefined ? undefined : -score.cp, mate: score.mate === undefined ? undefined : -score.mate };
}

// A score as centipawns, mate folded in, clamped so a won position going
// from +15 to +10 never counts as a blunder.
export function clampCp(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 1000 : s.mate < 0 ? -1000 : 0;
  return Math.max(-1000, Math.min(1000, s.cp ?? 0));
}

// White's share of the evaluation bar, 0..1.
export function barShare(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-(s.cp ?? 0) / 250));
}

export function formatScore(s: Score): string {
  if (s.mate !== undefined) return `M${Math.abs(s.mate)}`;
  const v = (s.cp ?? 0) / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

// How much a move cost its player, in clamped centipawns, and what it counts as.
export function classify(before: Score, after: Score, mover: Color): { loss: number; kind: Mark["kind"] | null } {
  const sign = mover === "w" ? 1 : -1;
  const loss = Math.max(0, sign * (clampCp(before) - clampCp(after)));
  const kind = loss >= 300 ? "blunder" : loss >= 150 ? "mistake" : loss >= 60 ? "inaccuracy" : null;
  return { loss, kind };
}

export const MARK_SYMBOL: Record<Mark["kind"], string> = { inaccuracy: "?!", mistake: "?", blunder: "??" };

// UCI ("e2e4", "e7e8q") to SAN in a position, or the UCI when it is illegal there.
export function uciToSan(fen: string, uci: string): string {
  try {
    const g = new Chess(fen);
    return g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined }).san;
  } catch {
    return uci;
  }
}

// Add a finished game to the record.
export function addResult(rec: ChessRecord, elo: number, r: Result): ChessRecord {
  const key = String(elo);
  const row = rec.byElo[key] ?? { w: 0, d: 0, l: 0 };
  const streak = r === "w" ? rec.streak + 1 : 0;
  return {
    ...rec,
    byElo: { ...rec.byElo, [key]: { ...row, [r]: row[r] + 1 } },
    last: [...rec.last, r].slice(-30),
    streak,
    best: Math.max(rec.best, streak),
  };
}

export function addPuzzleDay(rec: ChessRecord, day: string): ChessRecord {
  if (rec.puzzleDays.includes(day)) return rec;
  return { ...rec, puzzleDays: [...rec.puzzleDays, day].slice(-60) };
}

// Consecutive days, ending today or yesterday, with a solved puzzle.
export function puzzleStreak(days: string[], today: string): number {
  const set = new Set(days);
  const step = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
  let d = set.has(today) ? today : step(today);
  let n = 0;
  while (set.has(d)) { n++; d = step(d); }
  return n;
}

// The player's result in a finished game, or null while it runs.
export function resultFor(game: Chess, player: Color): Result | null {
  if (game.isCheckmate()) return game.turn() === player ? "l" : "w";
  if (game.isDraw() || game.isStalemate() || game.isThreefoldRepetition() || game.isInsufficientMaterial()) return "d";
  return null;
}

export type DailyPuzzle = { id: string; fen: string; lastMove?: string; solution: string[]; rating: number; themes: string[] };

// Lichess's /api/puzzle/daily: the game's PGN ends on the move that sets up
// the puzzle, so replaying it gives the position to solve. Checked against the
// first solution move; the API's own fen is the fallback.
export function parseDailyPuzzle(json: unknown): DailyPuzzle | null {
  const d = json as { game?: { pgn?: string }; puzzle?: { id?: string; fen?: string; solution?: string[]; rating?: number; themes?: string[] } };
  const p = d?.puzzle;
  if (!p?.id || !Array.isArray(p.solution) || !p.solution.length) return null;
  const legal = (fen: string) => {
    try { new Chess(fen).move({ from: p.solution![0].slice(0, 2), to: p.solution![0].slice(2, 4), promotion: p.solution![0].slice(4, 5) || undefined }); return true; } catch { return false; }
  };
  let fen = "", lastMove: string | undefined;
  if (d.game?.pgn) {
    try {
      const g = new Chess();
      g.loadPgn(d.game.pgn);
      const hist = g.history({ verbose: true });
      const last = hist[hist.length - 1];
      if (last) lastMove = last.from + last.to;
      if (legal(g.fen())) fen = g.fen();
    } catch { /* fall back to the api fen */ }
  }
  if (!fen && p.fen && legal(p.fen)) fen = p.fen;
  if (!fen) return null;
  return { id: p.id, fen, lastMove, solution: p.solution, rating: p.rating ?? 0, themes: p.themes ?? [] };
}
