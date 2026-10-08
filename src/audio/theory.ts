/**
 * Music theory for the score: modes, chord symbols, melody notation, voicing
 * and a small seeded random source. Pure functions, no Web Audio.
 *
 * Melody notation (durations in sixteenths, bar lines are checked):
 *   "1:6 5:2 6:4 5:4 | 3:12 2:4"
 *   degree 1-7 in the current mode, optional b/# prefix, ' up and , down an
 *   octave, r for a rest.
 *
 * Chord notation (durations in sixteenths, default the whole bar):
 *   "1 | 6:12 5/7:4 | 4.9 | 5.s4:8 5:8 | b7M | 4m.7"
 *   degree in the mode (diatonic triad), optional b/# root and M/m/o/+ for an
 *   explicit quality, extensions .7 .M7 .9 .6 .s4 .s2, /d for the bass degree.
 */

export type ModeName = "ionian" | "dorian" | "lydian" | "mixolydian" | "aeolian";

export const MODES: Record<ModeName, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};

export type MeterName = "4/4" | "3/4" | "6/8";
export type Meter = {
  name: MeterName;
  barTicks: number;
  /** Sixteenths per counted beat (the bpm unit). */
  beatTicks: number;
  /** Ticks that carry a strong accent. */
  strong: number[];
};

export const METERS: Record<MeterName, Meter> = {
  "4/4": { name: "4/4", barTicks: 16, beatTicks: 4, strong: [0, 8] },
  "3/4": { name: "3/4", barTicks: 12, beatTicks: 4, strong: [0] },
  "6/8": { name: "6/8", barTicks: 12, beatTicks: 6, strong: [0, 6] },
};

export type Key = { tonic: number; mode: ModeName };

