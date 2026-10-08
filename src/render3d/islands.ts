import * as THREE from "three";
import type { IslandStyle, TimeOfDay } from "../sim/types";
import {
  Bucket,
  Buckets,
  blob,
  gridMesh,
  box,
  capFan,
  extrude,
  gear,
  lathe,
  orientOutward,
  roundedRing,
  stitch,
  torus,
  tube,
  xf,
} from "./geo";
import type { Pal } from "./mood";
import { Rng, TAU, clamp, fbm2, lerp, mixCol, noise2, smooth } from "./util";

/** Instance lists filled while building, turned into instanced meshes afterwards. */
export type Scatter = {
  grass: { m: THREE.Matrix4; c: THREE.Color }[];
  flowers: { m: THREE.Matrix4; c: THREE.Color }[];
};

/** Things standing on island tops that darken the ground around them. */
export type Occluders = { rects: { x0: number; x1: number; z0: number; z1: number }[]; dots: { x: number; z: number; r: number }[] };

/** Contact darkening on a top at (x, z): 1 is open ground. */
export function groundAO(o: Occluders | undefined, x: number, z: number) {
  if (!o) return 1;
  let k = 1;
  for (const r of o.rects) {
    const dx = Math.max(r.x0 - x, 0, x - r.x1),
      dz = Math.max(r.z0 - z, 0, z - r.z1);
    k *= 1 - 0.4 * Math.exp(-Math.hypot(dx, dz) / 0.45);
  }
  for (const d of o.dots) k *= 1 - 0.32 * Math.exp(-Math.max(0, Math.hypot(d.x - x, d.z - z) - d.r) / 0.3);
  return k;
}

export type Ctx = {
  pal: Pal;
  /** Contact shadows for the island being built. */
  occluders?: Occluders;
  time: TimeOfDay;
  seed: number;
  /** 1 on high quality, lower on low. */
  detail: number;
  scatter: Scatter | null;
};

export type Shape = {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  style: IslandStyle;
};

type Ring = THREE.Vector3[];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** World-mapped paving UVs (scale = world units per texture tile). */
export const pavingUV =
  (scale: number, rotate = false) =>
  (p: THREE.Vector3, n: THREE.Vector3): [number, number] => {
    if (Math.abs(n.y) > 0.6) return rotate ? [p.z / scale, p.x / scale] : [p.x / scale, p.z / scale];
    return Math.abs(n.x) > Math.abs(n.z) ? [p.z / scale, p.y / scale] : [p.x / scale, p.y / scale];
  };

function ringAt(s: Shape, base: [number, number][], y: number, inset: number, jitter?: (i: number) => number): Ring {
  const sx = (s.w - 2 * inset) / s.w,
    sz = (s.d - 2 * inset) / s.d;
  return base.map(([bx, bz], i) => {
    const j = jitter ? jitter(i) : 0;
    const kx = sx - (j * 2) / s.w,
      kz = sz - (j * 2) / s.d;
    return V(s.x + bx * kx, y, s.z + bz * kz);
  });
}

/** A rectangle grid in XZ with rounded corners, facing up, for tops with vertex colour detail. */
export function topGrid(w: number, d: number, rc: number, cell: number) {
  const nx = Math.max(1, Math.round(w / cell)),
    nz = Math.max(1, Math.round(d / cell));
  const g = new THREE.PlaneGeometry(w, d, nx, nz).rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const hw = w / 2,
    hd = d / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    if (Math.abs(x) > hw - rc && Math.abs(z) > hd - rc) {
      const cx = Math.sign(x) * (hw - rc),
        cz = Math.sign(z) * (hd - rc);
      const dx = x - cx,
        dz = z - cz;
      const l = Math.hypot(dx, dz);
      if (l > rc) p.setXYZ(i, cx + (dx / l) * rc, 0, cz + (dz / l) * rc);
    }
  }
  return g;
}

/** Vertical walls between two heights following the footprint. */
function walls(
  bk: Bucket,
  s: Shape,
  base: [number, number][],
  yTop: number,
  yBot: number,
  rows: number,
  inset: (row: number, i: number) => number,
  opts: { color: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void; flat?: boolean; uv?: (p: THREE.Vector3, n: THREE.Vector3) => [number, number] },
) {
  const rings: Ring[] = [];
  for (let r = 0; r <= rows; r++) {
    const y = lerp(yTop, yBot, r / rows);
    rings.push(ringAt(s, base, y, 0, (i) => inset(r, i)));
  }
  const g = gridMesh(rings, V(s.x, 0, s.z));
  bk.add(g, { color: opts.color, flat: opts.flat ?? false, uv: opts.uv });
}

/**
 * The floating rock beneath an island: a dense, softly displaced mass with
 * rounded strata, tapering to a point. It sits inside the footprint so it
 * never reads as a ledge. Returns points on its surface where roots can hang.
 */
