"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { Swords, RotateCcw, Loader } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

const ENGINE_PATH = "/stockfish/stockfish-18-lite-single.js";
const MIN_ELO = 1300;
const MAX_ELO = 2800;
const MOVE_TIME_MS = 700;

type Saved = { pgn?: string; elo?: number; playerColor?: "w" | "b" };

export default function ChessWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const storageKey = `chess-${widget.id}`;

  const gameRef = useRef<Chess | null>(null);
  if (!gameRef.current) gameRef.current = new Chess();
  const game = gameRef.current;

  const workerRef = useRef<Worker | null>(null);

  const [fen, setFen] = useState(game.fen());
  const [elo, setElo] = useState(1500);
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [thinking, setThinking] = useState(false);
  const [ready, setReady] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);

  // Refs mirror state so the (once-bound) worker callback always reads current values
  const eloRef = useRef(elo);   eloRef.current = elo;
  const colorRef = useRef(playerColor); colorRef.current = playerColor;
  const initMoveDone = useRef(false);

  function persist() {
    const data: Saved = { pgn: game.pgn(), elo: eloRef.current, playerColor: colorRef.current };
    storage.setItem(storageKey, JSON.stringify(data));
  }
  function sync() {
    setFen(game.fen());
  }

  function requestEngineMove() {
    const w = workerRef.current;
    if (!w) return;
    setThinking(true);
    w.postMessage("position fen " + game.fen());
    w.postMessage("go movetime " + MOVE_TIME_MS);
  }

  // Load persisted game + settings
  useEffect(() => {
    storage.getItem(storageKey).then(saved => {
      if (saved) {
        try {
          const s: Saved = JSON.parse(saved);
          if (typeof s.elo === "number") setElo(s.elo);
          if (s.playerColor === "w" || s.playerColor === "b") setPlayerColor(s.playerColor);
          if (s.pgn) { game.loadPgn(s.pgn); setFen(game.fen()); }
        } catch {}
      }
      setConfigLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Spin up Stockfish (single-threaded WASM) in a worker
  useEffect(() => {
    const w = new Worker(ENGINE_PATH);
    workerRef.current = w;
    w.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : String(e.data ?? "");
      if (line === "uciok") {
        w.postMessage("isready");
      } else if (line === "readyok") {
        setReady(true);
      } else if (line.startsWith("bestmove")) {
        setThinking(false);
        const uci = line.split(/\s+/)[1];
        if (uci && uci !== "(none)") {
          try {
            game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
            sync();
            persist();
          } catch {}
        }
      }
    };
    w.postMessage("uci");
    return () => { w.terminate(); workerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply difficulty whenever it changes (and once the engine is ready)
  useEffect(() => {
    if (!ready) return;
    const w = workerRef.current;
    if (!w) return;
    w.postMessage("setoption name UCI_LimitStrength value true");
    w.postMessage("setoption name UCI_Elo value " + elo);
  }, [ready, elo]);

  // If it's the engine's turn once everything is loaded (e.g. resuming, or you
  // started a game as Black), let it move.
  useEffect(() => {
    if (!ready || !configLoaded || initMoveDone.current) return;
    initMoveDone.current = true;
    const engineColor = playerColor === "w" ? "b" : "w";
    if (!game.isGameOver() && game.turn() === engineColor) requestEngineMove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, configLoaded]);

  // Square board sized to the available tile area
  const contentRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState(0);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBoardSize(Math.floor(Math.min(width, height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gameOver = game.isGameOver();

  function canPlay() {
    return ready && !thinking && !gameOver && game.turn() === playerColor;
  }

  function clearSelection() {
    setSelected(null);
    setTargets([]);
  }

  // Apply a move (chess.js infers castling / en passant / capture from from→to).
  function doMove(from: string, to: string): boolean {
    const piece = game.get(from as Square);
    const isPromotion = piece?.type === "p" && (to[1] === "8" || to[1] === "1");
    try {
      game.move({ from, to, ...(isPromotion ? { promotion: "q" } : {}) });
    } catch {
      clearSelection();
      return false;
    }
    clearSelection();
    sync();
    persist();
    if (!game.isGameOver()) requestEngineMove();
    return true;
  }

  function onDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare || !canPlay()) return false;
    return doMove(sourceSquare, targetSquare);
  }

  // Click a piece to select it (legal targets get dots), click a target to move.
  function onSquareClick({ square }: { square: string }) {
    if (!canPlay()) return;
    if (selected && square !== selected && targets.includes(square)) {
      doMove(selected, square);
      return;
    }
    if (selected === square) {
      clearSelection();
      return;
    }
    const piece = game.get(square as Square);
    if (piece && piece.color === playerColor) {
      setSelected(square);
      setTargets(game.moves({ square: square as Square, verbose: true }).map(m => m.to));
    } else {
      clearSelection();
    }
  }

  const squareStyles: Record<string, CSSProperties> = {};
  if (selected) {
    squareStyles[selected] = { backgroundImage: "linear-gradient(rgba(250,204,21,0.45), rgba(250,204,21,0.45))" };
  }
  for (const t of targets) {
    squareStyles[t] = game.get(t as Square)
      ? { backgroundImage: "radial-gradient(circle, rgba(0,0,0,0) 68%, rgba(0,0,0,0.3) 69%, rgba(0,0,0,0.3) 79%, rgba(0,0,0,0) 80%)" }
      : { backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.3) 19%, rgba(0,0,0,0) 20%)" };
  }

  function newGame(color: "w" | "b") {
    game.reset();
    setPlayerColor(color);
    colorRef.current = color;
    setThinking(false);
    clearSelection();
    initMoveDone.current = true;
    sync();
    persist();
    if (ready && color === "b") requestEngineMove();
  }

  function changeElo(v: number) {
    setElo(v);
    eloRef.current = v;
    persist();
  }

  let status: string;
  if (!ready) status = "loading engine…";
  else if (thinking) status = "thinking…";
  else if (game.isCheckmate()) status = game.turn() === playerColor ? "checkmate, you lose" : "checkmate, you win";
  else if (game.isDraw()) status = "draw";
  else if (game.isStalemate()) status = "stalemate";
  else status = (game.turn() === playerColor ? "your move" : "engine's move") + (game.inCheck() ? " · check" : "");

  return (
    <div className={`rounded-2xl border p-5 flex flex-col h-full ${c.bg} ${c.border} ${c.glow} ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
        <div className={`flex items-center gap-1.5 shrink-0 ${c.label}`}>
          <span className="opacity-50"><Swords size={14} /></span>
          <span className="text-xs font-medium opacity-60">Chess</span>
        </div>
        <span className={`flex items-center gap-1 text-xs opacity-50 min-w-0 ${c.label}`}>
          {thinking && <Loader size={11} className="animate-spin shrink-0" />}
          <span className="truncate">{status}</span>
        </span>
      </div>

      <div ref={contentRef} className="flex-1 min-h-0 flex items-center justify-center">
        {boardSize > 0 && (
          <div style={{ width: boardSize, height: boardSize }}>
            <Chessboard
              options={{
                id: `chess-${widget.id}`,
                position: fen,
                onPieceDrop: onDrop,
                onSquareClick: onSquareClick,
                squareStyles: squareStyles,
                boardOrientation: playerColor === "w" ? "white" : "black",
                allowDragging: ready && !thinking && !gameOver,
                darkSquareStyle: { backgroundColor: "#6b7280" },
                lightSquareStyle: { backgroundColor: "#d1d5db" },
                animationDurationInMs: 200,
              }}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 mt-3 flex flex-col gap-2">
        <label className={`flex items-center gap-2 text-xs ${c.label}`}>
          <span className="opacity-50 tabular-nums w-14 shrink-0">Elo {elo}</span>
          <input
            type="range"
            min={MIN_ELO}
            max={MAX_ELO}
            step={100}
            value={elo}
            onChange={e => changeElo(parseInt(e.target.value))}
            className="flex-1 accent-current"
          />
        </label>
        <div className="flex items-center gap-2">
          <span className={`text-xs opacity-50 ${c.label}`}>New game:</span>
          <button
            onClick={() => newGame("w")}
            className="px-2 py-0.5 rounded-md text-xs border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            as White
          </button>
          <button
            onClick={() => newGame("b")}
            className="px-2 py-0.5 rounded-md text-xs border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            as Black
          </button>
          <RotateCcw size={14} className={`opacity-30 ${c.label} ml-auto`} />
        </div>
      </div>
    </div>
  );
}
