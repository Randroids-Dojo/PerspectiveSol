import {
  Biquad,
  OnePole,
  TAU,
  brownSource,
  clamp,
  fades,
  grain,
  loopify,
  mtof,
  normalize,
  partial,
  pinkSource,
  random,
  readTable,
  seconds,
  soft,
  table,
  wander,
  type Rendered,
} from "./dsp";

/**
 * Every sound in the game, synthesised from scratch. Keys:
 *   inst:<name>:<midi>   pitched instrument samples
 *   perc:<name>          drum kit pieces for both arrangements
 *   sfx:<name>           effect layers
 *   step:<surface>:<n>   footstep variants
 *   amb:<name>           ambience beds and calls
 */

export type InstrumentName =
  | "piano"
  | "pad"
  | "bass"
  | "strings"
  | "celesta"
  | "harp"
  | "pizz"
  | "flute"
  | "harmonium"
  | "glass";

const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let m = a; m <= b; m += step) out.push(m);
  return out;
};

export const ROOTS: Record<InstrumentName, number[]> = {
  piano: range(36, 96, 4),
  pad: range(36, 96, 6),
  bass: range(26, 58, 4),
  strings: range(40, 94, 6),
  celesta: range(60, 108, 4),
  harp: range(36, 96, 4),
  pizz: range(28, 76, 4),
  flute: range(58, 98, 4),
  harmonium: range(36, 96, 6),
  glass: range(60, 108, 4),
};

// ------------------------------------------------------------ instruments

function piano(midi: number): Rendered {
  const sr = 32000;
  const f0 = mtof(midi);
  const dur = clamp(4.4 - (midi - 36) * 0.048, 1.5, 4.4);
  const out = new Float32Array(seconds(sr, dur));
  const R = random(midi * 7919 + 13);
  const B = 0.00011 * Math.pow(2, (midi - 60) / 20);
  const fc = 1500 + (midi - 36) * 34;
  const t60 = clamp(13 - (midi - 36) * 0.17, 2.2, 13);
  const hammer = 1 / 8.3;
  for (let k = 1; k <= 60; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > Math.min(sr * 0.45, 9000)) break;
    const a = Math.pow(k, -1.05) * Math.exp(-fk / fc) * (0.3 + 0.7 * Math.abs(Math.sin(Math.PI * k * hammer)));
    if (a < 0.0006) continue;
    const slow = (6.9 / t60) * (1 + 0.16 * (k - 1) + fk / 3500);
    const fast = 2.4 + 0.8 * k + fk / 650;
    const ph = R() * TAU;
    const det = 1 + (R() - 0.5) * 0.0011;
    partial(out, sr, fk, a * 0.33, fast, a * 0.22, slow, ph, 0.0045);
    partial(out, sr, fk * det, a * 0.27, fast, a * 0.18, slow, ph + R(), 0.0045);
  }
  // The felt hammer's soft thump.
  const lp = new OnePole(sr, 600);
  const thumpN = seconds(sr, 0.04);
  for (let i = 0; i < thumpN; i++) out[i] += lp.run((R() * 2 - 1) * Math.exp(-i / (sr * 0.008))) * 0.05;
  normalize(out, sr, 0.13, 0.35);
  return { data: fades(out, sr, 0.001, 0.08), sr };
}

/** Sustained looped tone from wavetables with detuned, drifting voices. */
function ensemble(
  midi: number,
  sr: number,
  opts: {
    dark: number[];
    bright: number[];
    detune: number[];
    vibRate?: [number, number];
    vibDepth?: number;
    morph?: number;
    breath?: number;
    breathFreq?: number;
    sub?: number;
    seed: number;
    loop?: number;
  },
): Rendered {
  const loop = opts.loop ?? 2.6;
  const xf = 0.45;
  const n = seconds(sr, loop + xf);
  const out = new Float32Array(n);
  const R = random(opts.seed + midi * 31);
  const f0 = mtof(midi);
  const phA = opts.dark.map(() => R() * TAU);
  const dark = table(opts.dark, phA);
  const bright = table(opts.bright, phA);
  const voices = opts.detune.map((c) => ({
    ratio: Math.pow(2, c / 1200),
    ph: R(),
    vr: opts.vibRate ? opts.vibRate[0] + R() * (opts.vibRate[1] - opts.vibRate[0]) : 0,
    vp: R() * TAU,
    amp: 0.75 + R() * 0.25,
  }));
  const vd = opts.vibDepth ?? 0;
  const morphRate = 0.17 + R() * 0.1;
  const morphPh = R() * TAU;
  let subPh = 0;
  const bp = opts.breath ? new Biquad("bp", sr, opts.breathFreq ?? 2500, 0.8) : null;
  const drift = wander(R, sr, 0.6);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const m = 0.5 + (opts.morph ?? 0.35) * Math.sin(TAU * morphRate * t + morphPh);
    const dv = 1 + drift() * 0.0006;
    let s = 0;
    for (const v of voices) {
      const vib = vd ? 1 + vd * Math.sin(TAU * v.vr * t + v.vp) : 1;
      v.ph += (f0 * v.ratio * vib * dv) / sr;
      v.ph -= Math.floor(v.ph);
      const a = readTable(dark, v.ph);
      const b = readTable(bright, v.ph);
      s += (a + (b - a) * m) * v.amp;
    }
    if (opts.sub) {
      subPh += f0 / 2 / sr;
      subPh -= Math.floor(subPh);
      s += Math.sin(TAU * subPh) * opts.sub;
    }
    if (bp) s += bp.run(R() * 2 - 1) * (opts.breath as number);
    out[i] = s;
  }
  normalize(out, sr, 0.14, 1.0);
  return loopify(out, sr, xf, xf);
}

function harmonics(f0: number, limit: number, amp: (k: number, f: number) => number) {
  const out: number[] = [];
  for (let k = 1; k * f0 < limit && k <= 120; k++) out.push(amp(k, k * f0));
  return out;
}

function pad(midi: number): Rendered {
  const sr = 22050;
  const f0 = mtof(midi);
  const lim = Math.min(4200, sr * 0.45);
  return ensemble(midi, sr, {
    dark: harmonics(f0, lim, (k, f) => (Math.exp(-f / 900) * (f < 200 ? f / 200 : 1)) / k),
    bright: harmonics(f0, lim, (k, f) => (Math.exp(-f / 2200) * (f < 200 ? f / 200 : 1)) / k),
    detune: [-11, -5, 0, 5, 11],
    vibRate: [0.12, 0.3],
    vibDepth: 0.0008,
    morph: 0.4,
    breath: 0.006,
    breathFreq: 1200,
    seed: 11,
  });
}

function strings(midi: number): Rendered {
  const sr = 24000;
  const f0 = mtof(midi);
  const body = (f: number) =>
    1 + 0.7 * Math.exp(-(((f - 480) / 260) ** 2)) + 0.45 * Math.exp(-(((f - 2600) / 900) ** 2));
  const lim = Math.min(7000, sr * 0.45);
  return ensemble(midi, sr, {
    dark: harmonics(f0, lim, (k, f) => (body(f) * Math.exp(-f / 2600)) / k),
    bright: harmonics(f0, lim, (k, f) => (body(f) * Math.exp(-f / 5000)) / k),
    detune: [-13, -7, -2, 3, 8, 14],
    vibRate: [4.7, 6.1],
    vibDepth: 0.0026,
    morph: 0.3,
    breath: 0.012,
    breathFreq: 2800,
    seed: 23,
  });
}

