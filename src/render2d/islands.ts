import type { Island, Level } from "../sim/types";
import type { Art } from "./art";
import { DECO_SIZE, KITS, paintDeco, pickKind, shrub, type DecoKind, type GearSpec } from "./decor";
import { texturize } from "./texture";
import {
  Rng,
  TAU,
  clamp,
  hashString,
  hatch,
  leafPath,
  makeCanvas,
  mix,
  rgba,
  smooth,
  smoothOpen,
  sparkle,
  taper,
  type Ctx,
  type Sprite,
} from "./util";

/**
 * Island artwork. Every island is painted once per scale into two cached
 * bitmaps: `back` (the floating rock underside and the scenery standing on
 * top, all behind the walkway) and `front` (the solid slab whose edges match
 * the collision box exactly: top at y, width w, depth h).
 */
export type IslandArt = {
  id: string;
  S: number;
  back: Sprite | null;
  front: Sprite | null;
  /** Gears that turn at runtime, local units relative to the top centre. */
  gears: GearSpec[];
  /** Plinth face dials that turn while the island moves. */
  faceGears: GearSpec[];
  /** Lowest point of the keel or rock, local units below the top. */
  depth: number;
  /** Crystal at the bottom of a plinth keel. */
  keel: { x: number; y: number } | null;
  bytes: number;
};

type Underside = "rock" | "tiers" | "bridge" | "keel" | "none";

type Deco = { kind: DecoKind; x: number; s: number; flip: number; seed: number };

type Plan = {
  r: Rng;
  W: number;
  h: number;
  under: Underside;
  depth: number;
  contour: number[][];
  decos: Deco[];
  top: number;
  side: number;
  balustrade: boolean;
};

const OUT = 0.045;

function seedFor(i: Island, art: Art) {
  return (hashString(i.id) ^ Math.imul(art.seed + 17, 2654435761)) >>> 0;
}

function plan(i: Island, art: Art, level: Level): Plan {
  const r = new Rng(seedFor(i, art));
  const W = i.w / 2,
    h = i.h;
  let under: Underside = "rock";
  if (i.only) under = "none";
  else if (i.style === "plinth") under = "keel";
  else if (i.style === "bridge") under = "bridge";
  else if (i.style === "stone") under = r.chance(0.6) ? "tiers" : "rock";
  let depth = 0;
  let contour: number[][] = [];
  if (under === "rock") {
    const D = clamp(1.2 + i.w * 0.34, 1.6, 5.4) * r.range(0.85, 1.2);
    const lobes: number[][] = [[r.range(0.35, 0.65), r.range(0.3, 0.48), 1]];
    const extra = i.w > 6 ? r.int(1, 2) : r.int(0, 1);
    for (let k = 0; k < extra; k++) lobes.push([r.range(0.12, 0.88), r.range(0.14, 0.28), r.range(0.35, 0.72)]);
    const N = Math.max(10, Math.round(i.w * 2.6));
    for (let j = 0; j <= N; j++) {
      const u = j / N;
      let f = 0;
      for (const [c0, s0, a] of lobes) f = Math.max(f, a * Math.max(0, 1 - ((u - c0) / s0) ** 2));
      const edge = smooth(Math.min(u, 1 - u) / 0.14);
      const jag = (r.next() - 0.5) * 0.35 * edge;
      const x = -W + 0.06 + u * (i.w - 0.12);
      contour.push([x, h + 0.16 + 0.2 * edge + D * (0.12 + f) * edge * 0.92 + jag]);
    }
    depth = Math.max(...contour.map((p) => p[1]));
  } else if (under === "tiers") depth = h + 1.6 + i.w * 0.12;
  else if (under === "bridge") depth = h + 1.1;
  else if (under === "keel") depth = h + 0.9 + i.w * 0.16;

  // Scenery on the top, kept clear of walls, the observatory and lanterns.
  const decos: Deco[] = [];
  const kit = KITS[art.time][i.only ? "bridge" : i.style] ?? [];
  const blocked: [number, number][] = [];
  for (const w of level.walls)
    if (Math.abs(w.y - i.y) < 0.3 && Math.abs(w.x - i.x) < W + w.w) blocked.push([w.x - i.x - w.w / 2 - 0.9, w.x - i.x + w.w / 2 + 0.9]);
  if (level.exit.island === i.id) blocked.push([level.exit.x - i.x - 3.2, level.exit.x - i.x + 3.2]);
  if (kit.length && !i.motion && !i.lantern) {
    const n = i.w < 3 ? (r.chance(0.35) ? 1 : 0) : Math.max(1, Math.floor(i.w / 3) + (r.chance(0.5) ? 1 : 0));
    for (let k = 0; k < n; k++) {
      const x = -W + ((k + 0.5) / n) * i.w + r.range(-0.4, 0.4);
      const kind = pickKind(r, kit);
      const s = r.range(0.85, 1.1);
      const half = DECO_SIZE[kind][1] * s;
      if (Math.abs(x) + half > W + 0.25) continue;
      if (blocked.some(([a, b]) => x + half > a && x - half < b)) continue;
      if (decos.some((d) => Math.abs(d.x - x) < (DECO_SIZE[d.kind][1] * d.s + half) * 0.8)) continue;
      decos.push({ kind, x, s, flip: r.sign(), seed: r.int(0, 1e9) });
    }
  }
  let top = 0.4;
  let side = 0.4;
  for (const d of decos) {
    top = Math.max(top, DECO_SIZE[d.kind][0] * d.s + 0.4);
    side = Math.max(side, Math.abs(d.x) + DECO_SIZE[d.kind][1] * d.s + 0.4 - W);
  }
  const balustrade = i.style === "bridge" && !i.only;
  if (balustrade) top = Math.max(top, 0.9);
  return { r, W, h, under, depth, contour, decos, top, side, balustrade };
}

// ---------------------------------------------------------------- public

export function paintIsland(i: Island, art: Art, S: number, level: Level): IslandArt {
  const p = plan(i, art, level);
  const out: IslandArt = { id: i.id, S, back: null, front: null, gears: [], faceGears: [], depth: p.depth, keel: null, bytes: 0 };
  if (i.only === "3d") return out;
  const tint = clamp(-i.z * 0.012, 0, 0.1);

  // Back: underside and scenery.
  if (p.under !== "none" || p.decos.length || p.balustrade) {
    const left = -p.W - Math.max(0.75, p.side),
      right = p.W + Math.max(0.75, p.side);
    const top = -p.top,
      bottom = Math.max(p.h + 0.5, p.depth + 1.6);
    const { canvas, ctx: c } = makeCanvas((right - left) * S, (bottom - top) * S);
    const ox = -left * S,
      oy = -top * S;
    c.setTransform(S, 0, 0, S, ox, oy);
    c.lineJoin = "round";
    c.lineCap = "round";
    if (p.under === "rock") rockUnder(c, i, art, p);
    else if (p.under === "tiers") tierUnder(c, i, art, p);
    else if (p.under === "bridge") bridgeUnder(c, i, art, p);
    else if (p.under === "keel") out.keel = keelUnder(c, i, art, p, out);
    if (p.under !== "none") texturize(c, canvas, S / 60, 0.7);
    // Scenery behind the walkway, pushed slightly into the air.
    c.save();
    c.beginPath();
    c.rect(left, top, right - left, -top + 0.02);
    c.clip();
    if (p.balustrade) balustrade(c, art, p);
    for (const d of p.decos) {
      c.save();
      c.translate(d.x, 0.02);
      const g = paintDeco(c, d.kind, art, new Rng(d.seed), d.s, d.flip);
      for (const gear of g) out.gears.push({ ...gear, x: gear.x + d.x, y: gear.y + 0.02 });
      c.restore();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = rgba(art.air, art.airAmount + tint);
    c.fillRect(0, 0, canvas.width, oy + 0.02 * S);
    c.restore();
    if (tint > 0) wash(c, canvas, art, tint);
    out.back = { canvas, ox, oy };
    out.bytes += canvas.width * canvas.height * 4;
  }

  // Front: the solid slab.
  {
    const left = -p.W - 0.2,
      right = p.W + 0.2,
      top = -0.42,
      bottom = p.h + 0.2;
    const { canvas, ctx: c } = makeCanvas((right - left) * S, (bottom - top) * S);
    const ox = -left * S,
      oy = -top * S;
    c.setTransform(S, 0, 0, S, ox, oy);
    c.lineJoin = "round";
    c.lineCap = "round";
    if (i.only === "2d") starPlank(c, art, p);
    else if (i.style === "garden") gardenFront(c, art, p);
    else if (i.style === "stone") stoneFront(c, art, p);
    else if (i.style === "ruin") ruinFront(c, art, p);
    else if (i.style === "bridge") bridgeFront(c, art, p);
    else plinthFront(c, art, p, out, !!i.motion);
    if (i.only !== "2d") texturize(c, canvas, S / 60, 0.7);
    if (tint > 0 && i.only !== "2d") wash(c, canvas, art, tint);
    out.front = { canvas, ox, oy };
    out.bytes += canvas.width * canvas.height * 4;
  }
  return out;
}

function wash(c: Ctx, canvas: HTMLCanvasElement, art: Art, a: number) {
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-atop";
  c.fillStyle = rgba(mix(art.p.fog, art.p.skyTop, 0.3), a);
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.restore();
}

// --------------------------------------------------------------- slab kit

function slabPath(c: Ctx, W: number, h: number, round = 0.08) {
  const r = Math.min(round, h * 0.3);
  c.beginPath();
  c.moveTo(-W, 0);
  c.lineTo(W, 0);
  c.lineTo(W, h - r);
  c.quadraticCurveTo(W, h, W - r, h);
  c.lineTo(-W + r, h);
  c.quadraticCurveTo(-W, h, -W, h - r);
  c.closePath();
}

function vGrad(c: Ctx, y0: number, y1: number, stops: [number, string][]) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const [t, col] of stops) g.addColorStop(t, col);
  return g;
}

/** Shadow-side hatching and a bottom shade across a slab. */
function shadeSlab(c: Ctx, art: Art, W: number, h: number, from = 0.1) {
  const side = art.light > 0.2 ? -1 : art.light < -0.2 ? 1 : 0;
  c.save();
  c.beginPath();
  if (side !== 0) c.rect(side > 0 ? W * 0.55 : -W, from, W * 0.45, h);
  c.rect(-W, from + (h - from) * 0.62, W * 2, h);
  c.clip();
  c.beginPath();
  hatch(c, -W, from, W, h, 0.075, -0.95);
  c.strokeStyle = rgba(art.ink, 0.13);
  c.lineWidth = 0.014;
  c.stroke();
  c.restore();
  const g = c.createLinearGradient(0, h * 0.4, 0, h);
  g.addColorStop(0, rgba(art.ink, 0));
  g.addColorStop(1, rgba(art.ink, 0.2));
  c.fillStyle = g;
  c.fillRect(-W, h * 0.4, W * 2, h * 0.6);
  if (side !== 0) {
    const s = c.createLinearGradient(side * W * 0.4, 0, side * W, 0);
    s.addColorStop(0, rgba(art.ink, 0));
    s.addColorStop(1, rgba(art.ink, 0.14));
    c.fillStyle = s;
    c.fillRect(-W, 0, W * 2, h);
    const l = c.createLinearGradient(-side * W, 0, -side * W * 0.5, 0);
    l.addColorStop(0, rgba(art.rim, 0.28));
    l.addColorStop(1, rgba(art.rim, 0));
    c.fillStyle = l;
    c.fillRect(-W, 0, W * 2, h);
  }
}

function outline(c: Ctx, art: Art, W: number, h: number) {
  slabPath(c, W, h);
  c.strokeStyle = art.ink;
  c.lineWidth = OUT;
  c.stroke();
}

/** The lit lip along the walkable top edge. */
function litLip(c: Ctx, W: number, color: string) {
  c.beginPath();
  c.moveTo(-W + 0.02, 0.02);
  c.lineTo(W - 0.02, 0.02);
  c.strokeStyle = color;
  c.lineWidth = 0.045;
  c.stroke();
}

