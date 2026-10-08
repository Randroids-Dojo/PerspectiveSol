import type { Stinger } from "../contract";
import type { Bank } from "./bank";
import type { InstrumentName, Surface } from "./catalog";
import type { Mixer } from "./mixer";
import { degreeSemis, mod12, rng, type Key } from "./theory";

/**
 * Designed sound effects. Each effect is a few layers: synthesised textures
 * (whooshes, grains, thuds) plus pitched notes from the instrument bank, tuned
 * to the music's current key so rewards land inside the harmony.
 */

type LayerOpts = {
  gain: number;
  rate?: number;
  /** Ramp the playback rate to this value over `rateTime` seconds. */
  rateTo?: number;
  rateTime?: number;
  offset?: number;
  dur?: number;
  attack?: number;
  release?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number; to?: number; time?: number };
};

type Group = { node: GainNode; pan: StereoPannerNode; pending: number; out: AudioNode };

/**
 * Loudness hierarchy, as multipliers on each effect's layers: frequent sounds
 * (steps, jumps, folds) sit low; rewards and milestones sit high, with the
 * final seed and the observatory the most prominent things in the game.
 */
const LEVEL: Record<string, number> = {
  jump: 0.82,
  land: 0.85,
  step: 0.72,
  bump: 1,
  fold: 0.62,
  unfold: 0.9,
  seed: 1.75,
  mote: 1.7,
  checkpoint: 1.4,
  lantern: 0.88,
  gate: 0.72,
  bridge: 1.8,
  dieSentinel: 1.2,
  dieVoid: 0.75,
  dieCrush: 0.9,
  respawn: 1.3,
  locked: 1.6,
  exit: 1.6,
  hint: 0.75,
  "ui-move": 1.6,
  "ui-select": 1.6,
  "ui-back": 1.7,
  "chapter-start": 1.9,
  clear: 2.2,
  ending: 2.4,
  pause: 1.8,
  resume: 1.8,
};

export class Effects {
  private ctx: BaseAudioContext;
  private mixer: Mixer;
  private bank: Bank;
  private key: () => Key;
  private r = rng(97);
  private lastStep: Record<string, number> = {};
  private lastStepTime = 0;
  private motes = 0;
  private uiFlip = 0;
  live = 0;
  played = 0;

  constructor(ctx: BaseAudioContext, mixer: Mixer, bank: Bank, key: () => Key) {
    this.ctx = ctx;
    this.mixer = mixer;
    this.bank = bank;
    this.key = key;
  }

  // ------------------------------------------------------------- plumbing

  private group(pan: number, out: AudioNode, level = 1): Group {
    const node = this.ctx.createGain();
    node.gain.value = level;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    node.connect(p).connect(out);
    const g = { node, pan: p, pending: 0, out };
    // A group whose samples were not ready yet still gets cleaned up.
    setTimeout(() => {
      if (g.pending <= 0) this.release(g);
    }, 0);
    return g;
  }

  private release(g: Group) {
    g.node.disconnect();
    g.pan.disconnect();
  }

  private done(g: Group) {
    g.pending--;
    this.live--;
    if (g.pending <= 0) this.release(g);
  }

  private layer(g: Group, key: string, at: number, o: LayerOpts) {
    const s = this.bank.get(key);
    if (!s) return;
    this.src(g, s.buffer, at, o);
  }

