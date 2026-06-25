"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Keyboard, RotateCcw, Target } from "lucide-react";
import { colorMap, type Widget, type ColorClasses } from "@/lib/widgets";
import * as storage from "@/lib/storage";

// A Monkeytype-style typing trainer, tuned for practising specific weaknesses:
// it tracks which keys you miss and what KIND of slip it was — a neighbouring
// key, or a transposition (racing ahead and swapping order) — then can build a
// drill that targets exactly those. Built-in drills cover home-row resets, the
// awkward b/v reach, and rhythm word reps.

type Mode = "words" | "time" | "drill";
type DrillId = "home" | "bv" | "rhythm" | "weak";
type Config = { mode: Mode; length: number; drill: DrillId };
type Stats = {
  best: number;
  runs: number;
  keyHit: Record<string, number>;
  keyMiss: Record<string, number>;
};

const DEFAULT_CONFIG: Config = { mode: "words", length: 25, drill: "bv" };
const DEFAULT_STATS: Stats = { best: 0, runs: 0, keyHit: {}, keyMiss: {} };

const WORD_LENGTHS = [10, 25, 50];
const TIME_LENGTHS = [15, 30, 60];

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

// Build the text to type for the current config.
function buildTarget(cfg: Config, stats: Stats): string {
  if (cfg.mode === "words") return pickWords(cfg.length);
  if (cfg.mode === "time") return pickWords(80); // generous buffer; extended on demand
  // drills
  if (cfg.drill === "home") {
    return Array(6).fill("asdf jkl; fdsa ;lkj jfjf dkdk slsl a;a;").join(" ");
  }
  if (cfg.drill === "rhythm") {
    const ws = shuffle(["the", "and", "because", "should", "people", "through", "where", "little"]).slice(0, 6);
    return ws.map(w => `${w} ${w} ${w}`).join(" ");
  }
  if (cfg.drill === "weak") {
    // Keys you miss most (need a few attempts to count), worst first.
    const weak = Object.keys(stats.keyMiss)
      .map(k => ({ k, miss: stats.keyMiss[k] || 0, total: (stats.keyMiss[k] || 0) + (stats.keyHit[k] || 0) }))
      .filter(x => x.total >= 3 && x.miss > 0 && /[a-z]/.test(x.k))
      .sort((a, b) => b.miss / b.total - a.miss / a.total)
      .slice(0, 5)
      .map(x => x.k);
    if (!weak.length) return buildTarget({ ...cfg, drill: "bv" }, stats); // nothing learned yet
    const seqs: string[] = [];
    for (const k of weak) {
      seqs.push(`f${k}f`, `j${k}j`, `${k}${k}${k}`);
      const w = WORDS.filter(w => w.includes(k));
      if (w.length) seqs.push(shuffle(w).slice(0, 2).join(" "));
    }
    return Array(2).fill(shuffle(seqs).join(" ")).join(" ");
  }
  // default: b / v reach
  const base = "fvf fbf vfb bfv fvb bvb";
  const words = "verb brave above vibe value behave visible bubble believe";
  return `${base} ${base} ${words} ${base}`;
}

type RunStat = {
  start: number;
  keystrokes: number;
  errors: number;
  neighbor: number;
  transposition: number;
  keyHit: Record<string, number>;
  keyMiss: Record<string, number>;
};
function freshRun(): RunStat {
  return { start: 0, keystrokes: 0, errors: 0, neighbor: 0, transposition: 0, keyHit: {}, keyMiss: {} };
}

