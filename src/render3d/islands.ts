import * as THREE from "three";
import type { IslandStyle, TimeOfDay } from "../sim/types";
import {
  Bucket,
  Buckets,
  blob,
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
import { Rng, TAU, clamp, fbm2, lerp, mixCol, noise2 } from "./util";

/** Instance lists filled while building, turned into instanced meshes afterwards. */
export type Scatter = {
  grass: { m: THREE.Matrix4; c: THREE.Color }[];
  flowers: { m: THREE.Matrix4; c: THREE.Color }[];
};

export type Ctx = {
  pal: Pal;
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
  const g = orientOutward(stitch(rings), V(s.x, 0, s.z));
  bk.add(g, { color: opts.color, flat: opts.flat ?? true, uv: opts.uv });
}

/**
 * The floating rock beneath an island: a tapering, ridged, stratified mass
 * that sits inside the footprint so it never reads as a ledge.
 * Returns points on its surface where roots can hang.
 */
function underside(
  bk: Bucket,
  s: Shape,
  base: [number, number][],
  yTop: number,
  depth: number,
  r: Rng,
  ctx: Ctx,
  inset = 0.05,
) {
  const pal = ctx.pal;
  const n = base.length;
  const seed = r.int(0, 100000);
  const K = clamp(Math.round(depth / 0.8), 4, 12);
  const driftA = r.range(0, TAU),
    drift = Math.min(s.w, s.d) * r.range(0.04, 0.16);
  const ridgeAmt = r.range(0.1, 0.22);
  const sx0 = (s.w - 2 * inset) / s.w,
    sz0 = (s.d - 2 * inset) / s.d;
  const rings: Ring[] = [];
  const anchors: { p: THREE.Vector3; t: number }[] = [];
  const centreAt = (t: number) =>
    V(s.x + Math.cos(driftA) * drift * Math.pow(t, 1.5), 0, s.z + Math.sin(driftA) * drift * Math.pow(t, 1.5));
  const mk = (t: number, y: number, k: number) => {
    const c = centreAt(t);
    return base.map(([bx, bz], i) => {
      const u = i / n;
      const ridge = fbm2(u * 11, t * 1.2, seed, 2);
      const j = noise2(i * 1.3, t * 9, seed + 3);
      const m = k * (1 - ridgeAmt * ridge * Math.pow(t, 0.55) - 0.07 * j * Math.min(1, t * 3));
      return V(c.x + bx * sx0 * m, y + (noise2(i * 0.7, t * 5, seed + 9) - 0.5) * 0.12 * Math.min(1, t * 4), c.z + bz * sz0 * m);
    });
  };
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    const y = yTop - depth * Math.pow(t, 1.12) * 0.92;
    const prof = k === 0 ? 1 : Math.pow(1 - t * 0.94, 0.78) * (1 - 0.22 * t) * (0.97 + 0.06 * noise2(k, 1, seed));
    rings.push(mk(t, y, prof));
    if (k > 0 && k < K - 1 && r.chance(0.55)) rings.push(mk(t + 0.01, y - 0.08, prof * 0.93));
    if (k >= 1 && t < 0.55) for (let a = 0; a < 2; a++) anchors.push({ p: rings[rings.length - 1][r.int(0, n - 1)].clone(), t });
  }
  const tipC = centreAt(1);
  const tip = V(tipC.x + r.range(-0.3, 0.3), yTop - depth, tipC.z + r.range(-0.3, 0.3));
  const g = orientOutward(stitch(rings, tip), V(s.x, 0, s.z));
  const variants = [
    pal.rock.clone(),
    mixCol(pal.rock, pal.stone, 0.35),
    mixCol(pal.rock, pal.earth, 0.45),
    mixCol(pal.rock, pal.stoneShade, 0.6),
  ];
  const deep = pal.rockDeep;
  bk.add(g, {
    flat: true,
    color: (p, nn, out) => {
      const tt = clamp((yTop - p.y) / depth, 0, 1);
      const band = Math.floor((yTop - p.y) / 0.42 + fbm2(p.x * 0.35, p.z * 0.35, seed, 2) * 1.6);
      out.copy(variants[((band % 4) + 4) % 4]);
      out.lerp(deep, Math.pow(tt, 0.75) * 0.82);
      const down = nn.y < -0.2 ? 0.78 : 1;
      out.multiplyScalar(down * (0.92 + 0.16 * noise2(p.x * 2.1, p.y * 2.3, seed)));
    },
  });
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
    const g = blob(r.range(0.18, 0.5) * Math.min(1.4, s.w * 0.15 + 0.4), r, 0.3, 0);
    const side = r.chance(0.5) ? -1 : 1;
    const x = s.x + side * r.range(0.3, 0.8) * (s.w / 2 + 0.6);
    const y = lerp(s.y - s.h, bottom, r.range(0.5, 1.1));
    const z = s.z + r.range(-0.5, 0.5) * s.d;
    b.matte.add(g, {
      m: xf(x, y, z, r.range(0, 3), r.range(0, 3), 0, 1, r.range(0.6, 1)),
      flat: true,
      color: (_p, nn, out) => out.copy(ctx.pal.rock).lerp(ctx.pal.rockDeep, nn.y < 0 ? 0.6 : 0.25),
    });
  }
}