function harmonium(midi: number): Rendered {
  const sr = 22050;
  const f0 = mtof(midi);
  const nasal = (f: number) => 1 + 0.5 * Math.exp(-(((f - 1300) / 500) ** 2));
  const lim = Math.min(5000, sr * 0.45);
  return ensemble(midi, sr, {
    dark: harmonics(f0, lim, (k, f) => (nasal(f) * Math.exp(-f / 1600) * (k % 2 ? 1.15 : 1)) / Math.pow(k, 0.8)),
    bright: harmonics(f0, lim, (k, f) => (nasal(f) * Math.exp(-f / 2600) * (k % 2 ? 1.15 : 1)) / Math.pow(k, 0.8)),
    detune: [0, 5],
    vibRate: [0.3, 0.5],
    vibDepth: 0.0004,
    morph: 0.25,
    breath: 0.01,
    breathFreq: 1600,
    seed: 37,
  });
}

function flute(midi: number): Rendered {
  const sr = 32000;
  const f0 = mtof(midi);
  const dur = 3.4;
  const n = seconds(sr, dur);
  const out = new Float32Array(n);
  const R = random(midi * 101 + 7);
  const amps = [1, 0.16, 0.11, 0.045, 0.025, 0.012].filter((_, k) => (k + 1) * f0 < sr * 0.45);
  const tone = table(amps, amps.map(() => R() * TAU));
  const breathLow = new Biquad("bp", sr, f0, 5);
  const breathHi = new Biquad("bp", sr, 3200, 0.7);
  const chiff = new Biquad("bp", sr, f0 * 2.3, 2);
  const drift = wander(R, sr, 1.3);
  const vibRate = 4.8 + R() * 0.5;
  let ph = 0;
  let vph = R() * TAU;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const depth = 0.0042 * clamp((t - 0.28) / 0.6, 0, 1);
    vph += (TAU * vibRate) / sr;
    const vib = Math.sin(vph);
    const scoop = t < 0.07 ? -0.006 * (1 - t / 0.07) : 0;
    const f = f0 * (1 + depth * vib + scoop + drift() * 0.0007);
    ph += f / sr;
    ph -= Math.floor(ph);
    const attack = 1 - Math.exp(-t / 0.03);
    const bloom = 1 + 0.07 * Math.exp(-(((t - 0.1) / 0.06) ** 2));
    const env = attack * bloom * (1 + 0.03 * (depth / 0.0042) * vib);
    const w = R() * 2 - 1;
    let s = readTable(tone, ph) * env;
    s += breathLow.run(w) * 0.18 * env + breathHi.run(w) * 0.035 * env;
    s += chiff.run(w) * 0.5 * Math.exp(-t / 0.025);
    out[i] = s;
  }
  normalize(out, sr, 0.15, 1.2);
  fades(out, sr, 0.002, 0);
  return loopify(out, sr, 1.1, 0.35);
}

function celesta(midi: number): Rendered {
  const sr = 32000;
  const f0 = mtof(midi);
  const T = clamp(3.2 - (midi - 60) * 0.045, 0.9, 3.2);
  const dur = clamp(T * 0.8, 0.8, 2.4);
  const out = new Float32Array(seconds(sr, dur));
  const R = random(midi * 53 + 3);
  const r = (t60: number) => 6.9 / t60;
  partial(out, sr, f0, 0.75, r(T), 0, 0, R() * TAU, 0.0008);
  partial(out, sr, f0 * 1.0009, 0.25, r(T * 0.9), 0, 0, R() * TAU, 0.0008);
  partial(out, sr, f0 * 2, 0.05, r(T * 0.45), 0, 0, R() * TAU, 0.0008);
  partial(out, sr, f0 * 3, 0.03, r(T * 0.3), 0, 0, R() * TAU, 0.0008);
  partial(out, sr, f0 * 4, 0.1, r(T * 0.2), 0, 0, R() * TAU, 0.0008);
  partial(out, sr, f0 * 2.76, 0.08, r(0.12), 0, 0, R() * TAU, 0.0006);
  partial(out, sr, f0 * 5.4, 0.05, r(0.06), 0, 0, R() * TAU, 0.0006);
  partial(out, sr, f0 * 8.93, 0.025, r(0.035), 0, 0, R() * TAU, 0.0006);
  const hp = new Biquad("hp", sr, 2500, 0.7);
  for (let i = 0; i < seconds(sr, 0.006); i++) out[i] += hp.run(R() * 2 - 1) * 0.06 * Math.exp(-i / (sr * 0.0015));
  normalize(out, sr, 0.12, 0.3);
  return { data: fades(out, sr, 0.0005, 0.05), sr };
}

function glass(midi: number): Rendered {
  const sr = 32000;
  const f0 = mtof(midi);
  const T = clamp(4 - (midi - 60) * 0.05, 1.2, 4);
  const dur = clamp(T * 0.7, 1, 2.6);
  const out = new Float32Array(seconds(sr, dur));
  const R = random(midi * 211 + 5);
  const r = (t60: number) => 6.9 / t60;
  partial(out, sr, f0, 0.6, r(T), 0, 0, R() * TAU, 0.0015);
  partial(out, sr, f0 * 1.0014, 0.4, r(T * 0.95), 0, 0, R() * TAU, 0.0015);
  partial(out, sr, f0 * 2, 0.18, r(T * 0.55), 0, 0, R() * TAU, 0.0015);
  partial(out, sr, f0 * 3.01, 0.08, r(T * 0.35), 0, 0, R() * TAU, 0.0015);
  partial(out, sr, f0 * 4.16, 0.06, r(T * 0.2), 0, 0, R() * TAU, 0.001);
  partial(out, sr, f0 * 5.43, 0.035, r(T * 0.12), 0, 0, R() * TAU, 0.001);
  normalize(out, sr, 0.12, 0.3);
  return { data: fades(out, sr, 0.0005, 0.08), sr };
}

function bass(midi: number): Rendered {
  const sr = 16000;
  const f0 = mtof(midi);
  const out = new Float32Array(seconds(sr, 3));
  const R = random(midi * 17 + 1);
  // Strong low harmonics so the line still reads on small speakers.
  const parts: [number, number, number][] = [
    [1, 1, 4.5],
    [2, 0.6, 2.6],
    [3, 0.32, 1.6],
    [4, 0.14, 1],
    [5, 0.07, 0.7],
    [6, 0.035, 0.45],
  ];
  for (const [k, a, t60] of parts) partial(out, sr, f0 * k, a * 0.7, 6.9 / (t60 * 0.35), a * 0.3, 6.9 / t60, R() * TAU, 0.006);
  const lp = new OnePole(sr, 800);
  for (let i = 0; i < seconds(sr, 0.05); i++) out[i] += lp.run(R() * 2 - 1) * 0.12 * Math.exp(-i / (sr * 0.012));
  normalize(out, sr, 0.2, 0.5);
  return { data: fades(out, sr, 0.001, 0.1), sr };
}

/** Karplus-Strong plucked string with a fractional-delay tuning allpass. */
function pluck(
  midi: number,
  sr: number,
  o: { t60: number; bright: number; soft: number; pick: number; dur: number; seed: number },
) {
  const f0 = mtof(midi);
  const P = sr / f0;
  const s = clamp(0.5 - 0.42 * o.bright, 0.08, 0.5);
  const N = Math.max(2, Math.floor(P - s - 0.2));
  const delta = P - s - N;
  const C = (1 - delta) / (1 + delta);
  const g = Math.pow(0.001, 1 / (f0 * o.t60));
  const R = random(o.seed + midi * 97);
  const line = new Float64Array(N);
  // Excitation: soft, low-passed noise with a pick-position comb.
  const lp = new OnePole(sr, 200 + 9000 * (1 - o.soft));
  const raw = new Float64Array(N);
  for (let i = 0; i < N; i++) raw[i] = lp.run(R() * 2 - 1);
  const off = Math.max(1, Math.round(o.pick * N));
  let mean = 0;
  for (let i = 0; i < N; i++) {
    line[i] = raw[i] - (i >= off ? raw[i - off] : 0);
    mean += line[i];
  }
  mean /= N;
  for (let i = 0; i < N; i++) line[i] -= mean;
  const out = new Float32Array(seconds(sr, o.dur));
  let idx = 0,
    prev = 0,
    apx = 0,
    apy = 0;
  for (let i = 0; i < out.length; i++) {
    const x = line[idx];
    const low = (1 - s) * x + s * prev;
    prev = x;
    const ap = C * low + apx - C * apy;
    apx = low;
    apy = ap;
    line[idx] = g * ap;
    idx = idx + 1 === N ? 0 : idx + 1;
    out[i] = x;
  }
  return out;
}

