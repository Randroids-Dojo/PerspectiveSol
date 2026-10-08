/** Small numeric, random and colour helpers for the illustrated renderer. */

export const TAU = Math.PI * 2;
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const v = clamp(t);
  return v * v * (3 - 2 * v);
};
export const easeInOutSine = (t: number) => 0.5 - Math.cos(Math.PI * clamp(t)) / 2;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp(t), 3);
export const easeOutBack = (t: number) => {
  const v = clamp(t),
    s = 1.70158;
  return 1 + (s + 1) * Math.pow(v - 1, 3) + s * Math.pow(v - 1, 2);
};

/** FNV-1a string hash. */
export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic pseudo random stream (mulberry32). Never Math.random for layout. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
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
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length) % a.length];
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}

/** Stateless hash noise in [0, 1). */
export const noise1 = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// ------------------------------------------------------------------ colour

export type RGB = [number, number, number];
const parsed = new Map<string, RGB>();

export function rgbOf(c: string): RGB {
  let v = parsed.get(c);
  if (v) return v;
  if (c[0] === "#") {
    const h = c.length === 4 ? c.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : c;
    v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  } else {
    const m = c.match(/[\d.]+/g) ?? ["0", "0", "0"];
    v = [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  parsed.set(c, v);
  return v;
}

const toHex = (n: number) => {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return (v < 16 ? "0" : "") + v.toString(16);
};
export const hexOf = (c: RGB) => `#${toHex(c[0])}${toHex(c[1])}${toHex(c[2])}`;

/** Mix two colours, t = 0 gives a. Returns #rrggbb. */
export function mix(a: string, b: string, t: number) {
  const x = rgbOf(a),
    y = rgbOf(b);
  return hexOf([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function rgba(c: string, a: number) {
  const v = rgbOf(c);
  return `rgba(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])},${Math.round(clamp(a) * 1000) / 1000})`;
}

/** Relative luminance 0..1, rough. */
export function lum(c: string) {
  const v = rgbOf(c);
  return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255;
}

/** Saturate or desaturate around grey. */
export function saturate(c: string, amount: number) {
  const v = rgbOf(c);
  const g = (v[0] + v[1] + v[2]) / 3;
  return hexOf([g + (v[0] - g) * amount, g + (v[1] - g) * amount, g + (v[2] - g) * amount]);
}

// ------------------------------------------------------------------ canvas

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext("2d")!;
  return { canvas: c, ctx };
}

/** A cached bitmap with the device-pixel offset of its local origin. */
export type Sprite = { canvas: HTMLCanvasElement; ox: number; oy: number };

/** Four pointed sparkle centred at (x, y). */
export function sparkle(c: Ctx, x: number, y: number, r: number, pinch = 0.18) {
  c.moveTo(x, y - r);
  c.quadraticCurveTo(x + r * pinch, y - r * pinch, x + r, y);
  c.quadraticCurveTo(x + r * pinch, y + r * pinch, x, y + r);
  c.quadraticCurveTo(x - r * pinch, y + r * pinch, x - r, y);
  c.quadraticCurveTo(x - r * pinch, y - r * pinch, x, y - r);
  c.closePath();
}

/** A leaf shape pointing along angle a from (x, y). */
export function leafPath(c: Ctx, x: number, y: number, len: number, a: number, wide = 0.42) {
  const ca = Math.cos(a),
    sa = Math.sin(a);
  const px = -sa,
    py = ca;
  const tx = x + ca * len,
    ty = y + sa * len;
  const w = len * wide;
  c.moveTo(x, y);
  c.quadraticCurveTo(x + ca * len * 0.45 + px * w, y + sa * len * 0.45 + py * w, tx, ty);
  c.quadraticCurveTo(x + ca * len * 0.45 - px * w, y + sa * len * 0.45 - py * w, x, y);
  c.closePath();
}

/** Closed smooth path through points (Catmull-Rom converted to Bezier). */
export function smoothClosed(c: Ctx, pts: number[][], tension = 0.5) {
  const n = pts.length;
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n],
      p1 = pts[i],
      p2 = pts[(i + 1) % n],
      p3 = pts[(i + 2) % n];
    const t = tension / 3;
    c.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) * t,
      p1[1] + (p2[1] - p0[1]) * t,
      p2[0] - (p3[0] - p1[0]) * t,
      p2[1] - (p3[1] - p1[1]) * t,
      p2[0],
      p2[1],
    );
  }
  c.closePath();
}

/** Open smooth path through points. */
export function smoothOpen(c: Ctx, pts: number[][], tension = 0.5, move = true) {
  const n = pts.length;
  if (move) c.moveTo(pts[0][0], pts[0][1]);
  else c.lineTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)],
      p1 = pts[i],
      p2 = pts[i + 1],
      p3 = pts[Math.min(n - 1, i + 2)];
    const t = tension / 3;
    c.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) * t,
      p1[1] + (p2[1] - p0[1]) * t,
      p2[0] - (p3[0] - p1[0]) * t,
      p2[1] - (p3[1] - p1[1]) * t,
      p2[0],
      p2[1],
    );
  }
}

/** A tapered stroke along points (width w0 at the start to w1 at the end). */
export function taper(c: Ctx, pts: number[][], w0: number, w1: number) {
  const n = pts.length;
  if (n < 2) return;
  const left: number[][] = [],
    right: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0],
      dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const w = lerp(w0, w1, i / (n - 1)) / 2;
    left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  c.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) c.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
  c.closePath();
}

/** Hatching: parallel lines at angle a across a rectangle (clip first). */
export function hatch(c: Ctx, x0: number, y0: number, x1: number, y1: number, gap: number, a = -0.8) {
  const ca = Math.cos(a),
    sa = Math.sin(a);
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2;
  const r = Math.hypot(x1 - x0, y1 - y0) / 2 + gap;
  for (let d = -r; d <= r; d += gap) {
    const px = cx - sa * d,
      py = cy + ca * d;
    c.moveTo(px - ca * r, py - sa * r);
    c.lineTo(px + ca * r, py + sa * r);
  }
}
