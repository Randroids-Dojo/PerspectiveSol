import type { ArpStyle, BassStyle, CueDef, FormEntry, LeadI, LeadS, PercStyle } from "./score";
import {
  METERS,
  MODES,
  chordPcs,
  degreeSemis,
  hash,
  mod12,
  nearest,
  parseMelody,
  parseProgression,
  rng,
  voiceChord,
  type ChordSpan,
  type ChordTone,
  type Key,
  type MelodyNote,
  type Meter,
  type ModeName,
  type Rng,
} from "./theory";

/**
 * Turns a cue's score into bars of abstract note events. Every event names the
 * instrument that plays it in each arrangement, so the sculpted and illustrated
 * versions share every note and every onset. Variation is seeded by the pass
 * number, so repeats differ but a given bar of a given pass is reproducible.
 */

export type InstName =
  | "piano"
  | "pad"
  | "bass"
  | "strings"
  | "celesta"
  | "harp"
  | "pizz"
  | "flute"
  | "harmonium"
  | "glass"
  | "kit";

export type Role =
  | "lead"
  | "double"
  | "counter"
  | "arp"
  | "pad"
  | "bass"
  | "swell"
  | "sparkle"
  | "perc"
  | "shimmer"
  | "halo";

export type PercHit = "low" | "mid" | "high" | "swish" | "ghost" | "roll";

export type NoteEvent = {
  /** Sixteenths from the bar start. */
  tick: number;
  /** Written length in sixteenths. */
  dur: number;
  role: Role;
  midi: number;
  vel: number;
  s: InstName;
  i: InstName;
  hit?: PercHit;
  /** Timing offset in seconds (humanising, rolled chords, grace notes). */
  shift?: number;
  /** Crescendo-decrescendo articulation for sustained instruments. */
  swell?: boolean;
};

export type ChordInfo = {
  tick: number;
  dur: number;
  /** Absolute pitch classes. */
  pcs: number[];
  root: number;
  bass: number;
};

export type Bar = {
  events: NoteEvent[];
  barTicks: number;
  secPerTick: number;
  key: Key;
  chords: ChordInfo[];
  section: string;
  energy: number;
  pass: number;
  barInSection: number;
  sectionBars: number;
  index: number;
};

type Parsed = { chords: ChordSpan[][]; melody: MelodyNote[] | null };

type Instance = {
  entry: FormEntry;
  formIndex: number;
  parsed: Parsed;
  key: Key;
  mode: ModeName;
  melodyTonic: number;
  melody: MelodyNote[] | null;
  leadS: LeadS;
  leadI: LeadI;
  arp: ArpStyle;
  arpVariant: number;
  bass: BassStyle;
  perc: PercStyle | "none";
  energy: number;
  vary: number;
  bars: number;
  rng: Rng;
};

const ARPS: Record<ArpStyle, { ticks: number[]; variants: number[][]; ring?: number; chord?: boolean; roll?: boolean }> = {
  flow8: {
    ticks: [0, 2, 4, 6, 8, 10, 12, 14],
    variants: [
      [0, 2, 3, 4, 5, 4, 3, 2],
      [0, 3, 4, 5, 6, 5, 4, 3],
      [0, 2, 4, 3, 5, 4, 3, 2],
      [0, 1, 2, 3, 4, 3, 2, 1],
    ],
  },
  pastoral: {
    ticks: [0, 2, 4, 6, 8, 10],
    variants: [
      [0, 2, 3, 4, 3, 2],
      [0, 2, 4, 5, 4, 2],
      [0, 3, 4, 5, 4, 3],
    ],
  },
  waltzStab: {
    ticks: [4, 8],
    variants: [
      [2, 3, 4],
      [3, 4, 5],
    ],
    chord: true,
  },
  waltzFlow: {
    ticks: [0, 2, 4, 6, 8, 10],
    variants: [
      [0, 2, 3, 4, 3, 2],
      [0, 3, 4, 5, 4, 3],
      [0, 2, 4, 5, 4, 2],
    ],
  },
  ostinato16: {
    ticks: Array.from({ length: 16 }, (_, i) => i),
    variants: [
      [2, 4, 3, 5, 2, 4, 3, 5, 2, 4, 3, 5, 2, 4, 3, 6],
      [2, 3, 4, 5, 4, 3, 2, 3, 2, 3, 4, 5, 6, 5, 4, 3],
      [3, 5, 4, 6, 3, 5, 4, 6, 2, 4, 3, 5, 2, 4, 3, 5],
    ],
  },
  sparse4: {
    ticks: [0, 4, 8, 12],
    variants: [
      [0, 3, 5, 4],
      [0, 4, 6, 5],
      [1, 3, 5, 6],
    ],
    ring: 8,
  },
  hymn: {
    ticks: [0, 8],
    variants: [
      [0, 1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5, 6],
    ],
    chord: true,
    roll: true,
  },
};