type Result = {
  wpm: number; raw: number; acc: number; seconds: number; correct: number;
  neighbor: number; transposition: number;
  weak: { k: string; miss: number; total: number }[];
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

  const [target, setTarget] = useState("");
  const [typed, setTyped] = useState("");
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [focused, setFocused] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const typedRef = useRef("");
  const targetRef = useRef("");
  const runRef = useRef<RunStat>(freshRun());
  const statsRef = useRef<Stats>(DEFAULT_STATS);
  const configRef = useRef<Config>(DEFAULT_CONFIG);
  const fieldRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const finishedRef = useRef(false);

  // ── Load / persist ─────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([storage.getItem(configKey), storage.getItem(statsKey)]).then(([cRaw, sRaw]) => {
      let cfg = DEFAULT_CONFIG;
      let st = DEFAULT_STATS;
      try { if (cRaw) cfg = { ...DEFAULT_CONFIG, ...JSON.parse(cRaw) }; } catch {}
      try { if (sRaw) st = { ...DEFAULT_STATS, ...JSON.parse(sRaw) }; } catch {}
      setConfig(cfg); configRef.current = cfg;
      setStats(st); statsRef.current = st;
      const t = buildTarget(cfg, st);
      setTarget(t); targetRef.current = t;
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  const reset = useCallback((cfg: Config) => {
    const t = buildTarget(cfg, statsRef.current);
    targetRef.current = t;
    typedRef.current = "";
    runRef.current = freshRun();
    setTarget(t);
    setTyped("");
    setStarted(false);
    setFinished(false);
    setResult(null);
    finishedRef.current = false;
  }, []);

  function applyConfig(next: Config) {
    setConfig(next); configRef.current = next;
    storage.setItem(configKey, JSON.stringify(next));
    reset(next);
  }

  // ── Finish + scoring ─────────────────────────────────────────────────────
  const finish = useCallback((finalTyped: string) => {
    if (finishedRef.current) return; // idempotent: never double-count a run
    finishedRef.current = true;
    const run = runRef.current;
    const tgt = targetRef.current;
    const seconds = run.start ? Math.max(0.5, (Date.now() - run.start) / 1000) : 0.5;
    let correct = 0;
    for (let i = 0; i < finalTyped.length && i < tgt.length; i++) if (finalTyped[i] === tgt[i]) correct++;
    const wpm = Math.round((correct / 5) / (seconds / 60));
    const raw = Math.round((run.keystrokes / 5) / (seconds / 60));
    const acc = run.keystrokes ? Math.round(((run.keystrokes - run.errors) / run.keystrokes) * 100) : 100;
    const weak = Object.keys(run.keyMiss)
      .map(k => ({ k, miss: run.keyMiss[k], total: run.keyMiss[k] + (run.keyHit[k] || 0) }))
      .sort((a, b) => b.miss - a.miss)
      .slice(0, 5);

    setResult({ wpm, raw, acc, seconds: Math.round(seconds), correct, neighbor: run.neighbor, transposition: run.transposition, weak });
    setFinished(true);

    // Merge into lifetime stats.
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

  // ── Keystroke handling ─────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (!loaded) return;
    const k = e.key;
    if (finished) {
      if (k === "Enter" || k === "Tab") { e.preventDefault(); reset(configRef.current); }
      return;
    }
    if (k === "Tab") { e.preventDefault(); reset(configRef.current); return; }
    if (k === "Backspace") {
      e.preventDefault();
      if (typedRef.current) { typedRef.current = typedRef.current.slice(0, -1); setTyped(typedRef.current); }
      return;
    }
    let ch: string | null = null;
    if (k === " ") { e.preventDefault(); ch = " "; }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) ch = k;
    if (ch === null) return;

    const run = runRef.current;
    if (!run.start) { run.start = Date.now(); setStarted(true); }

    const tgt = targetRef.current;
    const i = typedRef.current.length;
    const expected = tgt[i];
    run.keystrokes++;
    const correct = ch === expected;
    if (!correct) {
      run.errors++;
      const el = (expected || "").toLowerCase();
      if (el && ADJ[el]?.includes(ch.toLowerCase())) run.neighbor++;
      if (tgt[i + 1] && ch === tgt[i + 1]) run.transposition++;
    }
    if (expected && expected !== " ") {
      if (correct) run.keyHit[expected] = (run.keyHit[expected] || 0) + 1;
      else run.keyMiss[expected] = (run.keyMiss[expected] || 0) + 1;
    }

    let next = typedRef.current + ch;
    // time mode: keep the buffer ahead of the typist
    if (configRef.current.mode === "time" && next.length > tgt.length - 24) {
      const extended = tgt + " " + pickWords(20);
      targetRef.current = extended;
      setTarget(extended);
    }
    typedRef.current = next;
    setTyped(next);
    if (configRef.current.mode !== "time" && next.length >= targetRef.current.length) finish(next);
  }

  // ── Timer (time mode): one timeout ends the run; the live countdown is a
  // self-ticking child so it never re-renders the character spans. ───────────
  useEffect(() => {
    if (!started || finished || config.mode !== "time") return;
    const start = runRef.current.start;
    if (!start) return;
    const id = setTimeout(() => finish(typedRef.current), Math.max(0, config.length * 1000 - (Date.now() - start)));
    return () => clearTimeout(id);
  }, [started, finished, config.mode, config.length, finish]);

  // Keep the caret in view as the typist advances (long targets / time mode).
  useEffect(() => {
    caretRef.current?.scrollIntoView({ block: "nearest" });
  }, [typed, target]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const lengthOptions = config.mode === "time" ? TIME_LENGTHS : config.mode === "words" ? WORD_LENGTHS : [];
  const DRILLS: { id: DrillId; label: string }[] = [
    { id: "bv", label: "b / v" }, { id: "home", label: "home row" }, { id: "rhythm", label: "rhythm" }, { id: "weak", label: "my weak keys" },
  ];

  const chipBase = "px-2 py-0.5 rounded-md text-[11px] transition-colors";
  const chip = (active: boolean) =>
    `${chipBase} ${active ? `bg-black/10 dark:bg-white/15 ${c.text}` : `${c.label} opacity-50 hover:opacity-90`}`;

  return (
    <div
      className={`rounded-2xl border h-full relative group flex flex-col p-5 ${c.bg} ${c.border} ${c.glow} ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2 shrink-0 gap-2">
        <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
          <span className="opacity-50"><Keyboard size={14} /></span>
          <span className="text-xs font-medium opacity-60 truncate">{widget.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stats.best > 0 && <span className={`text-[10px] tabular-nums opacity-50 ${c.text}`}>best {stats.best}</span>}
          <button
            onClick={() => { reset(configRef.current); fieldRef.current?.focus(); }}
            title="Restart (Tab)"
            className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`}
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* Config bar */}
      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-3 shrink-0">
        {(["words", "time", "drill"] as Mode[]).map(m => (
          <button key={m} onClick={() => applyConfig({ ...config, mode: m })} className={chip(config.mode === m)}>{m}</button>
        ))}
        <span className={`opacity-20 ${c.label}`}>|</span>
        {lengthOptions.map(n => (
          <button key={n} onClick={() => applyConfig({ ...config, length: n })} className={chip(config.length === n)}>{n}</button>
        ))}
        {config.mode === "drill" && DRILLS.map(d => (
          <button key={d.id} onClick={() => applyConfig({ ...config, drill: d.id })} className={chip(config.drill === d.id)}>{d.label}</button>
        ))}
      </div>

      {/* Body */}
      <div
        ref={fieldRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="flex-1 min-h-0 outline-none relative cursor-text overflow-y-auto"
      >
        {!loaded ? null : finished && result ? (
          <Results c={c} r={result} onRestart={() => { reset(configRef.current); fieldRef.current?.focus(); }} onPracticeWeak={() => applyConfig({ ...config, mode: "drill", drill: "weak" })} />
        ) : (
          <div className="relative">
            <p className={`font-mono text-[15px] leading-8 tracking-wide break-words whitespace-pre-wrap select-none transition-opacity ${focused ? "" : "opacity-50 blur-[1.5px]"}`}>
              {target.split("").map((ch, i) => {
                const t = typed[i];
                const isCaret = i === typed.length;
                let cls = isCaret ? `opacity-100 ${c.text}` : `opacity-30 ${c.text}`;
                if (i < typed.length) cls = t === ch ? `opacity-100 ${c.text}` : "opacity-100 text-red-500 dark:text-red-400 underline decoration-red-500/50";
                return (
                  <span key={i} className={`${cls} ${isCaret ? "relative before:absolute before:-left-px before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-current before:animate-pulse" : ""}`} ref={isCaret ? caretRef : undefined}>
                    {ch === " " ? " " : ch}
                  </span>
                );
              })}
              {typed.length >= target.length && target.length > 0 && (
                <span ref={caretRef} className="relative before:absolute before:-left-px before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-current before:animate-pulse">&nbsp;</span>
              )}
            </p>

            {!focused && (
              <button
                onClick={() => fieldRef.current?.focus()}
                className={`absolute inset-0 flex items-center justify-center text-xs ${c.label} opacity-80`}
              >
                click here, then type
              </button>
            )}
          </div>
        )}
      </div>

      {/* Live footer */}
      {!finished && started && (
        <div className={`shrink-0 mt-2 flex items-center gap-3 text-[11px] tabular-nums opacity-60 ${c.text}`}>
          {config.mode === "time" && runRef.current.start
            ? <Countdown endsAt={runRef.current.start + config.length * 1000} />
            : <span>{typed.length}/{target.length}</span>}
        </div>
      )}
    </div>
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
      <div className="flex items-end gap-5">
        <div>
          <div className={`text-3xl font-semibold tabular-nums leading-none ${c.text}`}>{r.wpm}</div>
          <div className={`text-[10px] uppercase tracking-widest opacity-40 mt-1 ${c.label}`}>wpm</div>
        </div>
        <div>
          <div className={`text-3xl font-semibold tabular-nums leading-none ${r.acc >= 97 ? "text-emerald-600 dark:text-emerald-400" : r.acc >= 90 ? c.text : "text-red-500 dark:text-red-400"}`}>{r.acc}%</div>
          <div className={`text-[10px] uppercase tracking-widest opacity-40 mt-1 ${c.label}`}>accuracy</div>
        </div>
        <div className={`text-[11px] tabular-nums opacity-55 leading-5 ${c.text}`}>
          <div>raw {r.raw}</div>
          <div>{r.seconds}s</div>
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