function harp(midi: number): Rendered {
  const sr = 32000;
  const t60 = clamp(6.5 - (midi - 36) * 0.09, 1.3, 6.5);
  const dur = clamp(t60 * 0.6, 1.2, 3.2);
  // Low strings are plucked softer and darker so their fundamentals carry.
  const low = clamp((60 - midi) / 24, 0, 1);
  const out = pluck(midi, sr, {
    t60,
    bright: 0.42 + (midi - 36) * 0.004 - 0.2 * low,
    soft: 0.45 + 0.45 * low,
    pick: 0.13,
    dur,
    seed: 5,
  });
  const body = new Biquad("bp", sr, 230, 1.2);
  const body2 = new Biquad("bp", sr, 520, 1.5);
  const k1 = 0.5 * (1 - 0.7 * low);
  const k2 = 0.25 * (1 - 0.7 * low);
  for (let i = 0; i < out.length; i++) out[i] += body.run(out[i]) * k1 + body2.run(out[i]) * k2;
  normalize(out, sr, 0.13, 0.3);
  return { data: fades(out, sr, 0.0008, 0.08), sr };
}

function pizz(midi: number): Rendered {
  const sr = 24000;
  const t60 = clamp(1.5 - (midi - 28) * 0.013, 0.45, 1.5);
  const out = pluck(midi, sr, { t60, bright: 0.18, soft: 0.7, pick: 0.2, dur: 1.2, seed: 9 });
  const b1 = new Biquad("bp", sr, 275, 3);
  const b2 = new Biquad("bp", sr, 560, 3);
  const b3 = new Biquad("bp", sr, 1150, 2.5);
  const R = random(midi + 400);
  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    out[i] = x * 0.6 + b1.run(x) * 0.9 + b2.run(x) * 0.5 + b3.run(x) * 0.25;
    if (i < sr * 0.004) out[i] += (R() * 2 - 1) * 0.02 * (1 - i / (sr * 0.004));
  }
  normalize(out, sr, 0.18, 0.25);
  return { data: fades(out, sr, 0.0008, 0.1), sr };
}

const INSTRUMENT_RENDER: Record<InstrumentName, (m: number) => Rendered> = {
  piano,
  pad,
  bass,
  strings,
  celesta,
  harp,
  pizz,
  flute,
  harmonium,
  glass,
};

// ------------------------------------------------------------- percussion

const SR = 32000;

function buffer(dur: number, sr = SR) {
  return new Float32Array(seconds(sr, dur));
}

function noiseBurst(
  out: Float32Array,
  sr: number,
  R: () => number,
  o: { start?: number; attack?: number; decay: number; amp: number; filters?: Biquad[]; until?: number },
) {
  const a = Math.floor((o.start ?? 0) * sr);
  const atk = Math.max(1, Math.floor((o.attack ?? 0.0008) * sr));
  const end = Math.min(out.length, a + Math.floor((o.until ?? o.decay * 8) * sr));
  for (let i = a; i < end; i++) {
    const j = i - a;
    const env = (j < atk ? j / atk : 1) * Math.exp(-(j - Math.min(j, atk)) / (o.decay * sr));
    let x = (R() * 2 - 1) * env * o.amp;
    if (o.filters) for (const f of o.filters) x = f.run(x);
    out[i] += x;
  }
}

/** A pitched sweep (sine with an exponential glide). */
function sweep(
  out: Float32Array,
  sr: number,
  o: { start?: number; f0: number; f1: number; glide: number; decay: number; amp: number; attack?: number; harm?: number },
) {
  const a = Math.floor((o.start ?? 0) * sr);
  const atk = Math.max(1, Math.floor((o.attack ?? 0.002) * sr));
  let ph = 0;
  for (let i = a; i < out.length; i++) {
    const t = (i - a) / sr;
    const f = o.f1 + (o.f0 - o.f1) * Math.exp(-t / o.glide);
    ph += (TAU * f) / sr;
    const env = Math.min(1, (i - a) / atk) * Math.exp(-t / o.decay);
    if (env < 1e-5 && t > 0.01) break;
    out[i] += (Math.sin(ph) + (o.harm ?? 0) * Math.sin(2 * ph)) * env * o.amp;
  }
}

/** Damped resonant modes (struck objects). */
function modes(out: Float32Array, sr: number, R: () => number, list: [freq: number, amp: number, decay: number][], start = 0) {
  const a = Math.floor(start * sr);
  for (const [f, amp, d] of list) {
    const tmp = new Float32Array(out.length - a);
    partial(tmp, sr, f, amp, 1 / d, 0, 0, R() * TAU, 0.0005);
    for (let i = 0; i < tmp.length; i++) out[a + i] += tmp[i];
  }
}

