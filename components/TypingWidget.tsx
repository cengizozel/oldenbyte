"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Keyboard, RotateCcw, Target, Maximize2, Minimize2, Volume2, VolumeX, Music } from "lucide-react";
import { colorMap, type Widget, type ColorClasses } from "@/lib/widgets";
import { TYPING_WORDS } from "@/lib/typingWords";
import { SIMPLE_WORDS } from "@/lib/simpleWords";
import * as storage from "@/lib/storage";

// A Monkeytype-style typing trainer. Input is word-based: you type a word and
// SPACE commits it and jumps to the next one (letters you skip count as missed,
// extra letters spill in dark red); backspace only reaches back into the
// previous word when that word has a mistake. Only three lines of text show at
// a time: once the caret passes the first line it stays on the second and
// finished lines scroll up out of view. On top of that it tracks which keys you
// miss and how you slip (neighbour reach vs transposition) and can drill
// exactly those.
//
// Extras: a controllable get-ready countdown, a custom-letters drill ("zxc" ->
// random combos of just those keys), a metronome mode that asks you to strike a
// key on each beat at a BPM you set, and an expand toggle that floats the
// trainer over a dimmed backdrop at 80% of the screen.

type Mode = "words" | "time" | "drill" | "metro";
type DrillId = "custom" | "home" | "rhythm" | "weak";
type WordPool = "simple" | "varied";
type Config = {
  mode: Mode;
  length: number;
  drill: DrillId;
  custom: string;
  customScramble: boolean; // custom drill: random strings of the letters
  customWords: boolean;    // custom drill: real words containing the letters
  pool: WordPool;          // words/time/metro vocabulary: classic 200 or top 1000
  countdown: number; // get-ready seconds before a run (0 = off)
  bpm: number;
  sound: boolean;
  dynamic: boolean;  // metro: tempo speeds up on hits, slows on misses
  endless: boolean;  // metro: never auto-ends, refill words until you stop
};
type Stats = {
  best: number;
  runs: number;
  keyHit: Record<string, number>;
  keyMiss: Record<string, number>;
};

const DEFAULT_CONFIG: Config = { mode: "words", length: 25, drill: "custom", custom: "zxc", customScramble: true, customWords: false, pool: "varied", countdown: 3, bpm: 100, sound: true, dynamic: false, endless: false };

const BPM_MIN = 40;
const BPM_MAX = 300;
// Dynamic tempo: a "level" needs a sustained run of strikes that are BOTH
// correct AND on the beat; a run of mistakes drops you a level.
const LEVEL_UP_STREAK = 8;
const LEVEL_DOWN_STREAK = 4;
const LEVEL_STEP = 5; // bpm per level
const clampBpm = (n: number) => Math.max(BPM_MIN, Math.min(BPM_MAX, n));
const DEFAULT_STATS: Stats = { best: 0, runs: 0, keyHit: {}, keyMiss: {} };

const WORD_LENGTHS = [10, 25, 50];
const TIME_LENGTHS = [15, 30, 60];
const METRO_LENGTHS = [15, 25, 40];
const COUNTDOWNS = [0, 3, 5];

// Word pools. "simple" is the classic 200 most common words (the Monkeytype
// default feel); "varied" is the top 1000 of the bundled frequency-ranked
// list (lib/typingWords.ts). Letter-matching drills search the full ~10k so
// any letter combo finds real words, ranked by commonness.
const WORDS = TYPING_WORDS.slice(0, 1000);
const MATCH_WORDS = TYPING_WORDS;
const POOLS: Record<WordPool, string[]> = { simple: SIMPLE_WORDS, varied: WORDS };

// Approximate QWERTY adjacency (horizontal + nearest staggered keys). Used to
// classify a wrong keystroke as a "neighbour slip".
const ADJ: Record<string, string> = {
  q: "wa", w: "qeas", e: "wrsd", r: "etdf", t: "rygf", y: "tuhg", u: "yijh", i: "uokj", o: "iplk", p: "ol",
  a: "qwsz", s: "awedxz", d: "serfcx", f: "drtgvc", g: "ftyhbv", h: "gyujnb", j: "huikmn", k: "jioml", l: "kop",
  z: "asx", x: "zsdc", c: "xdfv", v: "cfgb", b: "vghn", n: "bhjm", m: "njk",
};

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function pickWords(n: number, pool: WordPool = "varied"): string {
  const src = POOLS[pool] ?? WORDS;
  const out: string[] = [];
  while (out.length < n) out.push(...shuffle(src));
  return out.slice(0, n).join(" ");
}

// The top real words for a set of trouble letters: words containing ALL the
// letters rank first, then the closest approximations: more of the letters
// present wins, ties broken by how much of the word is made of them, then by
// commonness (MATCH_WORDS is frequency-ordered). Words with NONE of the
// letters never qualify; the list just comes back shorter.
function wordsForLetters(letters: string[]): string[] {
  return MATCH_WORDS
    .map((w, rank) => ({
      w,
      rank,
      present: letters.filter(l => w.includes(l)).length,
      density: w.split("").filter(ch => letters.includes(ch)).length / w.length,
    }))
    .filter(x => x.present > 0)
    .sort((a, b) => b.present - a.present || b.density - a.density || a.rank - b.rank)
    .slice(0, 50)
    .map(x => x.w);
}

// Custom drill text from the user's letters: scrambles (random strings of only
// those letters), real words containing them, or a random mix of both.
function buildCustom(cfg: Config): string {
  const letters = [...new Set((cfg.custom || "").toLowerCase().replace(/[^a-z0-9]/g, "").split(""))];
  if (letters.length === 0) return "asdf jkl; fdsa ;lkj asdf jkl;";
  const pool = cfg.customWords ? wordsForLetters(letters) : [];
  const useWords = cfg.customWords && pool.length > 0; // no matches at all: scramble instead
  const useScramble = cfg.customScramble || !useWords; // never neither
  const out: string[] = [];
  for (let i = 0; i < 28; i++) {
    if (useWords && (!useScramble || Math.random() < 0.5)) {
      out.push(pool[Math.floor(Math.random() * pool.length)]);
    } else {
      const len = 2 + Math.floor(Math.random() * 3); // 2 to 4 chars
      let w = "";
      for (let j = 0; j < len; j++) w += letters[Math.floor(Math.random() * letters.length)];
      out.push(w);
    }
  }
  return out.join(" ");
}

