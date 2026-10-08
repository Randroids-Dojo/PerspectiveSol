/**
 * Offline DSP building blocks for rendering instrument notes, effects and
 * ambience into sample buffers. Pure TypeScript, safe in a worker.
 */

export const TAU = Math.PI * 2;
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export type Rendered = {
  data: Float32Array;
  sr: number;
  /** Loop points in seconds of buffer time. */
  loopStart?: number;
  loopEnd?: number;
};

/** Seeded uniform random in [0, 1). */
export function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seconds = (sr: number, s: number) => Math.max(1, Math.floor(sr * s));

/**
 * Add a sinusoidal partial with a two-stage exponential decay, using a
 * recursive oscillator (two multiplies per sample).
 */
export function partial(
  out: Float32Array,
  sr: number,
  freq: number,
  a1: number,
  rate1: number,
  a2 = 0,
  rate2 = 0,
  phase = 0,
  attack = 0.002,
  start = 0,
) {
  if (freq <= 0 || freq >= sr * 0.47) return;
  const w = (TAU * freq) / sr;
  const c = 2 * Math.cos(w);
  let y1 = Math.sin(phase - w);
  let y2 = Math.sin(phase - 2 * w);
  let e1 = a1;
  let e2 = a2;
  const d1 = Math.exp(-rate1 / sr);
  const d2 = Math.exp(-rate2 / sr);
  const atk = Math.max(1, Math.floor(attack * sr));
  const floor = (Math.abs(a1) + Math.abs(a2)) * 1e-5;
  const n = out.length;
  for (let i = start, j = 0; i < n; i++, j++) {
    const y = c * y1 - y2;
    y2 = y1;
    y1 = y;
    const env = e1 + e2;
    out[i] += j < atk ? y * env * (0.5 - 0.5 * Math.cos((Math.PI * j) / atk)) : y * env;
    e1 *= d1;
    e2 *= d2;
    if (j > atk && Math.abs(env) < floor) break;
  }
}

/** One cycle of a harmonic spectrum, 2048 points plus a guard sample. */
export function table(amps: ArrayLike<number>, phases?: ArrayLike<number>) {
  const N = 2048;
  const t = new Float32Array(N + 1);
  for (let k = 1; k <= amps.length; k++) {
    const a = amps[k - 1];
    if (!a) continue;
    const ph = phases ? phases[k - 1] : 0;
    const w = (TAU * k) / N;
    for (let i = 0; i < N; i++) t[i] += a * Math.sin(w * i + ph);
  }
  t[N] = t[0];
  return t;
}

export function readTable(t: Float32Array, phase: number) {
  const x = phase * 2048;
  const i = x | 0;
  const f = x - i;
  return t[i] + (t[i + 1] - t[i]) * f;
}

/** RBJ biquad for offline filtering, with optional per-sample retuning. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    readonly type: "lp" | "hp" | "bp" | "peak",
    readonly sr: number,
    freq: number,
    q = 0.707,
    gainDb = 0,
  ) {
    this.set(freq, q, gainDb);
  }
  set(freq: number, q = 0.707, gainDb = 0) {
    const w = (TAU * clamp(freq, 10, this.sr * 0.45)) / this.sr;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (this.type === "lp") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (this.type === "hp") {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (this.type === "bp") {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** One-pole low-pass. */
export class OnePole {
  private y = 0;
  private a = 0;
  constructor(
    readonly sr: number,
    freq: number,
  ) {
    this.set(freq);
  }
  set(freq: number) {
    this.a = Math.exp((-TAU * clamp(freq, 1, this.sr * 0.49)) / this.sr);
  }
  run(x: number) {
    this.y = x + (this.y - x) * this.a;
    return this.y;
  }
}

/** Pink noise (Paul Kellet's economy filter). */
export function pinkSource(rand: () => number) {
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  return () => {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.2;
  };
}

/** Brown noise (leaky integrated white). */
export function brownSource(rand: () => number) {
  let y = 0;
  return () => {
    y = (y + (rand() * 2 - 1) * 0.06) * 0.996;
    return y * 3;
  };
}

/** Smoothed random walk in [-1, 1] at a given rate (Hz). */
export function wander(rand: () => number, sr: number, rate: number) {
  let target = rand() * 2 - 1;
  let value = target;
  let count = 0;
  const period = Math.max(1, Math.floor(sr / rate));
  const k = 1 - Math.exp(-TAU * rate / sr);
  return () => {
    if (count-- <= 0) {
      target = rand() * 2 - 1;
      count = period;
    }
    value += (target - value) * k;
    return value;
  };
}

export function rms(data: Float32Array, from = 0, to = data.length) {
  let s = 0;
  const a = Math.max(0, from);
  const b = Math.min(data.length, to);
  for (let i = a; i < b; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

export function peak(data: Float32Array) {
  let p = 0;
  for (let i = 0; i < data.length; i++) p = Math.max(p, Math.abs(data[i]));
  return p;
}

export function scale(data: Float32Array, k: number) {
  for (let i = 0; i < data.length; i++) data[i] *= k;
  return data;
}

/** Normalise loudness over a window, with a peak ceiling. */
export function normalize(data: Float32Array, sr: number, target: number, windowS = 0.4, ceiling = 0.95) {
  const r = rms(data, 0, Math.floor(windowS * sr));
  if (r <= 0) return data;
  let k = target / r;
  const p = peak(data) * k;
  if (p > ceiling) k *= ceiling / p;
  return scale(data, k);
}

/** Raised-cosine fades at the ends to keep every buffer click free. */
export function fades(data: Float32Array, sr: number, inS = 0.001, outS = 0.03) {
  const a = Math.min(data.length, Math.floor(inS * sr));
  for (let i = 0; i < a; i++) data[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
  const b = Math.min(data.length, Math.floor(outS * sr));
  for (let i = 0; i < b; i++) data[data.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / b);
  return data;
}

/**
 * Make [loopStart, end) loop seamlessly by cross-fading its tail into the
 * audio just before loopStart (equal power, for decorrelated textures).
 */
export function loopify(data: Float32Array, sr: number, loopStartS: number, xfadeS: number): Rendered {
  const Ls = Math.floor(loopStartS * sr);
  const X = Math.min(Ls, Math.floor(xfadeS * sr));
  const Le = data.length;
  for (let i = 0; i < X; i++) {
    const w = i / X;
    const a = Math.cos((w * Math.PI) / 2);
    const b = Math.sin((w * Math.PI) / 2);
    data[Le - X + i] = data[Le - X + i] * a + data[Ls - X + i] * b;
  }
  return { data, sr, loopStart: Ls / sr, loopEnd: Le / sr };
}

/** Add a short noise grain (Hann windowed) at sample position. */
export function grain(out: Float32Array, at: number, len: number, amp: number, rand: () => number, filter?: Biquad) {
  const n = Math.max(2, len);
  for (let i = 0; i < n && at + i < out.length; i++) {
    if (at + i < 0) continue;
    const w = 0.5 - 0.5 * Math.cos((TAU * i) / n);
    let x = (rand() * 2 - 1) * w * amp;
    if (filter) x = filter.run(x);
    out[at + i] += x;
  }
}

/** Soft saturation. */
export const soft = (x: number) => Math.tanh(x);