function goldLine(c: Ctx, art: Art, x0: number, x1: number, y: number, w = 0.035) {
  c.beginPath();
  c.moveTo(x0, y + w * 0.4);
  c.lineTo(x1, y + w * 0.4);
  c.strokeStyle = art.goldDark;
  c.lineWidth = w;
  c.stroke();
  c.beginPath();
  c.moveTo(x0, y);
  c.lineTo(x1, y);
  c.strokeStyle = art.gold;
  c.lineWidth = w * 0.8;
  c.stroke();
  c.beginPath();
  c.moveTo(x0, y - w * 0.2);
  c.lineTo(x1, y - w * 0.2);
  c.strokeStyle = rgba(art.goldLight, 0.8);
  c.lineWidth = w * 0.25;
  c.stroke();
}

function goldFlecks(c: Ctx, art: Art, r: Rng, W: number, y0: number, y1: number, n: number) {
  for (let k = 0; k < n; k++) {
    c.beginPath();
    sparkle(c, r.range(-W + 0.1, W - 0.1), r.range(y0, y1), r.range(0.02, 0.045));
    c.fillStyle = rgba(art.goldLight, r.range(0.5, 0.9));
    c.fill();
  }
}

/** Grass tufts and small wildflowers along a top edge. */
function tufts(c: Ctx, art: Art, r: Rng, x0: number, x1: number, density = 1, flowers = 0.12) {
  for (let x = x0; x < x1; x += r.range(0.07, 0.16) / density) {
    const n = r.int(2, 4);
    for (let k = 0; k < n; k++) {
      const hgt = r.range(0.05, 0.15);
      const lean = r.range(-0.07, 0.07);
      const bx = x + r.range(-0.03, 0.03);
      c.beginPath();
      c.moveTo(bx - 0.018, 0.03);
      c.quadraticCurveTo(bx + lean * 0.3, -hgt * 0.5, bx + lean, -hgt);
      c.quadraticCurveTo(bx + lean * 0.3 + 0.01, -hgt * 0.4, bx + 0.018, 0.03);
      c.closePath();
      c.fillStyle = k % 3 === 0 ? art.grassDark : k % 3 === 1 ? art.grass : art.grassLit;
      c.fill();
    }
    if (r.chance(flowers)) {
      const fx = x + r.range(-0.03, 0.03),
        fh = r.range(0.14, 0.24);
      c.beginPath();
      c.moveTo(fx, 0.02);
      c.quadraticCurveTo(fx + 0.03, -fh * 0.5, fx + 0.01, -fh);
      c.strokeStyle = art.grassDark;
      c.lineWidth = 0.014;
      c.stroke();
      const col = r.pick(art.flowers);
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * TAU;
        c.beginPath();
        c.ellipse(fx + 0.01 + Math.cos(a) * 0.028, -fh + Math.sin(a) * 0.028, 0.026, 0.016, a, 0, TAU);
        c.fillStyle = col;
        c.fill();
      }
      c.beginPath();
      c.arc(fx + 0.01, -fh, 0.016, 0, TAU);
      c.fillStyle = art.gold;
      c.fill();
    }
  }
}

// ---------------------------------------------------------------- faces

function pebble(c: Ctx, x: number, y: number, w: number, h: number, r: Rng) {
  const j = () => r.range(-0.035, 0.035);
  const pts = [
    [x + j(), y + j()],
    [x + w + j(), y + j()],
    [x + w + j(), y + h + j()],
    [x + j(), y + h + j()],
  ];
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[3], pts[0]);
  c.moveTo(m0[0], m0[1]);
  for (let k = 0; k < 4; k++) {
    const m = mid(pts[k], pts[(k + 1) % 4]);
    c.quadraticCurveTo(pts[k][0], pts[k][1], m[0], m[1]);
  }
  c.closePath();
}

function gardenFront(c: Ctx, art: Art, p: Plan) {
  const { W, h, r } = p;
  const warmStone = mix(art.stone, "#c9a27a", art.night ? 0.05 : 0.22);
  const mortar = mix(mix(art.stoneDark, art.soil, 0.55), art.ink, 0.2);
  slabPath(c, W, h);
  c.fillStyle = mortar;
  c.fill();
  c.save();
  slabPath(c, W, h);
  c.clip();
  // A band of dark soil threaded with roots below the turf.
  const soilH = Math.min(0.3, h * 0.24);
  c.fillStyle = vGrad(c, 0, soilH + 0.12, [
    [0, mix(art.soil, art.ink, 0.25)],
    [1, art.soil],
  ]);
  c.fillRect(-W, 0, W * 2, soilH + 0.12);
  c.beginPath();
  for (let k = 0; k < W * 4; k++) {
    const x = r.range(-W, W);
    c.moveTo(x, 0.12);
    c.quadraticCurveTo(x + r.range(-0.15, 0.15), soilH * 0.7, x + r.range(-0.2, 0.2), soilH + 0.08);
  }
  c.strokeStyle = rgba(mix(art.bark, "#e8d2a8", 0.3), 0.55);
  c.lineWidth = 0.014;
  c.stroke();
  const tones = [warmStone, mix(warmStone, art.stoneLit, 0.45), mix(warmStone, art.stoneMid, 0.45), mix(warmStone, art.soil, 0.22), mix(warmStone, art.grass, 0.14)];
  const medallion = h >= 1 && r.chance(0.6) ? r.range(-W * 0.6, W * 0.6) : null;
  const variant = h < 0.9 ? "cobble" : r.pick(["cobble", "flag", "terrace", "cliff"] as const);
  if (variant === "cobble") cobbles(c, art, r, W, h, soilH, tones, medallion);
  else if (variant === "flag") flagstones(c, art, r, W, h, soilH, tones, medallion);
  else if (variant === "terrace") {
    const band = Math.min(0.5, h * 0.4);
    cobbles(c, art, r, W, h, soilH + band, tones, null);
    garlandBand(c, art, r, W, soilH, band);
  } else cliffFace(c, art, r, W, h, soilH);
  // Moss creeping down from the turf.
  for (let k = 0; k < p.W * 3; k++) {
    const mx = r.range(-W, W),
      my = r.range(soilH, soilH + 0.3);
    c.beginPath();
    c.ellipse(mx, my, r.range(0.08, 0.2), r.range(0.04, 0.1), 0, 0, TAU);
    c.fillStyle = rgba(art.grassDark, 0.5);
    c.fill();
  }
  goldFlecks(c, art, r, W, soilH + 0.1, h - 0.1, Math.round(W * 3));
  shadeSlab(c, art, W, h, 0.12);
  c.restore();
  outline(c, art, W, h);

  // Turf with a fringe that hangs over the face.
  c.beginPath();
  c.moveTo(-W - 0.03, 0);
  c.lineTo(W + 0.03, 0);
  const pts: number[][] = [];
  for (let x = W + 0.03; x >= -W - 0.03; x -= r.range(0.05, 0.11)) {
    const edge = Math.min(W + 0.03 - x, x + W + 0.03);
    let d = 0.12 + r.range(0, 0.07);
    if (r.chance(0.16) && edge > 0.2) d += r.range(0.08, 0.26);
    pts.push([x, d]);
  }
  pts.push([-W - 0.03, 0.12]);
  for (const [x, d] of pts) c.lineTo(x, d);
  c.closePath();
  c.fillStyle = vGrad(c, 0, 0.32, [
    [0, art.grassLit],
    [0.3, art.grass],
    [1, art.grassDark],
  ]);
  c.fill();
  c.strokeStyle = rgba(art.ink, 0.6);
  c.lineWidth = 0.02;
  c.stroke();
  // Hanging blades along the fringe.
  c.beginPath();
  for (const [x, d] of pts) {
    if (!r.chance(0.5)) continue;
    c.moveTo(x, d - 0.04);
    c.quadraticCurveTo(x + r.range(-0.03, 0.03), d + 0.05, x + r.range(-0.05, 0.05), d + r.range(0.04, 0.12));
  }
  c.strokeStyle = art.grassDark;
  c.lineWidth = 0.016;
  c.stroke();
  litLip(c, W, rgba(mix(art.grassLit, "#ffffff", 0.35), 0.95));
  const bloom = { morning: 0.32, noon: 0.16, afternoon: 0.12, dusk: 0.22, night: 0.14, dawn: 0.22 }[art.time];
  tufts(c, art, r, -W + 0.02, W - 0.02, 1, bloom);
  // Ivy curling over the face from the turf.
  const ivy = r.int(0, Math.min(3, Math.floor(W)));
  for (let k = 0; k < ivy; k++) ivyStrand(c, art, r, r.range(-W + 0.2, W - 0.2), 0.15, r.range(0.4, Math.min(1.1, h - 0.1)));
}

function cobbles(c: Ctx, art: Art, r: Rng, W: number, h: number, y0: number, tones: string[], medallion: number | null) {
  let y = y0;
  const lightSide = art.light <= 0 ? -1 : 1;
  while (y < h + 0.05) {
    const rh = r.range(0.22, 0.4);
    let x = -W - r.range(0, 0.25);
    while (x < W + 0.05) {
      const sw = r.range(0.28, 0.75);
      const cx = x + sw / 2;
      if (medallion !== null && Math.abs(cx - medallion) < 0.45 && y > y0 && y + 0.62 < h + 0.1) {
        medallionStone(c, art, medallion, Math.min(h - 0.32, y + 0.3), 0.26);
        medallion = null;
        x += 0.95;
        continue;
      }
      c.beginPath();
      pebble(c, x + 0.025, y + 0.025, sw - 0.05, rh - 0.05, r);
      c.fillStyle = r.pick(tones);
      c.fill();
      c.save();
      c.clip();
      c.fillStyle = rgba(art.stoneLit, 0.55);
      c.fillRect(x, y, sw, 0.05);
      c.fillStyle = rgba(lightSide < 0 ? art.stoneLit : art.stoneDark, 0.3);
      c.fillRect(x, y, 0.05, rh);
      c.fillStyle = rgba(art.ink, 0.22);
      c.fillRect(x, y + rh - 0.09, sw, 0.09);
      c.fillStyle = rgba(lightSide < 0 ? art.stoneDark : art.stoneLit, 0.3);
      c.fillRect(x + sw - 0.06, y, 0.06, rh);
      c.restore();
      if (r.chance(0.15)) {
        c.beginPath();
        c.moveTo(cx - 0.04, y + 0.06);
        c.lineTo(cx + 0.02, y + rh * 0.5);
        c.lineTo(cx - 0.02, y + rh - 0.06);
        c.strokeStyle = rgba(art.ink, 0.3);
        c.lineWidth = 0.012;
        c.stroke();
      }
      x += sw;
    }
    y += rh;
  }
}

/** Large angular flagstones with gilt pointing in a few joints. */
function flagstones(c: Ctx, art: Art, r: Rng, W: number, h: number, y0: number, tones: string[], medallion: number | null) {
  let y = y0;
  const lightSide = art.light <= 0 ? -1 : 1;
  while (y < h + 0.05) {
    const rh = r.range(0.38, 0.62);
    let x = -W - r.range(0, 0.5);
    while (x < W + 0.05) {
      const sw = r.range(0.6, 1.3);
      if (medallion !== null && Math.abs(x + sw / 2 - medallion) < 0.6 && y > y0 && y + 0.62 < h + 0.1) {
        medallionStone(c, art, medallion, Math.min(h - 0.32, y + 0.3), 0.27);
        medallion = null;
        x += 0.95;
        continue;
      }
      const j = () => r.range(-0.05, 0.05);
      const pts = [
        [x + 0.03 + j(), y + 0.03 + j()],
        [x + sw * r.range(0.4, 0.6), y + 0.02 + j()],
        [x + sw - 0.03 + j(), y + 0.03 + j()],
        [x + sw - 0.03 + j(), y + rh - 0.03 + j()],
        [x + 0.03 + j(), y + rh - 0.03 + j()],
      ];
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts) c.lineTo(q[0], q[1]);
      c.closePath();
      c.fillStyle = r.pick(tones);
      c.fill();
      c.save();
      c.clip();
      const g = c.createLinearGradient(x, y, x + sw * lightSide * -1 + (lightSide < 0 ? sw : 0), y + rh);
      g.addColorStop(0, rgba(art.stoneLit, 0.35));
      g.addColorStop(1, rgba(art.ink, 0.12));
      c.fillStyle = g;
      c.fillRect(x, y, sw, rh);
      c.restore();
      c.strokeStyle = rgba(art.ink, 0.35);
      c.lineWidth = 0.014;
      c.stroke();
      if (r.chance(0.25)) {
        c.beginPath();
        c.moveTo(pts[2][0], pts[2][1]);
        c.lineTo(pts[3][0], pts[3][1]);
        c.strokeStyle = rgba(art.gold, 0.9);
        c.lineWidth = 0.018;
        c.stroke();
      }
      x += sw;
    }
    y += rh;
  }
}