function underside(
  bk: Bucket,
  s: Shape,
  _base: [number, number][],
  yTop: number,
  depth: number,
  r: Rng,
  ctx: Ctx,
  inset = 0.05,
  res = 0.26,
) {
  const pal = ctx.pal;
  const fine = res < 0.5;
  const seed = r.int(0, 100000);
  const rc = Math.min(s.w, s.d) * 0.22;
  const ring = roundedRing(s.w - 2 * inset, s.d - 2 * inset, rc, res);
  const n = ring.length;
  const K = clamp(Math.round(depth / (res * 1.1)), 6, fine ? 36 : 18);
  const driftA = r.range(0, TAU),
    drift = Math.min(s.w, s.d) * r.range(0.04, 0.14);
  const lumpAmt = r.range(0.22, 0.32);
  const bandH = r.range(0.6, 0.85);
  const rings: Ring[] = [];
  const anchors: { p: THREE.Vector3; t: number }[] = [];
  const centreAt = (t: number) =>
    V(s.x + Math.cos(driftA) * drift * Math.pow(t, 1.5), 0, s.z + Math.sin(driftA) * drift * Math.pow(t, 1.5));
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    // Ease the spacing so the shoulder near the top gets more rings.
    const y = yTop - depth * Math.pow(t, 1.25) * 0.94;
    const prof = k === 0 ? 1 : Math.pow(1 - Math.pow(t, 1.35) * 0.96, 0.85);
    const c = centreAt(t);
    const pts = ring.map(([bx, bz]) => {
      const wx = s.x + bx,
        wz = s.z + bz;
      const lump = fbm2(wx * 0.3 + y * 0.16, wz * 0.3 - y * 0.12, seed, 3);
      const flute = fbm2(wx * 1.3 + wz * 0.4, wz * 1.3 + y * 0.08, seed + 7, 2);
      const warp = fbm2(wx * 0.2, wz * 0.2, seed + 3, 2) * 1.6;
      const band = 0.5 + 0.5 * Math.sin(((yTop - y) / bandH + warp) * TAU);
      const ledge = smooth(0.62, 0.97, band) * Math.min(1, t * 6);
      const m = prof * (1 - lumpAmt * lump * Math.pow(t, 0.45) - 0.09 * flute * Math.min(1, t * 3) - 0.07 * ledge);
      return V(c.x + bx * m, y, c.z + bz * m);
    });
    rings.push(pts);
    if (k >= 2 && t < 0.5 && k % 2 === 0) for (let a = 0; a < 2; a++) anchors.push({ p: pts[r.int(0, n - 1)].clone(), t });
  }
  const tipC = centreAt(1);
  const tip = V(tipC.x + r.range(-0.25, 0.25), yTop - depth, tipC.z + r.range(-0.25, 0.25));
  const g = gridMesh(rings, V(s.x, 0, s.z), tip);
  // Hanging lobes break the single-cone silhouette.
  const lobes: THREE.BufferGeometry[] = [];
  const nl = res > 1 ? 0 : Math.min(2, Math.floor((s.w + s.d) / 6));
  for (let l = 0; l < nl; l++) {
    const lx = s.x + r.range(-0.28, 0.28) * s.w,
      lz = s.z + r.range(-0.25, 0.15) * s.d;
    const lr = Math.min(s.w, s.d) * r.range(0.24, 0.32);
    const ly = yTop - depth * r.range(0.1, 0.2);
    const ld = depth * r.range(0.4, 0.55);
    const lring = roundedRing(lr * 2, lr * 2, lr * 0.99, fine ? 0.2 : 0.35);
    const LK = Math.max(5, Math.round(ld / (fine ? 0.3 : 0.5)));
    const lrings: Ring[] = [];
    for (let k = 0; k <= LK; k++) {
      const t = k / LK;
      const y = ly - ld * t;
      const prof = Math.pow(1 - Math.pow(t, 1.15) * 0.95, 0.9) * (0.75 + 0.25 * Math.sin(Math.min(1, t * 3 + 0.3) * Math.PI * 0.5));
      lrings.push(
        lring.map(([bx, bz]) => {
          const lump = fbm2((lx + bx) * 0.5 + y * 0.2, (lz + bz) * 0.5, seed + 11 + l, 2);
          const m = prof * (1 - 0.25 * lump);
          return V(lx + bx * m, y, lz + bz * m);
        }),
      );
    }
    lobes.push(gridMesh(lrings, V(lx, 0, lz), V(lx + r.range(-0.1, 0.1), ly - ld - 0.2, lz)));
  }
  const tones = [mixCol(pal.rock, pal.stone, 0.45), mixCol(pal.rock, pal.earth, 0.35), mixCol(pal.rock, pal.stone, 0.2), mixCol(pal.rock, pal.stoneShade, 0.5)];
  const deep = pal.rockDeep;
  const tmp = new THREE.Color();
  const paint = (p: THREE.Vector3, nn: THREE.Vector3, out: THREE.Color) => {
    const tt = clamp((yTop - p.y) / depth, 0, 1);
    const v = (yTop - p.y) / (bandH * 0.62) + fbm2(p.x * 0.18, p.z * 0.18, seed + 3, 2) * 1.6;
    const i0 = ((Math.floor(v) % tones.length) + tones.length) % tones.length;
    const f = smooth(0.82, 1, v - Math.floor(v));
    out.copy(tones[i0]).lerp(tmp.copy(tones[(i0 + 1) % tones.length]), f);
    out.lerp(deep, Math.pow(tt, 0.8) * 0.72);
    // Ledge tops catch light, undercuts sit in shadow, the lip shades the top band.
    out.multiplyScalar(nn.y > 0.25 ? 1 + (nn.y - 0.25) * 0.5 : 0.78 + 0.22 * clamp(nn.y + 1, 0, 1));
    out.multiplyScalar(0.6 + 0.4 * smooth(0, 0.6, yTop - p.y));
    out.multiplyScalar(0.97 + 0.06 * noise2(p.x * 0.9, p.y * 0.9, seed));
  };
  bk.add(g, { color: paint });
  for (const lg of lobes) bk.add(lg, { color: paint });
  return { anchors, bottom: yTop - depth, tip };
}