const PERC: Record<string, () => Rendered> = {
  kick() {
    const out = buffer(0.55);
    const R = random(1);
    sweep(out, SR, { f0: 105, f1: 50, glide: 0.035, decay: 0.16, amp: 0.8, attack: 0.002, harm: 0.18 });
    noiseBurst(out, SR, R, { decay: 0.004, amp: 0.12, filters: [new Biquad("lp", SR, 2200)] });
    return { data: fades(normalize(out, SR, 0.25, 0.15), SR), sr: SR };
  },
  brush() {
    const out = buffer(0.4);
    const R = random(2);
    noiseBurst(out, SR, R, { decay: 0.05, amp: 0.7, attack: 0.002, filters: [new Biquad("bp", SR, 3400, 0.6)] });
    noiseBurst(out, SR, R, { decay: 0.09, amp: 0.3, filters: [new Biquad("hp", SR, 5200)] });
    sweep(out, SR, { f0: 220, f1: 185, glide: 0.02, decay: 0.03, amp: 0.18 });
    return { data: fades(normalize(out, SR, 0.16, 0.12), SR), sr: SR };
  },
  tick() {
    const out = buffer(0.12);
    noiseBurst(out, SR, random(3), { decay: 0.016, amp: 0.8, filters: [new Biquad("hp", SR, 6000), new Biquad("peak", SR, 9000, 1, 4)] });
    return { data: fades(normalize(out, SR, 0.12, 0.05), SR), sr: SR };
  },
  swish() {
    const out = buffer(0.5);
    const R = random(4);
    const bp = new Biquad("bp", SR, 3000, 0.9);
    const grit = wander(R, SR, 180);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      bp.set(2600 + 3200 * clamp(t / 0.3, 0, 1), 0.9);
      const env = Math.sin(Math.PI * clamp(t / 0.12, 0, 0.5)) * Math.exp(-Math.max(0, t - 0.12) / 0.11);
      out[i] = bp.run(R() * 2 - 1) * env * (0.8 + 0.3 * grit());
    }
    return { data: fades(normalize(out, SR, 0.1, 0.3), SR), sr: SR };
  },
  cymroll() {
    const out = buffer(2.3);
    const R = random(5);
    const f = [new Biquad("bp", SR, 5200, 3), new Biquad("bp", SR, 7100, 3), new Biquad("bp", SR, 9300, 2)];
    const hp = new Biquad("hp", SR, 3000);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const env = t < 1.6 ? Math.pow(t / 1.6, 2.2) : Math.exp(-(t - 1.6) / 0.22);
      const x = hp.run(R() * 2 - 1);
      out[i] = (f[0].run(x) + f[1].run(x) + f[2].run(x) * 0.8 + x * 0.25) * env;
    }
    normalize(out, SR, 0.1, 2.3);
    return { data: fades(out, SR, 0.01, 0.05), sr: SR };
  },
  doum() {
    const out = buffer(0.7);
    const R = random(6);
    const f1 = 92;
    sweep(out, SR, { f0: 112, f1, glide: 0.04, decay: 0.2, amp: 0.7, attack: 0.002 });
    modes(out, SR, R, [
      [f1 * 1.52, 0.22, 0.1],
      [f1 * 2.02, 0.13, 0.07],
      [f1 * 2.42, 0.08, 0.05],
      [f1 * 2.91, 0.05, 0.04],
    ]);
    noiseBurst(out, SR, R, { decay: 0.01, amp: 0.25, filters: [new Biquad("lp", SR, 600)] });
    return { data: fades(normalize(out, SR, 0.24, 0.15), SR), sr: SR };
  },
  tek() {
    const out = buffer(0.25);
    const R = random(7);
    modes(out, SR, R, [
      [420, 0.4, 0.05],
      [610, 0.3, 0.04],
      [890, 0.22, 0.03],
      [1340, 0.13, 0.02],
    ]);
    noiseBurst(out, SR, R, { decay: 0.012, amp: 0.55, filters: [new Biquad("bp", SR, 2300, 0.9)] });
    return { data: fades(normalize(out, SR, 0.16, 0.08), SR), sr: SR };
  },
  shaker() {
    const out = buffer(0.16);
    const R = random(8);
    const hp = new Biquad("hp", SR, 4200);
    for (let g = 0; g < 14; g++) {
      const at = Math.floor(SR * (0.004 + Math.pow(R(), 1.6) * 0.06));
      grain(out, at, Math.floor(SR * (0.002 + R() * 0.004)), 0.3 + R() * 0.5, R, hp);
    }
    return { data: fades(normalize(out, SR, 0.08, 0.08), SR), sr: SR };
  },
  shaker2() {
    const out = buffer(0.45);
    const R = random(9);
    const hp = new Biquad("hp", SR, 3800);
    for (let g = 0; g < 50; g++) {
      const u = R();
      const at = Math.floor(SR * (0.02 + u * 0.32));
      const env = Math.sin(Math.PI * u);
      grain(out, at, Math.floor(SR * (0.002 + R() * 0.004)), (0.2 + R() * 0.5) * env, R, hp);
    }
    return { data: fades(normalize(out, SR, 0.07, 0.4), SR), sr: SR };
  },
  shakeroll() {
    const out = buffer(2.1);
    const R = random(10);
    const hp = new Biquad("hp", SR, 3600);
    for (let g = 0; g < 420; g++) {
      const t = Math.pow(R(), 0.6) * 1.62;
      const env = Math.pow(t / 1.62, 2);
      grain(out, Math.floor(SR * t), Math.floor(SR * (0.002 + R() * 0.004)), (0.25 + R() * 0.5) * env, R, hp);
    }
    for (let i = Math.floor(SR * 1.62); i < out.length; i++) out[i] *= Math.exp(-(i / SR - 1.62) / 0.12);
    normalize(out, SR, 0.07, 2.1);
    return { data: fades(out, SR, 0.01, 0.05), sr: SR };
  },
};

// --------------------------------------------------------------- footsteps

export const SURFACES = ["grass", "stone", "bronze", "wood", "gravel", "glass", "soft"] as const;
export type Surface = (typeof SURFACES)[number];

function step(surface: Surface, v: number): Rendered {
  const R = random(1000 + v * 37 + SURFACES.indexOf(surface) * 1000);
  const out = buffer(surface === "bronze" ? 0.4 : 0.26);
  const tap = (amp: number, freq: number) =>
    noiseBurst(out, SR, R, { decay: 0.0014, amp, filters: [new Biquad("bp", SR, freq, 1)] });
  const scuff = (start: number, amp: number, lp: number) =>
    noiseBurst(out, SR, R, { start, attack: 0.006, decay: 0.03, amp, filters: [new Biquad("lp", SR, lp), new Biquad("hp", SR, 500)] });
  const v1 = 0.85 + R() * 0.3;
  switch (surface) {
    case "grass": {
      sweep(out, SR, { f0: 120 * v1, f1: 85 * v1, glide: 0.02, decay: 0.03, amp: 0.25 });
      const hp = new Biquad("hp", SR, 1700 + R() * 600);
      const lp = new Biquad("lp", SR, 7000);
      for (let g = 0; g < 70; g++) {
        const t = Math.pow(R(), 1.8) * 0.13;
        const a = (0.3 + R() * 0.7) * Math.exp(-t / 0.06);
        grain(out, Math.floor(SR * t), Math.floor(SR * (0.0008 + R() * 0.003)), a * 0.55, R, hp);
      }
      const late = 0.045 + R() * 0.03;
      for (let g = 0; g < 25; g++) {
        const t = late + Math.pow(R(), 1.5) * 0.07;
        grain(out, Math.floor(SR * t), Math.floor(SR * (0.0008 + R() * 0.002)), (0.2 + R() * 0.4) * 0.4, R, lp);
      }
      break;
    }
    case "stone":
    case "gravel": {
      tap(0.5, 3200 * v1);
      noiseBurst(out, SR, R, { decay: 0.016, amp: 0.45, filters: [new Biquad("bp", SR, (1500 + R() * 800) * v1, 4)] });
      sweep(out, SR, { f0: 190 * v1, f1: 150 * v1, glide: 0.015, decay: 0.02, amp: 0.3 });
      scuff(0.02 + R() * 0.02, 0.12, 5000);
      if (surface === "gravel") {
        const lp = new Biquad("lp", SR, 6000);
        for (let g = 0; g < 34; g++) {
          const t = R() * 0.1;
          grain(out, Math.floor(SR * t), Math.floor(SR * (0.0003 + R() * 0.001)), (0.3 + R() * 0.6) * 0.45, R, lp);
        }
      }
      break;
    }
    case "bronze": {
      tap(0.35, 3600);
      const f = (680 + R() * 220) * v1;
      modes(out, SR, R, [
        [f, 0.18, 0.18],
        [f * 1.58, 0.13, 0.12],
        [f * 2.42, 0.1, 0.09],
        [f * 3.37, 0.07, 0.06],
        [f * 4.6, 0.04, 0.04],
      ]);
      sweep(out, SR, { f0: 210, f1: 185, glide: 0.03, decay: 0.05, amp: 0.2 });
      break;
    }
    case "wood": {
      tap(0.4, 2600);
      modes(out, SR, R, [
        [190 * v1, 0.4, 0.05],
        [410 * v1, 0.3, 0.035],
        [720 * v1, 0.22, 0.025],
        [1150 * v1, 0.12, 0.015],
      ]);
      scuff(0.025, 0.08, 4000);
      break;
    }
    case "glass": {
      tap(0.4, 4500);
      const f = (2350 + R() * 400) * v1;
      modes(out, SR, R, [
        [f, 0.12, 0.09],
        [f * 1.65, 0.09, 0.06],
        [f * 2.39, 0.06, 0.04],
        [f * 3.15, 0.04, 0.03],
      ]);
      break;
    }
    case "soft": {
      noiseBurst(out, SR, R, { decay: 0.004, amp: 0.4, filters: [new Biquad("lp", SR, 2200)] });
      sweep(out, SR, { f0: 420 * v1, f1: 380 * v1, glide: 0.01, decay: 0.018, amp: 0.25 });
      break;
    }
  }
  normalize(out, SR, 0.14, 0.08);
  return { data: fades(out, SR, 0.0005, 0.03), sr: SR };
}