/** A dressed band carved with a garland of swags and rosettes. */
function garlandBand(c: Ctx, art: Art, r: Rng, W: number, y0: number, bh: number) {
  c.fillStyle = vGrad(c, y0, y0 + bh, [
    [0, art.stoneLit],
    [1, art.stone],
  ]);
  c.fillRect(-W, y0, W * 2, bh);
  c.fillStyle = rgba(art.ink, 0.28);
  c.fillRect(-W, y0 + bh - 0.03, W * 2, 0.03);
  goldLine(c, art, -W, W, y0 + 0.05, 0.02);
  const span = r.range(0.7, 1.0);
  const n = Math.max(1, Math.round((W * 2) / span));
  const sw = (W * 2) / n;
  for (let k = 0; k < n; k++) {
    const x0 = -W + k * sw,
      x1 = x0 + sw;
    const top = y0 + 0.12,
      sag = y0 + bh * 0.72;
    // Swag in relief: shadow then highlight.
    for (const [dy, col, wd] of [
      [0.02, rgba(art.ink, 0.3), 0.07],
      [0, mix(art.foliage, art.stone, 0.35), 0.055],
    ] as [number, string, number][]) {
      c.beginPath();
      c.moveTo(x0 + 0.06, top + dy);
      c.quadraticCurveTo((x0 + x1) / 2, sag + dy + 0.12, x1 - 0.06, top + dy);
      c.strokeStyle = col;
      c.lineWidth = wd;
      c.stroke();
    }
    for (let q = 1; q < 6; q++) {
      const t = q / 6;
      const lx = (1 - t) * (1 - t) * (x0 + 0.06) + 2 * (1 - t) * t * ((x0 + x1) / 2) + t * t * (x1 - 0.06);
      const ly = (1 - t) * (1 - t) * top + 2 * (1 - t) * t * (sag + 0.12) + t * t * top;
      c.beginPath();
      leafPath(c, lx, ly, 0.08, Math.PI / 2 + (q % 2 ? 0.9 : -0.9), 0.5);
      c.fillStyle = mix(art.foliage, art.stoneLit, 0.25);
      c.fill();
    }
    c.beginPath();
    c.arc(x0, top, 0.055, 0, TAU);
    c.fillStyle = art.gold;
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.45);
    c.lineWidth = 0.012;
    c.stroke();
  }
}

/** Natural earth: warm strata, embedded pebbles, roots and ferns in the cracks. */
function cliffFace(c: Ctx, art: Art, r: Rng, W: number, h: number, y0: number) {
  const clay = [mix(art.soil, "#b07a4a", art.night ? 0.1 : 0.35), mix(art.soil, art.stoneMid, 0.4), mix(art.soil, "#8a6a4a", 0.3), mix(art.stoneMid, "#c9a27a", 0.3)];
  let y = y0 - 0.02;
  let k = 0;
  while (y < h + 0.05) {
    const bh = r.range(0.16, 0.34);
    const ph = r.range(0, TAU);
    c.beginPath();
    c.moveTo(-W - 0.1, y);
    for (let x = -W; x <= W + 0.1; x += 0.2) c.lineTo(x, y + Math.sin(x * 2.1 + ph) * 0.035);
    c.lineTo(W + 0.1, h + 0.2);
    c.lineTo(-W - 0.1, h + 0.2);
    c.closePath();
    c.fillStyle = clay[k % clay.length];
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.28);
    c.lineWidth = 0.014;
    c.stroke();
    y += bh;
    k++;
  }
  for (let q = 0; q < W * 4; q++) {
    const px = r.range(-W, W),
      py = r.range(y0 + 0.1, h - 0.08);
    const pw = r.range(0.08, 0.2);
    c.beginPath();
    pebble(c, px, py, pw, pw * 0.7, r);
    c.fillStyle = mix(art.stone, art.stoneMid, r.next());
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.35);
    c.lineWidth = 0.01;
    c.stroke();
  }
  c.beginPath();
  for (let q = 0; q < W * 3; q++) {
    const x = r.range(-W, W);
    const yy = r.range(y0, h * 0.7);
    c.moveTo(x, yy);
    c.bezierCurveTo(x + 0.1, yy + 0.1, x - 0.12, yy + 0.2, x + r.range(-0.1, 0.1), yy + r.range(0.25, 0.5));
  }
  c.strokeStyle = rgba(mix(art.bark, "#e8d2a8", 0.25), 0.6);
  c.lineWidth = 0.013;
  c.stroke();
  // Ferns and flowers growing from the face.
  for (let q = 0; q < Math.max(1, W * 1.2); q++) {
    const fx = r.range(-W + 0.2, W - 0.2),
      fy = r.range(y0 + 0.2, h - 0.2);
    for (let l = 0; l < 5; l++) {
      c.beginPath();
      leafPath(c, fx, fy, r.range(0.1, 0.18), -Math.PI / 2 + (l - 2) * 0.45, 0.35);
      c.fillStyle = l % 2 ? art.grass : art.grassDark;
      c.fill();
    }
    if (r.chance(0.5)) {
      c.beginPath();
      c.arc(fx, fy - 0.16, 0.035, 0, TAU);
      c.fillStyle = r.pick(art.flowers);
      c.fill();
    }
  }
}

function medallionStone(c: Ctx, art: Art, x: number, y: number, R: number) {
  c.beginPath();
  c.arc(x, y, R, 0, TAU);
  c.fillStyle = art.stoneLit;
  c.fill();
  c.strokeStyle = rgba(art.ink, 0.5);
  c.lineWidth = 0.018;
  c.stroke();
  c.beginPath();
  c.arc(x, y, R * 0.82, 0, TAU);
  c.strokeStyle = rgba(art.stoneDark, 0.6);
  c.lineWidth = 0.012;
  c.stroke();
  // Engraved sun: groove then gilt.
  for (const [col, off, wd] of [
    [rgba(art.ink, 0.35), 0.008, 0.026],
    [art.gold, 0, 0.02],
  ] as [string, number, number][]) {
    c.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      const r0 = R * 0.36,
        r1 = R * (k % 2 ? 0.58 : 0.7);
      c.moveTo(x + off + Math.cos(a) * r0, y + off + Math.sin(a) * r0);
      c.lineTo(x + off + Math.cos(a) * r1, y + off + Math.sin(a) * r1);
    }
    c.moveTo(x + off + R * 0.24, y + off);
    c.arc(x + off, y + off, R * 0.24, 0, TAU);
    c.strokeStyle = col;
    c.lineWidth = wd;
    c.stroke();
  }
  c.beginPath();
  c.arc(x, y, R * 0.12, 0, TAU);
  c.fillStyle = art.goldLight;
  c.fill();
}

function ivyStrand(c: Ctx, art: Art, r: Rng, x: number, y0: number, len: number) {
  const pts: number[][] = [];
  let px = x;
  for (let t = 0; t <= 1.001; t += 0.2) {
    pts.push([px, y0 + t * len]);
    px += r.range(-0.08, 0.08);
  }
  c.beginPath();
  smoothOpen(c, pts);
  c.strokeStyle = art.foliageDark;
  c.lineWidth = 0.022;
  c.stroke();
  for (let k = 0; k < pts.length; k++) {
    const [lx, ly] = pts[k];
    for (const s of [-1, 1]) {
      if (r.chance(0.3)) continue;
      c.beginPath();
      leafPath(c, lx, ly, 0.12, Math.PI / 2 + s * 1.0 + r.range(-0.3, 0.3), 0.5);
      c.fillStyle = r.chance(0.5) ? art.foliage : art.foliageLit;
      c.fill();
      c.strokeStyle = rgba(art.ink, 0.35);
      c.lineWidth = 0.01;
      c.stroke();
    }
  }
}

type Frieze = "meander" | "wave" | "stars" | "glyphs" | "rays" | "coffers";

function stoneFront(c: Ctx, art: Art, p: Plan) {
  const { W, h, r } = p;
  slabPath(c, W, h);
  c.fillStyle = vGrad(c, 0, h, [
    [0, art.stoneLit],
    [0.3, art.stone],
    [1, art.stoneMid],
  ]);
  c.fill();
  c.save();
  slabPath(c, W, h);
  c.clip();
  // Ashlar in running bond.
  const cornice = Math.min(0.22, h * 0.3);
  const rowH = r.range(0.32, 0.42),
    blockW = r.range(0.75, 1.15);
  let row = 0;
  c.beginPath();
  for (let y = cornice + 0.08; y < h; y += rowH, row++) {
    c.moveTo(-W, y);
    c.lineTo(W, y);
    for (let x = -W + (row % 2 ? blockW / 2 : 0) + r.range(-0.1, 0.1); x < W; x += blockW) {
      c.moveTo(x, y);
      c.lineTo(x, Math.min(h, y + rowH));
    }
  }
  c.strokeStyle = rgba(art.stoneDark, 0.55);
  c.lineWidth = 0.016;
  c.stroke();
  // Block tonal variation.
  row = 0;
  for (let y = cornice + 0.08; y < h; y += rowH, row++)
    for (let x = -W + (row % 2 ? blockW / 2 : 0); x < W; x += blockW) {
      c.fillStyle = rgba(r.chance(0.5) ? art.stoneLit : art.stoneMid, r.range(0.05, 0.22));
      c.fillRect(x + 0.01, y + 0.01, blockW - 0.02, rowH - 0.02);
    }
  // Frieze of engraved gilt.
  if (h >= 0.9) {
    const kinds: Frieze[] = ["meander", "wave", "stars", "glyphs", "rays", "coffers"];
    const kind = r.pick(kinds);
    const fy = cornice + 0.12,
      fh = Math.min(0.34, h * 0.28);
    c.fillStyle = rgba(art.stoneDark, 0.18);
    c.fillRect(-W, fy, W * 2, fh);
    goldLine(c, art, -W, W, fy, 0.022);
    goldLine(c, art, -W, W, fy + fh, 0.022);
    frieze(c, art, r, kind, W, fy + 0.03, fh - 0.06);
  }
  // Base moulding.
  c.fillStyle = rgba(art.stoneDark, 0.35);
  c.fillRect(-W, h - 0.12, W * 2, 0.12);
  goldLine(c, art, -W, W, h - 0.14, 0.02);
  shadeSlab(c, art, W, h, cornice);
  // Cornice with dentils.
  c.fillStyle = vGrad(c, 0, cornice, [
    [0, mix(art.stoneLit, "#ffffff", 0.3)],
    [1, art.stone],
  ]);
  c.fillRect(-W, 0, W * 2, cornice);
  c.fillStyle = rgba(art.ink, 0.25);
  c.fillRect(-W, cornice, W * 2, 0.025);
  c.fillStyle = art.stoneMid;
  for (let x = -W + 0.06; x < W - 0.05; x += 0.15) c.fillRect(x, cornice + 0.025, 0.07, 0.06);
  goldLine(c, art, -W, W, cornice * 0.55, 0.03);
  c.restore();
  if (art.time === "afternoon" && h >= 0.9 && r.chance(0.7)) brassPipe(c, art, r, W, h * 0.72);
  outline(c, art, W, h);
  litLip(c, W, rgba("#ffffff", 0.75));
  // A few tufts in the paving joints.
  for (let k = 0; k < W; k++) {
    const x = r.range(-W + 0.2, W - 0.2);
    tufts(c, art, r, x, x + 0.15, 1, 0);
  }
}