/** Grass cap: a top face with colour variation and a hanging grass lip. */
function grassCap(b: Buckets, s: Shape, base: [number, number][], r: Rng, ctx: Ctx, rc: number) {
  const pal = ctx.pal;
  const seed = r.int(0, 99999);
  const g = topGrid(s.w, s.d, rc, 0.5);
  const dry = pal.grassDry,
    lush = mixCol(pal.grass, pal.foliage, 0.35),
    light = mixCol(pal.grass, "#f4f0b0", 0.18);
  b.matte.add(g, {
    m: xf(s.x, s.y, s.z),
    color: (p, _n, out) => {
      const f = fbm2(p.x * 0.33, p.z * 0.33, seed, 3);
      const f2 = noise2(p.x * 1.7, p.z * 1.7, seed + 1);
      out.copy(pal.grass);
      if (f > 0.56) out.lerp(dry, clamp((f - 0.56) * 4, 0, 0.7));
      if (f < 0.42) out.lerp(lush, clamp((0.42 - f) * 4, 0, 0.6));
      const edge = Math.min(s.w / 2 - Math.abs(p.x - s.x), s.d / 2 - Math.abs(p.z - s.z));
      if (edge < 0.35) out.lerp(light, (0.35 - edge) * 1.2);
      out.multiplyScalar(0.94 + f2 * 0.12);
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
  const top = topGrid(s.w, s.d, rc, 2);
  bk.add(top, { m: xf(s.x, s.y, s.z), color: pal.stone.clone().multiplyScalar(1.02), uv: pavingUV(tile) });
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
    // Vertical water stains.
    const stain = noise2(p.x * 1.3 + p.z * 1.1, 0.5, seed + 4);
    out.multiplyScalar(0.86 + 0.14 * stain + 0.08 * noise2(p.x * 4, p.y * 4, seed));
  };
  const masonry = (bk: Bucket, tint: THREE.Color, tile: number, yTop: number) =>
    walls(bk, s, base, yTop, s.y - s.h, 1, () => 0.02, {
      color: (p, _n, out) => {
        out.copy(tint);
        out.multiplyScalar(0.8 + 0.2 * clamp(1 - (yTop - p.y) / Math.max(0.5, s.h), 0, 1));
      },
      flat: false,
      uv: pavingUV(tile),
    });

  switch (style) {
    case "garden": {
      grassCap(b, s, base, r, ctx, rc);
      walls(b.matte, s, base, s.y - 0.06, s.y - s.h, far ? 1 : 5, (row, i) => (row === 0 ? 0.0 : 0.012 + 0.05 * noise2(i * 0.9, row * 1.7, seed) + (row % 2 === 0 ? 0.025 : 0)), {
        color: earth,
      });
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
    const u = underside(b.matte, s, base, s.y - s.h + 0.02, depth, r, ctx);
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
  const n = Math.round(area * 9 * density * ctx.detail);
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
    const sc0 = r.range(0.75, 1.25) * (edgeBias ? 1.15 : 0.9);
    const m = xf(x, s.y, z, 0, r.range(0, TAU), 0, sc0, sc0 * r.range(0.7, 1.2), sc0);
    const f = fbm2(x * 0.33, z * 0.33, 0, 3);
    const c = mixCol(pal.grass, f > 0.55 ? pal.grassDry : pal.leafLight, r.range(0.1, 0.45));
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
  const base = roundedRing(w.w, w.d, Math.min(w.w, w.d) * 0.32, 0.32);
  const n = base.length;
  const seed = r.int(0, 9999);
  const layers = Math.max(4, Math.round(w.h / 0.42));
  const rings: Ring[] = [];
  const at = (y: number, k: number, t: number) =>
    base.map(([bx, bz], i) => {
      const ridge = fbm2((i / n) * 9, t * 2.2, seed, 2);
      const m = k * (1 - 0.16 * ridge - 0.04 * noise2(i * 1.7, t * 13, seed + 1));
      return V(w.x + bx * m, y, w.z + bz * m);
    });
  for (let k = 0; k <= layers; k++) {
    const t = k / layers;
    const y = w.y + w.h * (1 - t);
    const sc = lerp(0.8, 1.0, Math.pow(t, 0.7)) * (0.95 + 0.05 * noise2(k, 2, seed));
    rings.push(at(y, sc, t));
    if (k > 0 && k < layers && k % 2 === 1) rings.push(at(y - 0.07, sc * 0.92, t + 0.005));
  }
  // Root into the clouds.
  const below = 9;
  for (let k = 1; k <= 5; k++) {
    const t = k / 5;
    rings.push(at(w.y - below * Math.pow(t, 1.1), Math.pow(1 - t * 0.92, 0.9), 1 + t));
  }
  const g = orientOutward(stitch(rings, V(w.x, w.y - below - 0.6, w.z)), V(w.x, 0, w.z));
  const tones = [pal.rock.clone(), mixCol(pal.rock, pal.stone, 0.35), mixCol(pal.rock, pal.earth, 0.4)];
  b.matte.add(g, {
    flat: true,
    color: (p, nn, out) => {
      const band = Math.floor((w.y + w.h - p.y) / 0.45 + fbm2(p.x * 0.4, p.z * 0.4, seed, 2) * 1.5);
      out.copy(tones[((band % 3) + 3) % 3]);
      out.lerp(pal.rockDeep, clamp((w.y - p.y) / below, 0, 1) * 0.8);
      if (nn.y > 0.5) out.lerp(mixCol(pal.grass, pal.foliage, 0.5), 0.7);
      out.multiplyScalar(nn.y < -0.3 ? 0.75 : 1);
    },
  });
  // Mossy crown.
  const top = rings[0];
  b.matte.add(capFan(top.map((v) => [v.x, v.z] as [number, number]), w.y + w.h, w.x, w.z), { color: mixCol(pal.grass, pal.foliage, 0.35) });
  for (let i = 0; i < 6; i++)
    b.matte.add(blob(r.range(0.2, 0.4), r, 0.3, 1, 0.45), {
      m: xf(w.x + r.range(-0.3, 0.3) * w.w, w.y + w.h + 0.02, w.z + r.range(-0.3, 0.3) * w.d),
      flat: true,
      color: mixCol(pal.grass, pal.foliage, r.range(0.2, 0.6)),
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