  private src(g: Group, buffer: AudioBuffer, at: number, o: LayerOpts, loop?: [number, number]) {
    const ctx = this.ctx;
    const t = Math.max(at, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const rate = o.rate ?? 1;
    src.playbackRate.setValueAtTime(rate, t);
    if (o.rateTo) src.playbackRate.exponentialRampToValueAtTime(o.rateTo, t + (o.rateTime ?? 0.5));
    if (loop) {
      src.loop = true;
      src.loopStart = loop[0];
      src.loopEnd = loop[1];
    }
    const gain = ctx.createGain();
    const offset = o.offset ?? 0;
    const natural = (buffer.duration - offset) / Math.min(rate, o.rateTo ?? rate);
    const dur = Math.min(o.dur ?? natural, loop ? Infinity : natural);
    const attack = o.attack ?? 0.002;
    const release = o.release ?? 0.02;
    const end = t + dur;
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(o.gain, t + attack);
    if (end - release > t + attack) gain.gain.setValueAtTime(o.gain, end - release);
    gain.gain.linearRampToValueAtTime(0, end);
    let last: AudioNode = gain;
    let filter: BiquadFilterNode | null = null;
    if (o.filter) {
      filter = ctx.createBiquadFilter();
      filter.type = o.filter.type;
      filter.Q.value = o.filter.q ?? 0.7;
      filter.frequency.setValueAtTime(o.filter.freq, t);
      if (o.filter.to) filter.frequency.exponentialRampToValueAtTime(o.filter.to, t + (o.filter.time ?? dur));
      gain.connect(filter);
      last = filter;
    }
    src.connect(gain);
    last.connect(g.node);
    src.start(t, offset);
    src.stop(end + 0.01);
    g.pending++;
    this.live++;
    this.played++;
    src.onended = () => {
      gain.disconnect();
      filter?.disconnect();
      this.done(g);
    };
  }

  /** A pitched note from the instrument bank. */
  private note(g: Group, inst: InstrumentName, midi: number, at: number, o: { gain: number; dur?: number; attack?: number; release?: number }) {
    const p = this.bank.pick(inst, midi);
    if (!p) return;
    const sustained = inst === "pad" || inst === "strings" || inst === "harmonium" || inst === "flute";
    const dur = o.dur ?? p.buffer.duration / p.rate;
    this.src(
      g,
      p.buffer,
      at,
      { gain: o.gain, rate: p.rate, dur, attack: o.attack ?? (sustained ? 0.2 : 0.002), release: o.release ?? (sustained ? 0.6 : 0.15) },
      sustained && p.loopStart !== undefined && p.loopEnd !== undefined ? [p.loopStart, p.loopEnd] : undefined,
    );
  }

  // ---------------------------------------------------------------- harmony

  /** The key's brightest stable chord root: I in major modes, III in minor. */
  private brightRoot() {
    const k = this.key();
    const minor = k.mode === "dorian" || k.mode === "aeolian";
    return mod12(k.tonic + (minor ? degreeSemis(k.mode, 3) : 0));
  }

  /** A pitch with this pitch class at or just above `low`. */
  private place(pc: number, low: number) {
    return low + mod12(pc - low);
  }

  /** Semitone offsets above the bright root, placed from `low`. */
  private bright(semis: number[], low: number) {
    const root = this.place(this.brightRoot(), low);
    return semis.map((s) => root + s);
  }

  private degree(d: number, low: number) {
    const k = this.key();
    const tonic = this.place(k.tonic, low);
    return tonic + degreeSemis(k.mode, d);
  }

  private now() {
    return this.ctx.currentTime + 0.004;
  }

  private rand(a: number, b: number) {
    return a + (b - a) * this.r();
  }

  // ---------------------------------------------------------------- events

  jump(pan: number) {
    const t = this.now();
    const g = this.group(pan, this.mixer.sfx, LEVEL.jump);
    this.layer(g, "sfx:whoosh", t, { gain: 0.42, rate: this.rand(0.94, 1.1) });
    const target = this.bright([7], 79)[0];
    this.layer(g, "sfx:lift", t + 0.01, { gain: 0.16, rate: Math.pow(2, (target - 81) / 12) });
  }

  land(impact: number, surface: Surface, pan: number) {
    const t = this.now();
    const w = Math.max(0, Math.min(1, (impact - 4) / 16));
    const g = this.group(pan, this.mixer.sfx, LEVEL.land);
    this.layer(g, "sfx:thud", t, { gain: 0.14 + 0.62 * w, rate: 1.15 - 0.3 * w });
    this.layer(g, this.stepKey(surface), t + 0.004, { gain: 0.32 + 0.45 * w, rate: 0.93 - 0.06 * w });
    this.layer(g, "sfx:dust", t + 0.01, { gain: 0.05 + 0.48 * w, rate: this.rand(0.9, 1.1) });
    if (w > 0.75) this.layer(g, "sfx:thud", t + 0.012, { gain: 0.3, rate: 0.7 });
  }

  step(foot: number, surface: Surface, pan: number) {
    const t = this.now();
    if (t - this.lastStepTime < 0.09) return;
    this.lastStepTime = t;
    const g = this.group(pan + (foot ? 0.05 : -0.05), this.mixer.sfx, LEVEL.step);
    const level: Record<Surface, number> = { grass: 0.5, stone: 0.42, bronze: 0.36, wood: 0.42, gravel: 0.44, glass: 0.3, soft: 0.34 };
    const rate = (foot ? 0.965 : 1.02) * this.rand(0.965, 1.035);
    this.layer(g, this.stepKey(surface), t, { gain: level[surface] * this.rand(0.88, 1.12), rate });
    // The body's weight: a soft low thump under every footfall, heavier on the heel.
    this.layer(g, "sfx:thud", t, { gain: (foot ? 0.07 : 0.09) * this.rand(0.85, 1.15), rate: this.rand(1.55, 1.75), dur: 0.12, release: 0.06 });
    if (surface === "soft") {
      // Star bridges chime softly underfoot.
      const pent = [0, 2, 4, 7, 9];
      const m = this.bright([pent[this.r.int(0, 4)] + 12], 72)[0];
      this.note(g, "glass", m, t, { gain: 0.07, dur: 0.5, release: 0.4 });
    }
  }

  private stepKey(surface: Surface) {
    let v = this.r.int(0, 3);
    if (v === this.lastStep[surface]) v = (v + 1) % 4;
    this.lastStep[surface] = v;
    return `step:${surface}:${v}`;
  }

  bump(pan: number) {
    const t = this.now();
    const g = this.group(pan, this.mixer.sfx, LEVEL.bump);
    this.layer(g, "sfx:knock", t, { gain: 0.5, rate: this.rand(0.95, 1.05) });
    this.layer(g, "sfx:dust", t + 0.02, { gain: 0.14, rate: 1.2 });
  }

  fold(toFlat: boolean, pan: number) {
    const t = this.now();
    const g = this.group(pan * 0.5, this.mixer.sfx, toFlat ? LEVEL.fold : LEVEL.unfold);
    if (toFlat) {
      this.layer(g, "sfx:paper", t, { gain: 0.5, rate: this.rand(0.96, 1.04) });
      const notes = this.bright([7, 12, 16], 79);
      notes.forEach((m, i) => this.note(g, "celesta", m, t + 0.05 + i * 0.055, { gain: 0.13 + i * 0.025 }));
      this.note(g, "glass", this.bright([19], 79)[0], t + 0.2, { gain: 0.06 });
    } else {
      const root = this.bright([0], 57)[0];
      this.layer(g, "sfx:bloom", t, { gain: 0.42, rate: Math.pow(2, (root - 57) / 12) });
      this.layer(g, "sfx:riser", t, { gain: 0.14, offset: 0.55 });
      this.note(g, "pad", root - 12, t, { gain: 0.14, dur: 0.9, attack: 0.05, release: 0.7 });
    }
  }

  seed(held: number, total: number, pan: number) {
    const t = this.now();
    const g = this.group(pan * 0.6, this.mixer.sfx, LEVEL.seed * (held >= total ? 1.2 : 1));
    this.layer(g, "sfx:sparkle", t, { gain: 0.42 });
    const shape = [0, 4, 7, 14, 16, 19, 24];
    const count = Math.min(shape.length, 4 + held);
    const notes = this.bright(shape.slice(0, count), 72);
    notes.forEach((m, i) => {
      this.note(g, "glass", m, t + i * 0.06, { gain: 0.15 + i * 0.012 });
      if (i >= count - 3) this.note(g, "celesta", m + 12, t + i * 0.06 + 0.012, { gain: 0.07 });
    });
    const low = this.bright([0, 7], 52);
    for (const m of low) this.note(g, "pad", m, t, { gain: 0.15, dur: 1.4, attack: 0.12, release: 1.1 });
    const root = this.bright([0], 57)[0];
    this.layer(g, "sfx:bloom", t + 0.02, { gain: 0.24, rate: Math.pow(2, (root - 12 - 57) / 12) });
    if (held >= total) {
      const crown = this.bright([24, 28, 31], 72);
      crown.forEach((m) => this.note(g, "glass", m, t + 0.48, { gain: 0.1 }));
      this.layer(g, "sfx:sparkle", t + 0.42, { gain: 0.32, rate: 1.12 });
      this.mixer.stingDuck(0.5, 1.4, 0.8);
    } else this.mixer.stingDuck(0.62, 0.9, 0.6);
  }

  mote(count: number, pan: number) {
    const t = this.now();
    const g = this.group(pan, this.mixer.sfx, LEVEL.mote);
    const pent = [0, 2, 4, 7, 9];
    const n = Math.max(0, count - 1);
    const m = this.bright([pent[n % 5] + 12 * Math.floor(n / 5)], 79)[0];
    this.note(g, "glass", Math.min(m, 104), t, { gain: 0.2 });
    this.note(g, "celesta", Math.min(m + 12, 108), t + 0.03, { gain: 0.07 });
    this.layer(g, "sfx:sparkle", t, { gain: 0.12, rate: 1.3, dur: 0.45, release: 0.2 });
    this.motes = count;
  }

  checkpoint(pan: number) {
    const t = this.now();
    const g = this.group(pan, this.mixer.sfx, LEVEL.checkpoint);
    this.bright([0, 7, 12, 16], 67).forEach((m, i) => this.note(g, "glass", m, t + i * 0.04, { gain: 0.15 }));
    for (const m of this.bright([0, 7], 55)) this.note(g, "pad", m, t, { gain: 0.13, dur: 1.4, attack: 0.18, release: 1.2 });
    this.layer(g, "step:bronze:1", t, { gain: 0.16, rate: 0.6 });
  }

  lantern(pan: number) {
    const t = this.now();
    const g = this.group(pan, this.mixer.sfx, LEVEL.lantern);
    this.layer(g, "sfx:ignite", t, { gain: 0.55 });
    this.bright([0, 4, 7, 12, 16], 55).forEach((m, i) => this.note(g, "harp", m, t + 0.12 + i * 0.032, { gain: 0.15 }));
    this.note(g, "glass", this.bright([24], 55)[0], t + 0.3, { gain: 0.1 });
    for (const m of this.bright([0, 7], 55)) this.note(g, "pad", m, t + 0.1, { gain: 0.11, dur: 1.2, attack: 0.2, release: 1 });
  }

  gate(pan: number, distance: number) {
    const t = this.now();
    const k = 1 / (1 + distance / 14);
    const g = this.group(pan, this.mixer.sfx, LEVEL.gate);
    this.layer(g, "sfx:grind", t, { gain: 0.55 * k });
    this.layer(g, "sfx:settle", t + 1.0, { gain: 0.6 * k });
    this.layer(g, "sfx:dust", t + 1.05, { gain: 0.3 * k, rate: 0.85 });
  }

  bridge(pan: number, distance: number) {
    const t = this.now();
    const k = 1 / (1 + distance / 14);
    const g = this.group(pan, this.mixer.sfx, LEVEL.bridge);
    const pent = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    const notes = this.bright(pent, 79);
    let at = 0;
    notes.forEach((m, i) => {
      this.note(g, "glass", m, t + at, { gain: 0.1 * k, dur: 0.18, release: 0.3 });
      this.layer(g, "step:glass:" + (i % 4), t + at, { gain: 0.1 * k, rate: 1.3 + i * 0.03 });
      at += 0.16 - i * 0.013;
    });
    this.bright([0, 7, 12, 16], 72).forEach((m) => this.note(g, "glass", m, t + at + 0.05, { gain: 0.11 * k }));
    const root = this.bright([0], 57)[0];
    this.layer(g, "sfx:bloom", t + at, { gain: 0.16 * k, rate: Math.pow(2, (root - 57) / 12) });
  }

  die(cause: string | undefined, pan: number) {
    const t = this.now();
    const g = this.group(pan, this.mixer.sfx, cause === "sentinel" ? LEVEL.dieSentinel : cause === "crush" ? LEVEL.dieCrush : LEVEL.dieVoid);
    if (cause === "sentinel") {
      this.layer(g, "sfx:crackle", t, { gain: 0.55 });
      const k = this.key();
      const root = this.place(k.tonic, 72);
      for (const m of [root, root + 1, root + 6]) this.note(g, "glass", m, t, { gain: 0.12, dur: 0.28, release: 0.25 });
      this.layer(g, "sfx:thud", t, { gain: 0.3, rate: 1.3 });
      this.layer(g, "sfx:fall", t + 0.08, { gain: 0.14, offset: 0.3 });
    } else if (cause === "crush") {
      this.layer(g, "sfx:settle", t, { gain: 0.5 });
      this.layer(g, "sfx:crackle", t, { gain: 0.2, rate: 0.8 });
      this.layer(g, "sfx:thud", t, { gain: 0.4, rate: 0.85 });
    } else {
      this.layer(g, "sfx:fall", t, { gain: 0.55 });
      const p = this.bank.pick("glass", this.bright([7], 72)[0]);
      if (p) this.src(g, p.buffer, t + 0.05, { gain: 0.1, rate: p.rate, rateTo: p.rate * 0.5, rateTime: 0.9, dur: 1.1, release: 0.4 });
    }
  }

  respawn(pan: number) {
    const t = this.now();
    const g = this.group(pan, this.mixer.sfx, LEVEL.respawn);
    this.layer(g, "sfx:riser", t, { gain: 0.3, dur: 0.9, release: 0.2 });
    this.bright([0, 2, 4, 7, 9, 12], 72).forEach((m, i) => this.note(g, "celesta", m, t + 0.1 + i * 0.07, { gain: 0.08 + i * 0.01 }));
    const root = this.bright([0], 57)[0];
    this.layer(g, "sfx:bloom", t + 0.35, { gain: 0.14, rate: Math.pow(2, (root - 57) / 12) });
  }

  locked(missing: number, pan: number) {
    const t = this.now();
    const g = this.group(pan, this.mixer.sfx, LEVEL.locked);
    this.note(g, "celesta", this.degree(3, 72), t, { gain: 0.17 });
    this.note(g, "celesta", this.degree(2, 72), t + 0.17, { gain: 0.14 });
    this.layer(g, "sfx:lock", t, { gain: 0.22 });
    for (let i = 0; i < Math.min(3, missing); i++)
      this.note(g, "glass", this.degree(5, 79), t + 0.45 + i * 0.11, { gain: 0.035, dur: 0.3, release: 0.25 });
  }

  exit(pan: number) {
    const t = this.now();
    const g = this.group(pan * 0.4, this.mixer.sfx, LEVEL.exit);
    const chord = this.bright([0, 7, 12, 16, 19], 50);
    for (const m of chord) {
      this.note(g, "strings", m, t, { gain: 0.12, dur: 2.6, attack: 1.3, release: 1.4 });
      this.note(g, "pad", m, t, { gain: 0.09, dur: 2.6, attack: 1, release: 1.5 });
    }
    this.bright([0, 4, 7, 12, 16, 19, 24], 72).forEach((m, i) => this.note(g, "glass", m, t + 0.2 + i * 0.18, { gain: 0.1 + i * 0.01 }));
    this.layer(g, "sfx:riser", t, { gain: 0.26 });
    this.layer(g, "sfx:sparkle", t + 1.2, { gain: 0.3 });
    const root = this.bright([0], 57)[0];
    this.layer(g, "sfx:bloom", t + 1.5, { gain: 0.22, rate: Math.pow(2, (root - 57) / 12) });
    this.mixer.stingDuck(0.5, 2.4, 0.9);
  }

  hint(pan: number) {
    const t = this.now();
    const g = this.group(pan * 0.5, this.mixer.sfx, LEVEL.hint);
    this.layer(g, "sfx:page", t, { gain: 0.38 });
    const m = this.bright([7], 84)[0];
    this.note(g, "glass", m, t + 0.08, { gain: 0.07 });
    this.note(g, "celesta", m + 12 <= 108 ? m + 12 : m, t + 0.09, { gain: 0.04 });
  }

  // --------------------------------------------------------------- stingers

  stinger(s: Stinger) {
    const t = this.now();
    const g = this.group(0, this.mixer.ui, LEVEL[s] ?? 1);
    switch (s) {
      case "ui-move": {
        this.layer(g, "sfx:tick", t, { gain: 0.2 });
        const m = this.bright([this.uiFlip++ % 2 ? 9 : 7], 72)[0];
        this.note(g, "harp", m, t, { gain: 0.07, dur: 0.3, release: 0.2 });
        break;
      }
      case "ui-select": {
        this.layer(g, "sfx:tick", t, { gain: 0.22 });
        const [a, b] = this.bright([0, 7], 72);
        this.note(g, "celesta", a, t, { gain: 0.13 });
        this.note(g, "celesta", b, t + 0.07, { gain: 0.15 });
        this.note(g, "glass", b + 12, t + 0.07, { gain: 0.04 });
        break;
      }
      case "ui-back": {
        this.layer(g, "step:soft:0", t, { gain: 0.22 });
        const [a, b] = this.bright([7, 0], 60);
        this.note(g, "celesta", a, t, { gain: 0.1 });
        this.note(g, "celesta", b, t + 0.08, { gain: 0.09 });
        break;
      }
      case "chapter-start": {
        const k = this.key();
        const tonic = this.place(k.tonic, 72);
        const motif = [1, 5, 6, 5].map((d) => tonic + degreeSemis(k.mode, d));
        const times = [0, 0.3, 0.4, 0.6];
        motif.forEach((m, i) => {
          this.note(g, "glass", m, t + times[i], { gain: 0.12 });
          this.note(g, "celesta", m + 12, t + times[i] + 0.01, { gain: 0.05 });
        });
        for (const m of [tonic - 12, tonic - 5]) this.note(g, "pad", m, t, { gain: 0.11, dur: 2, attack: 0.4, release: 1.5 });
        this.layer(g, "sfx:sparkle", t, { gain: 0.14 });
        break;
      }
      case "clear": {
        this.bright([0, 4, 7, 12, 16, 19], 60).forEach((m, i) => this.note(g, "harp", m, t + i * 0.06, { gain: 0.13 }));
        this.bright([16, 14, 12], 72).forEach((m, i) => this.note(g, "glass", m, t + 0.55 + i * 0.3, { gain: 0.14 }));
        for (const m of this.bright([5, 9, 12], 55)) this.note(g, "pad", m, t, { gain: 0.09, dur: 1.3, attack: 0.3, release: 0.6 });
        for (const m of this.bright([0, 4, 7, 12], 55)) this.note(g, "pad", m, t + 1.25, { gain: 0.09, dur: 2.2, attack: 0.4, release: 1.4 });
        this.layer(g, "sfx:sparkle", t + 1.15, { gain: 0.25 });
        this.mixer.stingDuck(0.45, 3.6, 0.9);
        break;
      }
      case "ending": {
        const k = this.key();
        const tonic = this.place(k.tonic, 72);
        const degs = [1, 5, 6, 5, 3, 2, 1];
        const times = [0, 0.45, 0.6, 0.9, 1.2, 1.95, 2.25];
        degs.forEach((d, i) => {
          const m = tonic + degreeSemis(k.mode, d);
          this.note(g, "glass", m, t + times[i], { gain: 0.12 });
          this.note(g, "celesta", m + 12, t + times[i] + 0.01, { gain: 0.05 });
        });
        const chords: [number[], number, number][] = [
          [[0, 4, 7], 0, 1.6],
          [[5, 9, 12], 1.6, 0.8],
          [[7, 11, 14], 2.4, 0.6],
          [[0, 4, 7, 12], 3.0, 2.6],
        ];
        for (const [c, at, d] of chords)
          for (const m of c) this.note(g, "pad", tonic - 12 + m, t + at, { gain: 0.08, dur: d, attack: 0.3, release: 1 });
        this.bright([0, 4, 7, 12, 16], 60).forEach((m, i) => this.note(g, "harp", m, t + 3 + i * 0.05, { gain: 0.12 }));
        this.layer(g, "sfx:sparkle", t + 3, { gain: 0.3 });
        this.mixer.stingDuck(0.4, 5.4, 1);
        break;
      }
      case "pause": {
        this.layer(g, "step:soft:1", t, { gain: 0.2 });
        const [a, b] = this.bright([7, 0], 55);
        this.note(g, "harp", a, t, { gain: 0.09 });
        this.note(g, "harp", b, t + 0.09, { gain: 0.08 });
        break;
      }
      case "resume": {
        this.layer(g, "step:soft:2", t, { gain: 0.2 });
        const [a, b] = this.bright([0, 7], 55);
        this.note(g, "harp", a, t, { gain: 0.08 });
        this.note(g, "harp", b, t + 0.08, { gain: 0.09 });
        break;
      }
    }
  }
}