// ------------------------------------------------------------------ effects

const FX: Record<string, () => Rendered> = {
  whoosh() {
    const out = buffer(0.45);
    const R = random(21);
    const bp = new Biquad("bp", SR, 500, 1.1);
    const lp = new Biquad("lp", SR, 700);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      bp.set(450 * Math.pow(5, clamp(t / 0.26, 0, 1)), 1.1);
      const env = Math.sin(Math.PI * clamp(t / 0.12, 0, 0.5)) * Math.exp(-Math.max(0, t - 0.06) / 0.11);
      const w = R() * 2 - 1;
      out[i] = (bp.run(w) * 0.9 + lp.run(w) * 0.25) * env;
    }
    return { data: fades(normalize(out, SR, 0.12, 0.3), SR), sr: SR };
  },
  lift() {
    // A breathy rising tone ending on A5; retuned per key at runtime.
    const out = buffer(0.36);
    const R = random(22);
    const bp = new Biquad("bp", SR, 1760, 3);
    let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const m = 76 + 5 * (1 - Math.exp(-t / 0.035));
      const f = mtof(m);
      ph += f / SR;
      const env = clamp(t / 0.012, 0, 1) * Math.exp(-Math.max(0, t - 0.05) / 0.08);
      const s = Math.sin(TAU * ph) + 0.18 * Math.sin(2 * TAU * ph) + 0.06 * Math.sin(3 * TAU * ph);
      bp.set(f * 2, 3);
      out[i] = (s + bp.run(R() * 2 - 1) * 0.6) * env;
    }
    return { data: fades(normalize(out, SR, 0.14, 0.15), SR), sr: SR };
  },
  thud() {
    const out = buffer(0.5);
    const R = random(23);
    sweep(out, SR, { f0: 135, f1: 52, glide: 0.04, decay: 0.09, amp: 0.8, harm: 0.3 });
    noiseBurst(out, SR, R, { decay: 0.02, amp: 0.35, filters: [new Biquad("lp", SR, 320)] });
    return { data: fades(normalize(out, SR, 0.25, 0.12), SR), sr: SR };
  },
  dust() {
    const out = buffer(0.8);
    const R = random(24);
    const bp = new Biquad("bp", SR, 2600, 0.6);
    for (let g = 0; g < 160; g++) {
      const t = Math.pow(R(), 2) * 0.55;
      grain(out, Math.floor(SR * t), Math.floor(SR * (0.0005 + R() * 0.0025)), (0.2 + R() * 0.6) * Math.exp(-t / 0.2), R, bp);
    }
    noiseBurst(out, SR, R, { attack: 0.01, decay: 0.15, amp: 0.35, filters: [new Biquad("lp", SR, 1200)] });
    return { data: fades(normalize(out, SR, 0.1, 0.3), SR), sr: SR };
  },
  knock() {
    const out = buffer(0.3);
    const R = random(25);
    sweep(out, SR, { f0: 230, f1: 140, glide: 0.02, decay: 0.035, amp: 0.7, harm: 0.2 });
    noiseBurst(out, SR, R, { decay: 0.02, amp: 0.4, filters: [new Biquad("lp", SR, 900)] });
    noiseBurst(out, SR, R, { decay: 0.002, amp: 0.25, filters: [new Biquad("bp", SR, 2500, 1)] });
    return { data: fades(normalize(out, SR, 0.2, 0.1), SR), sr: SR };
  },
  paper() {
    const out = buffer(0.62);
    const R = random(26);
    for (let g = 0; g < 140; g++) {
      const t = Math.pow(R(), 1.3) * 0.36;
      const f = new Biquad("bp", SR, 2000 + R() * 6000, 1.5);
      grain(out, Math.floor(SR * t), Math.floor(SR * (0.0005 + R() * 0.002)), 0.25 + R() * 0.6, R, f);
    }
    const bp = new Biquad("bp", SR, 3000, 0.8);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      bp.set(3200 - 2000 * clamp(t / 0.35, 0, 1), 0.8);
      const env = Math.sin(Math.PI * clamp(t / 0.1, 0, 0.5)) * Math.exp(-Math.max(0, t - 0.05) / 0.12);
      out[i] += bp.run(R() * 2 - 1) * env * 0.6;
    }
    noiseBurst(out, SR, R, { start: 0.32, attack: 0.004, decay: 0.03, amp: 0.4, filters: [new Biquad("lp", SR, 500)] });
    return { data: fades(normalize(out, SR, 0.12, 0.4), SR), sr: SR };
  },
  bloom() {
    // A glassy chord that swells outward, voiced on A (retuned per key).
    const out = buffer(2);
    const R = random(27);
    const voices: [number, number, number][] = [
      [0, 0.35, 0.05],
      [7, 0.28, 0.09],
      [12, 0.3, 0.13],
      [16, 0.2, 0.18],
      [19, 0.17, 0.23],
      [24, 0.12, 0.3],
    ];
    for (const [semi, amp, delay] of voices) {
      const f = mtof(57 + semi);
      for (const det of [1, 1.0016]) {
        let ph = R();
        const a0 = Math.floor(delay * SR);
        for (let i = a0; i < out.length; i++) {
          const t = (i - a0) / SR;
          const bend = 1 + 0.008 * (1 - Math.exp(-t / 0.12));
          ph += (f * det * bend) / SR;
          const env = (1 - Math.exp(-t / 0.09)) * Math.exp(-t / (1.1 - semi * 0.02));
          out[i] += (Math.sin(TAU * ph) + 0.12 * Math.sin(2 * TAU * ph)) * env * amp * 0.5;
        }
      }
    }
    const bp = new Biquad("bp", SR, 1500, 1);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      bp.set(1500 + 3000 * clamp(t / 0.4, 0, 1), 1);
      out[i] += bp.run(R() * 2 - 1) * 0.12 * Math.sin(Math.PI * clamp(t / 0.5, 0, 1));
    }
    return { data: fades(normalize(out, SR, 0.12, 1), SR, 0.002, 0.1), sr: SR };
  },
  sparkle() {
    const out = buffer(1);
    const R = random(28);
    for (let p = 0; p < 46; p++) {
      const t = Math.pow(R(), 1.7) * 0.65;
      const f = 3000 * Math.pow(3, R());
      const tmp = new Float32Array(seconds(SR, 0.12));
      partial(tmp, SR, f, 0.12 + R() * 0.2, 1 / (0.015 + R() * 0.04), 0, 0, 0, 0.0005);
      const a = Math.floor(t * SR);
      for (let i = 0; i < tmp.length && a + i < out.length; i++) out[a + i] += tmp[i] * Math.exp(-t / 0.4);
    }
    noiseBurst(out, SR, R, { decay: 0.12, amp: 0.05, filters: [new Biquad("hp", SR, 6500)] });
    return { data: fades(normalize(out, SR, 0.06, 0.6), SR), sr: SR };
  },
  ignite() {
    const out = buffer(1);
    const R = random(29);
    const lp = new Biquad("lp", SR, 200, 1.2);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const cut = t < 0.18 ? 150 * Math.pow(3500 / 150, t / 0.18) : 800 + 2700 * Math.exp(-(t - 0.18) / 0.15);
      lp.set(cut, 1.2);
      const env = clamp(t / 0.1, 0, 1) * Math.exp(-Math.max(0, t - 0.1) / 0.25);
      out[i] = lp.run(R() * 2 - 1) * env;
    }
    // Fire crackle: short band-limited pops, never single-sample ticks.
    for (let g = 0; g < 26; g++) {
      const t = 0.05 + R() * 0.6;
      const pop = new Biquad("bp", SR, 1800 + R() * 2600, 1.1);
      grain(out, Math.floor(SR * t), Math.floor(SR * (0.0012 + R() * 0.0015)), (0.3 + R() * 0.6) * Math.exp(-t / 0.4), R, pop);
    }
    sweep(out, SR, { f0: 80, f1: 55, glide: 0.06, decay: 0.18, amp: 0.25, attack: 0.03 });
    return { data: fades(normalize(out, SR, 0.14, 0.4), SR), sr: SR };
  },
  grind() {
    const out = buffer(1.25);
    const R = random(30);
    const brown = brownSource(R);
    const rough = wander(R, SR, 28);
    const b1 = new Biquad("bp", SR, 320, 0.8);
    const b2 = new Biquad("bp", SR, 900, 2);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const env = clamp(t / 0.1, 0, 1) * clamp((1.25 - t) / 0.25, 0, 1);
      const r = 0.55 + 0.45 * Math.abs(rough());
      const w = brown() * 0.6 + (R() * 2 - 1) * 0.4;
      out[i] = (b1.run(w) + b2.run(w) * 0.5) * r * env + Math.sin(TAU * 46 * t) * 0.12 * env * r;
    }
    const lp = new Biquad("lp", SR, 3000);
    for (let g = 0; g < 70; g++) {
      const t = 0.05 + R() * 1.1;
      grain(out, Math.floor(SR * t), Math.floor(SR * (0.0005 + R() * 0.002)), 0.15 + R() * 0.3, R, lp);
    }
    return { data: fades(normalize(out, SR, 0.14, 1), SR, 0.01, 0.05), sr: SR };
  },
  settle() {
    const out = buffer(1.1);
    const R = random(31);
    sweep(out, SR, { f0: 78, f1: 40, glide: 0.08, decay: 0.16, amp: 0.8, harm: 0.25 });
    noiseBurst(out, SR, R, { decay: 0.0018, amp: 0.4, filters: [new Biquad("bp", SR, 2400, 1)] });
    noiseBurst(out, SR, R, { decay: 0.02, amp: 0.4, filters: [new Biquad("bp", SR, 1300, 3)] });
    const bp = new Biquad("bp", SR, 2200, 0.6);
    for (let g = 0; g < 120; g++) {
      const t = 0.02 + Math.pow(R(), 2) * 0.7;
      grain(out, Math.floor(SR * t), Math.floor(SR * (0.0005 + R() * 0.002)), (0.2 + R() * 0.5) * Math.exp(-t / 0.3), R, bp);
    }
    noiseBurst(out, SR, R, { attack: 0.02, decay: 0.25, amp: 0.2, filters: [new Biquad("lp", SR, 220)] });
    return { data: fades(normalize(out, SR, 0.22, 0.25), SR), sr: SR };
  },
  crackle() {
    const out = buffer(0.75);
    const R = random(32);
    for (let g = 0; g < 180; g++) {
      const t = Math.pow(R(), 1.6) * 0.6;
      const f = new Biquad("bp", SR, 1500 + R() * 4500, 5);
      grain(out, Math.floor(SR * t), Math.floor(SR * (0.0004 + R() * 0.003)), (0.4 + R() * 0.8) * Math.exp(-t / 0.2), R, f);
    }
    let ph = 0;
    let f = 70;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      if (i % 400 === 0) f = 55 + R() * 45;
      ph += f / SR;
      const saw = (ph % 1) * 2 - 1;
      const gate = R() < 0.6 ? 1 : 0.3;
      out[i] = soft(out[i] * 3 + saw * 0.3 * gate * Math.exp(-t / 0.15)) * 0.6;
    }
    return { data: fades(normalize(out, SR, 0.18, 0.3), SR), sr: SR };
  },
  fall() {
    const out = buffer(1.35);
    const R = random(33);
    const bp = new Biquad("bp", SR, 2000, 2.5);
    let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const f = 2200 * Math.pow(180 / 2200, clamp(t / 1.15, 0, 1));
      bp.set(f, 2.5);
      const env = clamp(t / 0.1, 0, 1) * clamp((1.35 - t) / 0.45, 0, 1);
      ph += (f * 0.5) / SR;
      out[i] = (bp.run(R() * 2 - 1) + Math.sin(TAU * ph) * 0.05) * env;
    }
    return { data: fades(normalize(out, SR, 0.12, 1), SR), sr: SR };
  },
  riser() {
    const out = buffer(1);
    const R = random(34);
    const bp = new Biquad("bp", SR, 300, 3);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      bp.set(300 * Math.pow(5200 / 300, clamp(t / 0.9, 0, 1)), 3);
      const env = Math.pow(clamp(t / 0.9, 0, 1), 1.5) * clamp((1 - t) / 0.1, 0, 1);
      out[i] = bp.run(R() * 2 - 1) * env;
    }
    return { data: fades(normalize(out, SR, 0.1, 1), SR), sr: SR };
  },
  lock() {
    const out = buffer(0.3);
    const R = random(35);
    noiseBurst(out, SR, R, { decay: 0.002, amp: 0.3, filters: [new Biquad("bp", SR, 3000, 1)] });
    modes(out, SR, R, [
      [320, 0.4, 0.05],
      [760, 0.28, 0.03],
      [1460, 0.16, 0.02],
    ]);
    sweep(out, SR, { f0: 130, f1: 110, glide: 0.02, decay: 0.03, amp: 0.3 });
    return { data: fades(normalize(out, SR, 0.16, 0.1), SR), sr: SR };
  },
  page() {
    const out = buffer(0.45);
    const R = random(36);
    const bp = new Biquad("bp", SR, 2500, 0.9);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      bp.set(2500 + 2200 * clamp(t / 0.18, 0, 1), 0.9);
      const env = Math.sin(Math.PI * clamp(t / 0.18, 0, 1));
      out[i] = bp.run(R() * 2 - 1) * env * 0.6;
    }
    for (let g = 0; g < 40; g++) {
      const t = 0.02 + R() * 0.2;
      grain(out, Math.floor(SR * t), Math.floor(SR * (0.0005 + R() * 0.0015)), 0.3 + R() * 0.4, R, new Biquad("bp", SR, 3000 + R() * 4000, 1.5));
    }
    noiseBurst(out, SR, R, { start: 0.2, attack: 0.004, decay: 0.03, amp: 0.3, filters: [new Biquad("lp", SR, 600)] });
    return { data: fades(normalize(out, SR, 0.1, 0.3), SR), sr: SR };
  },
  tick() {
    const out = buffer(0.06);
    const R = random(37);
    noiseBurst(out, SR, R, { decay: 0.0008, amp: 0.4, filters: [new Biquad("bp", SR, 4000, 1)] });
    modes(out, SR, R, [
      [1800, 0.3, 0.008],
      [900, 0.25, 0.012],
    ]);
    return { data: fades(normalize(out, SR, 0.12, 0.03), SR), sr: SR };
  },
};

