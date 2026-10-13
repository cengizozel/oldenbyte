# Typing Widget

A Monkeytype-style typing trainer. It shows three lines of text at a time, tracks which keys you miss and how you slip, and can drill exactly those keys.

## Storage Keys

| Key | Value |
|---|---|
| `typing-config-{id}` | JSON `Config`: `mode`, `length`, `drill`, `custom`, `customScramble`, `customWords`, `pool`, `countdown`, `bpm`, `sound`, `dynamic`, `endless` |
| `typing-stats-{id}` | JSON: `{ best, runs, keyHit, keyMiss }` - best wpm, run count, and per-key hit/miss counts across runs |

## Input

Input is word-based. You type a word and **Space** commits it and moves to the next one; letters you skipped count as missed, and extra letters past the end of the word show in dark red. Backspace only reaches back into the previous word when that word has a mistake. Only three lines show: once the caret passes the first line it stays on the second and finished lines scroll up out of view. **Tab** or **Escape** restarts from anywhere; an idle Escape closes the expanded view.

An optional get-ready countdown (off, 3 or 5 seconds) runs before each test.

## Modes

- **words** - a fixed test of 10, 25 or 50 words
- **time** - 15, 30 or 60 seconds; words keep refilling ahead of you
- **drill** - targeted practice:
  - **custom** - your own letters (`zxc` by default), as random combos of just those keys and/or real words containing them
  - **home row** - home-row patterns
  - **rhythm** - common words, each repeated three times
  - **my weak keys** - the keys you miss most (by miss rate, from `typing-stats`); falls back to the custom letters until enough is learned
- **metro** - a metronome mode: strike a key on each beat at a BPM you set (40 to 300), over 15, 25 or 40 words or endless. With **dynamic** tempo, a run of correct, on-beat strikes raises the BPM and a run of misses lowers it.

Words, time and metro draw from one of two vocabularies: **simple** (the classic 200 most common English words, `lib/simpleWords.ts`) or **varied** (the top 1000 of the frequency-ranked list in `lib/typingWords.ts`). Letter-matching drills search the full list.

## Results

At the end of a run the widget shows wpm, raw wpm, accuracy, time and the character breakdown, a personal-best flag, how your mistakes split between neighbour-key reaches and transpositions, and your weakest keys with a button to practise them. Metro runs add the share of strikes on the beat, the average distance from the beat and, with dynamic tempo, the peak BPM.

The numbers are counted the way Monkeytype counts them (see the `tally` comment in `components/TypingWidget.tsx`). Every word is compared together with the space after it:

- **Characters** - correct, incorrect, extra and missed. A matching letter is correct; the space after a word is correct only when the whole word is, otherwise it counts as extra. Letters typed past the end of a word are extra, other mismatches are incorrect, and target letters never typed are missed (in timed runs the unfinished last word misses nothing).
- **wpm** - characters of fully correct words with their spaces (plus the correct prefix of the active word in timed runs), divided by 5, per minute.
- **raw** - everything typed (correct + incorrect + extra), divided by 5, per minute.
- **accuracy** - correct keystrokes over all keystrokes. A space only counts as correct where a space belongs: right after a word's last letter, and not after a fixed test's final word.

## Display

The expand toggle floats the trainer over a dimmed backdrop at 80% of the screen. A live wpm counter runs during a test, and the header shows your best wpm. Not digestable.

(component: `components/TypingWidget.tsx`)