/** A brass pipe run across a face, with flanges, a valve wheel and a gauge. */
function brassPipe(c: Ctx, art: Art, r: Rng, W: number, y: number) {
  const R = 0.07;
  c.fillStyle = vGrad(c, y - R, y + R, [
    [0, art.bronzeLit],
    [0.45, art.bronze],
    [1, art.bronzeDark],
  ]);
  c.fillRect(-W, y - R, W * 2, R * 2);
  c.fillStyle = rgba(art.ink, 0.4);
  c.fillRect(-W, y + R - 0.012, W * 2, 0.012);
  for (let x = -W + r.range(0.4, 0.9); x < W - 0.2; x += r.range(0.9, 1.4)) {
    c.beginPath();
    c.roundRect(x - 0.035, y - R * 1.45, 0.07, R * 2.9, 0.015);
    c.fillStyle = art.bronze;
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.55);
    c.lineWidth = 0.012;
    c.stroke();
  }
  // Valve wheel.
  const vx = r.range(-W * 0.5, W * 0.5);
  c.beginPath();
  c.moveTo(vx, y - R);
  c.lineTo(vx, y - 0.22);
  c.strokeStyle = art.bronzeDark;
  c.lineWidth = 0.03;
  c.stroke();
  c.beginPath();
  c.arc(vx, y - 0.26, 0.1, 0, TAU);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    c.moveTo(vx, y - 0.26);
    c.lineTo(vx + Math.cos(a) * 0.1, y - 0.26 + Math.sin(a) * 0.1);
  }
  c.strokeStyle = vx > 0 ? art.gold : art.bronzeLit;
  c.lineWidth = 0.022;
  c.stroke();
  // Pressure gauge.
  const gx = vx + (vx > 0 ? -0.7 : 0.7);
  if (Math.abs(gx) < W - 0.2) {
    c.beginPath();
    c.arc(gx, y - 0.2, 0.11, 0, TAU);
    c.fillStyle = art.ivory;
    c.fill();
    c.strokeStyle = art.bronzeDark;
    c.lineWidth = 0.025;
    c.stroke();
    c.beginPath();
    c.moveTo(gx, y - 0.2);
    c.lineTo(gx + 0.06, y - 0.26);
    c.strokeStyle = art.vermilion;
    c.lineWidth = 0.014;
    c.stroke();
    c.fillStyle = art.bronze;
    c.fillRect(gx - 0.02, y - 0.1, 0.04, 0.04);
  }
}

function frieze(c: Ctx, art: Art, r: Rng, kind: Frieze, W: number, y: number, fh: number) {
  const groove = rgba(art.ink, 0.35);
  const draw = (fn: () => void, width: number) => {
    c.save();
    c.translate(0.012, 0.012);
    c.beginPath();
    fn();
    c.strokeStyle = groove;
    c.lineWidth = width * 1.3;
    c.stroke();
    c.restore();
    c.beginPath();
    fn();
    c.strokeStyle = art.gold;
    c.lineWidth = width;
    c.stroke();
  };
  const cy = y + fh / 2;
  if (kind === "meander") {
    const u = fh / 3;
    draw(() => {
      let x = -W;
      c.moveTo(x, y + fh);
      while (x < W) {
        c.lineTo(x, y);
        c.lineTo(x + u * 3, y);
        c.lineTo(x + u * 3, y + u * 2);
        c.lineTo(x + u, y + u * 2);
        c.lineTo(x + u, y + u);
        c.lineTo(x + u * 2, y + u);
        c.moveTo(x + u * 3, y + u * 2);
        c.lineTo(x + u * 3, y + fh);
        c.lineTo(x + u * 4, y + fh);
        x += u * 4;
      }
    }, 0.022);
  } else if (kind === "wave") {
    const u = fh * 1.1;
    draw(() => {
      for (let x = -W; x < W; x += u) {
        c.moveTo(x, y + fh * 0.85);
        c.bezierCurveTo(x + u * 0.3, y + fh * 0.85, x + u * 0.55, y, x + u * 0.75, y + fh * 0.35);
        c.arc(x + u * 0.62, y + fh * 0.42, u * 0.14, 0, Math.PI * 1.5);
      }
    }, 0.02);
  } else if (kind === "stars") {
    for (let x = -W + fh * 0.6; x < W; x += fh * 1.4) {
      c.beginPath();
      sparkle(c, x, cy, fh * 0.42, 0.22);
      c.fillStyle = groove;
      c.fill();
      c.beginPath();
      sparkle(c, x - 0.01, cy - 0.01, fh * 0.4, 0.22);
      c.fillStyle = art.gold;
      c.fill();
      c.beginPath();
      c.arc(x + fh * 0.7, cy, fh * 0.07, 0, TAU);
      c.fillStyle = art.goldLight;
      c.fill();
    }
  } else if (kind === "glyphs") {
    // Planetary glyphs in medallions.
    let k = 0;
    for (let x = -W + fh * 0.7; x < W - fh * 0.3; x += fh * 1.6, k++) {
      const R = fh * 0.42;
      draw(() => {
        c.moveTo(x + R, cy);
        c.arc(x, cy, R, 0, TAU);
        switch (k % 4) {
          case 0:
            c.moveTo(x + R * 0.35, cy);
            c.arc(x, cy, R * 0.35, 0, TAU);
            break;
          case 1:
            c.moveTo(x + R * 0.3, cy - R * 0.55);
            c.arc(x, cy, R * 0.6, -1.0, 1.0, true);
            break;
          case 2:
            c.moveTo(x - R * 0.6, cy);
            c.lineTo(x + R * 0.6, cy);
            c.moveTo(x, cy - R * 0.6);
            c.lineTo(x, cy + R * 0.6);
            break;
          default:
            c.moveTo(x - R * 0.5, cy + R * 0.3);
            c.lineTo(x, cy - R * 0.5);
            c.lineTo(x + R * 0.5, cy + R * 0.3);
            c.closePath();
        }
      }, 0.018);
    }
  } else if (kind === "rays") {
    draw(() => {
      for (let x = -W; x < W; x += 0.1) {
        c.moveTo(x, y + fh);
        c.lineTo(x + 0.05, y + fh * (0.15 + 0.25 * Math.abs(Math.sin(x * 9))));
      }
    }, 0.012);
  } else {
    for (let x = -W + 0.1; x < W - 0.1; x += fh * 1.3) {
      c.beginPath();
      c.roundRect(x, y + 0.01, fh * 1.05, fh - 0.02, 0.04);
      c.fillStyle = rgba(art.stoneDark, 0.3);
      c.fill();
      c.strokeStyle = rgba(art.ink, 0.3);
      c.lineWidth = 0.012;
      c.stroke();
      c.beginPath();
      c.arc(x + fh * 0.52, cy, fh * 0.13, 0, TAU);
      c.fillStyle = art.gold;
      c.fill();
    }
  }
  void r;
}

function ruinFront(c: Ctx, art: Art, p: Plan) {
  const { W, h, r } = p;
  // A chipped bottom edge; the top stays exactly at the collision line.
  const bottomPts: number[][] = [];
  const N = Math.max(4, Math.round(W * 3));
  for (let k = 0; k <= N; k++) {
    const x = W - (k / N) * W * 2;
    const edge = k === 0 || k === N;
    bottomPts.push([x, h - (edge ? r.range(0.05, 0.18) : r.chance(0.3) ? r.range(0.04, 0.16) : 0)]);
  }
  const body = () => {
    c.beginPath();
    c.moveTo(-W, 0);
    c.lineTo(W, 0);
    c.lineTo(W, h - 0.2);
    for (const [x, y] of bottomPts) c.lineTo(x, y);
    c.lineTo(-W, h - 0.2);
    c.closePath();
  };
  const weathered = mix(art.stone, art.stoneMid, 0.3);
  body();
  c.fillStyle = vGrad(c, 0, h, [
    [0, mix(weathered, art.stoneLit, 0.5)],
    [0.4, weathered],
    [1, mix(art.stoneMid, art.grassDark, 0.15)],
  ]);
  c.fill();
  c.save();
  body();
  c.clip();
  // Irregular blocks.
  let y = 0.14;
  while (y < h) {
    const rh = r.range(0.28, 0.48);
    let x = -W - r.range(0, 0.4);
    while (x < W) {
      const bw = r.range(0.5, 1.2);
      const j = () => r.range(-0.025, 0.025);
      c.beginPath();
      c.moveTo(x + j(), y + j());
      c.lineTo(x + bw + j(), y + j());
      c.lineTo(x + bw + j(), y + rh + j());
      c.lineTo(x + j(), y + rh + j());
      c.closePath();
      const missing = r.chance(0.07) && y > 0.3;
      c.fillStyle = missing ? rgba(art.stoneDeep, 0.85) : rgba(r.chance(0.5) ? art.stoneLit : art.stoneDark, r.range(0.05, 0.2));
      c.fill();
      c.strokeStyle = rgba(art.ink, missing ? 0.5 : 0.3);
      c.lineWidth = 0.015;
      c.stroke();
      if (r.chance(0.25)) {
        c.beginPath();
        let cx = x + r.range(0.1, bw - 0.1),
          cy = y + 0.02;
        c.moveTo(cx, cy);
        for (let q = 0; q < 4; q++) {
          cx += r.range(-0.07, 0.07);
          cy += rh / 4;
          c.lineTo(cx, cy);
        }
        c.strokeStyle = rgba(art.ink, 0.45);
        c.lineWidth = 0.014;
        c.stroke();
      }
      x += bw;
    }
    y += rh;
  }
  // A broken gilt inlay.
  if (h > 0.8) {
    const gy = r.range(0.35, Math.min(0.7, h - 0.3));
    const gap = r.range(-W * 0.3, W * 0.3);
    goldLine(c, art, -W, gap - 0.25, gy, 0.026);
    goldLine(c, art, gap + 0.3, W, gy, 0.026);
    c.beginPath();
    c.arc(gap + r.range(0.6, 1.2), gy + 0.22, 0.12, Math.PI * 0.1, Math.PI * 1.3);
    c.strokeStyle = art.gold;
    c.lineWidth = 0.022;
    c.stroke();
  }
  shadeSlab(c, art, W, h, 0.1);
  // Moss pooling on the upper face.
  for (let k = 0; k < W * 4; k++) {
    c.beginPath();
    c.ellipse(r.range(-W, W), r.range(0.1, 0.3), r.range(0.1, 0.25), r.range(0.04, 0.09), 0, 0, TAU);
    c.fillStyle = rgba(art.grassDark, 0.5);
    c.fill();
  }
  c.restore();
  body();
  c.strokeStyle = art.ink;
  c.lineWidth = OUT;
  c.stroke();
  // Cracked paving cap.
  c.fillStyle = vGrad(c, 0, 0.12, [
    [0, mix(art.stoneLit, "#ffffff", 0.2)],
    [1, art.stone],
  ]);
  c.fillRect(-W, 0, W * 2, 0.11);
  c.beginPath();
  for (let x = -W + r.range(0.2, 0.5); x < W - 0.1; x += r.range(0.3, 0.7)) {
    c.moveTo(x, 0.0);
    c.lineTo(x + r.range(-0.04, 0.04), 0.11);
  }
  c.moveTo(-W, 0.11);
  c.lineTo(W, 0.11);
  c.strokeStyle = rgba(art.ink, 0.45);
  c.lineWidth = 0.016;
  c.stroke();
  c.beginPath();
  c.moveTo(-W, 0);
  c.lineTo(W, 0);
  c.strokeStyle = art.ink;
  c.lineWidth = OUT;
  c.stroke();
  litLip(c, W, rgba("#ffffff", 0.6));
  // Moss drips and patchy tufts.
  for (let k = 0; k < W * 2; k++) {
    const x = r.range(-W + 0.1, W - 0.1);
    const len = r.range(0.1, 0.35);
    c.beginPath();
    c.moveTo(x - 0.12, 0.01);
    c.quadraticCurveTo(x - 0.06, len * 0.5, x, len);
    c.quadraticCurveTo(x + 0.06, len * 0.5, x + 0.12, 0.01);
    c.closePath();
    c.fillStyle = art.grass;
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.35);
    c.lineWidth = 0.012;
    c.stroke();
    tufts(c, art, r, x - 0.15, x + 0.15, 1.2, 0.2);
  }
  const ivy = r.int(1, Math.min(3, Math.ceil(W)));
  for (let k = 0; k < ivy; k++) ivyStrand(c, art, r, r.range(-W + 0.2, W - 0.2), 0.1, r.range(0.3, Math.max(0.35, h - 0.25)));
}