/** Roots and vines hanging from the underside; decoration only. */
function hangers(b: Buckets, anchors: { p: THREE.Vector3; t: number }[], s: Shape, r: Rng, ctx: Ctx, count: number) {
  const pal = ctx.pal;
  const green = ctx.time === "morning" || ctx.time === "dawn" || ctx.time === "noon";
  for (let i = 0; i < count && anchors.length; i++) {
    const a = anchors[r.int(0, anchors.length - 1)];
    const len = r.range(0.8, 2.6) * (1 + a.t);
    const pts: THREE.Vector3[] = [];
    const dir = V(a.p.x - s.x, 0, a.p.z - s.z).normalize().multiplyScalar(0.15);
    let p = a.p.clone().add(dir.clone().multiplyScalar(0.3));
    const segs = 5;
    for (let k = 0; k <= segs; k++) {
      pts.push(p.clone());
      p = p.clone().add(V(r.range(-0.12, 0.12) + dir.x * 0.4, -len / segs, r.range(-0.12, 0.12) + dir.z * 0.4));
    }
    const vine = green && r.chance(0.65);
    const rad = vine ? r.range(0.022, 0.035) : r.range(0.025, 0.05);
    const g = tube(pts, (t) => rad * (1 - t * 0.8), 4);
    if (vine) {
      b.foliage.add(g, {
        color: mixCol(pal.foliage, pal.ink, 0.25),
        sway: (q) => clamp((a.p.y - q.y) / len, 0, 1) * 0.6,
      });
      const leaves = Math.round(len * 3);
      for (let k = 0; k < leaves; k++) {
        const t = r.range(0.1, 1);
        const q = pts[Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)))];
        const lg = blob(r.range(0.06, 0.11), r, 0.3, 0, 0.55);
        const lc = mixCol(pal.foliage, pal.leafLight, r.range(0, 0.6));
        b.foliage.add(lg, {
          m: xf(q.x + r.range(-0.07, 0.07), q.y, q.z + r.range(-0.07, 0.07), r.range(0, 3), r.range(0, 3), 0),
          color: lc,
          flat: true,
          sway: clamp((a.p.y - q.y) / len, 0, 1) * 0.7,
        });
      }
    } else {
      b.matte.add(g, { color: mixCol(pal.bark, pal.rockDeep, 0.4) });
    }
  }
}

/** Small floating rocks that hang near the underside for scale. */
function debris(b: Buckets, s: Shape, bottom: number, r: Rng, ctx: Ctx, n: number) {
  for (let i = 0; i < n; i++) {
    const g = blob(r.range(0.18, 0.5) * Math.min(1.4, s.w * 0.15 + 0.4), r, 0.16, 2);
    const side = r.chance(0.5) ? -1 : 1;
    const x = s.x + side * r.range(0.3, 0.8) * (s.w / 2 + 0.6);
    const y = lerp(s.y - s.h, bottom, r.range(0.5, 1.1));
    const z = s.z + r.range(-0.5, 0.5) * s.d;
    b.rock.add(g, {
      m: xf(x, y, z, r.range(0, 3), r.range(0, 3), 0, 1, r.range(0.55, 0.8)),
      color: (_p, nn, out) => out.copy(mixCol(ctx.pal.rock, ctx.pal.stone, 0.2)).lerp(ctx.pal.rockDeep, 0.35 - nn.y * 0.3),
    });
  }
}

/** Grass cap: a top face with colour variation and a hanging grass lip. */
function grassCap(b: Buckets, s: Shape, base: [number, number][], r: Rng, ctx: Ctx, rc: number) {
  const pal = ctx.pal;
  const seed = r.int(0, 99999);
  const g = topGrid(s.w, s.d, rc, 0.5);
  const dry = mixCol(pal.grassDry, pal.stone, 0.1),
    lush = mixCol(pal.grass, pal.foliage, 0.35),
    light = mixCol(pal.grass, "#f4f0b0", 0.18),
    turf = mixCol(pal.grass, pal.stone, 0.08);
  b.matte.add(g, {
    m: xf(s.x, s.y, s.z),
    color: (p, _n, out) => {
      const f = fbm2(p.x * 0.33, p.z * 0.33, seed, 3);
      const f2 = noise2(p.x * 1.7, p.z * 1.7, seed + 1);
      out.copy(turf);
      if (f > 0.56) out.lerp(dry, clamp((f - 0.56) * 4, 0, 0.7));
      if (f < 0.42) out.lerp(lush, clamp((0.42 - f) * 4, 0, 0.6));
      const edge = Math.min(s.w / 2 - Math.abs(p.x - s.x), s.d / 2 - Math.abs(p.z - s.z));
      if (edge < 0.35) out.lerp(light, (0.35 - edge) * 1.2);
      out.multiplyScalar((0.94 + f2 * 0.12) * groundAO(ctx.occluders, p.x, p.z));
    },
  });
  // Lip: a short skirt with irregular hanging tongues.
  const top = ringAt(s, base, s.y, -0.03);
  const bot = ringAt(s, base, 0, -0.04).map((v, i) => {
    const drip = 0.1 + 0.12 * noise2(i * 0.8, 0, seed) + (noise2(i * 0.37, 3, seed) > 0.72 ? 0.22 : 0);
    v.y = s.y - drip;
    return v;
  });
  const lip = orientOutward(stitch([top, bot]), V(s.x, 0, s.z));
  b.matte.add(lip, {
    flat: true,
    color: (p, _n, out) => out.copy(pal.grass).lerp(pal.foliage, clamp((s.y - p.y) * 3.2, 0, 0.75)),
  });
}