type Hit = [tick: number, hit: PercHit, vel: number, minEnergy: number];
const PERC: Record<PercStyle, Hit[]> = {
  soft44: [
    [0, "low", 0.5, 0.62],
    [4, "swish", 0.34, 0.55],
    [12, "swish", 0.34, 0.55],
    [8, "low", 0.28, 0.88],
    [2, "high", 0.16, 0.8],
    [6, "high", 0.16, 0.8],
    [10, "high", 0.16, 0.8],
    [14, "high", 0.16, 0.8],
    [7, "ghost", 0.12, 0.9],
  ],
  pastoral68: [
    [0, "low", 0.5, 0.55],
    [6, "mid", 0.3, 0.6],
    [0, "high", 0.22, 0.7],
    [2, "high", 0.16, 0.7],
    [4, "high", 0.16, 0.7],
    [6, "high", 0.2, 0.7],
    [8, "high", 0.16, 0.7],
    [10, "high", 0.16, 0.7],
    [10, "ghost", 0.12, 0.85],
  ],
  dance34: [
    [0, "low", 0.55, 0.55],
    [4, "mid", 0.34, 0.58],
    [8, "mid", 0.3, 0.58],
    [2, "high", 0.18, 0.7],
    [6, "high", 0.18, 0.7],
    [10, "high", 0.18, 0.7],
    [11, "ghost", 0.12, 0.85],
  ],
  clock44: [
    ...Array.from({ length: 16 }, (_, i): Hit => [i, "high", i % 4 === 0 ? 0.17 : 0.09, 0.5]),
    [0, "low", 0.5, 0.55],
    [10, "low", 0.34, 0.7],
    [4, "mid", 0.3, 0.62],
    [12, "mid", 0.3, 0.62],
    [7, "ghost", 0.12, 0.85],
  ],
  waltz34: [
    [0, "low", 0.45, 0.55],
    [4, "ghost", 0.2, 0.6],
    [8, "ghost", 0.18, 0.6],
    [4, "swish", 0.28, 0.72],
  ],
  night44: [
    [0, "low", 0.36, 0.55],
    [8, "swish", 0.24, 0.6],
    [6, "high", 0.1, 0.66],
    [14, "high", 0.1, 0.66],
  ],
  march44: [
    [0, "low", 0.6, 0.55],
    [8, "low", 0.45, 0.65],
    [6, "low", 0.28, 0.85],
    [4, "mid", 0.44, 0.6],
    [12, "mid", 0.44, 0.6],
    [0, "high", 0.2, 0.7],
    [2, "high", 0.18, 0.7],
    [4, "high", 0.2, 0.7],
    [6, "high", 0.18, 0.7],
    [8, "high", 0.2, 0.7],
    [10, "high", 0.18, 0.7],
    [12, "high", 0.2, 0.7],
    [14, "high", 0.18, 0.7],
    [3, "ghost", 0.12, 0.9],
    [11, "ghost", 0.12, 0.9],
  ],
};