function bridgeFront(c: Ctx, art: Art, p: Plan) {
  const { W, h, r } = p;
  slabPath(c, W, h, 0.05);
  c.fillStyle = vGrad(c, 0, h, [
    [0, art.stoneLit],
    [0.5, art.stone],
    [1, art.stoneMid],
  ]);
  c.fill();
  c.save();
  slabPath(c, W, h, 0.05);
  c.clip();
  // Coffers with gilt studs, or a blind arcade.
  const arcade = r.chance(0.5);
  const top = Math.min(0.13, h * 0.3);
  const ph = h - top - 0.1;
  if (arcade) {
    for (let x = -W + 0.12; x < W - 0.2; x += 0.34) {
      c.beginPath();
      c.moveTo(x, top + ph);
      c.lineTo(x, top + ph * 0.5);
      c.arc(x + 0.12, top + ph * 0.5, 0.12, Math.PI, 0);
      c.lineTo(x + 0.24, top + ph);
      c.fillStyle = rgba(art.stoneDeep, 0.45);
      c.fill();
      c.strokeStyle = rgba(art.ink, 0.35);
      c.lineWidth = 0.012;
      c.stroke();
    }
  } else {
    for (let x = -W + 0.1; x < W - 0.15; x += 0.5) {
      c.beginPath();
      c.roundRect(x, top + 0.04, 0.42, ph - 0.06, 0.04);
      c.fillStyle = rgba(art.stoneDark, 0.25);
      c.fill();
      c.strokeStyle = rgba(art.ink, 0.3);
      c.lineWidth = 0.012;
      c.stroke();
      c.beginPath();
      sparkle(c, x + 0.21, top + 0.04 + (ph - 0.06) / 2, 0.06);
      c.fillStyle = art.gold;
      c.fill();
    }
  }
  shadeSlab(c, art, W, h, top);
  c.fillStyle = vGrad(c, 0, top, [
    [0, mix(art.stoneLit, "#ffffff", 0.3)],
    [1, art.stone],
  ]);
  c.fillRect(-W, 0, W * 2, top);
  goldLine(c, art, -W, W, top, 0.024);
  c.restore();
  outline(c, art, W, h);
  litLip(c, W, rgba("#ffffff", 0.7));
}

function rivets(c: Ctx, art: Art, W: number, y: number, gap: number) {
  for (let x = -W + gap / 2; x < W; x += gap) {
    c.beginPath();
    c.arc(x, y, 0.028, 0, TAU);
    c.fillStyle = art.bronzeLit;
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.5);
    c.lineWidth = 0.01;
    c.stroke();
  }
}

function plinthFront(c: Ctx, art: Art, p: Plan, out: IslandArt, moving: boolean) {
  const { W, h, r } = p;
  slabPath(c, W, h, 0.05);
  c.fillStyle = vGrad(c, 0, h, [
    [0, art.stone],
    [1, art.stoneMid],
  ]);
  c.fill();
  c.save();
  slabPath(c, W, h, 0.05);
  c.clip();
  const rim = Math.min(0.17, h * 0.22);
  // Engraved panels on the core.
  const coreTop = rim + 0.04,
    coreBot = h - rim * 0.8 - 0.04;
  c.beginPath();
  for (let x = -W + 0.15; x < W - 0.1; x += 0.12) {
    if (Math.abs(x) < Math.min(W * 0.45, 0.65)) continue;
    c.moveTo(x, coreTop + 0.06);
    c.lineTo(x, coreBot - 0.06);
  }
  c.strokeStyle = rgba(art.stoneDark, 0.45);
  c.lineWidth = 0.016;
  c.stroke();
  // A centre medallion in one of four engravings; its inner gear turns while the island moves.
  const R = Math.min((coreBot - coreTop) * 0.5, W * 0.45, 0.6);
  const cy = (coreTop + coreBot) / 2;
  const face = r.pick(["dial", "compass", "orrery", "sunburst"] as const);
  if (R > 0.12) {
    c.beginPath();
    c.arc(0, cy, R, 0, TAU);
    c.fillStyle = rgba(art.stoneDeep, face === "orrery" ? 0.55 : 0.35);
    c.fill();
    c.strokeStyle = art.gold;
    c.lineWidth = 0.025;
    c.stroke();
    if (face === "dial") {
      c.beginPath();
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * TAU;
        c.moveTo(Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86);
        c.lineTo(Math.cos(a) * R * (k % 6 ? 0.94 : 1.0), cy + Math.sin(a) * R * (k % 6 ? 0.94 : 1.0));
      }
      c.strokeStyle = rgba(art.gold, 0.85);
      c.lineWidth = 0.014;
      c.stroke();
    } else if (face === "compass") {
      c.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU - Math.PI / 2;
        const rr = k % 4 === 0 ? R * 1.0 : k % 2 === 0 ? R * 0.7 : R * 0.42;
        const x = Math.cos(a) * rr,
          y = cy + Math.sin(a) * rr;
        if (k === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
        const a2 = ((k + 0.5) / 16) * TAU - Math.PI / 2;
        c.lineTo(Math.cos(a2) * R * 0.22, cy + Math.sin(a2) * R * 0.22);
      }
      c.closePath();
      c.fillStyle = rgba(art.gold, 0.75);
      c.fill();
      c.strokeStyle = rgba(art.goldDark, 0.9);
      c.lineWidth = 0.012;
      c.stroke();
    } else if (face === "orrery") {
      for (let k = 1; k <= 3; k++) {
        c.beginPath();
        c.arc(0, cy, R * (0.3 + k * 0.2), 0, TAU);
        c.strokeStyle = rgba(art.goldLight, 0.55);
        c.lineWidth = 0.012;
        c.stroke();
        const a = r.range(0, TAU);
        c.beginPath();
        c.arc(Math.cos(a) * R * (0.3 + k * 0.2), cy + Math.sin(a) * R * (0.3 + k * 0.2), 0.035 + k * 0.008, 0, TAU);
        c.fillStyle = k === 2 ? art.goldLight : mix(art.fabric, "#ffffff", 0.3);
        c.fill();
      }
    } else {
      c.beginPath();
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * TAU;
        c.moveTo(Math.cos(a) * R * 0.4, cy + Math.sin(a) * R * 0.4);
        c.lineTo(Math.cos(a) * R * (k % 2 ? 0.8 : 0.95), cy + Math.sin(a) * R * (k % 2 ? 0.8 : 0.95));
      }
      c.strokeStyle = rgba(art.gold, 0.85);
      c.lineWidth = 0.016;
      c.stroke();
    }
    out.faceGears.push({ x: 0, y: cy, r: R * (face === "dial" ? 0.72 : 0.36), teeth: face === "dial" ? 10 : 7, speed: moving ? 1 : 0, tone: 0 });
  }
  // Side ornaments: bolted plates with a star or a small porthole.
  const side = r.pick(["star", "port", "none"] as const);
  if (side !== "none" && W > 1.2)
    for (const sx of [-1, 1]) {
      const x = sx * (W - Math.min(0.42, W * 0.25));
      if (side === "star") {
        c.beginPath();
        sparkle(c, x, cy, Math.min(0.16, R * 0.4), 0.2);
        c.fillStyle = art.gold;
        c.fill();
      } else {
        c.beginPath();
        c.arc(x, cy, Math.min(0.13, R * 0.35), 0, TAU);
        c.fillStyle = rgba(art.warm, moving ? 0.6 : 0.25);
        c.fill();
        c.strokeStyle = art.bronzeDark;
        c.lineWidth = 0.03;
        c.stroke();
      }
    }
  shadeSlab(c, art, W, h, rim);
  // Bronze rims.
  for (const [y0, hh] of [
    [0, rim],
    [h - rim * 0.8, rim * 0.8],
  ]) {
    c.fillStyle = vGrad(c, y0, y0 + hh, [
      [0, art.bronzeLit],
      [0.45, art.bronze],
      [1, art.bronzeDark],
    ]);
    c.fillRect(-W, y0, W * 2, hh);
    c.fillStyle = rgba(art.ink, 0.35);
    c.fillRect(-W, y0 + hh - 0.015, W * 2, 0.015);
    rivets(c, art, W, y0 + hh / 2, 0.32);
  }
  if (moving) {
    c.fillStyle = rgba(art.warm, 0.55);
    c.fillRect(-W, rim + 0.005, W * 2, 0.025);
  }
  c.restore();
  slabPath(c, W, h, 0.05);
  c.strokeStyle = art.ink;
  c.lineWidth = OUT;
  c.stroke();
  litLip(c, W, rgba(art.goldLight, 0.95));
}

function starPlank(c: Ctx, art: Art, p: Plan) {
  const { W, h, r } = p;
  const deep = mix(art.p.ink, art.night ? art.p.skyTop : mix(art.p.skyTop, art.p.ink, 0.5), 0.45);
  const body = () => {
    c.beginPath();
    c.roundRect(-W, 0, W * 2, h, [0.02, 0.02, Math.min(0.14, h / 2), Math.min(0.14, h / 2)]);
  };
  body();
  c.fillStyle = vGrad(c, 0, h, [
    [0, rgba(mix(deep, art.gold, 0.25), 0.95)],
    [0.5, rgba(deep, 0.92)],
    [1, rgba(mix(deep, art.ink, 0.4), 0.9)],
  ]);
  c.fill();
  c.save();
  body();
  c.clip();
  for (let k = 0; k < W * 30; k++) {
    c.beginPath();
    c.arc(r.range(-W, W), r.range(0.05, h), r.range(0.006, 0.016), 0, TAU);
    c.fillStyle = rgba("#ffffff", r.range(0.3, 0.9));
    c.fill();
  }
  // Constellation zig-zag.
  const n = Math.max(3, Math.round(W * 2.4) + 1);
  const pts: number[][] = [];
  for (let k = 0; k < n; k++) pts.push([-W + 0.2 + (k / (n - 1)) * (W * 2 - 0.4), h * (k % 2 ? 0.72 : 0.36) + r.range(-0.05, 0.05)]);
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (const q of pts) c.lineTo(q[0], q[1]);
  c.strokeStyle = rgba(art.goldLight, 0.85);
  c.lineWidth = 0.02;
  c.stroke();
  for (const [x, y] of pts) {
    c.beginPath();
    sparkle(c, x, y, r.range(0.07, 0.1));
    c.fillStyle = "#fffbe8";
    c.fill();
    c.beginPath();
    c.arc(x, y, 0.1, 0, TAU);
    c.strokeStyle = rgba(art.goldLight, 0.5);
    c.lineWidth = 0.01;
    c.stroke();
  }
  c.restore();
  body();
  c.strokeStyle = art.goldLight;
  c.lineWidth = 0.03;
  c.stroke();
  c.beginPath();
  c.moveTo(-W, 0.025);
  c.lineTo(W, 0.025);
  c.strokeStyle = art.goldLight;
  c.lineWidth = 0.07;
  c.stroke();
  c.beginPath();
  c.moveTo(-W, 0.02);
  c.lineTo(W, 0.02);
  c.strokeStyle = "#ffffff";
  c.lineWidth = 0.025;
  c.stroke();
  for (const s of [-1, 1]) {
    c.beginPath();
    sparkle(c, s * (W - 0.02), 0.02, 0.13);
    c.fillStyle = "#fff6d8";
    c.fill();
  }
}

// ------------------------------------------------------------- undersides

function contactShadow(c: Ctx, art: Art, W: number, h: number) {
  // Only darkens paint already laid down, so it never spills into the air.
  const g = c.createLinearGradient(0, h, 0, h + 0.45);
  g.addColorStop(0, rgba(art.ink, 0.5));
  g.addColorStop(1, rgba(art.ink, 0));
  c.save();
  c.globalCompositeOperation = "source-atop";
  c.fillStyle = g;
  c.fillRect(-W - 0.2, h - 0.02, W * 2 + 0.4, 0.5);
  c.restore();
}