/** Stone top: paving with a carved cornice. */
function stoneCap(bk: Bucket, s: Shape, base: [number, number][], ctx: Ctx, rc: number, tile: number) {
  const pal = ctx.pal;
  const top = topGrid(s.w, s.d, rc, 0.6);
  const stone = pal.stone.clone().multiplyScalar(1.02);
  bk.add(top, { m: xf(s.x, s.y, s.z), color: (p, _n, out) => out.copy(stone).multiplyScalar(groundAO(ctx.occluders, p.x, p.z)), uv: pavingUV(tile) });
  const r0 = ringAt(s, base, s.y, 0);
  const r1 = ringAt(s, base, s.y - 0.05, -0.04);
  const r2 = ringAt(s, base, s.y - 0.2, -0.04);
  const r3 = ringAt(s, base, s.y - 0.26, 0.02);
  const g = orientOutward(stitch([r0, r1, r2, r3]), V(s.x, 0, s.z));
  bk.add(g, { color: mixCol(pal.stone, "#ffffff", 0.08), uv: pavingUV(tile), flat: true });
}

/** Gold inlay lines engraved in a stone top. */
function goldInlay(b: Buckets, s: Shape, ctx: Ctx, ornate: boolean) {
  const gold = ctx.pal.gold;
  const y = s.y + 0.004;
  const ins = 0.34;
  if (s.w > 1.6 && s.d > 1.2) {
    const w = s.w - ins * 2,
      d = s.d - ins * 2;
    const t = 0.045;
    b.metal.add(box(w, 0.01, t), { m: xf(s.x, y, s.z - d / 2), color: gold });
    b.metal.add(box(w, 0.01, t), { m: xf(s.x, y, s.z + d / 2), color: gold });
    b.metal.add(box(t, 0.01, d), { m: xf(s.x - w / 2, y, s.z), color: gold });
    b.metal.add(box(t, 0.01, d), { m: xf(s.x + w / 2, y, s.z), color: gold });
  }
  if (ornate && s.w >= 3.8 && s.d >= 3.2) {
    const R = Math.min(s.w, s.d) * 0.22;
    b.metal.add(torus(R, 0.03, 4, 48), { m: xf(s.x, y, s.z, Math.PI / 2, 0, 0, 1, 1, 0.25), color: gold });
    b.metal.add(torus(R * 0.5, 0.025, 4, 32), { m: xf(s.x, y, s.z, Math.PI / 2, 0, 0, 1, 1, 0.25), color: gold });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      const len = k % 3 === 0 ? R * 0.42 : R * 0.26;
      const rr = R * 0.6 + len / 2;
      b.metal.add(box(len, 0.01, 0.03), {
        m: xf(s.x + Math.cos(a) * rr, y, s.z + Math.sin(a) * rr, 0, -a, 0),
        color: gold,
      });
    }
  }
}

export type BuildOpts = {
  underside?: boolean;
  /** Distant scenery: less detail, no scatter. */
  far?: boolean;
  /** Override for the underside depth. */
  depth?: number;
};