/** Semitones above the tonic for a 1-based degree (may exceed 7 or go below 1). */
export function degreeSemis(mode: ModeName, degree: number, acc = 0) {
  const d = degree - 1;
  const oct = Math.floor(d / 7);
  const i = ((d % 7) + 7) % 7;
  return MODES[mode][i] + 12 * oct + acc;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const mod12 = (n: number) => ((n % 12) + 12) % 12;

// ------------------------------------------------------------------ chords

export type ChordTone = "r" | "3" | "5" | "7" | "9" | "6";
export type Chord = {
  sym: string;
  /** Root in semitones above the key tonic, 0..11. */
  root: number;
  /** Intervals above the root, by function. */
  tones: { fn: ChordTone; semis: number }[];
  /** Bass pitch class above the key tonic, 0..11. */
  bass: number;
  minor: boolean;
};

const QUALITY: Record<string, number[]> = {
  M: [0, 4, 7],
  m: [0, 3, 7],
  o: [0, 3, 6],
  "+": [0, 4, 8],
};

const CHORD_RE = /^([b#]?)([1-7])([Mmo+]?)((?:\.(?:M7|7|9|6|s4|s2))*)(?:\/([b#]?)([1-7]))?$/;

export function parseChord(sym: string, mode: ModeName): Chord {
  const m = CHORD_RE.exec(sym);
  if (!m) throw new Error(`Bad chord "${sym}"`);
  const acc = m[1] === "b" ? -1 : m[1] === "#" ? 1 : 0;
  const deg = Number(m[2]);
  const quality = m[3] || (acc ? "M" : "");
  const exts = m[4] ? m[4].split(".").filter(Boolean) : [];
  const rootSemis = degreeSemis(mode, deg) + acc;
  const diatonic = (steps: number) => degreeSemis(mode, deg + steps) - degreeSemis(mode, deg);
  let third: number, fifth: number;
  if (quality) {
    [, third, fifth] = QUALITY[quality];
  } else {
    third = diatonic(2);
    fifth = diatonic(4);
  }
  const tones: Chord["tones"] = [{ fn: "r", semis: 0 }];
  let thirdTone: { fn: ChordTone; semis: number } = { fn: "3", semis: third };
  for (const e of exts) {
    if (e === "s4") thirdTone = { fn: "3", semis: quality ? 5 : diatonic(3) };
    if (e === "s2") thirdTone = { fn: "3", semis: quality ? 2 : diatonic(1) };
  }
  tones.push(thirdTone, { fn: "5", semis: fifth });
  for (const e of exts) {
    if (e === "7") tones.push({ fn: "7", semis: quality ? (quality === "o" ? 10 : 10) : diatonic(6) });
    if (e === "M7") tones.push({ fn: "7", semis: 11 });
    if (e === "9") tones.push({ fn: "9", semis: (quality ? 2 : diatonic(1)) + 12 });
    if (e === "6") tones.push({ fn: "6", semis: quality ? 9 : diatonic(5) });
  }
  let bass = rootSemis;
  if (m[6]) {
    const bacc = m[5] === "b" ? -1 : m[5] === "#" ? 1 : 0;
    bass = degreeSemis(mode, Number(m[6])) + bacc;
  }
  return {
    sym,
    root: mod12(rootSemis),
    tones,
    bass: mod12(bass),
    minor: mod12(thirdTone.semis) === 3,
  };
}

/** Pitch classes (relative to the key tonic) of a chord. */
export const chordPcs = (c: Chord) => c.tones.map((t) => mod12(c.root + t.semis));

export type ChordSpan = { chord: Chord; start: number; dur: number };

/** Parse a progression into per-bar chord spans. */
export function parseProgression(src: string, mode: ModeName, barTicks: number): ChordSpan[][] {
  return src
    .split("|")
    .map((b) => b.trim())
    .filter((b) => b.length)
    .map((bar) => {
      const toks = bar.split(/\s+/);
      const spans: ChordSpan[] = [];
      let t = 0;
      const explicit = toks.map((tok) => (tok.includes(":") ? Number(tok.split(":")[1]) : 0));
      const used = explicit.reduce((a, b) => a + b, 0);
      const free = toks.filter((_, i) => !explicit[i]).length;
      for (let i = 0; i < toks.length; i++) {
        const sym = toks[i].split(":")[0];
        const dur = explicit[i] || (barTicks - used) / free;
        spans.push({ chord: parseChord(sym, mode), start: t, dur });
        t += dur;
      }
      if (Math.abs(t - barTicks) > 1e-6) throw new Error(`Chord bar "${bar}" is ${t} ticks, expected ${barTicks}`);
      return spans;
    });
}

// ----------------------------------------------------------------- melody

export type MelodyNote = {
  /** Semitones above the melody tonic, or null for a rest. */
  semis: number | null;
  start: number;
  dur: number;
  /** Scale degree (1-based, octave folded in) for diatonic transformations. */
  degree: number;
};

const NOTE_RE = /^([b#]?)([1-7r])(['",]*):(\d+)$/;

export function parseMelody(src: string, mode: ModeName, barTicks: number): MelodyNote[] {
  const out: MelodyNote[] = [];
  let t = 0;
  for (const tok of src.split(/\s+/).filter(Boolean)) {
    if (tok === "|") {
      if (t % barTicks !== 0) throw new Error(`Melody bar line at tick ${t} in "${src}"`);
      continue;
    }
    const m = NOTE_RE.exec(tok);
    if (!m) throw new Error(`Bad note "${tok}"`);
    const dur = Number(m[4]);
    if (m[2] === "r") {
      out.push({ semis: null, start: t, dur, degree: 0 });
    } else {
      const acc = m[1] === "b" ? -1 : m[1] === "#" ? 1 : 0;
      let oct = 0;
      for (const c of m[3]) oct += c === "," ? -1 : 1;
      const degree = Number(m[2]) + 7 * oct;
      out.push({ semis: degreeSemis(mode, degree, acc), start: t, dur, degree });
    }
    t += dur;
  }
  if (t % barTicks !== 0) throw new Error(`Melody length ${t} is not whole bars in "${src}"`);
  return out;
}

// ---------------------------------------------------------------- voicing

/**
 * Choose a close or open voicing of `count` notes for a chord in [lo, hi],
 * leading smoothly from the previous voicing.
 */
export function voiceChord(
  pcsAbs: number[],
  fns: ChordTone[],
  prev: number[] | null,
  lo: number,
  hi: number,
  count: number,
): number[] {
  // Priority: third, seventh, ninth/sixth, fifth, root.
  const order: ChordTone[] = ["3", "7", "9", "6", "5", "r"];
  const ranked = order
    .flatMap((fn) => fns.map((f, i) => (f === fn ? mod12(pcsAbs[i]) : -1)).filter((v) => v >= 0))
    .filter((v, i, a) => a.indexOf(v) === i);
  const root = fns.indexOf("r") >= 0 ? mod12(pcsAbs[fns.indexOf("r")]) : ranked[ranked.length - 1];
  const fifth = fns.indexOf("5") >= 0 ? mod12(pcsAbs[fns.indexOf("5")]) : root;
  // Candidate note sets: the most important tones, doubling the root or the fifth if needed.
  const sets: number[][] = [];
  const base = ranked.slice(0, Math.min(count, ranked.length));
  if (base.length >= count) sets.push(base);
  else {
    for (const dbl of [root, fifth, ranked[0]]) {
      const s = [...base];
      while (s.length < count) s.push(dbl);
      sets.push(s);
    }
  }
  if (count > 3) sets.push(ranked.slice(0, 3));
  const center = (lo + hi) / 2;
  let best: number[] = [];
  let bestCost = Infinity;
  for (const chosen of sets) {
    const n = chosen.length;
    for (const perm of permutations(chosen)) {
      for (let b = lo - 12; b <= hi; b++) {
        if (mod12(b) !== perm[0]) continue;
        const v = [b];
        for (let i = 1; i < n; i++) {
          let p = v[i - 1] + 1;
          while (mod12(p) !== perm[i]) p++;
          v.push(p);
        }
        for (const variant of [v, dropTwo(v)]) {
          const s = [...variant].sort((x, y) => x - y);
          if (s[0] < lo || s[s.length - 1] > hi) continue;
          if (s.some((x, i) => i > 0 && x === s[i - 1])) continue;
          let cost = 0;
          if (prev && prev.length) {
            const pv = [...prev].sort((x, y) => x - y);
            for (let i = 0; i < s.length; i++) cost += Math.abs(s[i] - pv[Math.min(i, pv.length - 1)]);
          } else cost += Math.abs((s[0] + s[s.length - 1]) / 2 - center) * 0.5;
          // Avoid muddy close intervals low down, and prefer full voicings.
          for (let i = 1; i < s.length; i++) {
            if (s[i] - s[i - 1] < 3 && s[i] < 55) cost += 4;
            if (s[i] - s[i - 1] === 1) cost += 9;
          }
          cost += Math.abs((s[0] + s[s.length - 1]) / 2 - center) * 0.15;
          cost += (count - s.length) * 3;
          if (cost < bestCost) {
            bestCost = cost;
            best = s;
          }
        }
      }
    }
  }
  if (!best.length) {
    // Fallback: the chord tones in close position from the bottom of the range.
    best = ranked.slice(0, 3).map((pc) => lo + mod12(pc - lo)).sort((x, y) => x - y);
  }
  return best;
}

function dropTwo(v: number[]) {
  if (v.length < 4) return v;
  const s = [...v].sort((a, b) => a - b);
  s[s.length - 2] -= 12;
  return s.sort((a, b) => a - b);
}

function permutations(a: number[]): number[][] {
  if (a.length <= 1) return [a];
  const out: number[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < a.length; i++) {
    for (const rest of permutations([...a.slice(0, i), ...a.slice(i + 1)])) {
      const p = [a[i], ...rest];
      const k = p.join(",");
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    }
  }
  return out;
}

/** Nearest pitch with pitch class pc to a target. */
export function nearest(pc: number, target: number) {
  const base = target - mod12(target - pc);
  return target - base > 6 ? base + 12 : base;
}

/** Highest pitch with pitch class pc that is <= limit. */
export function below(pc: number, limit: number) {
  return limit - mod12(limit - pc);
}

// ------------------------------------------------------------------- random

export function hash(...parts: (number | string)[]) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export type Rng = {
  (): number;
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  pick<T>(a: readonly T[]): T;
  chance(p: number): boolean;
};

export function rng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  const next = (() => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  next.pick = (a) => a[Math.floor(next() * a.length)];
  next.chance = (p) => next() < p;
  return next;
}