function rockUnder(c: Ctx, i: Island, art: Art, p: Plan) {
  const { W, h, r, contour } = p;
  const D = p.depth;
  const shape = () => {
    c.beginPath();
    c.moveTo(-W + 0.03, h - 0.05);
    c.lineTo(contour[0][0], contour[0][1]);
    smoothOpen(c, contour, 0.4, false);
    c.lineTo(W - 0.03, h - 0.05);
    c.closePath();
  };
  shape();
  c.fillStyle = vGrad(c, h, D, [
    [0, art.rockTop],
    [0.45, art.rockMid],
    [1, art.rockTip],
  ]);
  c.fill();
  c.save();
  shape();
  c.clip();
  // Strata bands following a gentle wave, with embedded boulders.
  const phase = r.range(0, TAU);
  const wave = (x: number, y: number) => y + Math.sin(x * 1.1 + phase + y * 1.7) * 0.08 + Math.sin(x * 2.9 + y) * 0.03;
  const lit = art.light <= 0 ? -1 : 1;
  let j = 0;
  let y = h + r.range(0.25, 0.4);
  while (y < D + 0.2) {
    const bandH = r.range(0.32, 0.62);
    const top: number[][] = [];
    for (let x = -W - 0.2; x <= W + 0.2; x += 0.2) top.push([x, wave(x, y)]);
    c.beginPath();
    smoothOpen(c, top);
    for (let k = top.length - 1; k >= 0; k--) c.lineTo(top[k][0], wave(top[k][0], y + bandH));
    c.closePath();
    c.fillStyle = j % 2 ? rgba(art.ink, 0.07 + r.range(0, 0.05)) : rgba(art.stoneLit, 0.06 + r.range(0, 0.05));
    c.fill();
    // Broken contour line on top of each band.
    c.beginPath();
    let drawing = false;
    for (const [x, yy] of top) {
      if (r.chance(0.1)) drawing = !drawing;
      if (drawing) c.lineTo(x, yy);
      else c.moveTo(x, yy);
    }
    c.strokeStyle = rgba(art.ink, 0.3);
    c.lineWidth = 0.02;
    c.stroke();
    // Ledge highlights on the lit side.
    c.beginPath();
    for (let x = lit < 0 ? -W : W * 0.1; x < (lit < 0 ? -W * 0.1 : W); x += 0.1) {
      if (!r.chance(0.12)) continue;
      const len = r.range(0.3, 0.7);
      c.moveTo(x, wave(x, y) + 0.03);
      for (let q = 0.1; q <= len; q += 0.1) c.lineTo(x + q, wave(x + q, y) + 0.03);
      x += len;
    }
    c.strokeStyle = rgba(art.rim, 0.28);
    c.lineWidth = 0.03;
    c.stroke();
    y += bandH;
    j++;
  }
  for (let k = 0; k < Math.round(W * 1.2); k++) {
    const bx = r.range(-W * 0.75, W * 0.75),
      by = r.range(h + 0.4, h + (D - h) * 0.6);
    const bw = r.range(0.25, 0.55),
      bh = bw * r.range(0.5, 0.8);
    c.beginPath();
    pebble(c, bx - bw / 2, by - bh / 2, bw, bh, r);
    c.fillStyle = mix(art.rockTop, art.stoneMid, r.range(0.2, 0.5));
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.35);
    c.lineWidth = 0.016;
    c.stroke();
    c.beginPath();
    c.moveTo(bx - bw * 0.3, by - bh * 0.42);
    c.quadraticCurveTo(bx, by - bh * 0.55, bx + bw * 0.3, by - bh * 0.42);
    c.strokeStyle = rgba(art.rim, 0.45);
    c.lineWidth = 0.02;
    c.stroke();
  }
  if (r.chance(art.night || art.time === "dawn" ? 0.7 : 0.35)) {
    // A vein of gold running through the rock.
    let vx = r.range(-W * 0.5, W * 0.5),
      vy = h + 0.3;
    c.beginPath();
    c.moveTo(vx, vy);
    while (vy < h + (D - h) * 0.7) {
      vx += r.range(-0.2, 0.2);
      vy += r.range(0.12, 0.25);
      c.lineTo(vx, vy);
    }
    c.strokeStyle = rgba(art.gold, 0.85);
    c.lineWidth = 0.022;
    c.stroke();
    c.strokeStyle = rgba(art.goldLight, 0.6);
    c.lineWidth = 0.008;
    c.stroke();
  }
  // Vertical fissures.
  c.beginPath();
  for (let k = 0; k < W * 1.5; k++) {
    let x = r.range(-W * 0.8, W * 0.8),
      y = h + r.range(0.2, 0.8);
    c.moveTo(x, y);
    const len = r.range(0.5, 1.6);
    for (let q = 0; q < 5; q++) {
      x += r.range(-0.08, 0.08);
      y += len / 5;
      c.lineTo(x, y);
    }
  }
  c.strokeStyle = rgba(art.ink, 0.3);
  c.lineWidth = 0.016;
  c.stroke();
  // Light side glow, shadow side hatching.
  const side = art.light < -0.2 ? -1 : art.light > 0.2 ? 1 : 0;
  if (side !== 0) {
    const g = c.createLinearGradient(side * W, 0, 0, 0);
    g.addColorStop(0, rgba(art.rim, 0.22));
    g.addColorStop(1, rgba(art.rim, 0));
    c.fillStyle = g;
    c.fillRect(-W, h, W * 2, D);
  }
  c.save();
  c.beginPath();
  if (side !== 0) c.rect(side > 0 ? -W - 0.2 : W * 0.15, h, W * 0.85 + 0.2, D);
  else {
    c.rect(-W, h, W * 0.5, D);
    c.rect(W * 0.5, h, W * 0.5, D);
  }
  c.clip();
  c.beginPath();
  hatch(c, -W, h, W, D + 0.5, 0.085, -0.9);
  c.strokeStyle = rgba(art.ink, 0.16);
  c.lineWidth = 0.015;
  c.stroke();
  c.restore();
  contactShadow(c, art, W, h);
  // Recede into the air towards the tip.
  const fade = c.createLinearGradient(0, h + (D - h) * 0.35, 0, D);
  fade.addColorStop(0, rgba(art.air, 0));
  fade.addColorStop(1, rgba(art.air, 0.55));
  c.fillStyle = fade;
  c.fillRect(-W - 1, h, W * 2 + 2, D - h + 0.5);
  c.restore();
  shape();
  c.strokeStyle = rgba(art.ink, 0.65);
  c.lineWidth = 0.032;
  c.stroke();

  hangings(c, art, r, i, p);
  pebbles(c, art, r, W, D);
}

/** Roots, vines, wisteria and moss beards hanging from the underside. */
function hangings(c: Ctx, art: Art, r: Rng, i: Island, p: Plan) {
  const { W, h, contour } = p;
  const rootCol = mix(art.bark, art.ink, 0.3);
  const anchors = contour.filter((_, k) => k > 1 && k < contour.length - 2);
  const nRoots = Math.min(anchors.length, r.int(3, 4 + Math.floor(W)));
  for (let k = 0; k < nRoots; k++) {
    const [ax, ay] = r.pick(anchors);
    const len = r.range(0.5, 1.7);
    const pts: number[][] = [[ax, ay - 0.15]];
    let x = ax,
      y = ay;
    let dir = r.range(-0.4, 0.4);
    for (let q = 1; q <= 7; q++) {
      dir += r.range(-0.5, 0.5);
      x += Math.sin(dir) * len * 0.1;
      y += (len / 7) * (0.8 + Math.cos(dir) * 0.2);
      pts.push([x, y]);
    }
    c.beginPath();
    taper(c, pts, 0.055, 0.006);
    c.fillStyle = rootCol;
    c.fill();
    if (r.chance(0.7)) {
      const b = pts[3];
      const side = r.sign();
      c.beginPath();
      taper(c, [b, [b[0] + side * 0.12, b[1] + 0.12], [b[0] + side * 0.18, b[1] + 0.3], [b[0] + side * 0.14, b[1] + 0.45]], 0.025, 0.004);
      c.fill();
    }
  }
  const vines = i.style === "garden" ? r.int(2, 3 + Math.floor(W / 2)) : i.style === "ruin" ? r.int(1, 3) : r.int(0, 2);
  const wisteria = art.time === "dusk" || (art.time === "morning" && r.chance(0.3));
  for (let k = 0; k < vines; k++) {
    const x0 = r.range(-W + 0.2, W - 0.2);
    const len = r.range(0.9, 2.6);
    const pts: number[][] = [];
    let x = x0;
    for (let q = 0; q <= 8; q++) {
      pts.push([x, h - 0.02 + (q / 8) * len]);
      x += r.range(-0.07, 0.07);
    }
    c.beginPath();
    smoothOpen(c, pts);
    c.strokeStyle = art.foliageDark;
    c.lineWidth = 0.024;
    c.stroke();
    for (let q = 1; q < pts.length; q++) {
      const [lx, ly] = pts[q];
      for (const s of [-1, 1]) {
        if (r.chance(0.25)) continue;
        c.beginPath();
        leafPath(c, lx, ly, r.range(0.1, 0.16), Math.PI / 2 + s * r.range(0.6, 1.2), 0.45);
        c.fillStyle = r.chance(0.5) ? art.foliage : mix(art.foliage, art.foliageLit, 0.5);
        c.fill();
      }
    }
    if (wisteria && r.chance(0.7)) {
      const [ex, ey] = pts[pts.length - 1];
      for (let q = 0; q < 8; q++) {
        c.beginPath();
        c.arc(ex + Math.sin(q * 1.7) * 0.03, ey + q * 0.06, 0.06 * (1 - q / 10), 0, TAU);
        c.fillStyle = mix("#b9a2ec", q % 2 ? "#ffffff" : art.ink, 0.15);
        c.fill();
      }
    } else if (r.chance(0.4)) {
      const [ex, ey] = pts[pts.length - 1];
      c.beginPath();
      c.arc(ex, ey + 0.04, 0.05, 0, TAU);
      c.fillStyle = r.pick(art.flowers);
      c.fill();
    }
  }
  if (i.style === "ruin") {
    for (let k = 0; k < W * 2; k++) {
      const x = r.range(-W + 0.1, W - 0.1);
      c.beginPath();
      for (let q = 0; q < 5; q++) {
        c.moveTo(x + q * 0.03, h);
        c.quadraticCurveTo(x + q * 0.03 + 0.04, h + 0.2, x + q * 0.025, h + r.range(0.25, 0.6));
      }
      c.strokeStyle = rgba(art.grassDark, 0.85);
      c.lineWidth = 0.016;
      c.stroke();
    }
  }
  chapterHangings(c, art, r, i, p);
}