/** Build one island into the buckets. Coordinates are absolute (use a local shape for movers). */
export function buildIsland(b: Buckets, s: Shape, r: Rng, ctx: Ctx, o: BuildOpts = {}) {
  const pal = ctx.pal;
  const far = !!o.far;
  const spacing = far ? 0.9 : s.w * s.d > 30 ? 0.5 : 0.4;
  const style = s.style;
  const rc = style === "plinth" ? Math.min(s.w, s.d) * 0.16 : style === "garden" ? Math.min(0.45, Math.min(s.w, s.d) * 0.18) : 0.1;
  const base = roundedRing(s.w, s.d, rc, spacing);
  const seed = r.int(0, 99999);
  const depth =
    o.depth ?? clamp(0.75 * Math.min(s.w, s.d) + 0.28 * Math.max(s.w, s.d), 1.4, 9.5) * r.range(0.85, 1.15);
  let bottom = s.y - s.h;
  let anchors: { p: THREE.Vector3; t: number }[] = [];
  const topsoil = mixCol(pal.earth, pal.ink, 0.35);
  const ochre = mixCol(pal.earth, "#c9a06a", 0.35);
  const sand = mixCol(pal.rock, pal.stone, 0.3);
  const earth = (p: THREE.Vector3, _n: THREE.Vector3, out: THREE.Color) => {
    const depth = s.y - p.y;
    const wobble = fbm2(p.x * 0.45 + p.z * 0.3, p.z * 0.45, seed, 2) * 1.4;
    const band = Math.floor(depth / 0.26 + wobble);
    const pick = ((band % 3) + 3) % 3;
    out.copy(pick === 0 ? pal.earth : pick === 1 ? ochre : sand);
    // Dark topsoil under the grass, fading into the strata.
    out.lerp(topsoil, clamp(1 - (depth - 0.06) / 0.28, 0, 1) * 0.8);
    // Faint vertical water stains.
    const stain = noise2(p.x * 1.1 + p.z * 0.9, 0.5, seed + 4);
    out.multiplyScalar(0.92 + 0.08 * stain);
  };
  const masonry = (bk: Bucket, tint: THREE.Color, tile: number, yTop: number) =>
    walls(bk, s, base, yTop, s.y - s.h, far ? 1 : Math.max(3, Math.round((yTop - s.y + s.h) / 0.22)), () => 0.02, {
      color: (p, _n, out) => {
        out.copy(tint);
        const below = yTop - p.y;
        // Shadow under the cornice lip, then a gentle darkening toward the rock.
        out.multiplyScalar((0.72 + 0.28 * smooth(0, 0.32, below)) * (1 - 0.14 * clamp(below / Math.max(0.5, s.h), 0, 1)));
      },
      flat: false,
      uv: pavingUV(tile),
    });

  if (ctx.time === "night" && !far) moonEdge(b, s, rc);
  switch (style) {
    case "garden": {
      grassCap(b, s, base, r, ctx, rc);
      {
        // A soft earthen band: coherent lumps, finer rows, smooth shading.
        const fineBase = far ? base : roundedRing(s.w, s.d, rc, 0.22);
        const rows = far ? 2 : Math.max(4, Math.round(s.h / 0.16));
        walls(b.rock, s, fineBase, s.y - 0.06, s.y - s.h, rows, (row, i) => {
          if (row === 0) return 0;
          const [bx, bz] = fineBase[i];
          const y = s.y - 0.06 - ((s.h - 0.06) * row) / rows;
          return 0.012 + 0.07 * fbm2((s.x + bx) * 0.7 + y * 0.4, (s.z + bz) * 0.7, seed, 3) + 0.02 * smooth(0.6, 1, Math.sin(y * 9 + bx) * 0.5 + 0.5);
        }, { color: earth });
      }
      const stones = !far && s.w >= 4 && s.d >= 3 ? steppingStones(b, s, r, ctx) : [];
      if (ctx.scatter && !far) scatterGrass(ctx.scatter, s, r, ctx, 1, stones);
      break;
    }
    case "stone":
    case "ruin": {
      const bk = style === "ruin" ? b.ruin : b.paving;
      stoneCap(bk, s, base, ctx, rc, 2.6);
      masonry(bk, mixCol(pal.stone, pal.stoneShade, 0.25), 2.2, s.y - 0.26);
      if (style === "stone" && !far) goldInlay(b, s, ctx, ctx.time === "noon" || ctx.time === "dawn" || ctx.time === "night");
      if (style === "ruin" && !far) ruinDetail(b, s, r, ctx);
      break;
    }
    case "bridge": {
      bridgeBody(b, s, base, r, ctx);
      bottom = s.y - s.h - 1.6;
      break;
    }
    case "plinth": {
      plinthBody(b, s, base, ctx);
      return { bottom: s.y - s.h - 1.6, depth: 1.6 };
    }
  }
  if (o.underside !== false && style !== "bridge") {
    const res = far ? 1.3 : ctx.detail >= 0.9 ? 0.26 : ctx.detail >= 0.5 ? 0.42 : 0.65;
    const u = underside(b.rock, s, base, s.y - s.h + 0.02, depth, r, ctx, 0.05, res);
    anchors = u.anchors;
    bottom = u.bottom;
    if (!far) {
      hangers(b, anchors, s, r, ctx, Math.round((s.w + s.d) * 0.9 * ctx.detail));
      debris(b, s, bottom, r, ctx, r.int(0, 2));
    }
  }
  return { bottom, depth };
}

function ruinDetail(b: Buckets, s: Shape, r: Rng, ctx: Ctx) {
  const pal = ctx.pal;
  const moss = mixCol(pal.grass, pal.foliage, 0.5);
  // Moss pads creeping over the top edge.
  const seed = r.int(0, 9999);
  const n = Math.round((s.w + s.d) * 1.2);
  for (let i = 0; i < n; i++) {
    const onX = r.chance(s.w / (s.w + s.d));
    const x = onX ? s.x + r.range(-0.5, 0.5) * (s.w - 0.3) : s.x + (r.chance(0.5) ? -1 : 1) * (s.w / 2 - 0.1);
    const z = onX ? s.z + (r.chance(0.5) ? -1 : 1) * (s.d / 2 - 0.1) : s.z + r.range(-0.5, 0.5) * (s.d - 0.3);
    const g = blob(r.range(0.12, 0.3), r, 0.3, 1, 0.25);
    b.matte.add(g, { m: xf(x, s.y + 0.01, z), color: mixCol(moss, pal.grassDry, noise2(i, 0, seed) * 0.5), flat: true });
  }
  if (ctx.scatter) scatterGrass(ctx.scatter, s, r, ctx, 0.25);
}