// ---------------------------------------------------------------- ambience

const AMB: Record<string, () => Rendered> = {
  wind() {
    const sr = 22050;
    const out = buffer(10.5, sr);
    const R = random(41);
    const pink = pinkSource(R);
    const brown = brownSource(R);
    const lp = new OnePole(sr, 600);
    const whistle = new Biquad("bp", sr, 900, 6);
    const gust = wander(R, sr, 0.25);
    const gust2 = wander(R, sr, 0.9);
    for (let i = 0; i < out.length; i++) {
      const g = 0.55 + 0.35 * gust() + 0.1 * gust2();
      lp.set(250 + 900 * g);
      const x = pink() * 0.7 + brown() * 0.3;
      if (i % 64 === 0) whistle.set(700 + 500 * g, 6);
      out[i] = lp.run(x) * g + whistle.run(x) * 0.15 * g * g;
    }
    normalize(out, sr, 0.2, 10);
    return loopify(out, sr, 0.5, 0.5);
  },
  surf() {
    const sr = 22050;
    const out = buffer(12.5, sr);
    const R = random(42);
    const pink = pinkSource(R);
    const lp = new Biquad("lp", sr, 400, 0.6);
    const hp = new Biquad("hp", sr, 3000);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const w = 0.5 - 0.5 * Math.cos((TAU * t) / 6);
      const env = 0.25 + 0.75 * Math.pow(w, 1.6);
      if (i % 64 === 0) lp.set(260 + 1200 * env, 0.6);
      const x = pink();
      out[i] = lp.run(x) * env + hp.run(x) * Math.pow(w, 4) * 0.25;
    }
    normalize(out, sr, 0.2, 12);
    return loopify(out, sr, 0.5, 0.5);
  },
  water() {
    const out = buffer(6.5);
    const R = random(43);
    for (let b = 0; b < 300; b++) {
      const t0 = R() * 6.4;
      const f0 = 500 * Math.pow(5, R());
      const d = 0.012 + R() * 0.04;
      const amp = 0.02 + R() * 0.1;
      const a = Math.floor(t0 * SR);
      let ph = 0;
      for (let i = 0; i < d * 4 * SR && a + i < out.length; i++) {
        const t = i / SR;
        const f = f0 * (1 + 0.6 * (1 - Math.exp(-t / d)));
        ph += f / SR;
        out[a + i] += Math.sin(TAU * ph) * amp * Math.exp(-t / (d * 0.6)) * Math.min(1, i / 20);
      }
    }
    const bp = new Biquad("bp", SR, 1800, 0.5);
    const mod = wander(R, SR, 30);
    for (let i = 0; i < out.length; i++) out[i] += bp.run(R() * 2 - 1) * 0.06 * (0.6 + 0.4 * mod());
    normalize(out, SR, 0.12, 6);
    return loopify(out, SR, 0.5, 0.5);
  },
  crickets() {
    const out = buffer(5.5);
    const R = random(44);
    for (const [f, rate, amp] of [
      [4400, 2.1, 1],
      [4950, 1.6, 0.7],
    ]) {
      let t = R() * 0.4;
      while (t < 5.4) {
        for (let p = 0; p < 3; p++) {
          const a = Math.floor((t + p * 0.024) * SR);
          const len = Math.floor(0.014 * SR);
          for (let i = 0; i < len && a + i < out.length; i++) {
            const w = Math.sin((Math.PI * i) / len);
            const ph = (TAU * f * i) / SR;
            out[a + i] += (Math.sin(ph) + 0.1 * Math.sin(2 * ph)) * w * w * amp * 0.3;
          }
        }
        t += 1 / rate + (R() - 0.5) * 0.08;
      }
    }
    normalize(out, SR, 0.06, 5);
    return loopify(out, SR, 0.4, 0.3);
  },
  cicada() {
    const out = buffer(6);
    const R = random(45);
    const b1 = new Biquad("bp", SR, 5000, 2);
    const b2 = new Biquad("bp", SR, 4200, 3);
    let ph = 0;
    const flutter = wander(R, SR, 10);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const env = t < 2.2 ? Math.pow(t / 2.2, 1.5) : t < 3.7 ? 1 : Math.exp(-(t - 3.7) / 0.7);
      ph += (190 + 10 * t) / SR;
      const pulse = Math.pow(Math.max(0, Math.sin(TAU * ph)), 6);
      const x = (R() * 2 - 1) * pulse;
      out[i] = (b1.run(x) + b2.run(x) * 0.6) * env * (0.8 + 0.2 * flutter());
    }
    normalize(out, SR, 0.08, 6);
    return { data: fades(out, SR, 0.02, 0.2), sr: SR };
  },
  clocktick() {
    const out = buffer(0.08);
    const R = random(46);
    noiseBurst(out, SR, R, { decay: 0.0008, amp: 0.4, filters: [new Biquad("hp", SR, 3000)] });
    modes(out, SR, R, [
      [3100, 0.25, 0.012],
      [4600, 0.18, 0.008],
      [6200, 0.1, 0.005],
    ]);
    return { data: fades(normalize(out, SR, 0.1, 0.04), SR), sr: SR };
  },
  clocktock() {
    const out = buffer(0.1);
    const R = random(47);
    noiseBurst(out, SR, R, { decay: 0.001, amp: 0.35, filters: [new Biquad("bp", SR, 2000, 1)] });
    modes(out, SR, R, [
      [1500, 0.25, 0.014],
      [2300, 0.18, 0.01],
      [700, 0.2, 0.02],
    ]);
    return { data: fades(normalize(out, SR, 0.1, 0.05), SR), sr: SR };
  },
  gear() {
    const out = buffer(0.8);
    const R = random(48);
    for (let k = 0; k < 6; k++) {
      const at = 0.02 + k * (0.045 + R() * 0.015);
      modes(out, SR, R, [
        [2600 + R() * 600, 0.12 * (1 - k * 0.1), 0.01],
        [4100, 0.06, 0.006],
      ], at);
    }
    modes(out, SR, R, [
      [180, 0.35, 0.18],
      [410, 0.22, 0.12],
      [690, 0.14, 0.08],
      [1130, 0.08, 0.05],
    ], 0.33);
    noiseBurst(out, SR, R, { start: 0.33, decay: 0.003, amp: 0.3, filters: [new Biquad("bp", SR, 1800, 1)] });
    return { data: fades(normalize(out, SR, 0.12, 0.6), SR), sr: SR };
  },
  rustle() {
    const out = buffer(0.8);
    const R = random(49);
    for (let g = 0; g < 110; g++) {
      const u = R();
      const t = 0.05 + u * 0.6;
      // Distant paper: soft, slightly longer grains in a lower band.
      const f = new Biquad("bp", SR, 1800 + R() * 3200, 1);
      grain(out, Math.floor(SR * t), Math.floor(SR * (0.0012 + R() * 0.002)), (0.2 + R() * 0.5) * Math.sin(Math.PI * u), R, f);
    }
    return { data: fades(normalize(out, SR, 0.06, 0.7), SR), sr: SR };
  },
  choir() {
    // "Ah" morphing to "oo", voiced on A3; retuned per key at runtime.
    const sr = 22050;
    const loop = 3.6;
    const out = buffer(loop + 0.5, sr);
    const R = random(50);
    const f0 = mtof(57);
    const saw = table(Array.from({ length: Math.floor(4000 / f0) }, (_, k) => 1 / (k + 1)));
    const voices = [-12, -6, 0, 6, 12].map((c) => ({ r: Math.pow(2, c / 1200), ph: R(), vr: 4.5 + R(), vp: R() * TAU }));
    const F = [new Biquad("bp", sr, 700, 6), new Biquad("bp", sr, 1100, 8), new Biquad("bp", sr, 2600, 10)];
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let s = 0;
      for (const v of voices) {
        v.ph += (f0 * v.r * (1 + 0.003 * Math.sin(TAU * v.vr * t + v.vp))) / sr;
        v.ph -= Math.floor(v.ph);
        s += readTable(saw, v.ph);
      }
      s += (R() * 2 - 1) * 0.15;
      if (i % 32 === 0) {
        const m = 0.5 + 0.5 * Math.sin((TAU * t) / 4.1);
        F[0].set(700 - 360 * m, 6);
        F[1].set(1100 - 230 * m, 8);
        F[2].set(2600 - 300 * m, 10);
      }
      out[i] = F[0].run(s) + F[1].run(s) * 0.55 + F[2].run(s) * 0.22;
    }
    normalize(out, sr, 0.12, 4);
    return loopify(out, sr, 0.5, 0.5);
  },
  drone() {
    // Tension: a minor-second rub on A1 with a glassy tritone above.
    const sr = 22050;
    const out = buffer(6.5, sr);
    const R = random(51);
    const f0 = 55;
    const saw = table(Array.from({ length: 22 }, (_, k) => Math.exp(-((k + 1) * f0) / 600) / (k + 1)));
    const vs = [
      { f: f0, a: 1, ph: R() },
      { f: f0 * Math.pow(2, 1 / 12), a: 0.55, ph: R() },
      { f: f0 * Math.pow(2, 18 / 12), a: 0.22, ph: R() },
      { f: f0 * 1.003, a: 0.5, ph: R() },
    ];
    const brown = brownSource(R);
    const lp = new Biquad("lp", sr, 180);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let s = 0;
      for (const v of vs) {
        v.ph += v.f / sr;
        v.ph -= Math.floor(v.ph);
        s += readTable(saw, v.ph) * v.a;
      }
      s += lp.run(brown()) * 0.5;
      const pulse = 0.8 + 0.2 * Math.sin((TAU * t) / 2);
      const glassA = Math.sin(TAU * 1244.5 * t) + Math.sin(TAU * 1244.5 * 1.0035 * t);
      const glassB = Math.sin(TAU * 1661.2 * t) * 0.6;
      s += (glassA * 0.035 + glassB * 0.025) * (0.6 + 0.4 * Math.sin((TAU * t) / 1.5));
      out[i] = s * pulse;
    }
    normalize(out, sr, 0.2, 6);
    return loopify(out, sr, 0.5, 0.5);
  },
};