// Build the text to type for the current config.
function buildTarget(cfg: Config, stats: Stats): string {
  if (cfg.mode === "words") return pickWords(cfg.length, cfg.pool);
  if (cfg.mode === "metro") return pickWords(cfg.length, cfg.pool);
  if (cfg.mode === "time") return pickWords(80, cfg.pool); // generous buffer; extended on demand
  // drills
  if (cfg.drill === "custom") return buildCustom(cfg);
  if (cfg.drill === "home") {
    return Array(6).fill("asdf jkl; fdsa ;lkj jfjf dkdk slsl a;a;").join(" ");
  }
  if (cfg.drill === "rhythm") {
    const ws = shuffle(["the", "and", "because", "should", "people", "through", "where", "little"]).slice(0, 6);
    return ws.map(w => `${w} ${w} ${w}`).join(" ");
  }
  if (cfg.drill === "weak") {
    const weak = Object.keys(stats.keyMiss)
      .map(k => ({ k, miss: stats.keyMiss[k] || 0, total: (stats.keyMiss[k] || 0) + (stats.keyHit[k] || 0) }))
      .filter(x => x.total >= 3 && x.miss > 0 && /[a-z]/.test(x.k))
      .sort((a, b) => b.miss / b.total - a.miss / a.total)
      .slice(0, 5)
      .map(x => x.k);
    if (!weak.length) return buildCustom(cfg); // nothing learned yet, fall back to your own keys
    const seqs: string[] = [];
    for (const k of weak) {
      seqs.push(`f${k}f`, `j${k}j`, `${k}${k}${k}`);
      const w = WORDS.filter(w => w.includes(k));
      if (w.length) seqs.push(shuffle(w).slice(0, 2).join(" "));
    }
    return Array(2).fill(shuffle(seqs).join(" ")).join(" ");
  }
  // default: your own custom letters
  return buildCustom(cfg);
}

function optionsFor(m: Mode): number[] {
  return m === "time" ? TIME_LENGTHS : m === "metro" ? METRO_LENGTHS : m === "words" ? WORD_LENGTHS : [];
}

// Runs that never end on their own: they refill words and end only on the
// clock (time) or when you stop (endless metronome).
function autoRefills(cfg: Config): boolean {
  return cfg.mode === "time" || (cfg.mode === "metro" && cfg.endless);
}

type RunStat = {
  start: number;
  keystrokes: number;
  errors: number;
  neighbor: number;
  transposition: number;
  keyHit: Record<string, number>;
  keyMiss: Record<string, number>;
  beatErr: number;   // summed |ms off nearest beat| (metro)
  beatCount: number; // keystrokes measured (metro)
  onBeat: number;    // keystrokes within tolerance (metro)
  peakBpm: number;   // highest tempo reached (dynamic metro)
  goodStreak: number; // consecutive correct + on-beat strikes
  badStreak: number;  // consecutive wrong strikes
};
function freshRun(): RunStat {
  return { start: 0, keystrokes: 0, errors: 0, neighbor: 0, transposition: 0, keyHit: {}, keyMiss: {}, beatErr: 0, beatCount: 0, onBeat: 0, peakBpm: 0, goodStreak: 0, badStreak: 0 };
}

type Chars = { correct: number; incorrect: number; extra: number; missed: number };

type Result = {
  wpm: number; raw: number; acc: number; seconds: number;
  chars: Chars;
  pb: boolean;  // beat the stored best
  test: string; // short description of the run ("words 25 varied")
  neighbor: number; transposition: number;
  weak: { k: string; miss: number; total: number }[];
  metro?: { bpm: number; onBeatPct: number; avgErr: number; peak?: number };
};

// Character tally of the run so far. Committed words count every letter as
// correct / incorrect / extra, and letters skipped with space as missed; the
// word being typed counts what's there but nothing as missed yet. `wpmChars`
// only credits fully correct words (plus the space after them) and the
// still-correct prefix of the current word; `rawChars` credits everything typed.
function tally(target: string[], typed: string[], cur: string): Chars & { wpmChars: number; rawChars: number } {
  const t = { correct: 0, incorrect: 0, extra: 0, missed: 0, wpmChars: 0, rawChars: 0 };
  const count = (g: string, w: string) => {
    for (let j = 0; j < w.length; j++) {
      if (j >= g.length) t.extra++;
      else if (w[j] === g[j]) t.correct++;
      else t.incorrect++;
    }
    t.rawChars += w.length;
  };
  typed.forEach((w, i) => {
    const g = target[i] ?? "";
    count(g, w);
    if (w.length < g.length) t.missed += g.length - w.length;
    t.rawChars++; // the space that committed it
    if (w === g) t.wpmChars += g.length + 1;
  });
  if (cur) {
    const g = target[typed.length] ?? "";
    count(g, cur);
    if (g.startsWith(cur)) t.wpmChars += cur.length;
  }
  return t;
}

const perMinute = (chars: number, seconds: number) => Math.round((chars / 5) / (Math.max(seconds, 0.5) / 60));

// Extra letters past the end of a word are capped so a stuck key can't push
// the line layout around indefinitely.
const MAX_EXTRA = 20;

// One word of the test. Memoised on primitive props so a keystroke only
// re-renders the word being typed, not the whole text. Letters not reached yet
// are dimmed, correct ones bright, wrong ones red, extras dark red; a word left
// behind with a mistake in it gets a red underline.
const Word = memo(function Word({ wi, word, typed, done, text }: {
  wi: number;
  word: string;
  typed?: string;
  done: boolean;
  text: string;
}) {
  const len = Math.max(word.length, typed?.length ?? 0);
  const flagged = done && typed !== word;
  const nodes: React.ReactNode[] = [];
  for (let j = 0; j < len; j++) {
    const tch = typed?.[j];
    let cls: string;
    let display = word[j];
    if (j < word.length) {
      if (tch === undefined) cls = `${text} opacity-40`;
      else if (tch === word[j]) cls = text;
      else cls = "text-red-500 dark:text-red-400";
    } else {
      display = tch ?? "";
      cls = "text-red-800 dark:text-red-400/55";
    }
    if (flagged) cls += " underline decoration-red-500/60 decoration-2 underline-offset-[0.3em]";
    nodes.push(<span key={j} className={cls}>{display}</span>);
  }
  return (
    <span data-wi={wi} className="inline-flex whitespace-pre">
      {nodes.length ? nodes : <span>&nbsp;</span>}
    </span>
  );
});

