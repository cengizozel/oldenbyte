# Chess Widget

Play an ongoing game of chess against the [Stockfish](https://stockfishchess.org/) engine. You play one side; the engine replies automatically. Difficulty is an adjustable Elo, and the game persists between visits.

## Storage Keys

| Key | Value |
|---|---|
| `chess-{id}` | JSON: `{ pgn: string; elo: number; playerColor: "w" \| "b" }` |

The game is stored as **PGN** (full move history, so it survives reloads), alongside the chosen difficulty and which color you play. On load the PGN is replayed into a fresh `chess.js` game.

## Libraries

| Concern | Library |
|---|---|
| Rules (legal moves, check/mate, PGN) | [`chess.js`](https://github.com/jhlywa/chess.js) |
| Board UI (drag-and-drop) | [`react-chessboard`](https://github.com/Clariity/react-chessboard) v5 |
| Engine | [Stockfish](https://github.com/nmrugg/stockfish.js) (single-threaded WASM) |

Nothing is implemented from scratch — `chess.js` owns the rules and Stockfish owns the play.

## Client-Side & Engine

Everything runs in the browser. The widget is loaded with `dynamic(..., { ssr: false })` (like the Reader) because it uses a Web Worker and a browser-only board.

Stockfish runs as a **Web Worker** so its search never blocks the UI. The single-threaded `lite` build is used (`public/stockfish/stockfish-18-lite-single.{js,wasm}`, ~7 MB) — it needs no `SharedArrayBuffer` and therefore no cross-origin-isolation (`COOP`/`COEP`) headers, and no native binary on the server. The `.wasm` is served from `public/` exactly like `pdf.worker.min.mjs`.

The worker speaks the UCI protocol over `postMessage`:

```
uci            → (engine lists options) → uciok
isready        → readyok
setoption name UCI_LimitStrength value true
setoption name UCI_Elo value <elo>
position fen <current position>
go movetime 700   → bestmove <uci>
```

`bestmove e2e4` (or `e7e8q` for promotions) is parsed into `{ from, to, promotion }` and applied via `chess.js`.

## Difficulty

An Elo slider (**1300–2800, steps of 100**) maps to Stockfish's `UCI_LimitStrength` + `UCI_Elo`. Changing it re-sends the options to the running worker; it doesn't affect the current position, only how the engine plays from then on.

## Move Flow

- `onPieceDrop` rejects the move if it isn't the player's turn, the engine is thinking, or the game is over.
- The move is validated by attempting `game.move(...)` (which throws on an illegal move); promotions auto-queen.
- After a legal player move, the position is persisted and the engine is asked to reply (`position` + `go movetime`).
- If it's the engine's turn when the widget loads — because you started a game as Black, or you're resuming a position where it's the engine's move — it moves automatically once it's ready.

## Layout

The board is rendered square, sized to `min(width, height)` of the tile via a `ResizeObserver`, and centered. Default tile size is 2×4. `digestable: false` — a chess position isn't useful for the `/digest` briefing.