function bird(kind: "morning" | "dawn", v: number): Rendered {
  const out = buffer(1.6);
  const R = random(600 + v * 13 + (kind === "dawn" ? 300 : 0));
  let t = 0.02;
  const syllables = kind === "dawn" ? 3 + Math.floor(R() * 3) : 2 + Math.floor(R() * 5);
  const pent = [0, 2, 4, 7, 9, 12];
  const baseF = kind === "dawn" ? 1700 + R() * 600 : 2600 + R() * 1500;
  for (let s = 0; s < syllables && t < 1.4; s++) {
    const type = kind === "dawn" ? (R() < 0.75 ? "whistle" : "warble") : (["whistle", "chirp", "trill", "warble"] as const)[Math.floor(R() * 4)];
    const a = Math.floor(t * SR);
    let ph = 0;
    let len = 0;
    if (type === "whistle") {
      len = 0.08 + R() * 0.18;
      const f1 = baseF * Math.pow(2, pent[Math.floor(R() * pent.length)] / 12);
      const f2 = f1 * (0.85 + R() * 0.35);
      for (let i = 0; i < len * SR && a + i < out.length; i++) {
        const u = i / (len * SR);
        const f = f1 + (f2 - f1) * u;
        ph += f / SR;
        const env = Math.sin(Math.PI * Math.min(1, u * 1.2)) ** 1.5;
        out[a + i] += (Math.sin(TAU * ph) + 0.06 * Math.sin(2 * TAU * ph)) * env * 0.5;
      }
    } else if (type === "chirp") {
      len = 0.03 + R() * 0.03;
      const f1 = baseF * 2;
      for (let i = 0; i < len * SR && a + i < out.length; i++) {
        const u = i / (len * SR);
        const f = f1 * (1 - 0.5 * u);
        ph += f / SR;
        out[a + i] += Math.sin(TAU * ph) * Math.sin(Math.PI * u) * 0.5;
      }
    } else if (type === "trill") {
      len = 0.25 + R() * 0.35;
      const rate = 13 + R() * 6;
      for (let i = 0; i < len * SR && a + i < out.length; i++) {
        const tt = i / SR;
        const u = tt * rate;
        const f = baseF * (1.2 - 0.3 * (u % 1));
        ph += f / SR;
        out[a + i] += Math.sin(TAU * ph) * Math.pow(Math.sin(Math.PI * (u % 1)), 2) * Math.sin(Math.PI * (i / (len * SR))) * 0.45;
      }
    } else {
      len = 0.18 + R() * 0.22;
      const fc = baseF * (0.9 + R() * 0.3);
      for (let i = 0; i < len * SR && a + i < out.length; i++) {
        const tt = i / SR;
        const f = fc + fc * 0.12 * Math.sin(TAU * 24 * tt);
        ph += f / SR;
        out[a + i] += Math.sin(TAU * ph) * Math.sin(Math.PI * (i / (len * SR))) * 0.45;
      }
    }
    t += len + 0.02 + R() * (kind === "dawn" ? 0.12 : 0.09);
  }
  return { data: fades(normalize(out, SR, 0.08, 1.2), SR), sr: SR };
}