function bridgeBody(b: Buckets, s: Shape, base: [number, number][], r: Rng, ctx: Ctx) {
  const pal = ctx.pal;
  const deck = topGrid(s.w, s.d, 0.06, 4);
  b.paving.add(deck, { m: xf(s.x, s.y, s.z), color: mixCol(pal.stone, pal.stoneShade, 0.08), uv: pavingUV(1.5, true) });
  walls(b.paving, s, base, s.y, s.y - s.h, 1, () => 0.0, {
    color: (_p, _n, out) => out.copy(mixCol(pal.stone, pal.stoneShade, 0.3)),
    flat: false,
    uv: pavingUV(1.8),
  });
  // Bronze edge trim along both long edges.
  for (const side of [-1, 1]) {
    b.metal.add(box(s.w - 0.1, 0.05, 0.05), { m: xf(s.x, s.y - 0.025, s.z + side * (s.d / 2 + 0.01)), color: pal.bronze });
    // Baluster relief carved into the side faces, below the walking surface.
    const count = Math.max(2, Math.floor((s.w - 0.4) / 0.36));
    for (let i = 0; i < count; i++) {
      const x = s.x - (s.w - 0.4) / 2 + ((i + 0.5) * (s.w - 0.4)) / count;
      const bh = s.h - 0.16;
      const bal = lathe(
        [
          [0.0, 0],
          [0.06, 0],
          [0.06, 0.04],
          [0.035, 0.08],
          [0.06, bh * 0.45],
          [0.03, bh * 0.8],
          [0.055, bh * 0.92],
          [0.055, bh],
          [0.0, bh],
        ],
        6,
      );
      b.matte.add(bal, { m: xf(x, s.y - 0.08 - bh, s.z + side * (s.d / 2 + 0.005)), color: mixCol(pal.stone, "#ffffff", 0.05) });
    }
  }
  // An arch beneath, with piers that taper into rock.
  if (s.w >= 2.2) {
    const pier = Math.min(0.7, s.w * 0.16);
    const drop = Math.min(1.8, 0.6 + s.w * 0.2);
    const sh = new THREE.Shape();
    const hw = s.w / 2 - 0.05;
    sh.moveTo(-hw, 0);
    sh.lineTo(hw, 0);
    sh.lineTo(hw, -drop);
    sh.lineTo(hw - pier, -drop);
    const span = hw - pier;
    const rise = drop * 0.75;
    for (let k = 1; k < 16; k++) {
      const a = (k / 16) * Math.PI;
      sh.lineTo(Math.cos(a) * span, -drop + Math.sin(a) * rise);
    }
    sh.lineTo(-hw + pier, -drop);
    sh.lineTo(-hw, -drop);
    sh.lineTo(-hw, 0);
    const g = extrude(sh, s.d * 0.72, 0.02);
    b.paving.add(g, {
      m: xf(s.x, s.y - s.h, s.z),
      color: (p, _n, out) => out.copy(mixCol(pal.stone, pal.stoneShade, 0.35)).multiplyScalar(0.85 + 0.15 * clamp((p.y - (s.y - s.h - drop)) / drop, 0, 1)),
      uv: pavingUV(1.8),
    });
    // Keystone.
    b.metal.add(box(0.22, 0.3, s.d * 0.74), { m: xf(s.x, s.y - s.h - drop + rise - 0.08, s.z), color: pal.gold });
    for (const side of [-1, 1]) {
      const px = s.x + side * (hw - pier / 2);
      const g2 = blob(pier * 0.6, r, 0.25, 1, 1.6);
      b.matte.add(g2, {
        m: xf(px, s.y - s.h - drop - pier * 0.5, s.z),
        flat: true,
        color: (p, _n, out) => out.copy(pal.rock).lerp(pal.rockDeep, clamp((s.y - s.h - drop - p.y) * 0.8, 0, 0.8)),
      });
    }
  }
}

function plinthBody(b: Buckets, s: Shape, base: [number, number][], ctx: Ctx) {
  const pal = ctx.pal;
  const top = topGrid(s.w, s.d, Math.min(s.w, s.d) * 0.16, 2);
  b.paving.add(top, { m: xf(s.x, s.y, s.z), color: mixCol(pal.stone, "#ffffff", 0.1), uv: pavingUV(3.2) });
  // Engraved concentric rings.
  const R = Math.min(s.w, s.d) * 0.36;
  for (const k of [1, 0.62]) b.metal.add(torus(R * k, 0.025, 4, 40), { m: xf(s.x, s.y + 0.003, s.z, Math.PI / 2, 0, 0, 1, 1, 0.3), color: pal.gold });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.metal.add(box(R * 0.3, 0.008, 0.035), { m: xf(s.x + Math.cos(a) * R * 0.81, s.y + 0.003, s.z + Math.sin(a) * R * 0.81, 0, -a, 0), color: pal.gold });
  }
  // Bronze rim band and fluted body.
  const r0 = ringAt(s, base, s.y, 0.0);
  const r1 = ringAt(s, base, s.y - 0.03, -0.035);
  const r2 = ringAt(s, base, s.y - 0.17, -0.035);
  const r3 = ringAt(s, base, s.y - 0.2, 0.01);
  b.metal.add(orientOutward(stitch([r0, r1, r2, r3]), V(s.x, 0, s.z)), { color: pal.bronze, flat: true });
  const body: Ring[] = [];
  for (const [y, k] of [
    [s.y - 0.2, 0.01],
    [s.y - s.h + 0.12, 0.05],
  ] as [number, number][])
    body.push(ringAt(s, base, y, k, (i) => (i % 3 === 0 ? 0.04 : 0)));
  b.matte.add(orientOutward(stitch(body), V(s.x, 0, s.z)), {
    flat: true,
    color: (p, _n, out) => out.copy(mixCol(pal.stoneShade, pal.ink, 0.25)).multiplyScalar(0.9 + 0.1 * clamp((p.y - s.y + s.h) / s.h, 0, 1)),
  });
  const r4 = ringAt(s, base, s.y - s.h + 0.12, 0.0);
  const r5 = ringAt(s, base, s.y - s.h, 0.0);
  const r6 = ringAt(s, base, s.y - s.h - 0.04, 0.12);
  b.metal.add(orientOutward(stitch([r4, r5, r6]), V(s.x, 0, s.z)), { color: pal.bronze, flat: true });
  // Stepped bronze underside with a glowing levitation crystal.
  const m = Math.min(s.w, s.d);
  const tiers: [number, number][] = [
    [m * 0.42, 0],
    [m * 0.42, -0.28],
    [m * 0.3, -0.32],
    [m * 0.3, -0.62],
    [m * 0.17, -0.66],
    [m * 0.17, -0.9],
    [0.02, -1.05],
  ];
  b.metal.add(lathe(tiers.map(([rr, y]) => [rr, -y] as [number, number]).reverse().map(([rr, y]) => [rr, -y]), 16), {
    m: xf(s.x, s.y - s.h - 0.04, s.z),
    color: mixCol(pal.bronze, pal.ink, 0.3),
    flat: true,
  });
  const crystal = new THREE.OctahedronGeometry(0.22, 0);
  b.glow.add(crystal, { m: xf(s.x, s.y - s.h - 1.3, s.z, 0, 0.4, 0, 1, 1.8, 1), color: pal.gold.clone().multiplyScalar(3.2), flat: true });
  // A gear on the front face that turns while the plinth moves.
  const gr = Math.min(0.38, m * 0.12);
  b.metal.add(gear(gr, 10, 0.06, 0.3), {
    m: xf(s.x + s.w * 0.22, s.y - s.h * 0.55, s.z + s.d / 2 + 0.03),
    color: pal.gold,
    spin: { pivot: V(s.x + s.w * 0.22, s.y - s.h * 0.55, s.z + s.d / 2 + 0.03), axis: V(0, 0, 1), speed: 0.9 },
  });
  b.metal.add(gear(gr * 0.65, 8, 0.06, 0.3), {
    m: xf(s.x + s.w * 0.22 - gr * 1.55, s.y - s.h * 0.55 + gr * 0.3, s.z + s.d / 2 + 0.03),
    color: pal.bronze,
    spin: { pivot: V(s.x + s.w * 0.22 - gr * 1.55, s.y - s.h * 0.55 + gr * 0.3, s.z + s.d / 2 + 0.03), axis: V(0, 0, 1), speed: -1.4 },
  });
}