export default function TypingWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const configKey = `typing-config-${widget.id}`;
  const statsKey = `typing-stats-${widget.id}`;

  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [loaded, setLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [words, setWordsState] = useState<string[]>([]);
  const [typedWords, setTypedWordsState] = useState<string[]>([]);
  const [cur, setCurState] = useState("");
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [counting, setCounting] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [caret, setCaret] = useState<{ x: number; y: number; h: number; show: boolean }>({ x: 0, y: 0, h: 0, show: false });
  const [shift, setShift] = useState(0);    // px the text is scrolled up so finished lines leave the window
  const [calm, setCalmState] = useState(false); // typing without touching the mouse: fade the chrome

  const wordsRef = useRef<string[]>([]);
  const typedWordsRef = useRef<string[]>([]);
  const curRef = useRef("");
  const runRef = useRef<RunStat>(freshRun());
  const statsRef = useRef<Stats>(DEFAULT_STATS);
  const configRef = useRef<Config>(DEFAULT_CONFIG);
  const fieldRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const topWordRef = useRef(0); // first word of the top visible line; you can't backspace above it
  const calmRef = useRef(false);
  const finishedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const bpmRef = useRef(DEFAULT_CONFIG.bpm);                 // live tempo during a run
  const beatRef = useRef({ last: 0, interval: 600 });        // Metronome writes; keystroke scoring reads
  const soundRef = useRef(true);
  const [liveBpm, setLiveBpm] = useState<number | null>(null); // shown while dynamic tempo is running
  const [levelDir, setLevelDir] = useState<"up" | "down" | null>(null);

  const setWords = (w: string[]) => { wordsRef.current = w; setWordsState(w); };
  const setTypedWords = (w: string[]) => { typedWordsRef.current = w; setTypedWordsState(w); };
  const setCur = (s: string) => { curRef.current = s; setCurState(s); };
  const setCalm = (v: boolean) => { if (calmRef.current !== v) { calmRef.current = v; setCalmState(v); } };

  useEffect(() => setMounted(true), []);

  // ── Load / persist ─────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([storage.getItem(configKey), storage.getItem(statsKey)]).then(([cRaw, sRaw]) => {
      let cfg = DEFAULT_CONFIG;
      let st = DEFAULT_STATS;
      try { if (cRaw) cfg = { ...DEFAULT_CONFIG, ...JSON.parse(cRaw) }; } catch {}
      // migrate the retired "bv" drill to the custom-letters drill
      if (!(["custom", "home", "rhythm", "weak"] as string[]).includes(cfg.drill)) cfg = { ...cfg, drill: "custom" };
      try { if (sRaw) st = { ...DEFAULT_STATS, ...JSON.parse(sRaw) }; } catch {}
      setConfig(cfg); configRef.current = cfg;
      setStats(st); statsRef.current = st;
      setWords(buildTarget(cfg, st).split(" ").filter(Boolean));
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  const reset = useCallback((cfg: Config) => {
    setWords(buildTarget(cfg, statsRef.current).split(" ").filter(Boolean));
    setTypedWords([]);
    setCur("");
    runRef.current = freshRun();
    finishedRef.current = false;
    topWordRef.current = 0;
    setShift(0);
    setCalm(false);
    setStarted(false);
    setFinished(false);
    setResult(null);
    setCounting(null);
    setLiveBpm(null);
    setLevelDir(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyConfig(next: Config) {
    setConfig(next); configRef.current = next;
    storage.setItem(configKey, JSON.stringify(next));
    reset(next);
  }
  function setMode(m: Mode) {
    const opts = optionsFor(m);
    const length = opts.includes(config.length) ? config.length : (opts[0] ?? config.length);
    applyConfig({ ...config, mode: m, length });
  }

  function ensureAudio() {
    if (!configRef.current.sound) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioRef.current) audioRef.current = new AC();
      if (audioRef.current.state === "suspended") audioRef.current.resume();
    } catch {}
  }

  function startTyping() {
    const cfg = configRef.current;
    runRef.current.start = Date.now();
    runRef.current.peakBpm = cfg.bpm;
    bpmRef.current = cfg.bpm;
    beatRef.current = { last: runRef.current.start, interval: 60000 / cfg.bpm };
    soundRef.current = cfg.sound;
    setLiveBpm(cfg.mode === "metro" && cfg.dynamic ? cfg.bpm : null);
    setStarted(true);
  }

  // Live wpm for the counter above the text, read on its own tick.
  const liveWpm = useCallback(() => {
    const start = runRef.current.start;
    if (!start) return 0;
    const t = tally(wordsRef.current, typedWordsRef.current, curRef.current);
    return perMinute(t.wpmChars, Math.max(1, (Date.now() - start) / 1000));
  }, []);

  // ── Finish + scoring ─────────────────────────────────────────────────────
  const finish = useCallback(() => {
    if (finishedRef.current) return; // idempotent
    finishedRef.current = true;
    const run = runRef.current;
    const cfg = configRef.current;
    let seconds = run.start ? Math.max(0.5, (Date.now() - run.start) / 1000) : 0.5;
    if (cfg.mode === "time") seconds = Math.min(seconds, cfg.length); // timer jitter

    const t = tally(wordsRef.current, typedWordsRef.current, curRef.current);
    const wpm = perMinute(t.wpmChars, seconds);
    const raw = perMinute(t.rawChars, seconds);
    const acc = run.keystrokes ? Math.round(((run.keystrokes - run.errors) / run.keystrokes) * 100) : 100;
    const weak = Object.keys(run.keyMiss)
      .map(k => ({ k, miss: run.keyMiss[k], total: run.keyMiss[k] + (run.keyHit[k] || 0) }))
      .sort((a, b) => b.miss - a.miss)
      .slice(0, 5);
    const metro = cfg.mode === "metro" && run.beatCount > 0
      ? {
          bpm: cfg.bpm,
          onBeatPct: Math.round((run.onBeat / run.beatCount) * 100),
          avgErr: Math.round(run.beatErr / run.beatCount),
          peak: cfg.dynamic ? Math.round(run.peakBpm) : undefined,
        }
      : undefined;
    const test =
      cfg.mode === "drill" ? `drill ${cfg.drill}`
      : cfg.mode === "metro" ? `metro ${cfg.endless ? "endless" : cfg.length} ${cfg.pool}`
      : `${cfg.mode} ${cfg.length} ${cfg.pool}`;

    setResult({
      wpm, raw, acc, seconds: Math.round(seconds),
      chars: { correct: t.correct, incorrect: t.incorrect, extra: t.extra, missed: t.missed },
      pb: wpm > 0 && wpm > statsRef.current.best,
      test, neighbor: run.neighbor, transposition: run.transposition, weak, metro,
    });
    setFinished(true);
    setCalm(false);

    const merged: Stats = {
      best: Math.max(statsRef.current.best, wpm),
      runs: statsRef.current.runs + 1,
      keyHit: { ...statsRef.current.keyHit },
      keyMiss: { ...statsRef.current.keyMiss },
    };
    for (const k in run.keyHit) merged.keyHit[k] = (merged.keyHit[k] || 0) + run.keyHit[k];
    for (const k in run.keyMiss) merged.keyMiss[k] = (merged.keyMiss[k] || 0) + run.keyMiss[k];
    statsRef.current = merged;
    setStats(merged);
    storage.setItem(statsKey, JSON.stringify(merged));
  }, [statsKey]);

  // ── Get-ready countdown ──────────────────────────────────────────────────
  useEffect(() => {
    if (counting === null) return;
    const id = setTimeout(() => {
      if (counting <= 1) { setCounting(null); startTyping(); }
      else setCounting(counting - 1);
    }, 720);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counting]);

  function arm() {
    if (finishedRef.current || runRef.current.start || counting !== null) return;
    fieldRef.current?.focus(); // typing after the count-in needs the field focused
    ensureAudio();
    if (configRef.current.countdown > 0) setCounting(configRef.current.countdown);
    else startTyping();
  }
  // Click/tap focuses the field; then space (or any key) begins the run.
  function startClick() {
    fieldRef.current?.focus();
  }

  // ── Keystroke handling ─────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (!loaded) return;
    const k = e.key;
    const inRun = runRef.current.start > 0 || counting !== null || finishedRef.current;

    // Escape and Tab restart from anywhere (mid-run, count-in, results). An
    // idle Escape closes the fullscreen overlay instead.
    if (k === "Escape") {
      e.preventDefault();
      if (inRun) reset(configRef.current);
      else if (expanded) setExpanded(false);
      return;
    }
    if (k === "Tab") { e.preventDefault(); reset(configRef.current); return; }
    if (counting !== null) return;

    if (finished) {
      if (k === "Enter") { e.preventDefault(); reset(configRef.current); }
      return;
    }
    // endless run: Enter stops it and shows results
    if (k === "Enter" && runRef.current.start && autoRefills(configRef.current) && configRef.current.mode === "metro") {
      e.preventDefault(); finish(); return;
    }

    // Not started yet: with a get-ready countdown, the first key (space or any
    // printable key) kicks off the count-in rather than typing. Enter is left
    // out so the Tab, Enter restart habit never arms a fresh run by accident.
    if (!runRef.current.start && configRef.current.countdown > 0) {
      if (k === " " || (k.length === 1 && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); arm(); }
      return;
    }

    if (k === "Backspace") {
      e.preventDefault();
      handleBackspace(e.ctrlKey || e.altKey || e.metaKey);
      return;
    }

    if (k === " ") { e.preventDefault(); handleSpace(); return; }
    if (k.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

    e.preventDefault();
    if (!runRef.current.start) { ensureAudio(); startTyping(); }
    handleChar(k);
  }

  // Backspace edits the current word; on an empty word it steps back into the
  // previous one, but only if that word has a mistake and its line is still on
  // screen. With a modifier held it clears the whole word.
  function handleBackspace(wholeWord: boolean) {
    if (curRef.current) { setCur(wholeWord ? "" : curRef.current.slice(0, -1)); return; }
    const pi = typedWordsRef.current.length - 1;
    if (pi < 0 || pi < topWordRef.current) return;
    const prev = typedWordsRef.current[pi];
    if (prev === wordsRef.current[pi]) return; // correct words are locked in
    setTypedWords(typedWordsRef.current.slice(0, -1));
    setCur(wholeWord ? "" : prev);
  }

  function handleChar(ch: string) {
    const run = runRef.current;
    const cfg = configRef.current;
    const wi = typedWordsRef.current.length;
    const targetWord = wordsRef.current[wi] || "";
    const pos = curRef.current.length;
    if (pos >= targetWord.length + MAX_EXTRA) return;
    const expected = targetWord[pos];
    setCalm(true);

    run.keystrokes++;
    const correct = ch === expected;
    if (!correct) {
      run.errors++;
      const el = (expected || "").toLowerCase();
      if (el && ADJ[el]?.includes(ch.toLowerCase())) run.neighbor++;
      if (targetWord[pos + 1] && ch === targetWord[pos + 1]) run.transposition++;
    }
    if (expected) {
      if (correct) run.keyHit[expected] = (run.keyHit[expected] || 0) + 1;
      else run.keyMiss[expected] = (run.keyMiss[expected] || 0) + 1;
    }
    // metro timing: how far from the nearest beat did this strike land? Reads
    // the live beat grid so it stays correct when the tempo is changing.
    if (cfg.mode === "metro" && run.start) {
      const b = beatRef.current;
      const now = Date.now();
      const dist = Math.min(Math.abs(now - b.last), Math.abs(now - (b.last + b.interval)));
      run.beatErr += dist; run.beatCount++;
      const onBeat = dist <= b.interval * 0.22;
      if (onBeat) run.onBeat++;
      if (cfg.dynamic) {
        // Two metrics: a level-up needs a sustained streak of strikes that are
        // BOTH correct and on the beat. A run of wrong strikes levels you down.
        if (correct && onBeat) { run.goodStreak++; run.badStreak = 0; }
        else if (correct) { run.goodStreak = 0; }        // correct but off-tempo: streak resets, no penalty
        else { run.goodStreak = 0; run.badStreak++; }
        if (run.goodStreak >= LEVEL_UP_STREAK) {
          run.goodStreak = 0;
          bpmRef.current = clampBpm(bpmRef.current + LEVEL_STEP);
          run.peakBpm = Math.max(run.peakBpm, bpmRef.current);
          setLiveBpm(Math.round(bpmRef.current));
          setLevelDir("up");
          if (soundRef.current) playLevelUp(audioRef.current);
        } else if (run.badStreak >= LEVEL_DOWN_STREAK) {
          run.badStreak = 0;
          bpmRef.current = clampBpm(bpmRef.current - LEVEL_STEP);
          setLiveBpm(Math.round(bpmRef.current));
          setLevelDir("down");
          if (soundRef.current) playLevelDown(audioRef.current);
        }
      }
    }

    setCur(curRef.current + ch);

    // finish the moment the final word is typed correctly (a wrong last word
    // needs a space) unless this run auto-refills (time mode, or an endless
    // metronome run) and only ends when you stop.
    if (!autoRefills(cfg) && wi === wordsRef.current.length - 1 && curRef.current === targetWord) {
      finish();
    }
  }

  // Space commits the word as typed, whatever state it's in; letters left
  // untyped count as missed. Leading or repeated spaces do nothing.
  function handleSpace() {
    const run = runRef.current;
    if (!run.start || curRef.current.length === 0) return;
    setCalm(true);
    run.keystrokes++; // the space counts as a (correct) advance keystroke
    setTypedWords([...typedWordsRef.current, curRef.current]);
    setCur("");

    if (!autoRefills(configRef.current) && typedWordsRef.current.length >= wordsRef.current.length) { finish(); return; }
    // time / endless: keep a buffer of words ahead of the typist
    if (autoRefills(configRef.current) && typedWordsRef.current.length >= wordsRef.current.length - 30) {
      setWords([...wordsRef.current, ...pickWords(40, configRef.current.pool).split(" ")]);
    }
  }

  // ── Timer (time mode) ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!started || finished || config.mode !== "time") return;
    const start = runRef.current.start;
    if (!start) return;
    const id = setTimeout(() => finish(), Math.max(0, config.length * 1000 - (Date.now() - start)));
    return () => clearTimeout(id);
  }, [started, finished, config.mode, config.length, finish]);

  // ── Line window + caret ──────────────────────────────────────────────────
  // Groups the rendered words into lines by their offsetTop (so it holds at
  // any card width or font size), keeps the caret's line at most the second
  // visible one by scrolling finished lines up, then measures where the caret
  // goes: the left edge of the letter it precedes, or the right edge of the
  // last one at a word's end. CSS transitions do the gliding. Reads refs so the
  // callback stays stable across renders.
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || finishedRef.current) { setCaret(p => ({ ...p, show: false })); return; }
    const els = wrap.querySelectorAll<HTMLElement>("[data-wi]");
    if (!els.length) { setCaret(p => ({ ...p, show: false })); return; }

    const tops: number[] = [];
    const firstOfLine: number[] = [];
    const lineOf: number[] = [];
    els.forEach((el, i) => {
      const top = el.offsetTop;
      if (!tops.length || top > tops[tops.length - 1] + 1) { tops.push(top); firstOfLine.push(i); }
      lineOf.push(tops.length - 1);
    });

    const active = Math.min(typedWordsRef.current.length, els.length - 1);
    const activeLine = lineOf[active];
    // The window only ever moves down while typing; a resize that rewraps the
    // text can pull it back so the caret is never above the window.
    let top = lineOf[Math.min(topWordRef.current, els.length - 1)];
    if (activeLine - top >= 2) top = activeLine - 1;
    else if (activeLine < top) top = activeLine;
    topWordRef.current = firstOfLine[top];
    setShift(tops[top] - tops[0]);

    const wordEl = els[active];
    const word = wordsRef.current[active] ?? "";
    const pos = curRef.current.length;
    const len = Math.max(word.length, pos);
    let x = wordEl.offsetLeft;
    if (len > 0) {
      const el = wordEl.children[pos < len ? pos : len - 1] as HTMLElement | undefined;
      if (el) x = pos < len ? el.offsetLeft : el.offsetLeft + el.offsetWidth;
    }
    const h = Math.round((parseFloat(getComputedStyle(wrap).fontSize) || 16) * 1.2);
    const y = wordEl.offsetTop + (wordEl.offsetHeight - h) / 2;
    setCaret({ x, y, h, show: true });
  }, []);

  useLayoutEffect(() => { measure(); }, [typedWords, cur, words, expanded, finished, loaded, measure]);
  // Card resizes (grid drag, window, fullscreen) rewrap the text: re-measure.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [expanded, finished, loaded, measure]);

  // Focus the field when the overlay opens.
  useEffect(() => {
    if (expanded) requestAnimationFrame(() => fieldRef.current?.focus());
  }, [expanded]);

  const focusField = () => fieldRef.current?.focus();
  const restart = () => { reset(configRef.current); focusField(); };

  // ── Render ─────────────────────────────────────────────────────────────────
  const chipBase = "px-2 py-0.5 rounded-md text-[11px] transition-colors";
  const chip = (active: boolean) =>
    `${chipBase} ${active ? `bg-black/10 dark:bg-white/15 ${c.text}` : `${c.label} opacity-50 hover:opacity-90`}`;

  const lengthOptions = optionsFor(config.mode);
  const DRILLS: { id: DrillId; label: string }[] = [
    { id: "custom", label: "custom" }, { id: "home", label: "home row" },
    { id: "rhythm", label: "rhythm" }, { id: "weak", label: "my weak keys" },
  ];

  const idle = !started && counting === null && !finished;
  const running = started && !finished;
  // Focus mode: while you type, the chrome fades out; moving the mouse brings it back.
  const quiet = running && calm;
  const fade = `transition-opacity duration-300 ${quiet ? "opacity-0 pointer-events-none" : ""}`;
  const onMouseMove = () => setCalm(false);

  // Exactly three lines tall: the window height is 3 x line-height in em, so it
  // follows the font size of either layout.
  function renderWords(big: boolean) {
    const activeWi = typedWords.length;
    const fontCls = big ? "text-[30px]" : "text-[19px]";
    return (
      <div className={`relative font-mono ${fontCls} leading-[1.6] h-[4.8em] overflow-hidden select-none transition-[filter,opacity] duration-200 ${focused ? "" : "opacity-40 blur-[3px]"}`}>
        <div
          ref={wrapRef}
          className="relative flex flex-wrap gap-x-[0.6em] pl-[3px] transition-transform duration-200 ease-out will-change-transform"
          style={{ transform: `translateY(${-shift}px)` }}
        >
          {/* single caret that glides between letters, nudged into the gap
              before the letter it precedes; blinks until the run starts */}
          <span
            aria-hidden
            className={`absolute left-0 top-0 w-[2px] rounded-full bg-current ${c.text} pointer-events-none will-change-transform transition-[transform,opacity] duration-100 ease-out ${started ? "" : "animate-pulse"}`}
            style={{ transform: `translate(${caret.x - 2}px, ${caret.y}px)`, height: caret.h || undefined, opacity: caret.show && !finished ? (focused ? 0.9 : 0) : 0 }}
          />
          {words.map((w, wi) => (
            <Word
              key={wi}
              wi={wi}
              word={w}
              typed={wi < activeWi ? typedWords[wi] : wi === activeWi ? cur : undefined}
              done={wi < activeWi}
              text={c.text}
            />
          ))}
        </div>
      </div>
    );
  }

  function card(big: boolean) {
    return (
      <>
        {/* Header */}
        <div className="flex items-center justify-between mb-2 shrink-0 gap-2">
          <div className={`flex items-center gap-1.5 min-w-0 ${c.label} ${fade}`}>
            <span className="opacity-50"><Keyboard size={14} /></span>
            <span className="text-xs font-medium opacity-60 truncate">{widget.title}</span>
          </div>
          <div className={`flex items-center gap-2 shrink-0 ${fade}`}>
            {stats.best > 0 && <span className={`text-[10px] tabular-nums opacity-50 ${c.text}`}>best {stats.best}</span>}
            <button
              onClick={restart}
              title="Restart (Tab)"
              className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 hover:!opacity-100 ${c.icon}`}
            >
              <RotateCcw size={13} />
            </button>
            <button
              onClick={() => setExpanded(v => !v)}
              title={big ? "Close" : "Expand"}
              className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 hover:!opacity-100 ${c.icon}`}
            >
              {big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
        </div>

        {/* Config bar */}
        <div className={`flex items-center flex-wrap gap-x-2 gap-y-1 mb-3 shrink-0 ${fade}`}>
          {(["words", "time", "drill", "metro"] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} className={chip(config.mode === m)}>{m}</button>
          ))}
          {lengthOptions.length > 0 && <span className={`opacity-20 ${c.label}`}>|</span>}
          {lengthOptions.map(n => (
            <button key={n} onClick={() => applyConfig({ ...config, length: n })} className={chip(config.length === n)}>{n}</button>
          ))}
          {config.mode !== "drill" && <span className={`opacity-20 ${c.label}`}>|</span>}
          {config.mode !== "drill" && (["simple", "varied"] as WordPool[]).map(p => (
            <button
              key={p}
              onClick={() => applyConfig({ ...config, pool: p })}
              className={chip(config.pool === p)}
              title={p === "simple" ? "The classic 200 most common words" : "The 1000 most common words"}
            >
              {p}
            </button>
          ))}
          {config.mode === "drill" && <span className={`opacity-20 ${c.label}`}>|</span>}
          {config.mode === "drill" && DRILLS.map(d => (
            <button key={d.id} onClick={() => applyConfig({ ...config, drill: d.id })} className={chip(config.drill === d.id)}>{d.label}</button>
          ))}
          {config.mode === "drill" && config.drill === "custom" && (
            <>
              <input
                value={config.custom}
                onChange={e => applyConfig({ ...config, custom: e.target.value })}
                placeholder="letters e.g. zxc"
                spellCheck={false}
                className={`w-28 px-2 py-0.5 rounded-md text-[11px] font-mono bg-black/5 dark:bg-white/10 outline-none ${c.text} placeholder:opacity-40`}
              />
              <button
                onClick={() => { if (config.customWords) applyConfig({ ...config, customScramble: !config.customScramble }); }}
                className={chip(config.customScramble)}
                title="Random strings of your letters"
              >
                scramble
              </button>
              <button
                onClick={() => { if (config.customScramble) applyConfig({ ...config, customWords: !config.customWords }); }}
                className={chip(config.customWords)}
                title="Real words containing your letters"
              >
                words
              </button>
            </>
          )}
          {config.mode === "metro" && <span className={`opacity-20 ${c.label}`}>|</span>}
          {config.mode === "metro" && (
            <span className="flex items-center gap-1">
              <Music size={12} className={`${c.label} opacity-60`} />
              <button onClick={() => applyConfig({ ...config, bpm: Math.max(BPM_MIN, config.bpm - 5) })} className={`${chipBase} ${c.label} opacity-60 hover:opacity-100`}>−</button>
              <span className={`text-[11px] tabular-nums w-16 text-center ${c.text}`}>{config.bpm} bpm{config.dynamic ? " start" : ""}</span>
              <button onClick={() => applyConfig({ ...config, bpm: Math.min(BPM_MAX, config.bpm + 5) })} className={`${chipBase} ${c.label} opacity-60 hover:opacity-100`}>+</button>
              <button onClick={() => applyConfig({ ...config, dynamic: !config.dynamic })} className={chip(config.dynamic)} title="Tempo speeds up on hits, slows on misses">dynamic</button>
              <button onClick={() => applyConfig({ ...config, endless: !config.endless })} className={chip(config.endless)} title="Never ends on its own, press Enter to stop">endless</button>
              <button
                onClick={() => applyConfig({ ...config, sound: !config.sound })}
                title={config.sound ? "Mute" : "Unmute"}
                className={`${c.icon} opacity-60 hover:opacity-100`}
              >
                {config.sound ? <Volume2 size={13} /> : <VolumeX size={13} />}
              </button>
            </span>
          )}
          {/* get-ready countdown */}
          <span className="flex items-center gap-1 ml-auto">
            <span className={`text-[10px] uppercase tracking-wider opacity-40 ${c.label}`}>ready</span>
            {COUNTDOWNS.map(n => (
              <button key={n} onClick={() => applyConfig({ ...config, countdown: n })} className={chip(config.countdown === n)}>
                {n === 0 ? "off" : `${n}s`}
              </button>
            ))}
          </span>
        </div>

        {/* Body */}
        <div
          ref={fieldRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onClick={() => { if (idle) startClick(); else focusField(); }}
          className={`flex-1 min-h-0 outline-none relative cursor-text flex flex-col ${finished ? "overflow-y-auto" : "justify-center overflow-hidden"}`}
        >
          {!loaded ? null : finished && result ? (
            <div className="tw-rise h-full">
              <Results c={c} r={result} onRestart={restart} onPracticeWeak={() => applyConfig({ ...config, mode: "drill", drill: "weak" })} />
            </div>
          ) : (
            <>
              {/* live counter: time left or words done, plus wpm (and the
                  metronome pulse) while a run is going */}
              <div className={`h-7 shrink-0 flex items-center gap-3 tabular-nums ${big ? "text-lg" : "text-sm"} ${c.text}`}>
                {running && runRef.current.start > 0 && (
                  <LiveStats
                    endsAt={config.mode === "time" ? runRef.current.start + config.length * 1000 : undefined}
                    progress={`${typedWords.length}${autoRefills(config) ? "" : `/${words.length}`}`}
                    wpm={liveWpm}
                  />
                )}
                {config.mode === "metro" && running && runRef.current.start > 0 && (
                  <div className="ml-auto flex items-center gap-2">
                    {config.dynamic && liveBpm !== null && (
                      <span
                        key={liveBpm}
                        className={`tw-pop text-[11px] tabular-nums font-medium ${levelDir === "up" ? "text-emerald-600 dark:text-emerald-400" : levelDir === "down" ? "text-red-500 dark:text-red-400" : c.text} `}
                        style={{ animationDuration: "0.3s" }}
                      >
                        {levelDir === "up" ? "▲ " : levelDir === "down" ? "▼ " : ""}{liveBpm} bpm
                      </span>
                    )}
                    <Metronome key={runRef.current.start} startAt={runRef.current.start} bpmRef={bpmRef} beatRef={beatRef} soundRef={soundRef} audioRef={audioRef} c={c} />
                  </div>
                )}
              </div>

              <div className="relative shrink-0">
                {renderWords(big)}

                {/* get-ready countdown overlay */}
                {counting !== null && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span key={counting} className={`tw-pop font-semibold tabular-nums ${big ? "text-8xl" : "text-5xl"} ${c.text} drop-shadow`}>
                      {counting}
                    </span>
                  </div>
                )}

                {/* focus hint over the blurred text whenever the field isn't
                    focused. pointer-events-none: a focusable overlay would
                    steal the first click's focus and unmount mid-click, eating
                    the click; let it fall through to the field itself. */}
                {!focused && counting === null && (
                  <div className={`absolute inset-0 flex items-center justify-center text-xs ${c.label} opacity-80 pointer-events-none`}>
                    {running ? "click here to continue" : config.countdown > 0 ? "click, then press space to start" : "click here, then type"}
                  </div>
                )}
              </div>

              {/* footer: start hint, metronome cue, or the endless stop button */}
              <div className={`h-7 shrink-0 mt-1 flex items-center gap-3 text-[11px] ${c.label}`}>
                {idle && focused && config.countdown > 0 && <span className="opacity-60">press space to start</span>}
                {running && config.mode === "metro" && !autoRefills(config) && <span className="opacity-50">strike a key on each beat</span>}
                {running && config.mode === "metro" && autoRefills(config) && (
                  <button
                    onClick={() => finish()}
                    className={`px-2 py-0.5 rounded-md bg-black/10 dark:bg-white/15 ${c.text} opacity-80 hover:opacity-100 transition-opacity`}
                  >
                    stop (enter)
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div onMouseMove={onMouseMove} className={`rounded-2xl border h-full relative group flex flex-col p-5 ${c.bg} ${c.border} ${c.glow} ${className}`}>
        {expanded ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <Keyboard size={22} className={`${c.label} opacity-40`} />
            <p className={`text-xs ${c.label} opacity-60`}>Typing trainer is open in fullscreen</p>
            <button onClick={() => setExpanded(false)} className={`text-xs px-3 py-1.5 rounded-lg bg-black/10 dark:bg-white/15 ${c.text} hover:bg-black/15 dark:hover:bg-white/20 transition-colors`}>
              Close
            </button>
          </div>
        ) : card(false)}
      </div>

      {expanded && mounted && createPortal(
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setExpanded(false); }}
          onMouseMove={onMouseMove}
        >
          <div className={`tw-overlay-in group w-[80vw] h-[80vh] max-w-[1200px] rounded-2xl border shadow-2xl relative flex flex-col p-6 ${c.bg} ${c.border}`}>
            {card(true)}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// One sine tone with a fixed, identical envelope, the building block for every
// cue so loudness never varies. `when` is an AudioContext timestamp so tones can
// be scheduled precisely ahead of time.
function tone(ctx: AudioContext, freq: [number, number] | number, when: number, dur: number, peak: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  if (Array.isArray(freq)) { o.frequency.setValueAtTime(freq[0], when); o.frequency.exponentialRampToValueAtTime(freq[1], when + dur * 0.6); }
  else o.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0004, when + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(when); o.stop(when + dur + 0.02);
}
// A soft woodblock click, scheduled at AudioContext time `when`.
function playClickAt(ctx: AudioContext, when: number) {
  try { tone(ctx, [900, 600], when, 0.05, 0.09); } catch {}
}
// Rising three-note flourish on a level-up.
function playLevelUp(ctx: AudioContext | null) {
  if (!ctx) return;
  const t = ctx.currentTime;
  try { [523.25, 659.25, 783.99].forEach((f, i) => tone(ctx, f, t + i * 0.075, 0.11, 0.1)); } catch {}
}
// Falling two-note cue on a level-down.
function playLevelDown(ctx: AudioContext | null) {
  if (!ctx) return;
  const t = ctx.currentTime;
  try { [493.88, 349.23].forEach((f, i) => tone(ctx, f, t + i * 0.1, 0.14, 0.1)); } catch {}
}

// Metronome with a Web Audio lookahead scheduler: a 25ms interval queues clicks
// ~150ms ahead at sample-accurate AudioContext times, so beats never drop or
// waver even when animation frames stutter. A rAF loop only drains that queue to
// pulse the dot and publish the live beat grid (in wall-clock time) to `beatRef`
// for keystroke scoring. Reads bpmRef every beat, so it follows a changing tempo.
function Metronome({
  startAt, bpmRef, beatRef, soundRef, audioRef, c,
}: {
  startAt: number;
  bpmRef: React.RefObject<number>;
  beatRef: React.RefObject<{ last: number; interval: number }>;
  soundRef: React.RefObject<boolean>;
  audioRef: React.RefObject<AudioContext | null>;
  c: ColorClasses;
}) {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const ctx = audioRef.current;
    let raf = 0, sched = 0, stopped = false;
    const queue: number[] = []; // AudioContext times of scheduled beats awaiting their visual/beat mark
    beatRef.current = { last: startAt, interval: 60000 / clampBpm(bpmRef.current) };

    if (ctx) {
      let nextTick = ctx.currentTime + 0.08;
      const lookahead = 0.15;
      const scheduler = () => {
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        while (nextTick < ctx.currentTime + lookahead) {
          if (soundRef.current) playClickAt(ctx, nextTick);
          queue.push(nextTick);
          nextTick += 60 / clampBpm(bpmRef.current);
        }
      };
      sched = window.setInterval(scheduler, 25);
      const drain = () => {
        if (stopped) return;
        while (queue.length && queue[0] <= ctx.currentTime) {
          queue.shift();
          beatRef.current = { last: Date.now(), interval: 60000 / clampBpm(bpmRef.current) };
          setPulse(p => p + 1);
        }
        raf = requestAnimationFrame(drain);
      };
      raf = requestAnimationFrame(drain);
    } else {
      // No audio context (blocked/muted before start): drive visuals off the wall clock.
      let prev = Date.now(), phase = 1;
      const loop = () => {
        if (stopped) return;
        const now = Date.now();
        const interval = 60000 / clampBpm(bpmRef.current);
        phase += (now - prev) / interval; prev = now;
        if (phase >= 1) { phase -= Math.floor(phase); beatRef.current = { last: now, interval }; setPulse(p => p + 1); }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => { stopped = true; cancelAnimationFrame(raf); if (sched) clearInterval(sched); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt]);

  return (
    <span
      key={pulse}
      className={`block w-3 h-3 rounded-full bg-current ${c.text} tw-pop`}
      style={{ animationDuration: "0.25s" }}
    />
  );
}

// Live counter above the text: seconds left (time mode) or words done, plus
// wpm. Ticks on its own interval so only this element re-renders, never the
// parent's words.
function LiveStats({ endsAt, progress, wpm }: { endsAt?: number; progress: string; wpm: () => number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  const left = endsAt !== undefined ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null;
  return (
    <>
      <span className="font-semibold">{left !== null ? left : progress}</span>
      <span className="opacity-50">{wpm()} wpm</span>
    </>
  );
}

function Results({
  c, r, onRestart, onPracticeWeak,
}: {
  c: ColorClasses;
  r: Result;
  onRestart: () => void;
  onPracticeWeak: () => void;
}) {
  const big = (value: React.ReactNode, label: string, cls = c.text) => (
    <div>
      <div className={`text-[10px] uppercase tracking-widest opacity-40 mb-1 ${c.label}`}>{label}</div>
      <div className={`text-4xl font-semibold tabular-nums leading-none ${cls}`}>{value}</div>
    </div>
  );
  const small = (value: React.ReactNode, label: string, title?: string) => (
    <div title={title}>
      <div className={`text-[10px] uppercase tracking-widest opacity-40 ${c.label}`}>{label}</div>
      <div className={`text-sm tabular-nums ${c.text}`}>{value}</div>
    </div>
  );
  const ch = r.chars;
  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-end gap-6 flex-wrap">
        {big(r.wpm, r.pb ? "wpm, new best" : "wpm")}
        {big(`${r.acc}%`, "accuracy", r.acc >= 97 ? "text-emerald-600 dark:text-emerald-400" : r.acc >= 90 ? c.text : "text-red-500 dark:text-red-400")}
        {r.metro && big(`${r.metro.onBeatPct}%`, "on beat", r.metro.onBeatPct >= 80 ? "text-emerald-600 dark:text-emerald-400" : c.text)}
        {r.metro?.peak !== undefined && big(r.metro.peak, "peak bpm")}
      </div>

      <div className="flex items-start gap-x-6 gap-y-2 flex-wrap">
        {small(r.raw, "raw")}
        {small(
          <>
            <span>{ch.correct}</span><span className="opacity-40">/</span>
            <span className={ch.incorrect ? "text-red-500 dark:text-red-400" : ""}>{ch.incorrect}</span><span className="opacity-40">/</span>
            <span className={ch.extra ? "text-red-800 dark:text-red-400/55" : ""}>{ch.extra}</span><span className="opacity-40">/</span>
            <span className={ch.missed ? "opacity-50" : ""}>{ch.missed}</span>
          </>,
          "characters",
          "correct / incorrect / extra / missed",
        )}
        {small(`${r.seconds}s`, "time")}
        {r.metro && small(`±${r.metro.avgErr}ms`, r.metro.peak !== undefined ? `from ${r.metro.bpm}bpm` : `at ${r.metro.bpm}bpm`, "average distance from the beat")}
        {small(r.test, "test")}
      </div>

      <div className={`text-[11px] leading-relaxed opacity-70 ${c.text}`}>
        {r.neighbor > 0 && <span>{r.neighbor} neighbour slip{r.neighbor > 1 ? "s" : ""}</span>}
        {r.neighbor > 0 && r.transposition > 0 && <span> · </span>}
        {r.transposition > 0 && <span>{r.transposition} transposition{r.transposition > 1 ? "s" : ""}</span>}
        {r.neighbor === 0 && r.transposition === 0 && <span>clean run, no neighbour slips or transpositions</span>}
      </div>

      {r.weak.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] uppercase tracking-widest opacity-40 ${c.label}`}>missed</span>
          {r.weak.map(w => (
            <span key={w.k} className="px-1.5 py-0.5 rounded-md text-[11px] font-mono bg-red-500/10 text-red-500 dark:text-red-400" title={`${w.miss}/${w.total} wrong`}>
              {w.k === " " ? "space" : w.k}<span className="opacity-50"> {w.miss}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-auto">
        <button onClick={onRestart} title="Next test (Tab, Enter or Esc)" className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-black/10 dark:bg-white/15 ${c.text} hover:bg-black/15 dark:hover:bg-white/20 transition-colors`}>
          <RotateCcw size={12} /> next test
        </button>
        {r.weak.length > 0 && (
          <button onClick={onPracticeWeak} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${c.label} opacity-70 hover:opacity-100 transition-opacity`}>
            <Target size={12} /> practice these
          </button>
        )}
        <span className={`ml-auto text-[10px] opacity-40 ${c.label}`}>tab or enter to restart</span>
      </div>
    </div>
  );
}
