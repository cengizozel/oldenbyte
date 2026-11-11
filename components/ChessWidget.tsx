"use client";

import { useState, useEffect, useRef, useMemo, type CSSProperties, type ReactNode } from "react";
import { Chessboard } from "react-chessboard";
import type { Arrow, PieceDropHandlerArgs } from "react-chessboard";
import { Chess, type Move, type Square } from "chess.js";
import { Swords, Loader, Undo2, Lightbulb, ListChecks, Puzzle, Trophy, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { colorMap, type Widget, type ColorClasses } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { localDateStr } from "@/lib/format";
import { FOCUS_RING, HIT_AREA } from "@/components/ui/Field";
import Toggle from "@/components/ui/Toggle";
import { WidgetHeader, SmallButton, SettingsFace, SettingsField, Chip } from "@/components/ui/WidgetChrome";
import { Analyzer, type Analysis } from "@/lib/chessEngine";
import {
  addPuzzleDay, addResult, barShare, capturedBy, classify, emptyRecord, formatScore, materialBalance, MARK_SYMBOL,
  puzzleStreak, resultFor, uciToSan, type ChessRecord, type Color, type DailyPuzzle, type Mark, type Saved, type Score,
} from "@/lib/chess";

const ENGINE_PATH = "/stockfish/stockfish-18-lite-single.js";
const MIN_ELO = 1300;
const MAX_ELO = 2800;
const GUTTER = 18;   // room for the coordinates beside and under the board
const EVAL_W = 14;   // the evaluation bar and its gap
const MOVE_TIME_MS = 700;
const GREEN = "rgba(34, 197, 94, 0.85)";
const RED = "rgba(239, 68, 68, 0.85)";
const LAST = "rgba(250, 204, 21, 0.28)";
const PLURAL: Record<Mark["kind"], string> = { blunder: "blunders", mistake: "mistakes", inaccuracy: "inaccuracies" };

// Index of the last move shown: -1 is the start position, null the live game.
type View = number | null;

function IconAction({ c, label, onClick, disabled, children }: { c: ColorClasses; label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`w-7 h-7 shrink-0 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 bg-black/5 dark:bg-white/10 enabled:hover:bg-black/10 dark:enabled:hover:bg-white/15 ${c.label} ${FOCUS_RING}`}
    >
      {children}
    </button>
  );
}

