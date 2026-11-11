import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { addPuzzleDay, addResult, capturedBy, classify, emptyRecord, materialBalance, parseDailyPuzzle, puzzleStreak, resultFor, toWhite, uciToSan } from "@/lib/chess";

describe("chess helpers", () => {
  it("counts material and captures", () => {
    const g = new Chess();
    for (const m of ["e4", "d5", "exd5", "Qxd5"]) g.move(m);
    expect(materialBalance(g)).toBe(0);
    expect(capturedBy(g.history({ verbose: true }))).toEqual({ w: "♟", b: "♟" });
  });
  it("turns side-to-move scores into White's view", () => {
    expect(toWhite({ cp: 50 }, "8/8/8/8/8/8/8/K6k b - - 0 1")).toEqual({ cp: -50, mate: undefined });
    expect(toWhite({ cp: 50 }, "8/8/8/8/8/8/8/K6k w - - 0 1")).toEqual({ cp: 50 });
  });
  it("classifies a move by what it cost its player", () => {
    expect(classify({ cp: 30 }, { cp: -350 }, "w").kind).toBe("blunder");
    expect(classify({ cp: 30 }, { cp: -350 }, "b").kind).toBe(null);
    expect(classify({ cp: 0 }, { cp: 170 }, "b").kind).toBe("mistake");
    expect(classify({ mate: 3 }, { cp: 1500 }, "w").kind).toBe(null);
  });
  it("converts UCI to SAN", () => {
    expect(uciToSan(new Chess().fen(), "g1f3")).toBe("Nf3");
  });
  it("keeps a record and streaks", () => {
    let r = addResult(addResult(emptyRecord(), 1500, "w"), 1500, "w");
    expect(r.streak).toBe(2);
    r = addResult(r, 1600, "l");
    expect(r).toMatchObject({ streak: 0, best: 2, byElo: { "1500": { w: 2, d: 0, l: 0 }, "1600": { w: 0, d: 0, l: 1 } } });
    const days = addPuzzleDay(addPuzzleDay(emptyRecord(), "2026-11-10"), "2026-11-11").puzzleDays;
    expect(puzzleStreak(days, "2026-11-11")).toBe(2);
    expect(puzzleStreak(days, "2026-11-12")).toBe(2);
    expect(puzzleStreak(days, "2026-11-13")).toBe(0);
  });
  it("reads results", () => {
    const g = new Chess();
    for (const m of ["f3", "e5", "g4", "Qh4#"]) g.move(m);
    expect(resultFor(g, "w")).toBe("l");
    expect(resultFor(g, "b")).toBe("w");
  });
  it("parses a daily puzzle from its game", () => {
    const p = parseDailyPuzzle({ game: { pgn: "e4 e5 Nf3 Nc6" }, puzzle: { id: "x", solution: ["f1c4"], rating: 1500, themes: ["opening"] } });
    expect(p).toMatchObject({ id: "x", lastMove: "b8c6", solution: ["f1c4"] });
    expect(parseDailyPuzzle({ puzzle: { id: "x", solution: [] } })).toBeNull();
  });
});
