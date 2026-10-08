import * as THREE from "three";

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const saturate = (v: number) => clamp(v, 0, 1);
export const smooth = (a: number, b: number, v: number) => {
  const t = saturate((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smoother = (t: number) => {
  t = saturate(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** Frame-rate independent exponential approach. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  target + (current - target) * Math.exp(-rate * dt);
export const dampAngle = (current: number, target: number, rate: number, dt: number) => {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return target - d * Math.exp(-rate * dt);
};

/** Deterministic pseudo random generator (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length) % list.length];
  }
  /** Roughly normal, mean 0, about unit spread. */
  gauss() {
    return (this.next() + this.next() + this.next() - 1.5) * 1.15;
  }
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export const mixSeed = (a: number, b: number) => (Math.imul(a ^ 0x5bd1e995, 0x27d4eb2d) + b * 0x165667b1) >>> 0;

/** Cheap smooth 2D value noise for CPU-side layout and shaping, range about 0..1. */
export function noise2(x: number, y: number, seed = 0) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const h = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi),
    b = h(xi + 1, yi),
    c = h(xi, yi + 1),
    d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm2 = (x: number, y: number, seed = 0, oct = 3) => {
  let s = 0,
    a = 0.5,
    f = 1,
    n = 0;
  for (let i = 0; i < oct; i++) {
    s += noise2(x * f, y * f, seed + i * 17) * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
};

const tmp = new THREE.Color();
/** Linear-space colour from an sRGB hex string. */
export const col = (hex: string | THREE.Color) =>
  typeof hex === "string" ? new THREE.Color(hex) : hex.clone();
export const mixCol = (a: THREE.Color | string, b: THREE.Color | string, t: number) =>
  col(a).lerp(typeof b === "string" ? tmp.set(b) : b, t);
export const scaleCol = (a: THREE.Color | string, k: number) => col(a).multiplyScalar(k);
/** Shift a colour's hue (turns), saturation and lightness offsets. */
export const shiftCol = (a: THREE.Color | string, dh: number, ds: number, dl: number) => {
  const c = col(a);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL((hsl.h + dh + 1) % 1, saturate(hsl.s + ds), saturate(hsl.l + dl));
};

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