// ----------------------------------------------------------------- catalog

export const BIRDS = { morning: 6, dawn: 4 };
export const STEP_VARIANTS = 4;

export function renderKey(key: string): Rendered {
  const [kind, name, arg] = key.split(":");
  if (kind === "inst") return INSTRUMENT_RENDER[name as InstrumentName](Number(arg));
  if (kind === "perc") return PERC[name]();
  if (kind === "sfx") return FX[name]();
  if (kind === "step") return step(name as Surface, Number(arg));
  if (kind === "bird") return bird(name as "morning" | "dawn", Number(arg));
  if (kind === "amb") return AMB[name]();
  throw new Error(`Unknown sample ${key}`);
}

const instKeys = (name: InstrumentName) => ROOTS[name].map((m) => `inst:${name}:${m}`);

/**
 * Every sample, in render order: what the first bars of music and the most
 * common effects need comes first, rarer material later.
 */
export function allKeys(first: "sculpted" | "illustrated" = "sculpted"): string[] {
  const steps = SURFACES.flatMap((s) => Array.from({ length: STEP_VARIANTS }, (_, i) => `step:${s}:${i}`));
  const core = ["sfx:whoosh", "sfx:lift", "sfx:thud", "step:stone:0", "step:grass:0", "sfx:tick"];
  const sculptedFirst = ["pad", "bass", "piano"].flatMap((n) => instKeys(n as InstrumentName));
  const illustratedFirst = ["harmonium", "harp", "flute"].flatMap((n) => instKeys(n as InstrumentName));
  const sculptedRest = ["strings"].flatMap((n) => instKeys(n as InstrumentName));
  const illustratedRest = ["celesta", "pizz"].flatMap((n) => instKeys(n as InstrumentName));
  const kits = ["perc:kick", "perc:brush", "perc:tick", "perc:swish", "perc:doum", "perc:tek", "perc:shaker", "perc:shaker2", "perc:cymroll", "perc:shakeroll"];
  const music =
    first === "sculpted"
      ? [...sculptedFirst, ...illustratedFirst, ...sculptedRest, ...illustratedRest]
      : [...illustratedFirst, ...sculptedFirst, ...illustratedRest, ...sculptedRest];
  const fx = Object.keys(FX).map((k) => `sfx:${k}`);
  const amb = Object.keys(AMB).map((k) => `amb:${k}`);
  const birds = [
    ...Array.from({ length: BIRDS.morning }, (_, i) => `bird:morning:${i}`),
    ...Array.from({ length: BIRDS.dawn }, (_, i) => `bird:dawn:${i}`),
  ];
  const all = [...core, ...music, ...kits, ...instKeys("glass"), ...fx, "amb:wind", ...steps, ...amb, ...birds];
  return all.filter((k, i) => all.indexOf(k) === i);
}