/** Slow motif statement for bars without a melody; quick echo otherwise. */
const MOTIF_RHYTHM: Record<string, { slow: [number, number][]; echo: [number, number][] }> = {
  "4/4": {
    slow: [
      [0, 6],
      [6, 2],
      [8, 4],
      [12, 4],
    ],
    echo: [
      [8, 3],
      [11, 1],
      [12, 2],
      [14, 2],
    ],
  },
  "3/4": {
    slow: [
      [0, 4],
      [4, 2],
      [6, 2],
      [8, 4],
    ],
    echo: [
      [4, 3],
      [7, 1],
      [8, 2],
      [10, 2],
    ],
  },
  "6/8": {
    slow: [
      [0, 4],
      [4, 2],
      [6, 4],
      [10, 2],
    ],
    echo: [
      [6, 3],
      [9, 1],
      [10, 2],
    ],
  },
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Composer {
  readonly def: CueDef;
  readonly meter: Meter;
  readonly secPerTick: number;
  pass = 0;
  barIndex = 0;
  private pos = -1;
  private intro = true;
  private bar = 0;
  private inst!: Instance;
  private prevPad: number[] | null = null;
  private prevCounter: number | null = null;
  private prevBass: number | null = null;
  private prevShimmer: number | null = null;
  private prevBassChord = -1;
  private cache = new Map<string, Parsed>();
  /** Accompaniment registers. */
  private reg: number;

  constructor(def: CueDef) {
    this.def = def;
    this.meter = METERS[def.meter];
    this.secPerTick = 60 / def.bpm / this.meter.beatTicks;
    this.reg = clamp(def.melodyBase, 70, 76);
    this.advance();
  }

  get barSeconds() {
    return this.meter.barTicks * this.secPerTick;
  }

  /** Current section key, for tuning effects. */
  get key(): Key {
    return this.inst.key;
  }

  private plan(): FormEntry[] {
    return this.intro ? this.def.intro : this.def.loop[this.pass % this.def.loop.length];
  }

  private parse(sec: string, mode: ModeName): Parsed {
    const k = `${sec}|${mode}`;
    let p = this.cache.get(k);
    if (!p) {
      const s = this.def.sections[sec];
      p = {
        chords: parseProgression(s.chords, mode, this.meter.barTicks),
        melody: s.melody ? parseMelody(s.melody, mode, this.meter.barTicks) : null,
      };
      this.cache.set(k, p);
    }
    return p;
  }

  private advance() {
    this.pos++;
    let plan = this.plan();
    if (this.pos >= plan.length) {
      if (this.intro) this.intro = false;
      else this.pass++;
      this.pos = 0;
      plan = this.plan();
    }
    const entry = plan[this.pos];
    const mode = entry.mode ?? this.def.mode;
    const parsed = this.parse(entry.sec, mode);
    const shift = entry.key ?? 0;
    let melodyTonic = this.def.melodyBase + shift;
    while (melodyTonic - this.def.melodyBase > 6) melodyTonic -= 12;
    while (melodyTonic - this.def.melodyBase < -6) melodyTonic += 12;
    const r = rng(hash(this.def.seed, this.pass, this.pos, this.intro ? "i" : "l", entry.sec));
    const vary = entry.vary ?? (this.pass > 0 ? 0.35 : 0);
    const arp = entry.arp ?? this.def.arp;
    const inst: Instance = {
      entry,
      formIndex: this.pos,
      parsed,
      key: { tonic: mod12(this.def.tonic + shift), mode },
      mode,
      melodyTonic,
      melody: null,
      leadS: entry.lead?.[0] ?? "piano",
      leadI: entry.lead?.[1] ?? "flute",
      arp,
      arpVariant: r.int(0, ARPS[arp].variants.length - 1),
      bass: entry.bass ?? this.def.bass,
      perc: entry.perc ?? this.def.perc,
      energy: entry.energy,
      vary,
      bars: parsed.chords.length,
      rng: r,
    };
    if (this.pos === 0 && !this.intro && this.pass % 2 === 0) inst.arpVariant = 0;
    inst.melody = parsed.melody ? this.vary(parsed.melody, inst) : null;
    this.inst = inst;
    this.bar = 0;
  }

  /** Seeded melodic variation: passing tones, neighbours and anticipations. */
  private vary(notes: MelodyNote[], inst: Instance): MelodyNote[] {
    if (inst.vary <= 0) return notes;
    const r = inst.rng;
    const out: MelodyNote[] = [];
    const T = this.meter.barTicks;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const next = notes[i + 1];
      if (
        n.semis !== null &&
        next &&
        next.semis !== null &&
        n.dur >= 8 &&
        r.chance(0.42 * inst.vary)
      ) {
        const tail = n.dur >= 12 && r.chance(0.5) ? 4 : 2;
        const dn = n.degree;
        const dt = next.degree;
        let deg: number;
        if (dt - dn >= 2) deg = dt - 1;
        else if (dn - dt >= 2) deg = dt + 1;
        else if (dt === dn) deg = dn + 1;
        else deg = dt;
        const semis = degreeSemis(inst.mode, deg);
        const at = n.start + n.dur - tail;
        // Keep the added note consonant with the harmony under it.
        const span = this.spanAt(inst.parsed, at);
        const pcs = chordPcs(span.chord);
        const pc = mod12(semis);
        const rub = pcs.some((c) => {
          const d = mod12(pc - c);
          return d === 1 || d === 11;
        });
        // Notes written with accidentals keep their colour.
        const alteredNear =
          n.semis !== degreeSemis(inst.mode, n.degree) || next.semis !== degreeSemis(inst.mode, next.degree);
        if ((!rub || pcs.includes(pc)) && !alteredNear && Math.floor(at / T) === Math.floor(n.start / T)) {
          out.push({ ...n, dur: n.dur - tail });
          out.push({ semis, start: at, dur: tail, degree: deg });
          continue;
        }
      }
      out.push(n);
    }
    return out;
  }

  private spanAt(p: Parsed, tick: number) {
    const T = this.meter.barTicks;
    const bar = p.chords[Math.floor(tick / T) % p.chords.length];
    const t = tick % T;
    return bar.find((s) => t >= s.start && t < s.start + s.dur) ?? bar[0];
  }

  /** Energy of the section after the current one, for transitions. */
  private peekNextEnergy() {
    if (this.bar < this.inst.bars - 1) return this.inst.energy;
    const plan = this.plan();
    if (this.pos + 1 < plan.length) return plan[this.pos + 1].energy;
    const next = this.intro ? this.def.loop[0] : this.def.loop[(this.pass + 1) % this.def.loop.length];
    return next[0].energy;
  }

  /** Root of the first chord of the next bar, absolute pitch class. */
  private peekNextRoot(): number {
    if (this.bar < this.inst.bars - 1) {
      const sp = this.inst.parsed.chords[this.bar + 1][0];
      return mod12(this.inst.key.tonic + sp.chord.bass);
    }
    const plan = this.plan();
    let entry: FormEntry;
    if (this.pos + 1 < plan.length) entry = plan[this.pos + 1];
    else entry = (this.intro ? this.def.loop[0] : this.def.loop[(this.pass + 1) % this.def.loop.length])[0];
    const mode = entry.mode ?? this.def.mode;
    const sp = this.parse(entry.sec, mode).chords[0][0];
    return mod12(this.def.tonic + (entry.key ?? 0) + sp.chord.bass);
  }

  /** Compose the next bar. */
  next(radiant = false): Bar {
    if (this.bar >= this.inst.bars) this.advance();
    const inst = this.inst;
    const T = this.meter.barTicks;
    const b = this.bar;
    const E = inst.energy;
    const r = rng(hash(this.def.seed, "bar", this.pass, inst.formIndex, this.intro ? 1 : 0, b));
    const spans = inst.parsed.chords[b];
    const tonic = inst.key.tonic;
    const mb = this.def.melodyBase;
    const reg = this.reg;
    const dyn = 0.62 + 0.38 * E;
    const events: NoteEvent[] = [];
    const human = (s = 0.008) => (r() * 2 - 1) * s;
    const chords: ChordInfo[] = spans.map((sp) => ({
      tick: sp.start,
      dur: sp.dur,
      pcs: chordPcs(sp.chord).map((p) => mod12(p + tonic)),
      root: mod12(sp.chord.root + tonic),
      bass: mod12(sp.chord.bass + tonic),
    }));
    const fnsOf = (sp: ChordSpan): ChordTone[] => sp.chord.tones.map((t) => t.fn);

    // Melody notes that begin in this bar.
    const barStart = b * T;
    const mel = inst.melody?.filter((n) => n.start >= barStart && n.start < barStart + T) ?? [];
    const sounding = (tick: number) =>
      inst.melody?.find((n) => n.semis !== null && n.start <= barStart + tick && n.start + n.dur > barStart + tick);
    const hasLead = !!inst.melody && E >= 0.3;
    const phrasePos = (tick: number) => (b + tick / T) / inst.bars;

    // ---- lead and doubling
    if (hasLead)
      for (const n of mel) {
        if (n.semis === null) continue;
        const tick = n.start - barStart;
        const midi = inst.melodyTonic + n.semis;
        const strong = this.meter.strong.includes(tick) ? 1 : 0.93;
        const shape = 0.88 + 0.12 * Math.sin(Math.PI * phrasePos(tick));
        const vel = clamp(0.8 * dyn * strong * shape + human(0.04), 0.1, 1);
        events.push({ tick, dur: n.dur, role: "lead", midi, vel, s: inst.leadS, i: inst.leadI, shift: human(0.006) });
        // A grace note from the upper neighbour, sometimes.
        if (
          inst.vary > 0 &&
          n.dur >= 6 &&
          n.semis === degreeSemis(inst.mode, n.degree) &&
          r.chance(0.16 * inst.vary)
        ) {
          const g = inst.melodyTonic + degreeSemis(inst.mode, n.degree + 1);
          events.push({ tick, dur: 0.6, role: "lead", midi: g, vel: vel * 0.55, s: inst.leadS, i: inst.leadI, shift: -0.075 });
        }
        if (E >= 0.9 && midi - 12 >= 55)
          events.push({ tick, dur: n.dur, role: "double", midi: midi - 12, vel: vel * 0.6, s: "strings", i: "harmonium" });
      }

    // ---- pad (sustained harmony)
    const padNotes: number[][] = [];
    for (let si = 0; si < spans.length; si++) {
      const sp = spans[si];
      const v = voiceChord(chords[si].pcs, fnsOf(sp), this.prevPad, reg - 21, reg - 2, E < 0.4 ? 3 : 4);
      this.prevPad = v;
      padNotes.push(v);
      for (const m of v)
        events.push({ tick: sp.start, dur: sp.dur, role: "pad", midi: m, vel: 0.5 * dyn, s: "pad", i: "harmonium" });
    }

    // ---- arpeggio
    const style = ARPS[inst.arp];
    const pattern = style.variants[(inst.arpVariant + (inst.vary > 0.5 && b % 4 === 3 ? 1 : 0)) % style.variants.length];
    const arpI: InstName = this.def.id === "2" ? "celesta" : "harp";
    const thin = E < 0.35;
    for (let k = 0; k < style.ticks.length; k++) {
      const tick = style.ticks[k];
      if (tick >= T) continue;
      if (thin && !style.chord && tick % (inst.arp === "ostinato16" ? 2 : 4) !== 0) continue;
      const si = spans.findIndex((s) => tick >= s.start && tick < s.start + s.dur);
      const sp = spans[si];
      const lad = ladder(chords[si], reg - 26, reg + 1);
      const end = sp.start + sp.dur;
      const nextTick = style.ticks[k + 1] ?? T;
      const ring = Math.min(end, Math.max(nextTick, tick + (style.ring ?? 6))) - tick;
      const accent = tick % this.meter.beatTicks === 0 ? 1 : 0.86;
      const vel = clamp(0.44 * dyn * accent + human(0.04), 0.08, 1);
      if (style.chord) {
        const idxs = inst.arp === "hymn" && tick === 8 && pattern.length > 4 ? pattern.slice(2) : pattern;
        idxs.forEach((ix, j) => {
          const m = lad[Math.min(ix, lad.length - 1)];
          events.push({
            tick,
            dur: end - tick,
            role: "arp",
            midi: m,
            vel: vel * (style.roll ? 0.85 : 0.75),
            s: "piano",
            i: arpI,
            shift: style.roll ? j * 0.038 : human(0.01),
          });
        });
      } else {
        const m = lad[Math.min(pattern[k % pattern.length], lad.length - 1)];
        events.push({ tick, dur: ring, role: "arp", midi: m, vel, s: "piano", i: arpI, shift: human(0.008) });
      }
    }

    // ---- bass
    if (E >= 0.2) {
      const bassAt = (pc: number) => {
        let p = nearest(pc, this.prevBass ?? 43);
        while (p > 52) p -= 12;
        while (p < 36) p += 12;
        this.prevBass = p;
        return p;
      };
      // Long bass notes ring on the low harp in the storybook; moving lines are pizzicato.
      const longI: InstName = inst.bass === "long" || E < 0.45 ? "harp" : "pizz";
      const push = (tick: number, dur: number, midi: number, vel: number) =>
        events.push({ tick, dur, role: "bass", midi, vel: clamp(vel * dyn, 0.1, 1), s: "bass", i: dur >= 8 ? longI : "pizz", shift: human(0.006) });
      const style = inst.bass;
      for (let si = 0; si < spans.length; si++) {
        const sp = spans[si];
        const root = bassAt(chords[si].bass);
        // Over a slash chord the pulse repeats the bass note rather than adding a fifth.
        const slash = chords[si].bass !== chords[si].root;
        const fifth = slash ? root : root + 7 > 52 ? root - 5 : root + 7;
        const half = this.meter.barTicks / 2;
        if (style === "long" || (E < 0.45 && style !== "oom")) push(sp.start, sp.dur, root, 0.7);
        else if (style === "pulse") {
          if (sp.dur >= T) {
            push(sp.start, half, root, 0.72);
            push(sp.start + half, half, this.meter.name === "3/4" ? root : fifth, 0.6);
          } else push(sp.start, sp.dur, root, 0.7);
        } else if (style === "pastoral") {
          if (sp.dur >= T) {
            push(0, 6, root, 0.7);
            push(6, 6, fifth, 0.55);
          } else push(sp.start, sp.dur, root, 0.68);
        } else if (style === "oom") {
          // Alternate root and fifth only while the harmony holds.
          const held = this.prevBassChord === chords[si].root && sp.dur >= T;
          push(sp.start, Math.min(sp.dur, 4), held && b % 2 === 1 ? fifth : root, 0.72);
        } else if (style === "clock") {
          if (E < 0.55 || sp.dur < T) push(sp.start, sp.dur, root, 0.7);
          else {
            push(0, 3, root, 0.72);
            push(6, 2, root, 0.5);
            push(8, 3, fifth, 0.62);
            push(14, 2, root + 12 <= 55 ? root + 12 : root, 0.45);
          }
        } else if (style === "walk") {
          if (sp.dur >= T && this.meter.name === "4/4") {
            let target = nearest(this.peekNextRoot(), root);
            while (target < 37) target += 12;
            while (target > 52) target -= 12;
            // A passing note into the next root: in the scale, and never a
            // semitone against the harmony it sounds over.
            const scale = MODES[inst.mode].map((x) => mod12(x + tonic));
            const pcs = chords[si].pcs;
            const ok = (m: number) =>
              scale.includes(mod12(m)) &&
              (pcs.includes(mod12(m)) || !pcs.some((c) => [1, 11].includes(mod12(m - c)))) &&
              m !== target;
            const dir = target > root ? -1 : 1;
            const approach = [target + dir, target - dir, target + 2 * dir, target - 2 * dir].find(ok) ?? fifth;
            push(0, 4, root, 0.74);
            push(4, 4, fifth, 0.56);
            push(8, 4, root + 12 <= 55 ? root + 12 : fifth, 0.6);
            push(12, 4, approach, 0.55);
          } else push(sp.start, sp.dur, root, 0.7);
        }
        this.prevBassChord = chords[si].root;
      }
    }

    // ---- counter-melody: guide tones under the lead
    if (hasLead && E >= 0.58) {
      const cs: InstName = inst.leadS === "strings" ? "piano" : "strings";
      const ci: InstName = inst.leadI === "celesta" ? "harmonium" : "celesta";
      for (let si = 0; si < spans.length; si++) {
        const sp = spans[si];
        const segs: [number, number][] =
          sp.dur >= 8 && E >= 0.7 ? [[sp.start, sp.dur / 2], [sp.start + sp.dur / 2, sp.dur / 2]] : [[sp.start, sp.dur]];
        let last: number | null = null;
        for (const [tick, dur] of segs) {
          const mNote = sounding(tick);
          const ceiling = mNote ? inst.melodyTonic + (mNote.semis as number) - 3 : reg - 2;
          const lo = reg - 15;
          const hi = Math.min(reg - 2, ceiling);
          if (hi - lo < 4) continue;
          const prev = this.prevCounter ?? (lo + hi) / 2;
          let best = -1;
          let bestCost = Infinity;
          sp.chord.tones.forEach((t) => {
            const pc = mod12(sp.chord.root + t.semis + tonic);
            for (let p = lo; p <= hi; p++) {
              if (mod12(p) !== pc) continue;
              let cost = Math.abs(p - prev);
              if (t.fn === "5") cost += 1.5;
              if (t.fn === "r") cost += 3;
              if (p === last) cost += 2.5;
              if (cost < bestCost) {
                bestCost = cost;
                best = p;
              }
            }
          });
          if (best < 0) continue;
          last = best;
          this.prevCounter = best;
          events.push({ tick, dur, role: "counter", midi: best, vel: 0.5 * dyn, s: cs, i: ci, shift: human(0.01) });
        }
      }
    }

    // ---- swells at section starts
    if (E >= 0.68 && (b === 0 || (E >= 0.85 && b % 4 === 0))) {
      const top = padNotes[0].slice(-2).map((m) => (m < reg - 10 ? m + 12 : m));
      for (const m of top)
        events.push({ tick: 0, dur: spans[0].dur, role: "swell", midi: m, vel: 0.55 * dyn, s: "strings", i: "harmonium", swell: true });
    }

    // ---- sparkle: the motif echoed high
    const lastHold = mel.length ? mel[mel.length - 1] : null;
    const phraseEnd = (b + 1) % 4 === 0;
    const holdsLate =
      !!lastHold && lastHold.semis !== null && lastHold.start - barStart <= T / 2 && lastHold.start + lastHold.dur >= barStart + T;
    const noMelodyHere = !hasLead || mel.every((n) => n.semis === null);
    let sparkle: [number, number][] | null = null;
    if (noMelodyHere && E >= 0.2 && (b % 2 === 0 ? r.chance(0.8) : r.chance(0.25))) sparkle = MOTIF_RHYTHM[this.meter.name].slow;
    else if (hasLead && phraseEnd && holdsLate && r.chance(0.55 + 0.3 * inst.vary)) sparkle = MOTIF_RHYTHM[this.meter.name].echo;
    if (sparkle) {
      const t0 = sparkle[0][0];
      const si = spans.findIndex((s) => t0 >= s.start && t0 < s.start + s.dur);
      const notes = motifOnChord(spans[si], inst.mode, tonic, noMelodyHere ? mb - 3 : Math.min(mb + 5, 79));
      sparkle.forEach(([tick, dur], j) => {
        if (j >= notes.length) return;
        const v = (j === 0 ? 0.42 : 0.34) * dyn;
        events.push({ tick, dur: Math.max(dur, 2), role: "sparkle", midi: notes[j], vel: v, s: "piano", i: "celesta", shift: human(0.008) });
      });
    }

    // ---- percussion
    if (inst.perc !== "none" && E >= 0.55) {
      const hits = PERC[inst.perc];
      const nightSkip = inst.perc === "night44" && b % 2 === 1;
      for (const [tick, hit, vel, minE] of hits) {
        if (tick >= T || E < minE) continue;
        if (nightSkip && hit === "low") continue;
        if (inst.perc === "waltz34" && hit === "swish" && b % 2 === 0) continue;
        events.push({
          tick,
          dur: 1,
          role: "perc",
          midi: 60,
          vel: clamp(vel * (0.75 + 0.35 * E) + human(0.03), 0.04, 1),
          s: "kit",
          i: "kit",
          hit,
          shift: human(0.004),
        });
      }
      // A fill into each phrase.
      if (phraseEnd && E >= 0.7 && r.chance(0.6)) {
        for (let k = 0; k < 4; k++)
          events.push({
            tick: T - 4 + k,
            dur: 1,
            role: "perc",
            midi: 60,
            vel: 0.16 + 0.08 * k,
            s: "kit",
            i: "kit",
            hit: k === 3 ? "mid" : "ghost",
            shift: human(0.004),
          });
      }
    }
    // A soft roll into a louder section.
    if (b === inst.bars - 1 && E >= 0.4) {
      const nextE = this.peekNextEnergy();
      if (nextE >= 0.72 && nextE > E + 0.05) {
        const rollTicks = Math.min(T, Math.round(1.6 / this.secPerTick));
        events.push({ tick: T - rollTicks, dur: rollTicks, role: "perc", midi: 60, vel: 0.4, s: "kit", i: "kit", hit: "roll" });
      }
    }

    // ---- radiant shimmer once every seed is held
    if (radiant) {
      const steps = this.meter.name === "4/4" ? 8 : 6;
      const shape = [0, 1, 2, 3, 4, 3, 2, 1];
      for (let k = 0; k < steps; k++) {
        const tick = k * 2;
        const si = spans.findIndex((s) => tick >= s.start && tick < s.start + s.dur);
        const lad = ladder(chords[si], mb + 9, mb + 27, true);
        const m = lad[Math.min(shape[k] + (b % 2), lad.length - 1)];
        events.push({ tick, dur: 3, role: "shimmer", midi: m, vel: 0.3 + (k === 0 ? 0.08 : 0), s: "glass", i: "celesta", shift: human(0.006) });
      }
      for (let si = 0; si < spans.length; si++) {
        const root = chords[si].root;
        let p = nearest(root, this.prevShimmer ?? mb + 12);
        if (p < mb + 7) p += 12;
        if (p > mb + 19) p -= 12;
        this.prevShimmer = p;
        for (const m of [p, p + 7])
          events.push({ tick: spans[si].start, dur: spans[si].dur, role: "halo", midi: m, vel: 0.3, s: "pad", i: "harmonium" });
      }
    }

    const out: Bar = {
      events,
      barTicks: T,
      secPerTick: this.secPerTick,
      key: inst.key,
      chords,
      section: inst.entry.sec,
      energy: E,
      pass: this.pass,
      barInSection: b,
      sectionBars: inst.bars,
      index: this.barIndex,
    };
    this.bar++;
    this.barIndex++;
    return out;
  }
}