/** Set dressing under the islands that tells each chapter apart. */
export function chapterHangings(c: Ctx, art: Art, r: Rng, i: Island, p: Plan) {
  const { W, h } = p;
  const t = art.time;
  if ((t === "morning" || t === "noon") && i.style === "garden" && r.chance(0.55)) waterfall(c, art, r, p);
  if (t === "afternoon") {
    const n = r.int(1, 2);
    for (let k = 0; k < n; k++) {
      const x = r.range(-W * 0.7, W * 0.7);
      const len = r.range(0.8, 1.8);
      c.beginPath();
      for (let y = h + 0.05; y < h + len; y += 0.08) {
        c.moveTo(x + 0.025, y);
        c.ellipse(x, y, 0.025, 0.04, 0, 0, TAU);
      }
      c.strokeStyle = art.bronzeDark;
      c.lineWidth = 0.014;
      c.stroke();
      const wy = h + len;
      c.beginPath();
      c.roundRect(x - 0.13, wy, 0.26, 0.38, 0.05);
      const g = c.createLinearGradient(x - 0.13, 0, x + 0.13, 0);
      g.addColorStop(0, art.bronzeLit);
      g.addColorStop(0.5, art.bronze);
      g.addColorStop(1, art.bronzeDark);
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = rgba(art.ink, 0.6);
      c.lineWidth = 0.018;
      c.stroke();
      c.fillStyle = art.gold;
      c.fillRect(x - 0.13, wy + 0.08, 0.26, 0.03);
      c.fillRect(x - 0.13, wy + 0.27, 0.26, 0.03);
    }
  } else if (t === "dusk" && r.chance(0.8)) {
    const n = r.int(1, 2);
    for (let k = 0; k < n; k++) {
      const x = r.range(-W * 0.6, W * 0.6);
      const len = r.range(0.7, 1.3);
      c.fillStyle = art.bronze;
      c.fillRect(x - 0.24, h + 0.02, 0.48, 0.05);
      c.beginPath();
      c.moveTo(x - 0.2, h + 0.06);
      c.lineTo(x + 0.2, h + 0.06);
      c.lineTo(x + 0.2, h + len);
      c.quadraticCurveTo(x, h + len + 0.12, x - 0.2, h + len);
      c.closePath();
      c.fillStyle = art.ivory;
      c.fill();
      c.strokeStyle = rgba(art.ink, 0.5);
      c.lineWidth = 0.015;
      c.stroke();
      c.beginPath();
      for (let y = h + 0.18; y < h + len - 0.1; y += 0.07) {
        c.moveTo(x - 0.13, y);
        for (let q = 1; q <= 4; q++) c.lineTo(x - 0.13 + q * 0.065, y + (q % 2 ? -0.012 : 0.012));
      }
      c.strokeStyle = rgba(art.ink, 0.4);
      c.lineWidth = 0.01;
      c.stroke();
      c.beginPath();
      c.ellipse(x, h + len + 0.04, 0.22, 0.05, 0, 0, TAU);
      c.fillStyle = art.paperShade;
      c.fill();
      c.strokeStyle = rgba(art.ink, 0.5);
      c.stroke();
    }
  } else if (t === "night" && p.contour.length) {
    const tips = p.contour.slice().sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [x, y] of tips) {
      if (!r.chance(0.6)) continue;
      const g = c.createRadialGradient(x, y + 0.3, 0, x, y + 0.3, 0.7);
      g.addColorStop(0, "rgba(190,225,255,0.35)");
      g.addColorStop(1, "rgba(190,225,255,0)");
      c.fillStyle = g;
      c.fillRect(x - 0.7, y - 0.4, 1.4, 1.4);
      for (let q = 0; q < 3; q++) {
        const cx = x + (q - 1) * 0.1,
          len = r.range(0.25, 0.55) * (q === 1 ? 1.3 : 1);
        c.beginPath();
        c.moveTo(cx - 0.06, y - 0.05);
        c.lineTo(cx + 0.06, y - 0.05);
        c.lineTo(cx, y + len);
        c.closePath();
        c.fillStyle = q === 1 ? "#cfe6ff" : "#9fc4ea";
        c.fill();
        c.strokeStyle = rgba(art.ink, 0.5);
        c.lineWidth = 0.012;
        c.stroke();
      }
    }
  } else if (t === "dawn" && r.chance(0.8)) {
    const n = r.int(1, 3);
    for (let k = 0; k < n; k++) {
      const x = r.range(-W * 0.7, W * 0.7);
      const len = r.range(0.4, 1.1);
      c.beginPath();
      c.moveTo(x, h);
      c.lineTo(x, h + len);
      c.strokeStyle = art.goldDark;
      c.lineWidth = 0.014;
      c.stroke();
      c.beginPath();
      c.moveTo(x - 0.1, h + len + 0.18);
      c.quadraticCurveTo(x - 0.1, h + len, x, h + len);
      c.quadraticCurveTo(x + 0.1, h + len, x + 0.1, h + len + 0.18);
      c.closePath();
      c.fillStyle = art.gold;
      c.fill();
      c.strokeStyle = rgba(art.ink, 0.5);
      c.lineWidth = 0.014;
      c.stroke();
      c.beginPath();
      c.arc(x, h + len + 0.2, 0.03, 0, TAU);
      c.fillStyle = art.goldLight;
      c.fill();
    }
  }
}

function waterfall(c: Ctx, art: Art, r: Rng, p: Plan) {
  const { W, h } = p;
  const side = r.sign();
  const x0 = side * (W - 0.05);
  const bottom = p.depth + 1.3;
  const water = mix("#e4f6ff", art.p.skyHorizon, 0.2);
  const deep = mix("#8cc4e0", art.p.skyTop, 0.3);
  const wd = 0.34;
  // Ribbon edges wobble slightly as the water falls.
  const edge = (offset: number, phase: number) => {
    const pts: number[][] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const y = 0.1 + t * (bottom - 0.1);
      const out = Math.min(1, t * 6);
      pts.push([x0 + side * (0.5 * out + offset + Math.sin(t * 9 + phase) * 0.02 + t * 0.08 * (offset > 0 ? 1 : -1)), y]);
    }
    return pts;
  };
  const outer = edge(0.02, 0),
    inner = edge(-wd, 1.3);
  const shape = () => {
    c.beginPath();
    c.moveTo(outer[0][0], outer[0][1]);
    for (const q of outer) c.lineTo(q[0], q[1]);
    for (let k = inner.length - 1; k >= 0; k--) c.lineTo(inner[k][0], inner[k][1]);
    c.closePath();
  };
  shape();
  const g = c.createLinearGradient(0, 0, 0, bottom);
  g.addColorStop(0, rgba(water, 0.85));
  g.addColorStop(0.5, rgba(mix(water, deep, 0.35), 0.6));
  g.addColorStop(1, rgba(water, 0));
  c.fillStyle = g;
  c.fill();
  c.save();
  shape();
  c.clip();
  // Long falling streaks.
  c.beginPath();
  for (let k = 0; k < 9; k++) {
    const u = r.range(0.05, 0.95);
    const y0 = r.range(0.2, h + 0.8),
      len = r.range(0.6, 2.2);
    const px = (t: number) => x0 + side * (0.5 + 0.02 - u * wd + t * 0.06);
    c.moveTo(px(0), y0);
    c.lineTo(px(1), y0 + len);
  }
  c.strokeStyle = "rgba(255,255,255,0.75)";
  c.lineWidth = 0.016;
  c.stroke();
  c.beginPath();
  for (let k = 0; k < 6; k++) {
    const u = r.range(0.1, 0.9);
    const y0 = r.range(0.4, h + 1.4);
    c.moveTo(x0 + side * (0.52 - u * wd), y0);
    c.lineTo(x0 + side * (0.54 - u * wd), y0 + r.range(0.3, 0.9));
  }
  c.strokeStyle = rgba(deep, 0.5);
  c.lineWidth = 0.012;
  c.stroke();
  c.restore();
  // Foam at the lip and mist where the stream thins.
  for (let k = 0; k < 6; k++) {
    c.beginPath();
    c.arc(x0 + side * r.range(0.15, 0.5), r.range(0.1, 0.3), r.range(0.04, 0.08), 0, TAU);
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.fill();
  }
  const mist = c.createRadialGradient(x0 + side * 0.4, bottom - 0.6, 0, x0 + side * 0.4, bottom - 0.6, 0.8);
  mist.addColorStop(0, "rgba(255,255,255,0.35)");
  mist.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = mist;
  c.fillRect(x0 + side * 0.4 - 0.8, bottom - 1.4, 1.6, 1.6);
}

function pebbles(c: Ctx, art: Art, r: Rng, W: number, D: number) {
  const n = r.int(1, 3);
  for (let k = 0; k < n; k++) {
    const x = r.range(-W * 0.6, W * 0.6),
      y = D + r.range(0.35, 1.1);
    const s = r.range(0.08, 0.2);
    c.beginPath();
    c.moveTo(x - s, y - s * 0.3);
    c.lineTo(x + s * 0.8, y - s * 0.5);
    c.lineTo(x + s, y + s * 0.1);
    c.lineTo(x, y + s * 0.9);
    c.closePath();
    c.fillStyle = mix(art.rockMid, art.air, 0.35);
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.4);
    c.lineWidth = 0.014;
    c.stroke();
  }
}

function tierUnder(c: Ctx, i: Island, art: Art, p: Plan) {
  const { W, h, r } = p;
  const tiers = r.int(2, 4);
  let y = h;
  let half = W * 0.9;
  const total = p.depth - h - 0.6;
  const shrink = (half - 0.25) / (tiers + 0.5);
  for (let t = 0; t < tiers; t++) {
    const th = total / (tiers + 0.6);
    const tone = t / tiers;
    const fill = mix(mix(art.stoneMid, art.rockMid, 0.4 + tone * 0.3), art.air, tone * 0.35);
    c.beginPath();
    c.moveTo(-half, y - 0.02);
    c.lineTo(half, y - 0.02);
    c.lineTo(half - 0.06, y + th);
    c.lineTo(-half + 0.06, y + th);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.save();
    c.clip();
    c.beginPath();
    const bw = r.range(0.5, 0.8);
    for (let x = -half + (t % 2 ? bw / 2 : 0); x < half; x += bw) {
      c.moveTo(x, y);
      c.lineTo(x, y + th);
    }
    c.strokeStyle = rgba(art.ink, 0.18);
    c.lineWidth = 0.014;
    c.stroke();
    // Blind arched niches.
    const nw = 0.22;
    for (let x = -half + 0.25; x < half - 0.25 - nw; x += 0.55) {
      const top = y + th * 0.22,
        bot = y + th * 0.85;
      c.beginPath();
      c.moveTo(x, bot);
      c.lineTo(x, top + nw / 2);
      c.arc(x + nw / 2, top + nw / 2, nw / 2, Math.PI, 0);
      c.lineTo(x + nw, bot);
      c.closePath();
      c.fillStyle = rgba(mix(art.ink, art.rockMid, 0.4), 0.55);
      c.fill();
      c.strokeStyle = rgba(art.stoneLit, 0.35);
      c.lineWidth = 0.012;
      c.stroke();
    }
    c.fillStyle = rgba(art.stoneLit, 0.5);
    c.fillRect(-half, y, half * 2, 0.04);
    const side = art.light <= 0 ? 1 : -1;
    c.beginPath();
    hatch(c, side > 0 ? half * 0.3 : -half, y, side > 0 ? half : -half * 0.3, y + th, 0.08, -0.9);
    c.strokeStyle = rgba(art.ink, 0.14);
    c.lineWidth = 0.014;
    c.stroke();
    c.restore();
    c.beginPath();
    c.moveTo(-half, y - 0.02);
    c.lineTo(half, y - 0.02);
    c.lineTo(half - 0.06, y + th);
    c.lineTo(-half + 0.06, y + th);
    c.closePath();
    c.strokeStyle = rgba(art.ink, 0.55);
    c.lineWidth = 0.028;
    c.stroke();
    c.beginPath();
    c.moveTo(-half + 0.04, y + th - 0.02);
    c.lineTo(half - 0.04, y + th - 0.02);
    c.strokeStyle = t === 0 ? art.gold : rgba(art.gold, 0.55);
    c.lineWidth = 0.02;
    c.stroke();
    y += th;
    half -= shrink;
  }
  // Pendant finial.
  const fh = 0.5;
  c.beginPath();
  c.moveTo(-half, y - 0.02);
  c.lineTo(half, y - 0.02);
  c.lineTo(0, y + fh);
  c.closePath();
  c.fillStyle = mix(art.stoneMid, art.air, 0.4);
  c.fill();
  c.strokeStyle = rgba(art.ink, 0.5);
  c.lineWidth = 0.025;
  c.stroke();
  c.beginPath();
  c.moveTo(0, y + fh);
  c.lineTo(0, y + fh + 0.3);
  c.strokeStyle = art.goldDark;
  c.lineWidth = 0.015;
  c.stroke();
  c.beginPath();
  sparkle(c, 0, y + fh + 0.42, 0.12);
  c.fillStyle = art.gold;
  c.fill();
  contactShadow(c, art, W, h);
  hangings(c, art, r, i, { ...p, contour: [[-half, y], [0, y + fh], [half, y]] });
}