/** Grass tufts and wildflowers scattered over a top. */
export function scatterGrass(sc: Scatter, s: Shape, r: Rng, ctx: Ctx, density: number, avoid: { x: number; z: number; r: number }[] = []) {
  const pal = ctx.pal;
  const area = s.w * s.d;
  const n = Math.round(area * 7 * density * ctx.detail);
  const flowerCols = flowerPalette(ctx);
  for (let i = 0; i < n; i++) {
    const edgeBias = r.next() < 0.45;
    let x = s.x + r.range(-0.5, 0.5) * (s.w - 0.2);
    let z = s.z + r.range(-0.5, 0.5) * (s.d - 0.2);
    if (edgeBias) {
      if (r.chance(0.5)) z = s.z + (r.chance(0.65) ? -1 : 1) * (s.d / 2 - r.range(0.06, 0.5));
      else x = s.x + (r.chance(0.5) ? -1 : 1) * (s.w / 2 - r.range(0.06, 0.5));
    }
    if (avoid.some((a) => (a.x - x) ** 2 + (a.z - z) ** 2 < a.r * a.r)) continue;
    // Thinner through the middle of the top, where the keeper walks and lands.
    const lane = 1 - smooth(0.18, 0.36, Math.abs(z - s.z) / s.d);
    if (lane > 0 && r.next() < lane * 0.55) continue;
    const sc0 = r.range(0.75, 1.25) * (edgeBias ? 1.15 : 0.9);
    const m = xf(x, s.y, z, 0, r.range(0, TAU), 0, sc0, sc0 * r.range(0.7, 1.2), sc0);
    const f = fbm2(x * 0.33, z * 0.33, 0, 3);
    const c = mixCol(mixCol(pal.grass, f > 0.55 ? pal.grassDry : pal.leafLight, r.range(0.1, 0.4)), pal.stone, 0.12);
    sc.grass.push({ m, c });
    if (r.chance(0.32 * density + 0.05)) {
      const fs = r.range(0.75, 1.2);
      sc.flowers.push({
        m: xf(x + r.range(-0.1, 0.1), s.y, z + r.range(-0.1, 0.1), 0, r.range(0, TAU), 0, fs),
        c: r.pick(flowerCols).clone(),
      });
    }
  }
}

export function flowerPalette(ctx: Ctx) {
  switch (ctx.time) {
    case "morning":
      return ["#fff6e6", "#ffd75e", "#f39ab2", "#b9a6ff", "#ffffff"].map((h) => new THREE.Color(h));
    case "noon":
      return ["#ffffff", "#ffcf4a", "#ff8a5c", "#e8d8ff"].map((h) => new THREE.Color(h));
    case "afternoon":
      return ["#ffb347", "#ffe08a", "#e86f4f", "#fff4dc"].map((h) => new THREE.Color(h));
    case "dusk":
      return ["#d9a6ff", "#ff9fc0", "#b48cff", "#ffe2f0"].map((h) => new THREE.Color(h));
    case "night":
      return ["#bfe8ff", "#e8f0ff", "#9fd8ff"].map((h) => new THREE.Color(h).multiplyScalar(1.6));
    case "dawn":
      return ["#ffd36e", "#ffb08a", "#fff1c8", "#f7a0b8"].map((h) => new THREE.Color(h));
  }
}