/** Chord tones from lo upward: bass, fifth, then every chord tone. */
function ladder(c: ChordInfo, lo: number, hi: number, close = false): number[] {
  const out: number[] = [];
  let p = lo + mod12(c.bass - lo);
  out.push(p);
  if (!close) {
    const fifth = mod12(c.root + 7);
    if (c.pcs.includes(fifth)) {
      let q = p + 1;
      while (mod12(q) !== fifth) q++;
      out.push(q);
      p = q;
    }
    // Continue an octave above the bass.
    p = out[0] + 11;
  }
  for (let q = p + 1; q <= hi && out.length < 12; q++) if (c.pcs.includes(mod12(q))) out.push(q);
  return out;
}

/** The motif's head (root, fifth, sixth, fifth) placed diatonically on a chord. */
function motifOnChord(sp: ChordSpan, mode: ModeName, tonic: number, lo: number): number[] {
  const rel = sp.chord.root;
  let degree = 0;
  for (let d = 1; d <= 7; d++) if (mod12(degreeSemis(mode, d)) === rel) degree = d;
  const pcs = chordPcs(sp.chord);
  const diatonic = pcs.every((pc) => [0, 1, 2, 3, 4, 5, 6].some((d) => mod12(degreeSemis(mode, d + 1)) === pc));
  let semis: number[];
  if (degree && diatonic) semis = [0, 4, 5, 4].map((k) => degreeSemis(mode, degree + k));
  else semis = [0, 7, 12, 7].map((k) => rel + k);
  const first = tonic + semis[0];
  const base = lo + mod12(first - lo);
  return semis.map((s) => base + (s - semis[0]));
}
