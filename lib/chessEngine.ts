"use client";

import { toWhite, type Score } from "@/lib/chess";

// A full-strength Stockfish in its own worker, for analysis only: the
// evaluation bar, hints, blunder alerts and game review. The opponent plays
// from a separate, strength-limited worker in the widget. Jobs run one at a
// time; a job with a tag replaces a queued one with the same tag (the
// evaluation of a position that has already moved on is not worth waiting
// for). Results are cached by position and think time.

export type Analysis = Score & { best?: string };
type Job = { fen: string; ms: number; tag?: string; resolve: (a: Analysis) => void };

const ENGINE_PATH = "/stockfish/stockfish-18-lite-single.js";

export class Analyzer {
  private w: Worker;
  private ready = false;
  private queue: Job[] = [];
  private current: Job | null = null;
  private last: Score = {};
  private cache = new Map<string, Analysis>();

  constructor() {
    this.w = new Worker(ENGINE_PATH);
    this.w.onmessage = (e: MessageEvent) => this.onLine(typeof e.data === "string" ? e.data : String(e.data ?? ""));
    this.w.postMessage("uci");
  }

  analyze(fen: string, ms: number, tag?: string): Promise<Analysis> {
    const hit = this.cache.get(`${fen}|${ms}`) ?? this.cache.get(`${fen}|1200`);
    if (hit) return Promise.resolve(hit);
    return new Promise(resolve => {
      if (tag) {
        const old = this.queue.findIndex(j => j.tag === tag);
        if (old >= 0) this.queue.splice(old, 1);
      }
      this.queue.push({ fen, ms, tag, resolve });
      this.pump();
    });
  }

  // Drop queued jobs (a new game, a cancelled review).
  clear() {
    this.queue = [];
  }

  dispose() {
    this.queue = [];
    this.w.terminate();
  }

  private pump() {
    if (!this.ready || this.current || !this.queue.length) return;
    this.current = this.queue.shift()!;
    this.last = {};
    this.w.postMessage("position fen " + this.current.fen);
    this.w.postMessage("go movetime " + this.current.ms);
  }

  private onLine(line: string) {
    if (line === "uciok") { this.w.postMessage("setoption name UCI_LimitStrength value false"); this.w.postMessage("isready"); return; }
    if (line === "readyok") { this.ready = true; this.pump(); return; }
    if (line.startsWith("info") && line.includes(" score ")) {
      const cp = line.match(/ score cp (-?\d+)/);
      const mate = line.match(/ score mate (-?\d+)/);
      if (cp) this.last = { cp: Number(cp[1]) };
      else if (mate) this.last = { mate: Number(mate[1]) };
      return;
    }
    if (line.startsWith("bestmove") && this.current) {
      const job = this.current;
      this.current = null;
      const best = line.split(/\s+/)[1];
      const result: Analysis = { ...toWhite(this.last, job.fen), best: best && best !== "(none)" ? best : undefined };
      this.cache.set(`${job.fen}|${job.ms}`, result);
      if (this.cache.size > 2000) this.cache.clear();
      job.resolve(result);
      this.pump();
    }
  }
}