/** A natural sea-stack spire that fills a wall's box and roots into the cloud sea. */
export function spire(b: Buckets, w: { x: number; y: number; z: number; w: number; d: number; h: number }, r: Rng, ctx: Ctx) {
  const pal = ctx.pal;
  const fine = ctx.detail >= 0.9;
  const base = roundedRing(w.w, w.d, Math.min(w.w, w.d) * 0.4, fine ? 0.18 : 0.3);
  const seed = r.int(0, 9999);
  const below = 9;
  const total = w.h + below;
  const K = Math.round(total / (fine ? 0.22 : 0.4));
  const rings: Ring[] = [];
  const bandH = 0.7;
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    const y = w.y + w.h - total * t;
    const under = y < w.y ? (w.y - y) / below : 0;
    // Slightly narrower at the crown, full at the base, then tapering into the clouds.
    const sc = (y >= w.y ? lerp(0.82, 1.0, Math.pow((w.y + w.h - y) / w.h, 0.6)) : Math.pow(1 - under * 0.93, 0.9)) * (0.96 + 0.04 * noise2(k * 0.3, 2, seed));
    rings.push(
      base.map(([bx, bz]) => {
        const wx = w.x + bx,
          wz = w.z + bz;
        const lump = fbm2(wx * 0.6 + y * 0.18, wz * 0.6 - y * 0.15, seed, 3);
        const flute = fbm2(wx * 2.2 + wz * 0.7, wz * 2.2 + y * 0.05, seed + 5, 2);
        const band = 0.5 + 0.5 * Math.sin(((w.y + w.h - y) / bandH + fbm2(wx * 0.4, wz * 0.4, seed + 2, 2) * 1.5) * TAU);
        const m = sc * (1 - 0.22 * lump - 0.12 * flute - 0.08 * smooth(0.62, 0.97, band));
        return V(w.x + bx * m, y, w.z + bz * m);
      }),
    );
  }
  const g = gridMesh(rings, V(w.x, 0, w.z), V(w.x, w.y - below - 0.6, w.z));
  const tones = [mixCol(pal.rock, pal.stone, 0.35), mixCol(pal.rock, pal.stone, 0.6), mixCol(pal.rock, pal.earth, 0.35), mixCol(pal.rock, pal.stone, 0.45)];
  const tmp = new THREE.Color();
  b.rock.add(g, {
    color: (p, nn, out) => {
      const v = (w.y + w.h - p.y) / 0.5 + fbm2(p.x * 0.4, p.z * 0.4, seed, 2) * 2;
      const i0 = ((Math.floor(v) % tones.length) + tones.length) % tones.length;
      out.copy(tones[i0]).lerp(tmp.copy(tones[(i0 + 1) % tones.length]), smooth(0.7, 1, v - Math.floor(v)));
      out.lerp(pal.rockDeep, clamp((w.y - p.y) / below, 0, 1) * 0.8);
      // Moss gathers on up-facing ledges.
      if (nn.y > 0.45 && p.y > w.y) out.lerp(mixCol(pal.grass, pal.foliage, 0.5), clamp((nn.y - 0.45) * 2.5, 0, 0.75));
      out.multiplyScalar(0.8 + 0.2 * clamp(nn.y + 1, 0, 1));
    },
  });
  // Mossy crown.
  const top = rings[0];
  b.matte.add(capFan(top.map((v) => [v.x, v.z] as [number, number]), w.y + w.h, w.x, w.z), { color: mixCol(pal.grass, pal.foliage, 0.35) });
  for (let i = 0; i < 6; i++)
    b.foliage.add(blob(r.range(0.22, 0.42), r, 0.18, 2, 0.45, true), {
      m: xf(w.x + r.range(-0.3, 0.3) * w.w, w.y + w.h + 0.02, w.z + r.range(-0.3, 0.3) * w.d),
      color: mixCol(pal.grass, pal.foliage, r.range(0.2, 0.6)),
      sway: 0.05,
    });
}

/** A meandering line of flat stones across a garden top, flush with the grass. */
function steppingStones(b: Buckets, s: Shape, r: Rng, ctx: Ctx) {
  const pal = ctx.pal;
  const out: { x: number; z: number; r: number }[] = [];
  const amp = Math.min(0.6, s.d * 0.12);
  const ph = r.range(0, TAU);
  const zc = s.z + r.range(-0.15, 0.15) * s.d;
  for (let x = s.x - s.w / 2 + 0.45; x < s.x + s.w / 2 - 0.3; x += r.range(0.55, 0.75)) {
    const z = zc + Math.sin(x * 0.7 + ph) * amp;
    const sz = r.range(0.22, 0.32);
    out.push({ x, z, r: sz + 0.05 });
    const g = new THREE.CylinderGeometry(sz, sz * 1.05, 0.04, r.int(6, 8), 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 0.85 + r.next() * 0.3;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * (0.75 + r.next() * 0.2));
    }
    b.paving.add(g, {
      m: xf(x, s.y + 0.005, z, 0, r.range(0, TAU), 0),
      color: mixCol(pal.stone, pal.stoneShade, r.range(0.05, 0.3)),
      flat: true,
      uv: (q) => [q.x / 1.1, q.z / 1.1],
    });
  }
  return out;
}

/** At night, a faint moonlit line traces every walkable top edge so jumps stay judgeable. */
export function moonEdge(b: Buckets, s: Shape, rc: number) {
  const ring = roundedRing(s.w, s.d, rc, 0.3);
  const pos: number[] = [];
  const n = ring.length;
  const k0 = 0.012,
    k1 = 0.055;
  const at = (i: number, inset: number) => {
    const [bx, bz] = ring[i % n];
    return [s.x + bx * (1 - (2 * inset) / s.w), s.y + 0.008, s.z + bz * (1 - (2 * inset) / s.d)];
  };
  for (let i = 0; i < n; i++) {
    const a = at(i, k0),
      b2 = at(i, k1),
      c = at(i + 1, k0),
      d = at(i + 1, k1);
    pos.push(...a, ...c, ...b2, ...b2, ...c, ...d);
  }
  // Face up.
  const e1 = new THREE.Vector3(pos[3] - pos[0], pos[4] - pos[1], pos[5] - pos[2]);
  const e2 = new THREE.Vector3(pos[6] - pos[0], pos[7] - pos[1], pos[8] - pos[2]);
  if (e1.cross(e2).y < 0)
    for (let i = 0; i < pos.length; i += 9)
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = t;
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  b.glow.add(g, { color: new THREE.Color("#a8c4ff").multiplyScalar(0.55) });
}