function bridgeUnder(c: Ctx, _i: Island, art: Art, p: Plan) {
  const { W, h, r } = p;
  const tone = mix(mix(art.stoneMid, art.rockMid, 0.45), art.air, 0.2);
  // Corbels at each end.
  for (const s of [-1, 1]) {
    const x = s * (W - 0.12);
    c.beginPath();
    c.moveTo(x, h - 0.02);
    c.lineTo(x - s * 0.55, h - 0.02);
    for (let k = 1; k <= 3; k++) {
      c.lineTo(x - s * (0.55 - k * 0.14), h - 0.02 + (k - 1) * 0.2);
      c.lineTo(x - s * (0.55 - k * 0.14), h - 0.02 + k * 0.2);
    }
    c.lineTo(x, h + 0.75);
    c.closePath();
    c.fillStyle = tone;
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.55);
    c.lineWidth = 0.025;
    c.stroke();
  }
  // A shallow arch between them, receding.
  if (W > 1.2) {
    c.beginPath();
    c.moveTo(-W + 0.6, h - 0.02);
    c.lineTo(W - 0.6, h - 0.02);
    c.lineTo(W - 0.6, h + 0.3);
    c.quadraticCurveTo(0, h + 0.05, -W + 0.6, h + 0.3);
    c.closePath();
    c.fillStyle = mix(tone, art.air, 0.15);
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.45);
    c.lineWidth = 0.02;
    c.stroke();
  }
  contactShadow(c, art, W, h);
  // Chains with gilt drops.
  for (let k = 0; k < Math.max(1, Math.floor(W)); k++) {
    const x0 = -W + 0.5 + r.range(0, W * 2 - 1);
    const len = r.range(0.5, 1.1);
    c.beginPath();
    for (let y = h + 0.1; y < h + len; y += 0.07) {
      c.moveTo(x0 + 0.02, y);
      c.ellipse(x0, y, 0.02, 0.035, 0, 0, TAU);
    }
    c.strokeStyle = art.bronzeDark;
    c.lineWidth = 0.012;
    c.stroke();
    c.beginPath();
    c.moveTo(x0, h + len);
    c.lineTo(x0 + 0.07, h + len + 0.1);
    c.lineTo(x0, h + len + 0.24);
    c.lineTo(x0 - 0.07, h + len + 0.1);
    c.closePath();
    c.fillStyle = art.gold;
    c.fill();
    c.strokeStyle = rgba(art.ink, 0.5);
    c.lineWidth = 0.01;
    c.stroke();
  }
  // A catenary garland between the corbels.
  c.beginPath();
  c.moveTo(-W + 0.4, h + 0.55);
  c.quadraticCurveTo(0, h + 1.0, W - 0.4, h + 0.55);
  c.strokeStyle = art.foliageDark;
  c.lineWidth = 0.022;
  c.stroke();
  for (let t = 0.05; t < 1; t += 0.08) {
    const x = (1 - t) * (1 - t) * (-W + 0.4) + 2 * (1 - t) * t * 0 + t * t * (W - 0.4);
    const y = (1 - t) * (1 - t) * (h + 0.55) + 2 * (1 - t) * t * (h + 1.0) + t * t * (h + 0.55);
    c.beginPath();
    leafPath(c, x, y, 0.12, Math.PI / 2 + r.range(-0.8, 0.8), 0.5);
    c.fillStyle = r.chance(0.5) ? art.foliage : art.foliageLit;
    c.fill();
    if (r.chance(0.25)) {
      c.beginPath();
      c.arc(x, y + 0.06, 0.04, 0, TAU);
      c.fillStyle = r.pick(art.flowers);
      c.fill();
    }
  }
}

function keelUnder(c: Ctx, _i: Island, art: Art, p: Plan, out: IslandArt) {
  const { W, h, r } = p;
  const K = p.depth - h;
  const top = Math.min(W * 0.8, W - 0.15);
  const kind = r.pick(["cone", "stepped", "pods"] as const);
  const path = () => {
    c.beginPath();
    if (kind === "stepped") {
      const n = 3;
      c.moveTo(-top, h - 0.02);
      c.lineTo(top, h - 0.02);
      for (let k = 0; k < n; k++) {
        const w0 = top * (1 - k / (n + 0.3)),
          w1 = top * (1 - (k + 1) / (n + 0.3));
        const y = h + ((k + 1) / n) * (K - 0.2);
        c.lineTo(w0 * 0.92, y - 0.05);
        c.lineTo(w1, y);
      }
      c.lineTo(0.12, h + K - 0.15);
      c.lineTo(-0.12, h + K - 0.15);
      for (let k = n - 1; k >= 0; k--) {
        const w0 = top * (1 - k / (n + 0.3)),
          w1 = top * (1 - (k + 1) / (n + 0.3));
        const y = h + ((k + 1) / n) * (K - 0.2);
        c.lineTo(-w1, y);
        c.lineTo(-w0 * 0.92, y - 0.05);
      }
      c.closePath();
    } else {
      c.moveTo(-top, h - 0.02);
      c.lineTo(top, h - 0.02);
      c.lineTo(top * 0.75, h + 0.18);
      c.quadraticCurveTo(top * 0.45, h + K * 0.55, 0.16, h + K - 0.15);
      c.lineTo(-0.16, h + K - 0.15);
      c.quadraticCurveTo(-top * 0.45, h + K * 0.55, -top * 0.75, h + 0.18);
      c.closePath();
      if (kind === "pods")
        for (const sx of [-1, 1]) {
          const px = sx * top * 0.82;
          c.moveTo(px - 0.16, h - 0.02);
          c.lineTo(px + 0.16, h - 0.02);
          c.lineTo(px, h + K * 0.55);
          c.closePath();
        }
    }
  };
  path();
  const g = c.createLinearGradient(-top, 0, top, 0);
  const lit = art.light <= 0;
  g.addColorStop(0, lit ? art.bronzeLit : art.bronzeDark);
  g.addColorStop(0.45, art.bronze);
  g.addColorStop(1, lit ? art.bronzeDark : art.bronzeLit);
  c.fillStyle = g;
  c.fill();
  c.save();
  c.clip();
  for (let k = 1; k < 5; k++) {
    const y = h + 0.18 + (k / 5) * (K - 0.3);
    c.fillStyle = rgba(art.ink, 0.25);
    c.fillRect(-W, y, W * 2, 0.03);
    c.fillStyle = rgba(art.bronzeLit, 0.6);
    c.fillRect(-W, y - 0.02, W * 2, 0.015);
  }
  const fade = c.createLinearGradient(0, h, 0, h + K);
  fade.addColorStop(0, rgba(art.air, 0));
  fade.addColorStop(1, rgba(art.air, 0.35));
  c.fillStyle = fade;
  c.fillRect(-W, h, W * 2, K);
  c.restore();
  path();
  c.strokeStyle = rgba(art.ink, 0.6);
  c.lineWidth = 0.028;
  c.stroke();
  contactShadow(c, art, top, h);
  // Crystal finial (its glow is drawn live).
  const cy = h + K;
  c.beginPath();
  c.moveTo(0, cy - 0.28);
  c.lineTo(0.13, cy - 0.08);
  c.lineTo(0, cy + 0.2);
  c.lineTo(-0.13, cy - 0.08);
  c.closePath();
  c.fillStyle = art.goldLight;
  c.fill();
  c.beginPath();
  c.moveTo(0, cy - 0.28);
  c.lineTo(0.13, cy - 0.08);
  c.lineTo(0, cy + 0.2);
  c.closePath();
  c.fillStyle = art.gold;
  c.fill();
  c.beginPath();
  c.moveTo(0, cy - 0.28);
  c.lineTo(0.13, cy - 0.08);
  c.lineTo(0, cy + 0.2);
  c.lineTo(-0.13, cy - 0.08);
  c.closePath();
  c.strokeStyle = rgba(art.ink, 0.6);
  c.lineWidth = 0.018;
  c.stroke();
  // Side cogs that turn at runtime.
  out.gears.push({ x: -top * 0.55, y: h + 0.32, r: Math.min(0.32, W * 0.25), teeth: 9, speed: 1, tone: 1 });
  if (W > 1.4) out.gears.push({ x: top * 0.6, y: h + 0.26, r: 0.22, teeth: 7, speed: -1.4, tone: 0 });
  void r;
  return { x: 0, y: cy - 0.04 };
}

function balustrade(c: Ctx, art: Art, p: Plan) {
  const { W } = p;
  const H = 0.62;
  const col = mix(art.stone, art.stoneLit, 0.3);
  for (let x = -W + 0.2; x < W - 0.12; x += 0.22) {
    c.beginPath();
    c.moveTo(x - 0.035, 0);
    c.quadraticCurveTo(x - 0.09, -H * 0.3, x - 0.03, -H * 0.55);
    c.lineTo(x - 0.04, -H + 0.08);
    c.lineTo(x + 0.04, -H + 0.08);
    c.lineTo(x + 0.03, -H * 0.55);
    c.quadraticCurveTo(x + 0.09, -H * 0.3, x + 0.035, 0);
    c.closePath();
    c.fillStyle = col;
    c.fill();
    c.strokeStyle = art.inkSoft;
    c.lineWidth = 0.014;
    c.stroke();
  }
  for (const s of [-1, 1]) {
    c.beginPath();
    c.rect(s * (W - 0.1) - 0.08, -H - 0.16, 0.16, H + 0.16);
    c.fillStyle = art.stone;
    c.fill();
    c.strokeStyle = art.inkSoft;
    c.lineWidth = 0.02;
    c.stroke();
    c.beginPath();
    c.arc(s * (W - 0.1), -H - 0.24, 0.07, 0, TAU);
    c.fillStyle = art.gold;
    c.fill();
  }
  c.beginPath();
  c.rect(-W + 0.05, -H - 0.04, W * 2 - 0.1, 0.1);
  c.fillStyle = art.stoneLit;
  c.fill();
  c.strokeStyle = art.inkSoft;
  c.lineWidth = 0.018;
  c.stroke();
  c.beginPath();
  c.moveTo(-W + 0.1, -H + 0.04);
  c.lineTo(W - 0.1, -H + 0.04);
  c.strokeStyle = art.gold;
  c.lineWidth = 0.015;
  c.stroke();
  if (art.time === "dusk" || art.time === "noon") shrub(c, art, new Rng(7), W - 0.35, 0, 0.45);
}

// ------------------------------------------------------------------ gears

const gearCache = new Map<string, Sprite>();

/** A cached gear bitmap, keyed by teeth, tone and pixel radius. */
export function gearSprite(art: Art, teeth: number, tone: number, R: number): Sprite {
  const px = Math.max(6, Math.round(R));
  const key = `${art.time}|${teeth}|${tone}|${px}`;
  let s = gearCache.get(key);
  if (s) return s;
  if (gearCache.size > 80) gearCache.clear();
  const size = px * 2.5;
  const { canvas, ctx: c } = makeCanvas(size, size);
  c.translate(size / 2, size / 2);
  const outer = px,
    inner = px * 0.8;
  c.beginPath();
  for (let k = 0; k < teeth; k++) {
    const a0 = (k / teeth) * TAU,
      a1 = ((k + 0.5) / teeth) * TAU,
      step = TAU / teeth;
    c.lineTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
    c.lineTo(Math.cos(a0 + step * 0.12) * outer, Math.sin(a0 + step * 0.12) * outer);
    c.lineTo(Math.cos(a1 - step * 0.12) * outer, Math.sin(a1 - step * 0.12) * outer);
    c.lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner);
  }
  c.closePath();
  const base = tone ? art.bronze : mix(art.bronze, art.gold, 0.5);
  const g = c.createLinearGradient(-px, -px, px, px);
  g.addColorStop(0, mix(base, "#fff2c8", 0.4));
  g.addColorStop(0.5, base);
  g.addColorStop(1, mix(base, art.ink, 0.45));
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = rgba(art.ink, 0.7);
  c.lineWidth = Math.max(1, px * 0.06);
  c.stroke();
  c.beginPath();
  c.arc(0, 0, px * 0.55, 0, TAU);
  c.strokeStyle = rgba(art.ink, 0.35);
  c.lineWidth = Math.max(1, px * 0.05);
  c.stroke();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    c.beginPath();
    c.arc(Math.cos(a) * px * 0.36, Math.sin(a) * px * 0.36, px * 0.12, 0, TAU);
    c.fillStyle = rgba(art.ink, 0.45);
    c.fill();
  }
  c.beginPath();
  c.arc(0, 0, px * 0.14, 0, TAU);
  c.fillStyle = art.goldLight;
  c.fill();
  c.strokeStyle = rgba(art.ink, 0.6);
  c.lineWidth = Math.max(1, px * 0.04);
  c.stroke();
  s = { canvas, ox: size / 2, oy: size / 2 };
  gearCache.set(key, s);
  return s;
}