export default function ChessWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `chess-${widget.id}`;

  const gameRef = useRef<Chess | null>(null);
  if (!gameRef.current) gameRef.current = new Chess();
  const game = gameRef.current;
  const workerRef = useRef<Worker | null>(null);
  const analyzerRef = useRef<Analyzer | null>(null);

  const [fen, setFen] = useState(game.fen());
  const [elo, setElo] = useState(1500);
  const [playerColor, setPlayerColor] = useState<Color>("w");
  const [evalBar, setEvalBar] = useState(false);
  const [coach, setCoach] = useState(true);
  const [record, setRecord] = useState<ChessRecord>(emptyRecord());
  const [review, setReview] = useState<{ pgn: string; marks: Mark[] } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [ready, setReady] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [view, setView] = useState<View>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [hint, setHint] = useState<string | null>(null); // UCI
  const [coachNote, setCoachNote] = useState<{ ply: number; best: string; bestUci: string; loss: number } | null>(null);
  const [reviewing, setReviewing] = useState<{ done: number; total: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState({ elo: 1500, evalBar: false, coach: true });
  const [recordOpen, setRecordOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // Daily puzzle
  const [mode, setMode] = useState<"game" | "puzzle">("game");
  const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null);
  const [puzzleError, setPuzzleError] = useState("");
  const puzzleRef = useRef<Chess | null>(null);
  const [puzzleFen, setPuzzleFen] = useState("");
  const [puzzleStep, setPuzzleStep] = useState(0);
  const [puzzleState, setPuzzleState] = useState<"solving" | "wrong" | "solved">("solving");
  const [puzzleHint, setPuzzleHint] = useState(false);

  // Refs mirror state for the once-bound worker callbacks.
  const eloRef = useRef(elo); eloRef.current = elo;
  const colorRef = useRef(playerColor); colorRef.current = playerColor;
  const savedRef = useRef<Saved>({});
  const engineGen = useRef(0);
  const pendingGen = useRef(-1);
  const reviewGen = useRef(0);
  const initMoveDone = useRef(false);

  function persist(patch: Partial<Saved> = {}) {
    savedRef.current = { ...savedRef.current, pgn: game.pgn(), elo: eloRef.current, playerColor: colorRef.current, ...patch };
    storage.setItem(storageKey, JSON.stringify(savedRef.current));
  }
  const sync = () => setFen(game.fen());

  // Load
  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (saved) {
        try {
          const s: Saved = JSON.parse(saved);
          savedRef.current = s;
          if (typeof s.elo === "number") setElo(s.elo);
          if (s.playerColor === "w" || s.playerColor === "b") setPlayerColor(s.playerColor);
          if (typeof s.evalBar === "boolean") setEvalBar(s.evalBar);
          if (typeof s.coach === "boolean") setCoach(s.coach);
          if (s.record) setRecord({ ...emptyRecord(), ...s.record });
          if (s.review) setReview(s.review);
          if (s.pgn) { game.loadPgn(s.pgn); setFen(game.fen()); }
        } catch {}
      }
      setConfigLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Engines: the opponent (strength limited) and the analyst (full strength).
  useEffect(() => {
    const w = new Worker(ENGINE_PATH);
    workerRef.current = w;
    w.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : String(e.data ?? "");
      if (line === "uciok") w.postMessage("isready");
      else if (line === "readyok") setReady(true);
      else if (line.startsWith("bestmove")) {
        const stale = pendingGen.current !== engineGen.current;
        pendingGen.current = -1;
        setThinking(false);
        const uci = line.split(/\s+/)[1];
        if (stale || !uci || uci === "(none)" || game.turn() === colorRef.current) return;
        try {
          game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
          sync();
          persist();
          settle();
        } catch {}
      }
    };
    w.postMessage("uci");
    analyzerRef.current = new Analyzer();
    return () => { w.terminate(); workerRef.current = null; analyzerRef.current?.dispose(); analyzerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    const w = workerRef.current;
    if (!w) return;
    w.postMessage("setoption name UCI_LimitStrength value true");
    w.postMessage("setoption name UCI_Elo value " + elo);
  }, [ready, elo]);

  function requestEngineMove() {
    const w = workerRef.current;
    if (!w) return;
    setThinking(true);
    pendingGen.current = engineGen.current;
    w.postMessage("position fen " + game.fen());
    w.postMessage("go movetime " + MOVE_TIME_MS);
  }

  function stopEngine() {
    engineGen.current++;
    if (pendingGen.current !== -1) workerRef.current?.postMessage("stop");
    setThinking(false);
  }

  // A finished game goes into the record once.
  function settle() {
    const r = resultFor(game, colorRef.current);
    if (!r || savedRef.current.counted) return;
    savedRef.current.counted = true;
    setRecord(prev => {
      const next = addResult(prev, eloRef.current, r);
      persist({ record: next, counted: true });
      return next;
    });
  }

  useEffect(() => {
    if (!ready || !configLoaded || initMoveDone.current) return;
    initMoveDone.current = true;
    if (!game.isGameOver() && game.turn() !== playerColor) requestEngineMove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, configLoaded]);

  // Board size
  const contentRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Positions
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hist: Move[] = useMemo(() => game.history({ verbose: true }), [fen]);
  const n = hist.length;
  const positions = useMemo(() => [hist[0]?.before ?? game.fen(), ...hist.map(m => m.after)], [hist, game]);
  const reviewOk = review && review.pgn === game.pgn() ? review : null;
  const markAt = (ply: number) => reviewOk?.marks.find(m => m.ply === ply) ?? null;
  const viewMark = mode === "game" && view !== null && view >= 0 ? markAt(view) : null;
  // A flagged move is shown from the position it was played in, with the
  // played move and the better one drawn; any other move after it is played.
  const shownFen = mode === "puzzle"
    ? puzzleFen
    : view === null ? fen : viewMark ? positions[view] : positions[view + 1];
  const shownPlies = view === null ? n : viewMark ? view : view + 1;
  const lastMove: Move | undefined = mode === "game" ? hist[shownPlies - 1] : undefined;

  // Engine view of the shown position: the evaluation bar, and for the live
  // position what the Assistant reads.
  useEffect(() => {
    const a = analyzerRef.current;
    if (!a || !shownFen || reviewing) return;
    let alive = true;
    a.analyze(shownFen, 400, "shown").then(res => {
      if (!alive) return;
      setScore(res);
      if (mode === "game" && shownFen === game.fen()) {
        persist({ analysis: { fen: shownFen, cp: res.cp, mate: res.mate, best: res.best } });
      }
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownFen, mode, ready, reviewing]);

  const gameOver = game.isGameOver();
  const live = mode === "game" && view === null;
  const canPlay = () => live && ready && !thinking && !gameOver && game.turn() === playerColor;
  const puzzleColor: Color = puzzle ? (new Chess(puzzle.fen).turn() as Color) : "w";

  function clearSelection() { setSelected(null); setTargets([]); }

  // Moves
  function doMove(from: string, to: string): boolean {
    const piece = game.get(from as Square);
    const isPromotion = piece?.type === "p" && (to[1] === "8" || to[1] === "1");
    const before = game.fen();
    let played: Move;
    try { played = game.move({ from, to, ...(isPromotion ? { promotion: "q" } : {}) }); } catch { clearSelection(); return false; }
    const ply = game.history().length - 1;
    clearSelection();
    setHint(null);
    setCoachNote(null);
    sync();
    persist();
    if (game.isGameOver()) settle(); else requestEngineMove();
    // Blunder alert: the position before and after, from your side.
    const a = analyzerRef.current;
    if (coach && a) {
      Promise.all([a.analyze(before, 250), a.analyze(played.after, 250)]).then(([b, af]) => {
        const { loss, kind } = classify(b, af, colorRef.current);
        if (kind !== "blunder" || !b.best || b.best === played.lan) return;
        if (game.history()[ply] !== played.san) return; // taken back since
        setCoachNote({ ply, best: uciToSan(before, b.best), bestUci: b.best, loss });
      });
    }
    return true;
  }

  function onDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false;
    if (mode === "puzzle") return puzzleMove(sourceSquare, targetSquare);
    if (!canPlay()) return false;
    return doMove(sourceSquare, targetSquare);
  }

  function onSquareClick({ square }: { square: string }) {
    const pg = puzzleRef.current;
    const board = mode === "puzzle" ? pg : game;
    const mine = mode === "puzzle" ? puzzleColor : playerColor;
    const allowed = mode === "puzzle" ? !!pg && puzzleState !== "solved" && pg.turn() === puzzleColor : canPlay();
    if (!board || !allowed) return;
    if (selected && square !== selected && targets.includes(square)) {
      if (mode === "puzzle") puzzleMove(selected, square); else doMove(selected, square);
      clearSelection();
      return;
    }
    if (selected === square) { clearSelection(); return; }
    const piece = board.get(square as Square);
    if (piece && piece.color === mine) {
      setSelected(square);
      setTargets(board.moves({ square: square as Square, verbose: true }).map(m => m.to));
    } else clearSelection();
  }

  // Take back your last move (and the engine's reply to it).
  const undoSteps = game.turn() === playerColor ? 2 : 1;
  const canUndo = live && !thinking && n >= undoSteps;
  function undo() {
    if (!canUndo) return;
    for (let i = 0; i < undoSteps; i++) game.undo();
    stopEngine();
    setHint(null);
    setCoachNote(null);
    clearSelection();
    sync();
    persist();
  }

  function newGame(color: Color) {
    stopEngine();
    analyzerRef.current?.clear();
    reviewGen.current++;
    game.reset();
    setPlayerColor(color);
    colorRef.current = color;
    setReview(null);
    setReviewing(null);
    setHint(null);
    setCoachNote(null);
    setView(null);
    setNewOpen(false);
    clearSelection();
    initMoveDone.current = true;
    sync();
    persist({ counted: false, review: undefined, analysis: undefined });
    if (ready && color === "b") requestEngineMove();
  }

  // Hint and review
  async function showHint() {
    if (mode === "puzzle") { setPuzzleHint(true); return; }
    const a = analyzerRef.current;
    if (!a || !canPlay()) return;
    const at = game.fen();
    const res: Analysis = await a.analyze(at, 1200);
    if (game.fen() === at && res.best) setHint(res.best);
  }

  async function runReview() {
    const a = analyzerRef.current;
    if (!a || n < 2 || thinking) return;
    const gen = ++reviewGen.current;
    const moves = hist.map((m, i) => ({ m, i })).filter(({ m }) => m.color === playerColor);
    const marks: Mark[] = [];
    setView(null);
    setReviewing({ done: 0, total: moves.length });
    for (let k = 0; k < moves.length; k++) {
      const { m, i } = moves[k];
      const [b, af] = await Promise.all([a.analyze(m.before, 300), a.analyze(m.after, 300)]);
      if (gen !== reviewGen.current) return;
      const { loss, kind } = classify(b, af, playerColor);
      if (kind && b.best && b.best !== m.lan) marks.push({ ply: i, kind, loss, best: uciToSan(m.before, b.best), bestUci: b.best });
      setReviewing({ done: k + 1, total: moves.length });
    }
    const next = { pgn: game.pgn(), marks };
    setReview(next);
    setReviewing(null);
    persist({ review: next });
  }

  // Daily puzzle
  const today = localDateStr();
  function startPuzzle(p: DailyPuzzle) {
    puzzleRef.current = new Chess(p.fen);
    setPuzzleFen(p.fen);
    setPuzzleStep(0);
    setPuzzleState("solving");
    setPuzzleHint(false);
    clearSelection();
  }
  async function openPuzzle() {
    setMode("puzzle");
    setView(null);
    clearSelection();
    if (puzzle) { startPuzzle(puzzle); return; }
    setPuzzleError("");
    try {
      const res = await fetch("/api/chess/puzzle");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the puzzle");
      setPuzzle(data);
      startPuzzle(data);
    } catch (e) {
      setPuzzleError(String((e as Error).message ?? e));
    }
  }
  function puzzleMove(from: string, to: string): boolean {
    const pg = puzzleRef.current;
    if (!pg || !puzzle || puzzleState === "solved" || pg.turn() !== puzzleColor) return false;
    const expected = puzzle.solution[puzzleStep] ?? "";
    const piece = pg.get(from as Square);
    const promo = piece?.type === "p" && (to[1] === "8" || to[1] === "1")
      ? (expected.slice(0, 4) === from + to && expected[4] ? expected[4] : "q")
      : undefined;
    let mv: Move;
    try { mv = pg.move({ from, to, promotion: promo }); } catch { return false; }
    // Any mate counts, as on Lichess.
    if (mv.lan !== expected && !pg.isCheckmate()) {
      pg.undo();
      setPuzzleState("wrong");
      return false;
    }
    setPuzzleHint(false);
    setPuzzleState("solving");
    setPuzzleFen(pg.fen());
    const step = puzzleStep + 1;
    setPuzzleStep(step);
    if (step >= puzzle.solution.length || pg.isCheckmate()) { solved(); return true; }
    const reply = puzzle.solution[step];
    setTimeout(() => {
      try { pg.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply.slice(4, 5) || undefined }); } catch { return; }
      setPuzzleFen(pg.fen());
      setPuzzleStep(step + 1);
      if (step + 1 >= puzzle.solution.length) solved();
    }, 450);
    return true;
  }
  function solved() {
    setPuzzleState("solved");
    setRecord(prev => {
      const next = addPuzzleDay(prev, today);
      persist({ record: next });
      return next;
    });
  }

  // Board decorations
  const squareStyles: Record<string, CSSProperties> = {};
  const tint = (sq: string, rgba: string) => { squareStyles[sq] = { ...(squareStyles[sq] ?? {}), backgroundImage: `linear-gradient(${rgba}, ${rgba})` }; };
  if (lastMove) { tint(lastMove.from, LAST); tint(lastMove.to, LAST); }
  if (mode === "puzzle" && puzzle?.lastMove && puzzleStep === 0) { tint(puzzle.lastMove.slice(0, 2), LAST); tint(puzzle.lastMove.slice(2, 4), LAST); }
  if (selected) tint(selected, "rgba(250, 204, 21, 0.45)");
  const board = mode === "puzzle" ? puzzleRef.current : game;
  for (const t of targets) {
    squareStyles[t] = { ...(squareStyles[t] ?? {}), backgroundImage: board?.get(t as Square)
      ? "radial-gradient(circle, rgba(0,0,0,0) 68%, rgba(0,0,0,0.3) 69%, rgba(0,0,0,0.3) 79%, rgba(0,0,0,0) 80%)"
      : "radial-gradient(circle, rgba(0,0,0,0.3) 19%, rgba(0,0,0,0) 20%)" };
  }
  const coachShown = live && coachNote !== null && n - 1 <= coachNote.ply + 1;
  const arrows: Arrow[] = [];
  const arrow = (uci: string, color: string) => arrows.push({ startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4), color });
  if (viewMark && view !== null) { arrow(hist[view].lan, RED); arrow(viewMark.bestUci, GREEN); }
  if (live && hint) arrow(hint, GREEN);
  if (coachShown && coachNote && n - 1 === coachNote.ply) arrow(coachNote.bestUci, GREEN);
  if (mode === "puzzle" && puzzleHint && puzzle?.solution[puzzleStep]) arrow(puzzle.solution[puzzleStep], GREEN);

  // Material
  const shownGame = useMemo(() => { try { return new Chess(shownFen); } catch { return null; } }, [shownFen]);
  const caps = capturedBy(hist.slice(0, shownPlies));
  const balance = shownGame ? materialBalance(shownGame) : 0;
  const yours = playerColor === "w" ? balance : -balance;
  const opp: Color = playerColor === "w" ? "b" : "w";

  // Status line
  const link = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={`ml-2 underline underline-offset-2 hover:opacity-80 ${FOCUS_RING}`}>{label}</button>
  );
  const moveNo = (ply: number) => `${Math.floor(ply / 2) + 1}.${ply % 2 ? ".." : ""}`;
  let note: ReactNode;
  if (mode === "puzzle") {
    note = puzzleError ? <span className="text-red-400">{puzzleError}</span>
      : !puzzle ? <span className="flex items-center gap-1.5"><Loader size={12} className="animate-spin" /> Loading today&apos;s puzzle</span>
      : puzzleState === "solved" ? <>Solved · {puzzleStreak(record.puzzleDays, today)} day streak</>
      : puzzleState === "wrong" ? <>Not the move. Try again.</>
      : <>{puzzleColor === "w" ? "White" : "Black"} to move · rating {puzzle.rating}{record.puzzleDays.includes(today) ? " · solved today" : ""}</>;
  } else if (reviewing) {
    note = <span className="flex items-center gap-1.5"><Loader size={12} className="animate-spin" /> Reviewing move {reviewing.done} of {reviewing.total}</span>;
  } else if (viewMark && view !== null) {
    note = <>{moveNo(view)} {hist[view].san}{MARK_SYMBOL[viewMark.kind]} lost {(viewMark.loss / 100).toFixed(1)}. Better was {viewMark.best}.{link("Back to game", () => setView(null))}</>;
  } else if (view !== null) {
    note = <>Move {view + 1} of {n}{link("Back to game", () => setView(null))}</>;
  } else if (coachShown && coachNote) {
    note = <>{game.isCheckmate() ? "Checkmate, you lose" : `Blunder, lost ${(coachNote.loss / 100).toFixed(1)}`}. Better was {coachNote.best}.{canUndo && link("Take back", undo)}</>;
  } else if (hint) {
    note = <>Hint: {uciToSan(fen, hint)}</>;
  } else if (reviewOk && gameOver) {
    const parts = (["blunder", "mistake", "inaccuracy"] as const)
      .map(k => [k, reviewOk.marks.filter(m => m.kind === k).length] as const)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${v === 1 ? k : PLURAL[k]}`);
    note = <>Review: {parts.length ? parts.join(", ") : "no mistakes"}</>;
  } else {
    note = !ready ? "Loading engine"
      : thinking ? <span className="flex items-center gap-1.5"><Loader size={12} className="animate-spin" /> Engine is thinking</span>
      : game.isCheckmate() ? (game.turn() === playerColor ? "Checkmate, you lose" : "Checkmate, you win")
      : game.isDraw() ? "Draw"
      : `${game.turn() === playerColor ? "Your move" : "Engine's move"}${game.inCheck() ? " · check" : ""} · Elo ${elo}`;
  }

  // Layout
  const bar = evalBar && mode === "game" ? EVAL_W : 0; // hidden in puzzles, it gives the answer away
  const side = Math.floor(Math.max(0, Math.min(box.w - bar, box.h)));
  const inner = side - GUTTER;
  const orient: Color = mode === "puzzle" ? puzzleColor : playerColor;
  const whiteShare = score ? barShare(score) : 0.5;
  const capRow = (glyphs: string, adv: number) => (
    <div className={`shrink-0 h-5 flex items-center gap-1.5 text-sm leading-none ${c.label}`} style={{ paddingLeft: Math.max(0, (box.w - side) / 2) + bar + GUTTER }}>
      <span className="tracking-tight">{glyphs}</span>
      {adv > 0 && <span className="opacity-80 tabular-nums">+{adv}</span>}
    </div>
  );
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>("[data-current]");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view, n]);

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full relative ${c.bg} ${c.border} ${c.glow} ${className}`}>
      <WidgetHeader c={c} icon={Swords} title={mode === "puzzle" ? "Daily puzzle" : "Chess"} onSettings={() => { setDraft({ elo, evalBar, coach }); setSettingsOpen(true); }} />

      {settingsOpen && (
        <div className={`absolute inset-px z-30 rounded-[15px] p-5 flex flex-col ${c.bg}`}>
          <SettingsFace
            c={c}
            onReset={() => setDraft({ elo: 1500, evalBar: false, coach: true })}
            onSave={() => {
              setElo(draft.elo); eloRef.current = draft.elo;
              setEvalBar(draft.evalBar);
              setCoach(draft.coach);
              persist({ evalBar: draft.evalBar, coach: draft.coach });
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          >
            <SettingsField c={c} label={`Strength: Elo ${draft.elo}`} hint="The engine plays at this strength from its next move.">
              <input type="range" min={MIN_ELO} max={MAX_ELO} step={100} value={draft.elo} aria-label="Engine strength in Elo"
                onChange={e => setDraft(d => ({ ...d, elo: parseInt(e.target.value) }))} className={`w-full accent-current ${c.label}`} />
            </SettingsField>
            <SettingsField c={c} label="Evaluation bar" inline hint="Who is ahead, judged by a full-strength engine.">
              <Toggle checked={draft.evalBar} onChange={() => setDraft(d => ({ ...d, evalBar: !d.evalBar }))} label="Evaluation bar" />
            </SettingsField>
            <SettingsField c={c} label="Blunder alerts" inline hint="After a move that throws away three pawns or more, shows the better move.">
              <Toggle checked={draft.coach} onChange={() => setDraft(d => ({ ...d, coach: !d.coach }))} label="Blunder alerts" />
            </SettingsField>
          </SettingsFace>
        </div>
      )}

      {recordOpen && (
        <div className={`absolute inset-px z-30 rounded-[15px] p-5 flex flex-col gap-3 ${c.bg}`}>
          <WidgetHeader panel c={c} icon={Trophy} title="Record" />
          <div className={`flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto pr-3 text-sm ${c.text}`}>
            <div className="grid grid-cols-3 gap-2">
              {[["Win streak", record.streak], ["Best streak", record.best], ["Puzzle streak", puzzleStreak(record.puzzleDays, today)]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-black/5 dark:bg-white/10 px-3 py-2">
                  <div className="text-xl font-semibold tabular-nums">{v}</div>
                  <div className={`${c.label}`}>{k}</div>
                </div>
              ))}
            </div>
            {record.last.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className={c.label}>Last {record.last.length} games</p>
                <div className="flex flex-wrap gap-1">
                  {record.last.map((r, i) => (
                    <span key={i} title={r === "w" ? "Win" : r === "l" ? "Loss" : "Draw"}
                      className={`w-3.5 h-3.5 rounded-sm ${r === "w" ? "bg-emerald-500" : r === "l" ? "bg-red-500" : "bg-neutral-400"}`} />
                  ))}
                </div>
              </div>
            )}
            <table className="w-full tabular-nums">
              <thead><tr className={`text-left ${c.label}`}><th className="font-normal py-1">Engine Elo</th><th className="font-normal">Won</th><th className="font-normal">Drawn</th><th className="font-normal">Lost</th></tr></thead>
              <tbody>
                {Object.entries(record.byElo).sort(([a], [b]) => Number(a) - Number(b)).map(([k, v]) => (
                  <tr key={k} className="border-t border-black/10 dark:border-white/10"><td className="py-1">{k}</td><td>{v.w}</td><td>{v.d}</td><td>{v.l}</td></tr>
                ))}
                {Object.keys(record.byElo).length === 0 && <tr><td colSpan={4} className={`py-1 ${c.label}`}>No finished games yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="shrink-0 flex justify-end">
            <SmallButton c={c} onClick={() => setRecordOpen(false)}>Back to game</SmallButton>
          </div>
        </div>
      )}

      {/* The rows around the board keep their height in every mode, so the
          board is the same size in a game, a puzzle and before the first move. */}
      {mode === "game" ? capRow(caps[opp], -yours) : capRow("", 0)}

      <div ref={contentRef} className="flex-1 min-h-0 flex items-center justify-center">
        {side > GUTTER && (
          /* Coordinates sit outside the board, in the card's own text color:
             ranks down the left, files along the bottom, flipped with the
             board when you play Black. The evaluation bar sits left of them. */
          <div className={`grid text-sm tabular-nums ${c.label}`} style={{ gridTemplateColumns: `${bar ? `${bar}px ` : ""}${GUTTER}px ${inner}px`, gridTemplateRows: `${inner}px ${GUTTER}px` }}>
            {bar > 0 && (
              <div className="pr-1 h-full" title={score ? formatScore(score) : ""}>
                <div role="img" aria-label={`Evaluation ${score ? formatScore(score) : ""}`} className="relative w-2.5 h-full rounded-sm overflow-hidden bg-neutral-800 ring-1 ring-black/20 dark:ring-white/15">
                  <div className="absolute inset-x-0 bg-neutral-100 transition-[height] duration-300" style={{ height: `${whiteShare * 100}%`, [orient === "w" ? "bottom" : "top"]: 0 }} />
                </div>
              </div>
            )}
            <div className="flex flex-col opacity-80">
              {(orient === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]).map(r => <span key={r} className="flex-1 flex items-center justify-center">{r}</span>)}
            </div>
            <div style={{ width: inner, height: inner }}>
              <Chessboard
                options={{
                  id: `chess-${widget.id}`,
                  position: shownFen || game.fen(),
                  onPieceDrop: onDrop,
                  onSquareClick,
                  squareStyles,
                  arrows,
                  allowDrawingArrows: false,
                  boardOrientation: orient === "w" ? "white" : "black",
                  allowDragging: mode === "puzzle" ? !!puzzle && puzzleState !== "solved" : live && ready && !thinking && !gameOver,
                  darkSquareStyle: { backgroundColor: "#6b7280" },
                  lightSquareStyle: { backgroundColor: "#d1d5db" },
                  showNotation: false,
                  animationDurationInMs: 200,
                }}
              />
            </div>
            {bar > 0 && <span />}
            <span />
            <div className="flex opacity-80">
              {(orient === "w" ? "abcdefgh" : "hgfedcba").split("").map(f => <span key={f} className="flex-1 flex items-center justify-center">{f}</span>)}
            </div>
          </div>
        )}
      </div>

      {mode === "game" ? capRow(caps[playerColor], yours) : capRow("", 0)}

      {/* Moves: click one to see its position; a reviewed mistake shows the
          position before it with the better move. */}
      {!(mode === "game" && n > 0) && <div className="shrink-0 mt-2 h-6" aria-hidden />}
      {mode === "game" && n > 0 && (
        <div className="shrink-0 mt-2 h-6 flex items-center gap-1.5">
          <button type="button" aria-label="Previous move" title="Previous move" disabled={(view ?? n - 1) < 0}
            onClick={() => setView(v => Math.max(-1, (v ?? n - 1) - 1))} className={`shrink-0 opacity-80 hover:opacity-100 disabled:opacity-30 ${HIT_AREA} ${FOCUS_RING} ${c.label}`}><ChevronLeft size={16} /></button>
          <div ref={stripRef} className={`flex-1 min-w-0 flex items-center overflow-x-auto whitespace-nowrap text-sm tabular-nums [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${c.text}`}>
            {hist.map((m, i) => {
              const mark = markAt(i);
              const current = view === null ? i === n - 1 : i === view;
              return (
                <span key={i} className="flex items-center">
                  {i % 2 === 0 && <span className={`ml-1.5 mr-0.5 ${c.label}`}>{i / 2 + 1}.</span>}
                  <button type="button" onClick={() => setView(i === n - 1 && !mark ? null : i)} {...(current ? { "data-current": true } : {})}
                    className={`px-1 rounded-md ${current ? "bg-black/15 dark:bg-white/20 font-medium" : "hover:bg-black/5 dark:hover:bg-white/10"} ${FOCUS_RING}`}>
                    {m.san}{mark && <span className={mark.kind === "blunder" ? "text-red-500" : mark.kind === "mistake" ? "text-orange-500" : "text-amber-500"}>{MARK_SYMBOL[mark.kind]}</span>}
                  </button>
                </span>
              );
            })}
          </div>
          <button type="button" aria-label="Next move" title="Next move" disabled={view === null}
            onClick={() => setView(v => (v === null || v + 1 >= n - 1 ? null : v + 1))} className={`shrink-0 opacity-80 hover:opacity-100 disabled:opacity-30 ${HIT_AREA} ${FOCUS_RING} ${c.label}`}><ChevronRight size={16} /></button>
        </div>
      )}

      <p className={`shrink-0 mt-2 min-h-5 text-sm truncate ${c.label}`}>{note}</p>

      <div className="shrink-0 mt-2 flex items-center gap-1.5">
        {mode === "game" ? (
          <>
            <IconAction c={c} label="Take back" onClick={undo} disabled={!canUndo}><Undo2 size={14} /></IconAction>
            <IconAction c={c} label="Hint" onClick={showHint} disabled={!canPlay()}><Lightbulb size={14} /></IconAction>
            <IconAction c={c} label="Review the game" onClick={runReview} disabled={n < 2 || thinking || !!reviewing}><ListChecks size={14} /></IconAction>
            <IconAction c={c} label="Daily puzzle" onClick={openPuzzle}><Puzzle size={14} /></IconAction>
            <IconAction c={c} label="Record" onClick={() => setRecordOpen(true)}><Trophy size={14} /></IconAction>
            <div className="relative ml-auto">
              <SmallButton c={c} onClick={() => setNewOpen(o => !o)}>New game</SmallButton>
              {newOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNewOpen(false)} />
                  <div className={`absolute right-0 bottom-full mb-1.5 z-50 flex gap-1.5 p-1.5 rounded-xl border ${c.border} ${c.bg} shadow-lg`}>
                    <Chip c={c} onClick={() => newGame("w")}>as White</Chip>
                    <Chip c={c} onClick={() => newGame("b")}>as Black</Chip>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <IconAction c={c} label="Show the next move" onClick={showHint} disabled={!puzzle || puzzleState === "solved"}><Lightbulb size={14} /></IconAction>
            <IconAction c={c} label="Start over" onClick={() => puzzle && startPuzzle(puzzle)} disabled={!puzzle}><RotateCcw size={14} /></IconAction>
            <div className="ml-auto">
              <SmallButton c={c} onClick={() => { setMode("game"); clearSelection(); }}>Back to game</SmallButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
