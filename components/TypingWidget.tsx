"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Keyboard, RotateCcw, Target, Maximize2, Minimize2, Volume2, VolumeX, Music } from "lucide-react";
import { colorMap, type Widget, type ColorClasses } from "@/lib/widgets";
import * as storage from "@/lib/storage";

// A Monkeytype-style typing trainer. Input is word-based: you type a word and
// SPACE commits it and jumps to the next one (partial/wrong words are scored as
// typed, extra letters spill in red) — never a rigid character-by-character
// stream. On top of that it tracks which keys you miss and how you slip
// (neighbour reach vs transposition) and can drill exactly those.
//
// Extras: a controllable get-ready countdown, a custom-letters drill ("zxc" ->
// random combos of just those keys), a metronome mode that asks you to strike a
// key on each beat at a BPM you set, and an expand toggle that floats the
// trainer over a dimmed backdrop at 80% of the screen.

type Mode = "words" | "time" | "drill" | "metro";
type DrillId = "custom" | "home" | "rhythm" | "weak";
type Config = {
  mode: Mode;
  length: number;
  drill: DrillId;
  custom: string;
  customScramble: boolean; // custom drill: random strings of the letters
  customWords: boolean;    // custom drill: real words containing the letters
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

const DEFAULT_CONFIG: Config = { mode: "words", length: 25, drill: "custom", custom: "zxc", customScramble: true, customWords: false, countdown: 3, bpm: 100, sound: true, dynamic: false, endless: false };

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

// A compact common-word pool (lowercase, no punctuation) — enough variety for
// words/time modes and to seed weak-key drills.
const WORDS = (
  "the of and a to in is you that it he was for on are as with his they i at be this have from or one had by " +
  "word but not what all were we when your can said there use an each which she do how their if will up other " +
  "about out many then them these so some her would make like him into time has look two more write go see " +
  "number no way could people my than first water been call who oil its now find long down day did get come " +
  "made may part over new sound take only little work know place year live me back give most very after thing " +
  "our just name good sentence man think say great where help through much before line right too mean old any " +
  "same tell boy follow came want show also around form three small set put end does another well large must big"
).split(/\s+/).filter(Boolean);

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
function pickWords(n: number): string {
  const out: string[] = [];
  while (out.length < n) out.push(...shuffle(WORDS));
  return out.slice(0, n).join(" ");
}

// The top real words for a set of trouble letters: words containing ALL the
// letters rank first, then the closest approximations — more of the letters
// present wins, ties broken by how much of the word is made of them.
function wordsForLetters(letters: string[]): string[] {
  return WORDS
    .map(w => ({
      w,
      present: letters.filter(l => w.includes(l)).length,
      density: w.split("").filter(ch => letters.includes(ch)).length / w.length,
    }))
    .sort((a, b) => b.present - a.present || b.density - a.density)
    .slice(0, 50)
    .map(x => x.w);
}

// Custom drill text from the user's letters: scrambles (random strings of only
// those letters), real words containing them, or a random mix of both.
function buildCustom(cfg: Config): string {
  const letters = [...new Set((cfg.custom || "").toLowerCase().replace(/[^a-z0-9]/g, "").split(""))];
  if (letters.length === 0) return "asdf jkl; fdsa ;lkj asdf jkl;";
  const useWords = cfg.customWords;
  const useScramble = cfg.customScramble || !useWords; // never neither
  const pool = useWords ? wordsForLetters(letters) : [];
  const out: string[] = [];
  for (let i = 0; i < 28; i++) {
    if (useWords && (!useScramble || Math.random() < 0.5)) {
      out.push(pool[Math.floor(Math.random() * pool.length)]);
    } else {
      const len = 2 + Math.floor(Math.random() * 3); // 2–4 chars
      let w = "";
      for (let j = 0; j < len; j++) w += letters[Math.floor(Math.random() * letters.length)];
      out.push(w);
    }
  }
  return out.join(" ");
}

// Build the text to type for the current config.
function buildTarget(cfg: Config, stats: Stats): string {
  if (cfg.mode === "words") return pickWords(cfg.length);
  if (cfg.mode === "metro") return pickWords(cfg.length);
  if (cfg.mode === "time") return pickWords(80); // generous buffer; extended on demand
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
    if (!weak.length) return buildCustom(cfg); // nothing learned yet — fall back to your own keys
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

// Runs that never end on their own — they refill words and end only on the
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

type Result = {
  wpm: number; raw: number; acc: number; seconds: number; correct: number;
  neighbor: number; transposition: number;
  weak: { k: string; miss: number; total: number }[];
  metro?: { bpm: number; onBeatPct: number; avgErr: number; peak?: number };
};

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

  const wordsRef = useRef<string[]>([]);
  const typedWordsRef = useRef<string[]>([]);
  const curRef = useRef("");
  const runRef = useRef<RunStat>(freshRun());
  const statsRef = useRef<Stats>(DEFAULT_STATS);
  const configRef = useRef<Config>(DEFAULT_CONFIG);
  const fieldRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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

  // ── Finish + scoring ─────────────────────────────────────────────────────
  const finish = useCallback(() => {
    if (finishedRef.current) return; // idempotent
    finishedRef.current = true;
    const run = runRef.current;
    const cfg = configRef.current;
    const seconds = run.start ? Math.max(0.5, (Date.now() - run.start) / 1000) : 0.5;

    const typedList = curRef.current.length ? [...typedWordsRef.current, curRef.current] : [...typedWordsRef.current];
    let correct = 0;
    for (let i = 0; i < typedList.length; i++) {
      const t = typedList[i], g = wordsRef.current[i] || "";
      for (let j = 0; j < t.length; j++) if (t[j] === g[j]) correct++;
    }
    const wpm = Math.round((correct / 5) / (seconds / 60));
    const raw = Math.round((run.keystrokes / 5) / (seconds / 60));
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

    setResult({ wpm, raw, acc, seconds: Math.round(seconds), correct, neighbor: run.neighbor, transposition: run.transposition, weak, metro });
    setFinished(true);

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
    if (k === "Escape" && expanded) { setExpanded(false); return; }
    if (counting !== null) { if (k === "Escape") reset(configRef.current); return; }

    if (finished) {
      if (k === "Enter" || k === "Tab") { e.preventDefault(); reset(configRef.current); }
      return;
    }
    if (k === "Tab") { e.preventDefault(); reset(configRef.current); return; }
    // endless run: Enter stops it and shows results
    if (k === "Enter" && runRef.current.start && autoRefills(configRef.current) && configRef.current.mode === "metro") {
      e.preventDefault(); finish(); return;
    }

    // Not started yet: with a get-ready countdown, the first key (space or any
    // printable key) kicks off the count-in rather than typing.
    if (!runRef.current.start) {
      if (configRef.current.countdown > 0) {
        if (k === " " || k === "Enter" || k.length === 1) { e.preventDefault(); arm(); }
        return;
      }
      // countdown off: first real key starts the clock (handled below)
    }

    if (k === "Backspace") {
      e.preventDefault();
      if (curRef.current) setCur(curRef.current.slice(0, -1));
      else if (typedWordsRef.current.length) {
        const prev = typedWordsRef.current[typedWordsRef.current.length - 1];
        setTypedWords(typedWordsRef.current.slice(0, -1));
        setCur(prev);
      }
      return;
    }

    if (k === " ") { e.preventDefault(); handleSpace(); return; }
    if (k.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

    if (!runRef.current.start) { ensureAudio(); startTyping(); }
    handleChar(k);
  }

  function handleChar(ch: string) {
    const run = runRef.current;
    const cfg = configRef.current;
    const wi = typedWordsRef.current.length;
    const targetWord = wordsRef.current[wi] || "";
    const pos = curRef.current.length;
    const expected = targetWord[pos];

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

    // finish when the final word is fully typed — unless this run auto-refills
    // (time mode, or an endless metronome run) and only ends when you stop.
    if (!autoRefills(cfg) && wi === wordsRef.current.length - 1 && curRef.current.length >= targetWord.length) {
      finish();
    }
  }

  function handleSpace() {
    const run = runRef.current;
    if (!run.start || curRef.current.length === 0) return; // ignore leading / repeat spaces
    run.keystrokes++; // the space counts as a (correct) advance keystroke
    setTypedWords([...typedWordsRef.current, curRef.current]);
    setCur("");

    if (!autoRefills(configRef.current) && typedWordsRef.current.length >= wordsRef.current.length) { finish(); return; }
    // time / endless: keep a buffer of words ahead of the typist
    if (autoRefills(configRef.current) && typedWordsRef.current.length >= wordsRef.current.length - 8) {
      setWords([...wordsRef.current, ...pickWords(24).split(" ")]);
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

  // Measure where the caret should sit — the left edge of the character it
  // precedes, or the right edge of the last one at a word's end — and let CSS
  // glide it there. Reads refs so the callback stays stable across renders.
  const measureCaret = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || finishedRef.current) { setCaret(c => ({ ...c, show: false })); return; }
    const activeWi = typedWordsRef.current.length;
    const word = wordsRef.current[activeWi];
    const wordEl = wrap.querySelector('[data-w-active="1"]') as HTMLElement | null;
    if (word === undefined || !wordEl) { setCaret(c => ({ ...c, show: false })); return; }
    const caretPos = curRef.current.length;
    const len = Math.max(word.length, caretPos);
    let x: number, y: number, h: number;
    if (len === 0) {
      x = wordEl.offsetLeft; y = wordEl.offsetTop; h = wordEl.offsetHeight;
    } else {
      const idx = caretPos < len ? caretPos : len - 1;
      const el = wordEl.children[idx] as HTMLElement | undefined;
      if (!el) { setCaret(c => ({ ...c, show: false })); return; }
      h = el.offsetHeight; y = el.offsetTop;
      x = caretPos < len ? el.offsetLeft : el.offsetLeft + el.offsetWidth;
    }
    setCaret({ x, y, h, show: true });
    if (runRef.current.start) wordEl.scrollIntoView({ block: "nearest" });
  }, []);

  useLayoutEffect(() => { measureCaret(); }, [typedWords, cur, words, expanded, finished, loaded, measureCaret]);
  useEffect(() => {
    const onResize = () => measureCaret();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureCaret]);

  // Focus the field when the overlay opens.
  useEffect(() => {
    if (expanded) requestAnimationFrame(() => fieldRef.current?.focus());
  }, [expanded]);

  const focusField = () => fieldRef.current?.focus();

  // ── Render ─────────────────────────────────────────────────────────────────
  const chipBase = "px-2 py-0.5 rounded-md text-[11px] transition-colors";
  const chip = (active: boolean) =>
    `${chipBase} ${active ? `bg-black/10 dark:bg-white/15 ${c.text}` : `${c.label} opacity-50 hover:opacity-90`}`;

  const lengthOptions = optionsFor(config.mode);
  const DRILLS: { id: DrillId; label: string }[] = [
    { id: "custom", label: "custom" }, { id: "home", label: "home row" },
    { id: "rhythm", label: "rhythm" }, { id: "weak", label: "my weak keys" },
  ];

  function renderWords(big: boolean) {
    const activeWi = typedWords.length;
    const fontCls = big ? "text-2xl leading-[2.6rem]" : "text-[15px] leading-8";
    return (
      <div ref={wrapRef} className={`relative font-mono ${fontCls} tracking-wide flex flex-wrap gap-x-[0.55ch] gap-y-1 select-none transition-opacity ${focused ? "" : "opacity-50 blur-[1.5px]"}`}>
        {/* single caret that glides between characters */}
        <span
          aria-hidden
          className={`absolute left-0 top-0 w-[2px] rounded-full bg-current ${c.text} pointer-events-none will-change-transform transition-[transform,height] duration-75 ease-out ${started ? "" : "animate-pulse"}`}
          style={{ transform: `translate(${caret.x}px, ${caret.y}px)`, height: caret.h || undefined, opacity: caret.show ? (focused ? 0.9 : 0.35) : 0 }}
        />
        {words.map((w, wi) => {
          const typedW = wi < typedWords.length ? typedWords[wi] : wi === activeWi ? cur : undefined;
          const isActive = wi === activeWi && !finished;
          const len = Math.max(w.length, typedW?.length ?? 0);
          const nodes: React.ReactNode[] = [];
          for (let j = 0; j < len; j++) {
            const gch = w[j];
            const tch = typedW?.[j];
            let cls: string;
            let display: string | undefined = gch;
            if (j < w.length) {
              if (tch === undefined) cls = `opacity-30 ${c.text}`;
              else if (tch === gch) cls = `opacity-100 ${c.text}`;
              else cls = "opacity-100 text-red-500 dark:text-red-400 underline decoration-red-500/50";
            } else {
              display = tch; // extra letters spilled past the word
              cls = "opacity-90 text-red-500/80 dark:text-red-400/80";
            }
            nodes.push(<span key={j} className={cls}>{display}</span>);
          }
          return (
            <span key={wi} data-w-active={isActive ? "1" : undefined} className="inline-flex whitespace-pre">
              {nodes.length ? nodes : <span>&nbsp;</span>}
            </span>
          );
        })}
      </div>
    );
  }

  const idle = !started && counting === null && !finished;
  const totalWords = words.length;

  function card(big: boolean) {
    return (
      <>
        {/* Header */}
        <div className="flex items-center justify-between mb-2 shrink-0 gap-2">
          <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
            <span className="opacity-50"><Keyboard size={14} /></span>
            <span className="text-xs font-medium opacity-60 truncate">{widget.title}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {stats.best > 0 && <span className={`text-[10px] tabular-nums opacity-50 ${c.text}`}>best {stats.best}</span>}
            <button
              onClick={() => { reset(configRef.current); focusField(); }}
              title="Restart (Tab)"
              className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 hover:!opacity-100 ${c.icon}`}
            >
              <RotateCcw size={13} />
            </button>
            <button
              onClick={() => setExpanded(v => !v)}
              title={big ? "Close (Esc)" : "Expand"}
              className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 hover:!opacity-100 ${c.icon}`}
            >
              {big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
        </div>

        {/* Config bar */}
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-3 shrink-0">
          {(["words", "time", "drill", "metro"] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} className={chip(config.mode === m)}>{m}</button>
          ))}
          {lengthOptions.length > 0 && <span className={`opacity-20 ${c.label}`}>|</span>}
          {lengthOptions.map(n => (
            <button key={n} onClick={() => applyConfig({ ...config, length: n })} className={chip(config.length === n)}>{n}</button>
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
              <button onClick={() => applyConfig({ ...config, endless: !config.endless })} className={chip(config.endless)} title="Never ends on its own — press Enter to stop">endless</button>
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
          className="flex-1 min-h-0 outline-none relative cursor-text overflow-y-auto"
        >
          {!loaded ? null : finished && result ? (
            <div className="tw-rise h-full">
              <Results c={c} r={result} onRestart={() => { reset(configRef.current); focusField(); }} onPracticeWeak={() => applyConfig({ ...config, mode: "drill", drill: "weak" })} />
            </div>
          ) : (
            <div className="relative">
              {renderWords(big)}

              {/* metronome pulse (top-right of the text) */}
              {config.mode === "metro" && started && runRef.current.start && (
                <div className="absolute top-0 right-0 flex items-center gap-2">
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

              {/* get-ready countdown overlay */}
              {counting !== null && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span key={counting} className={`tw-pop font-semibold tabular-nums ${big ? "text-8xl" : "text-6xl"} ${c.text} drop-shadow`}>
                    {counting}
                  </span>
                </div>
              )}

              {/* idle hint */}
              {/* pointer-events-none: a focusable overlay would steal the first
                  click's focus and unmount mid-click, eating the click — let it
                  fall through to the field itself. */}
              {idle && !focused && (
                <div
                  className={`absolute inset-0 flex items-center justify-center text-xs ${c.label} opacity-80 pointer-events-none`}
                >
                  {config.countdown > 0 ? "click, then press space to start" : "click here, then type"}
                </div>
              )}
              {idle && focused && config.countdown > 0 && (
                <div className={`absolute inset-x-0 bottom-0 flex items-center justify-center text-[11px] ${c.label} opacity-60 pointer-events-none`}>
                  press space to start
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live footer */}
        {!finished && started && (
          <div className={`shrink-0 mt-2 flex items-center gap-3 text-[11px] tabular-nums opacity-60 ${c.text}`}>
            {config.mode === "time" && runRef.current.start
              ? <Countdown endsAt={runRef.current.start + config.length * 1000} />
              : <span>{typedWords.length}{autoRefills(config) ? "" : `/${totalWords}`} words</span>}
            {config.mode === "metro" && !autoRefills(config) && <span className="opacity-70">strike a key on each beat</span>}
            {config.mode === "metro" && autoRefills(config) && (
              <button
                onClick={() => finish()}
                className={`ml-auto px-2 py-0.5 rounded-md bg-black/10 dark:bg-white/15 ${c.text} opacity-80 hover:opacity-100 transition-opacity`}
              >
                stop (enter)
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className={`rounded-2xl border h-full relative group flex flex-col p-5 ${c.bg} ${c.border} ${c.glow} ${className}`}>
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

// One sine tone with a fixed, identical envelope — the building block for every
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

// Self-ticking countdown for time mode — its own interval re-renders only this
// element, never the parent's character spans.
function Countdown({ endsAt }: { endsAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  return <span>{Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))}s left</span>;
}

function Results({
  c, r, onRestart, onPracticeWeak,
}: {
  c: ColorClasses;
  r: Result;
  onRestart: () => void;
  onPracticeWeak: () => void;
}) {
  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-end gap-5 flex-wrap">
        <div>
          <div className={`text-3xl font-semibold tabular-nums leading-none ${c.text}`}>{r.wpm}</div>
          <div className={`text-[10px] uppercase tracking-widest opacity-40 mt-1 ${c.label}`}>wpm</div>
        </div>
        <div>
          <div className={`text-3xl font-semibold tabular-nums leading-none ${r.acc >= 97 ? "text-emerald-600 dark:text-emerald-400" : r.acc >= 90 ? c.text : "text-red-500 dark:text-red-400"}`}>{r.acc}%</div>
          <div className={`text-[10px] uppercase tracking-widest opacity-40 mt-1 ${c.label}`}>accuracy</div>
        </div>
        {r.metro && (
          <div>
            <div className={`text-3xl font-semibold tabular-nums leading-none ${r.metro.onBeatPct >= 80 ? "text-emerald-600 dark:text-emerald-400" : c.text}`}>{r.metro.onBeatPct}%</div>
            <div className={`text-[10px] uppercase tracking-widest opacity-40 mt-1 ${c.label}`}>on beat</div>
          </div>
        )}
        {r.metro?.peak !== undefined && (
          <div>
            <div className={`text-3xl font-semibold tabular-nums leading-none ${c.text}`}>{r.metro.peak}</div>
            <div className={`text-[10px] uppercase tracking-widest opacity-40 mt-1 ${c.label}`}>peak bpm</div>
          </div>
        )}
        <div className={`text-[11px] tabular-nums opacity-55 leading-5 ${c.text}`}>
          <div>raw {r.raw}</div>
          <div>{r.seconds}s</div>
          {r.metro && <div>±{r.metro.avgErr}ms {r.metro.peak !== undefined ? `from ${r.metro.bpm}bpm` : `@ ${r.metro.bpm}bpm`}</div>}
        </div>
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
        <button onClick={onRestart} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-black/10 dark:bg-white/15 ${c.text} hover:bg-black/15 dark:hover:bg-white/20 transition-colors`}>
          <RotateCcw size={12} /> again
        </button>
        {r.weak.length > 0 && (
          <button onClick={onPracticeWeak} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${c.label} opacity-70 hover:opacity-100 transition-opacity`}>
            <Target size={12} /> practice these
          </button>
        )}
      </div>
    </div>
  );
}
