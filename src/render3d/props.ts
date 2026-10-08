import * as THREE from "three";
import type { Level } from "../sim/types";
import { Buckets, blob, box, boxB, cylB, extrude, gear, lathe, sphere, torus, tube, xf } from "./geo";
import type { Ctx, Shape } from "./islands";
import { Rng, TAU, clamp, lerp, mixCol, noise2 } from "./util";

/**
 * Chapter set dressing. Big props stand just behind an island's back edge so
 * the walkable top stays clear; small ones (flowers, moss, urns on deep
 * islands) may sit on the top.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ flora

export function cypress(b: Buckets, r: Rng, x: number, y: number, z: number, h: number, ctx: Ctx) {
  const pal = ctx.pal;
  b.matte.add(cylB(0.07, 0.1, h * 0.25, 6), { m: xf(x, y, z), color: pal.bark });
  const prof: [number, number][] = [];
  const n = 9;
  const rad = h * 0.15;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const rr = rad * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.9) * (1 - t * 0.25);
    prof.push([Math.max(0.01, rr), t * h * 0.92]);
  }
  const g = lathe(prof, 9);
  const p = g.attributes.position as THREE.BufferAttribute;
  const seed = r.int(0, 9999);
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i),
      py = p.getY(i),
      pz = p.getZ(i);
    const a = Math.atan2(pz, px);
    const k = 1 + (noise2(a * 2.2, py * 2.4, seed) - 0.5) * 0.45;
    p.setXYZ(i, px * k, py, pz * k);
  }
  const dark = mixCol(pal.foliage, pal.ink, 0.35);
  const light = pal.leafLight;
  b.foliage.add(g, {
    m: xf(x, y + h * 0.1, z, 0, r.range(0, TAU), 0),
    flat: true,
    color: (q, nn, out) => out.copy(dark).lerp(light, clamp(nn.y * 0.6 + 0.25 + (q.y - y) / h * 0.25, 0, 0.85)),
    sway: (q) => clamp((q.y - y) / h, 0, 1) * 0.5,
  });
}

export function roundTree(b: Buckets, r: Rng, x: number, y: number, z: number, s: number, ctx: Ctx, kind: "olive" | "round" | "wisteria" | "citrus") {
  const pal = ctx.pal;
  const h = s * r.range(1.6, 2.1);
  const lean = r.range(-0.25, 0.25);
  const top = V(x + lean * s, y + h, z + r.range(-0.1, 0.1));
  const trunk = [V(x, y - 0.2, z), V(x + lean * s * 0.2, y + h * 0.35, z), V(x - lean * s * 0.2, y + h * 0.7, z), top];
  const tr = kind === "olive" ? 0.11 * s : 0.08 * s;
  b.matte.add(tube(trunk, (t) => tr * (1.25 - t * 0.6), 6), { color: pal.bark, flat: true });
  // Branches.
  const branches = r.int(2, 4);
  const tips: THREE.Vector3[] = [top];
  for (let i = 0; i < branches; i++) {
    const a = r.range(0, TAU);
    const from = trunk[2].clone().lerp(top, r.range(0, 0.6));
    const tip = from.clone().add(V(Math.cos(a) * s * 0.7, r.range(0.2, 0.6) * s, Math.sin(a) * s * 0.4 - 0.1));
    b.matte.add(tube([from, from.clone().lerp(tip, 0.5).add(V(0, 0.1, 0)), tip], (t) => tr * 0.55 * (1 - t * 0.6), 5), { color: pal.bark });
    tips.push(tip);
  }
  const leafBase =
    kind === "olive"
      ? mixCol(pal.foliage, "#a9b79a", 0.45)
      : kind === "wisteria"
        ? mixCol(pal.foliage, "#7a5aa8", 0.35)
        : kind === "citrus"
          ? mixCol(pal.foliage, pal.grass, 0.25)
          : pal.foliage;
  const leafHi = kind === "olive" ? mixCol(leafBase, "#e8ecd6", 0.35) : mixCol(leafBase, pal.leafLight, 0.55);
  const shadow = mixCol(leafBase, pal.ink, 0.35);
  for (const t of tips) {
    const k = r.int(2, 3);
    for (let i = 0; i < k; i++) {
      const rr = s * r.range(0.42, 0.62) * (kind === "olive" ? 0.85 : 1);
      const g = blob(rr, r, 0.28, 1, kind === "olive" ? 0.7 : 0.82);
      const cx = t.x + r.range(-0.3, 0.3) * s,
        cy = t.y + r.range(-0.1, 0.25) * s,
        cz = t.z + r.range(-0.25, 0.2) * s;
      b.foliage.add(g, {
        m: xf(cx, cy, cz, 0, r.range(0, TAU), 0),
        flat: true,
        color: (_q, nn, out) => out.copy(shadow).lerp(leafHi, clamp(nn.y * 0.55 + 0.45 + nn.x * 0.1, 0, 1)),
        sway: 0.35,
      });
    }
  }
  if (kind === "wisteria") {
    const bloom = [new THREE.Color("#b58ce8"), new THREE.Color("#d6a8ff"), new THREE.Color("#9a7ae0")];
    for (let i = 0; i < 9; i++) {
      const t = r.pick(tips);
      const c = new THREE.ConeGeometry(0.1 * s, r.range(0.5, 0.9) * s, 5).rotateX(Math.PI);
      b.foliage.add(c, {
        m: xf(t.x + r.range(-0.6, 0.6) * s, t.y - 0.35 * s, t.z + r.range(-0.3, 0.4) * s),
        color: r.pick(bloom),
        flat: true,
        sway: 0.6,
      });
    }
  }
  if (kind === "citrus") {
    for (let i = 0; i < 10; i++) {
      const t = r.pick(tips);
      b.matte.add(sphere(0.06 * s, 6, 4), {
        m: xf(t.x + r.range(-0.45, 0.45) * s, t.y + r.range(-0.35, 0.3) * s, t.z + r.range(-0.1, 0.5) * s),
        color: new THREE.Color("#f29a26"),
      });
    }
  }
}

export function shrub(b: Buckets, r: Rng, x: number, y: number, z: number, s: number, ctx: Ctx, tint?: THREE.Color) {
  const pal = ctx.pal;
  const base = tint ?? mixCol(pal.foliage, pal.grass, 0.3);
  const n = r.int(2, 4);
  for (let i = 0; i < n; i++) {
    const rr = s * r.range(0.25, 0.42);
    b.foliage.add(blob(rr, r, 0.3, 1, 0.75), {
      m: xf(x + r.range(-0.3, 0.3) * s, y + rr * 0.55, z + r.range(-0.2, 0.2) * s),
      flat: true,
      color: (_q, nn, out) => out.copy(mixCol(base, pal.ink, 0.3)).lerp(mixCol(base, pal.leafLight, 0.5), clamp(nn.y * 0.6 + 0.4, 0, 1)),
      sway: 0.12,
    });
  }
}

// ------------------------------------------------------------- architecture

export function column(b: Buckets, x: number, y: number, z: number, h: number, rad: number, ctx: Ctx, broken = 0, r?: Rng) {
  const pal = ctx.pal;
  const stone = mixCol(pal.stone, "#ffffff", 0.04);
  const shade = mixCol(pal.stone, pal.stoneShade, 0.25);
  b.matte.add(boxB(rad * 2.6, rad * 0.5, rad * 2.6), { m: xf(x, y, z), color: shade });
  b.matte.add(torus(rad * 1.05, rad * 0.18, 4, 14), { m: xf(x, y + rad * 0.62, z, Math.PI / 2, 0, 0), color: stone });
  const shaftH = broken ? h * broken : h - rad * 1.4;
  const shaft = new THREE.CylinderGeometry(rad * 0.88, rad, shaftH, 12, 1, false).translate(0, shaftH / 2, 0);
  // Fluting.
  const p = shaft.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = 1 - 0.06 * (Math.cos(a * 12) > 0 ? 1 : 0);
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  b.matte.add(shaft, { m: xf(x, y + rad * 0.5, z), color: stone, flat: true });
  if (!broken) {
    const cy = y + rad * 0.5 + shaftH;
    b.matte.add(cylB(rad * 1.25, rad * 0.9, rad * 0.35, 12), { m: xf(x, cy, z), color: stone });
    b.matte.add(boxB(rad * 2.7, rad * 0.4, rad * 2.7), { m: xf(x, cy + rad * 0.35, z), color: shade });
  } else if (r) {
    for (let i = 0; i < 3; i++)
      b.matte.add(blob(rad * r.range(0.4, 0.8), r, 0.35, 0), {
        m: xf(x + r.range(-1, 1) * rad * 2.5, y + rad * 0.3, z + r.range(-1, 0.5) * rad * 2),
        color: stone,
        flat: true,
      });
  }
}

/** A run of arches between x0 and x1 at depth z, standing on y. */
export function arcade(b: Buckets, x0: number, x1: number, y: number, z: number, h: number, ctx: Ctx, r: Rng, ruined = false) {
  const pal = ctx.pal;
  const span = x1 - x0;
  const n = Math.max(1, Math.round(span / 1.6));
  const step = span / n;
  const rad = 0.16;
  const colH = h * 0.62;
  for (let i = 0; i <= n; i++) column(b, x0 + i * step, y, z, colH, rad, ctx, ruined && r.chance(0.3) ? r.range(0.3, 0.7) : 0, r);
  if (ruined && r.chance(0.5)) return;
  // Arched wall above the columns.
  const top = h - colH;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.lineTo(span, 0);
  sh.lineTo(span, top);
  sh.lineTo(0, top);
  sh.lineTo(0, 0);
  for (let i = 0; i < n; i++) {
    const hole = new THREE.Path();
    const cx = (i + 0.5) * step;
    const hw = step / 2 - rad * 1.2;
    hole.moveTo(cx - hw, -0.01);
    hole.lineTo(cx - hw, top * 0.15);
    hole.absarc(cx, top * 0.15, hw, Math.PI, 0, true);
    hole.lineTo(cx + hw, -0.01);
    hole.lineTo(cx - hw, -0.01);
    sh.holes.push(hole);
  }
  const g = extrude(sh, 0.34, 0.02);
  const stone = mixCol(pal.stone, "#ffffff", 0.05);
  b.matte.add(g, { m: xf(x0, y + colH + rad * 1.5, z), color: stone });
  b.matte.add(boxB(span + 0.4, 0.14, 0.5), { m: xf(x0 + span / 2, y + colH + rad * 1.5 + top, z), color: mixCol(pal.stone, pal.stoneShade, 0.2) });
  b.metal.add(box(span, 0.035, 0.02), { m: xf(x0 + span / 2, y + colH + rad * 1.5 + top - 0.12, z + 0.18), color: pal.gold });
}

export function urn(b: Buckets, r: Rng, x: number, y: number, z: number, s: number, ctx: Ctx, flowers = true) {
  const pal = ctx.pal;
  const g = lathe(
    [
      [0.001, 0],
      [0.16, 0],
      [0.12, 0.06],
      [0.1, 0.12],
      [0.22, 0.3],
      [0.24, 0.42],
      [0.17, 0.55],
      [0.2, 0.6],
      [0.18, 0.62],
    ].map(([a, c]) => [a * s, c * s] as [number, number]),
    12,
  );
  const terracotta = ctx.time === "noon" || ctx.time === "afternoon";
  b.matte.add(g, { m: xf(x, y, z), color: terracotta ? new THREE.Color("#c46a45") : mixCol(pal.stone, pal.stoneShade, 0.15) });
  if (flowers) shrub(b, r, x, y + 0.5 * s, z, 0.7 * s, ctx);
}

export function pergola(b: Buckets, r: Rng, x0: number, x1: number, y: number, z: number, ctx: Ctx) {
  const pal = ctx.pal;
  const h = 2.4;
  const broken = r.chance(0.5);
  column(b, x0, y, z, h, 0.13, ctx);
  column(b, x1, y, z, h, 0.13, ctx, broken ? 0.55 : 0, r);
  const beam = boxB(x1 - x0 + 0.6, 0.16, 0.22);
  b.matte.add(beam, { m: xf((x0 + x1) / 2, y + h, z, 0, 0, broken ? -0.12 : 0), color: mixCol(pal.bark, pal.stone, 0.4) });
  // Vines draped over the beam.
  for (let i = 0; i < 8; i++) {
    const x = lerp(x0, x1, r.next());
    const len = r.range(0.4, 1.2);
    const g = tube([V(x, y + h + 0.1, z), V(x + r.range(-0.1, 0.1), y + h - len * 0.5, z + 0.12), V(x, y + h - len, z + 0.1)], () => 0.02, 3);
    b.foliage.add(g, { color: mixCol(pal.foliage, pal.ink, 0.2), sway: 0.4 });
    for (let k = 0; k < 4; k++)
      b.foliage.add(blob(r.range(0.07, 0.13), r, 0.3, 0), {
        m: xf(x + r.range(-0.1, 0.1), y + h - r.range(0, len), z + 0.1),
        color: mixCol(pal.foliage, pal.leafLight, r.next()),
        flat: true,
        sway: 0.5,
      });
  }
  for (let i = 0; i < 5; i++)
    b.foliage.add(blob(r.range(0.15, 0.25), r, 0.3, 1, 0.7), {
      m: xf(lerp(x0, x1, r.next()), y + h + 0.18, z + r.range(-0.1, 0.1)),
      color: mixCol(pal.foliage, pal.leafLight, r.next() * 0.6),
      flat: true,
      sway: 0.3,
    });
}

export function fountain(b: Buckets, _r: Rng, x: number, y: number, z: number, s: number, ctx: Ctx) {
  const pal = ctx.pal;
  const stone = mixCol(pal.stone, "#ffffff", 0.06);
  b.matte.add(
    lathe(
      [
        [0.001, 0],
        [1.0, 0],
        [1.05, 0.08],
        [1.0, 0.36],
        [0.9, 0.38],
        [0.88, 0.12],
        [0.001, 0.12],
      ].map(([a, c]) => [a * s, c * s] as [number, number]),
      28,
    ),
    { m: xf(x, y, z), color: stone },
  );
  b.metal.add(cylB(0.86 * s, 0.86 * s, 0.01, 28), { m: xf(x, y + 0.3 * s, z), color: new THREE.Color("#4f9bb0") });
  b.matte.add(cylB(0.1 * s, 0.14 * s, 0.9 * s, 10), { m: xf(x, y, z), color: stone });
  b.matte.add(
    lathe(
      [
        [0.001, 0],
        [0.1, 0],
        [0.45, 0.12],
        [0.48, 0.18],
        [0.4, 0.17],
        [0.001, 0.1],
      ].map(([a, c]) => [a * s, c * s] as [number, number]),
      18,
    ),
    { m: xf(x, y + 0.9 * s, z), color: stone },
  );
  b.metal.add(cylB(0.38 * s, 0.38 * s, 0.01, 18), { m: xf(x, y + 1.05 * s, z), color: new THREE.Color("#5aa7bb") });
  b.metal.add(sphere(0.09 * s, 8, 6), { m: xf(x, y + 1.15 * s, z), color: pal.gold });
}

export function bookshelf(b: Buckets, r: Rng, x: number, y: number, z: number, w: number, h: number, ctx: Ctx) {
  const pal = ctx.pal;
  const stone = mixCol(pal.stone, pal.stoneShade, 0.25);
  const dpt = 0.45;
  b.matte.add(boxB(0.14, h, dpt), { m: xf(x - w / 2, y, z), color: stone });
  b.matte.add(boxB(0.14, h, dpt), { m: xf(x + w / 2, y, z), color: stone });
  b.matte.add(boxB(w + 0.3, 0.16, dpt + 0.1), { m: xf(x, y + h, z), color: mixCol(pal.stone, "#ffffff", 0.05) });
  b.matte.add(boxB(w, h, 0.06), { m: xf(x, y, z - dpt / 2 + 0.03), color: mixCol(stone, pal.ink, 0.35) });
  const shelves = Math.max(2, Math.floor(h / 0.55));
  const sh = h / shelves;
  const bookCols = ["#7a3b4f", "#3f4f7a", "#b0894a", "#5e3a6e", "#2f5a55", "#8f5a3a", "#d8c8a8", "#4a2f4f"].map((c) => new THREE.Color(c));
  for (let k = 0; k < shelves; k++) {
    const sy = y + k * sh;
    b.matte.add(boxB(w, 0.06, dpt), { m: xf(x, sy, z), color: stone });
    let bx = x - w / 2 + 0.08;
    while (bx < x + w / 2 - 0.12) {
      if (r.chance(0.08)) {
        bx += r.range(0.1, 0.3);
        continue;
      }
      const bw = r.range(0.05, 0.11);
      const bh = sh * r.range(0.55, 0.85);
      const tilt = r.chance(0.08) ? r.range(-0.3, 0.3) : 0;
      b.matte.add(boxB(bw, bh, dpt * r.range(0.6, 0.85)), {
        m: xf(bx + bw / 2, sy + 0.06, z + 0.02, 0, 0, tilt),
        color: r.pick(bookCols).clone().multiplyScalar(r.range(0.75, 1.1)),
      });
      bx += bw + 0.005;
    }
  }
  if (r.chance(0.6))
    b.metal.add(torus(0.12, 0.02, 4, 16), { m: xf(x, y + h + 0.3, z + 0.1), color: pal.gold });
}

export function banner(b: Buckets, _r: Rng, x: number, top: number, z: number, len: number, ctx: Ctx, colr?: THREE.Color) {
  const pal = ctx.pal;
  const w = 0.42;
  const g = new THREE.PlaneGeometry(w, len, 2, 8).translate(0, -len / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const yy = p.getY(i);
    if (yy < -len + 0.01 && Math.abs(p.getX(i)) < 0.01) p.setY(i, yy - 0.14);
  }
  const c = colr ?? mixCol(pal.accent, "#5a2a6e", 0.55);
  const m = xf(x, top, z);
  b.foliage.add(g, { m, color: (q, _n, out) => out.copy(c).multiplyScalar(0.8 + 0.2 * clamp((q.y - top + len) / len, 0, 1)), sway: (q) => clamp((top - q.y) / len, 0, 1) * 0.8 });
  const back = g.clone().rotateY(Math.PI);
  b.foliage.add(back, { m: xf(x, top, z - 0.005), color: mixCol(c, pal.ink, 0.3), sway: (q) => clamp((top - q.y) / len, 0, 1) * 0.8 });
  b.metal.add(box(w + 0.16, 0.04, 0.04), { m: xf(x, top, z), color: pal.gold });
  b.metal.add(sphere(0.06, 6, 4), { m: xf(x, top - len * 0.35, z + 0.02), color: pal.gold });
}

export function hangingLantern(b: Buckets, x: number, top: number, z: number, drop: number, ctx: Ctx) {
  const pal = ctx.pal;
  b.metal.add(box(0.015, drop, 0.015), { m: xf(x, top - drop / 2, z), color: pal.bronze });
  b.metal.add(cylB(0.02, 0.11, 0.08, 6), { m: xf(x, top - drop - 0.02, z), color: pal.bronze });
  b.glow.add(new THREE.OctahedronGeometry(0.1, 0), { m: xf(x, top - drop - 0.14, z, 0, 0, 0, 1, 1.4, 1), color: new THREE.Color("#ffb45e").multiplyScalar(4), flat: true });
  b.metal.add(cylB(0.05, 0.02, 0.06, 6), { m: xf(x, top - drop - 0.32, z), color: pal.bronze });
}

export function crystals(b: Buckets, r: Rng, x: number, y: number, z: number, s: number, _ctx: Ctx, glow: THREE.Color) {
  const n = r.int(3, 6);
  for (let i = 0; i < n; i++) {
    const hgt = s * r.range(0.4, 1.1);
    const g = new THREE.OctahedronGeometry(0.16 * s, 0).scale(1, hgt / (0.16 * s) / 2, 1);
    b.glow.add(g, {
      m: xf(x + r.range(-0.3, 0.3) * s, y + hgt * 0.35, z + r.range(-0.2, 0.2) * s, r.range(-0.4, 0.4), r.range(0, 3), r.range(-0.4, 0.4)),
      color: (_q, nn, out) => out.copy(glow).multiplyScalar(0.7 + 0.5 * clamp(nn.y + 0.5, 0, 1)),
      flat: true,
    });
  }
}

export function obelisk(b: Buckets, x: number, y: number, z: number, h: number, ctx: Ctx, starGlow: boolean) {
  const pal = ctx.pal;
  const g = new THREE.CylinderGeometry(0.16, 0.26, h, 4, 1).rotateY(Math.PI / 4).translate(0, h / 2, 0);
  b.matte.add(boxB(0.75, 0.25, 0.75), { m: xf(x, y, z), color: mixCol(pal.stone, pal.stoneShade, 0.3) });
  b.matte.add(g, { m: xf(x, y + 0.25, z), color: mixCol(pal.stone, pal.stoneShade, 0.1), flat: true });
  b.metal.add(new THREE.ConeGeometry(0.23, 0.32, 4).rotateY(Math.PI / 4).translate(0, 0.16, 0), { m: xf(x, y + 0.25 + h, z), color: pal.gold, flat: true });
  if (starGlow)
    for (let i = 0; i < 4; i++)
      b.glow.add(sphere(0.03, 5, 4), { m: xf(x + (i % 2 ? 0.06 : -0.05), y + 0.6 + i * h * 0.2, z + 0.22 - i * 0.012), color: new THREE.Color("#ffe7a8").multiplyScalar(3) });
}

export function gearTower(b: Buckets, r: Rng, x: number, y: number, z: number, h: number, ctx: Ctx) {
  const pal = ctx.pal;
  const bronze = pal.bronze,
    dark = mixCol(pal.bronze, pal.ink, 0.45);
  b.metal.add(cylB(0.1, 0.14, h, 8), { m: xf(x, y, z), color: dark });
  const R = r.range(0.7, 1.15);
  const gy = y + h - R * 0.4;
  b.metal.add(gear(R, r.int(12, 18), 0.12, 0.3), {
    m: xf(x, gy, z + 0.12),
    color: bronze,
    spin: { pivot: V(x, gy, z + 0.12), axis: V(0, 0, 1), speed: r.range(0.15, 0.3) * (r.chance(0.5) ? 1 : -1) },
  });
  const r2 = R * r.range(0.45, 0.6);
  const ang = r.range(-0.6, 0.6) - Math.PI / 2;
  const gx2 = x + Math.cos(ang) * (R + r2) * 0.9,
    gy2 = gy + Math.sin(ang) * (R + r2) * 0.9;
  b.metal.add(gear(r2, 9, 0.1, 0.3), {
    m: xf(gx2, gy2, z + 0.2),
    color: pal.gold,
    spin: { pivot: V(gx2, gy2, z + 0.2), axis: V(0, 0, 1), speed: -0.5 },
  });
  b.metal.add(sphere(0.12, 8, 6), { m: xf(x, gy, z + 0.22), color: pal.gold });
}

/** A tide-engine clock pylon: a bronze-banded stone housing with a turning gold dial. */
export function clockPylon(b: Buckets, r: Rng, x: number, y: number, z: number, h: number, ctx: Ctx) {
  const pal = ctx.pal;
  const stone = mixCol(pal.stone, pal.stoneShade, 0.2);
  const dark = mixCol(pal.bronze, pal.ink, 0.45);
  b.matte.add(boxB(0.9, 0.25, 0.7), { m: xf(x, y, z), color: mixCol(stone, pal.ink, 0.1) });
  b.matte.add(boxB(0.7, h, 0.5), { m: xf(x, y + 0.25, z), color: stone });
  b.matte.add(boxB(0.86, 0.2, 0.62), { m: xf(x, y + 0.25 + h, z), color: mixCol(stone, "#ffffff", 0.08) });
  for (const k of [0.3, 0.62]) b.metal.add(box(0.74, 0.06, 0.54), { m: xf(x, y + 0.25 + h * k, z), color: dark });
  const cy = y + 0.25 + h * 0.78,
    cz = z + 0.27;
  b.metal.add(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 32).rotateX(Math.PI / 2), { m: xf(x, cy, cz), color: pal.gold });
  b.matte.add(new THREE.CylinderGeometry(0.27, 0.27, 0.045, 32).rotateX(Math.PI / 2), { m: xf(x, cy, cz + 0.005), color: mixCol(pal.stone, "#ffffff", 0.3) });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    b.metal.add(box(0.025, i % 3 === 0 ? 0.08 : 0.045, 0.02), { m: xf(x + Math.sin(a) * 0.22, cy + Math.cos(a) * 0.22, cz + 0.03, 0, 0, -a), color: pal.ink });
  }
  const pivot = V(x, cy, cz + 0.04);
  b.metal.add(box(0.03, 0.2, 0.015).translate(0, 0.08, 0), { m: xf(x, cy, cz + 0.04), color: pal.ink, spin: { pivot, axis: V(0, 0, -1), speed: r.range(0.4, 0.7) } });
  b.metal.add(box(0.025, 0.13, 0.015).translate(0, 0.05, 0), { m: xf(x, cy, cz + 0.05), color: pal.ink, spin: { pivot, axis: V(0, 0, -1), speed: r.range(0.05, 0.09) } });
  const gr = 0.32;
  b.metal.add(gear(gr, 10, 0.08, 0.3), {
    m: xf(x + 0.42, y + 0.25 + h * 0.45, z + 0.05, 0, Math.PI / 2, 0),
    color: pal.bronze,
    spin: { pivot: V(x + 0.42, y + 0.25 + h * 0.45, z + 0.05), axis: V(1, 0, 0), speed: 0.6 },
  });
}

export function chain(b: Buckets, x: number, top: number, z: number, len: number, ctx: Ctx) {
  const n = Math.round(len / 0.12);
  for (let i = 0; i < n; i++)
    b.metal.add(torus(0.05, 0.014, 4, 8), {
      m: xf(x, top - i * 0.11, z, 0, i % 2 ? Math.PI / 2 : 0, 0, 1, 1.4, 1),
      color: mixCol(ctx.pal.bronze, ctx.pal.ink, 0.35),
    });
}

export function telescope(b: Buckets, r: Rng, x: number, y: number, z: number, s: number, ctx: Ctx) {
  const pal = ctx.pal;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    b.metal.add(tube([V(x, y + 1.1 * s, z), V(x + Math.cos(a) * 0.5 * s, y, z + Math.sin(a) * 0.5 * s)], () => 0.03 * s, 4), { color: mixCol(pal.bronze, pal.ink, 0.35) });
  }
  const tilt = r.range(0.6, 0.9);
  const yaw = r.range(-0.6, 0.6);
  const len = 2.0 * s;
  const tubeG = new THREE.CylinderGeometry(0.12 * s, 0.2 * s, len, 14).rotateZ(Math.PI / 2 - tilt);
  b.metal.add(tubeG, { m: xf(x, y + 1.2 * s, z, 0, yaw, 0), color: pal.bronze });
  for (const t of [-0.35, 0, 0.35]) {
    const ox = Math.cos(tilt) * t * len,
      oy = Math.sin(tilt) * t * len;
    b.metal.add(torus(0.18 * s - t * 0.06 * s, 0.025 * s, 4, 16), {
      m: xf(x + ox * Math.cos(yaw), y + 1.2 * s + oy, z - ox * Math.sin(yaw), 0, yaw + Math.PI / 2, Math.PI / 2 - tilt),
      color: pal.gold,
    });
  }
  b.metal.add(sphere(0.1 * s, 8, 6), { m: xf(x, y + 1.2 * s, z), color: pal.gold });
}

export function armillary(b: Buckets, x: number, y: number, z: number, s: number, ctx: Ctx, speed = 0.25) {
  const pal = ctx.pal;
  b.matte.add(
    lathe(
      [
        [0.001, 0],
        [0.32, 0],
        [0.32, 0.1],
        [0.12, 0.2],
        [0.08, 0.7],
        [0.16, 0.8],
        [0.001, 0.82],
      ].map(([a, c]) => [a * s, c * s] as [number, number]),
      12,
    ),
    { m: xf(x, y, z), color: mixCol(pal.stone, pal.stoneShade, 0.15) },
  );
  const c = V(x, y + 1.35 * s, z);
  const rings: [number, number, number, number][] = [
    [0.52, 0, 0, speed],
    [0.48, Math.PI / 2, 0.4, -speed * 1.3],
    [0.44, 0.9, -0.5, speed * 0.8],
  ];
  for (const [R, rx, rz, sp] of rings) {
    const axis = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rx, 0, rz));
    b.metal.add(torus(R * s, 0.025 * s, 4, 40), { m: xf(c.x, c.y, c.z, rx, 0, rz), color: pal.gold, spin: { pivot: c, axis, speed: sp } });
  }
  b.glow.add(sphere(0.1 * s, 10, 8), { m: xf(c.x, c.y, c.z), color: pal.gold.clone().multiplyScalar(2.5) });
}

export function dome(b: Buckets, x: number, y: number, z: number, R: number, ctx: Ctx, glowWindows: boolean) {
  const pal = ctx.pal;
  const stone = mixCol(pal.stone, "#ffffff", 0.04);
  const drumH = R * 0.9;
  b.matte.add(cylB(R * 1.12, R * 1.18, 0.2, 24), { m: xf(x, y, z), color: mixCol(pal.stone, pal.stoneShade, 0.3) });
  b.matte.add(cylB(R, R, drumH, 24), { m: xf(x, y + 0.2, z), color: stone });
  // Pilasters and windows.
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    b.matte.add(boxB(0.12, drumH, 0.1), { m: xf(x + Math.cos(a) * R, y + 0.2, z + Math.sin(a) * R, 0, -a, 0), color: mixCol(stone, "#ffffff", 0.1) });
    const wa = a + Math.PI / n;
    const wc = glowWindows ? new THREE.Color("#ffc46e").multiplyScalar(2.2) : mixCol(pal.ink, pal.stoneShade, 0.4);
    (glowWindows ? b.glow : b.matte).add(boxB(0.16, drumH * 0.45, 0.04), {
      m: xf(x + Math.cos(wa) * (R + 0.005), y + 0.2 + drumH * 0.3, z + Math.sin(wa) * (R + 0.005), 0, -wa + Math.PI / 2, 0),
      color: wc,
    });
  }
  b.matte.add(cylB(R * 1.06, R * 1.06, 0.12, 24), { m: xf(x, y + 0.2 + drumH, z), color: mixCol(pal.stone, pal.stoneShade, 0.2) });
  const domeG = new THREE.SphereGeometry(R * 1.02, 24, 10, 0, TAU, 0, Math.PI / 2);
  const patina = ctx.time === "dawn" ? pal.gold : mixCol(pal.bronze, "#5f9f8a", 0.45);
  b.metal.add(domeG, { m: xf(x, y + 0.32 + drumH, z), color: patina });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.metal.add(torus(R * 1.03, 0.025, 3, 16, Math.PI / 2), {
      m: xf(x, y + 0.32 + drumH, z, 0, -a, 0),
      color: pal.gold,
    });
  }
  b.metal.add(cylB(0.02, 0.07, 0.4, 6), { m: xf(x, y + 0.32 + drumH + R, z), color: pal.gold });
  b.metal.add(sphere(0.08, 8, 6), { m: xf(x, y + 0.75 + drumH + R, z), color: pal.gold });
}

// ---------------------------------------------------------------- placement

export type Blocker = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };

/** Dress an island for the chapter. `blockers` are things behind that must stay visible. */
export function dress(b: Buckets, s: Shape, r: Rng, ctx: Ctx, blockers: Blocker[], keepClear: { x: number; z: number; r: number }[], far = false) {
  const t = ctx.time;
  const back = s.z - s.d / 2;
  const free = (x: number, rad: number, height: number) => {
    for (const k of keepClear) if (Math.abs(k.x - x) < k.r + rad && k.z < back + 1.5) return false;
    for (const o of blockers) {
      if (o.z1 > back + 0.2) continue;
      if (o.x1 < x - rad - 1.2 || o.x0 > x + rad + 1.2) continue;
      if (o.y1 < s.y - 6 || o.y0 > s.y + height + 4) continue;
      return false;
    }
    return true;
  };
  let cursor = s.x - s.w / 2 + r.range(0.2, 0.9);
  const end = s.x + s.w / 2 - 0.2;
  const placeBehind = (rad: number, height: number, fn: (x: number, z: number, y: number) => void) => {
    if (cursor + rad > end + 0.4) return false;
    const x = cursor + rad;
    if (free(x, rad, height)) {
      const z = back - rad * 0.8 - 0.05;
      const y = s.y - 0.35;
      // A mound so the base reads as rooted if glimpsed.
      if (s.style === "garden")
        b.matte.add(blob(rad * 0.9 + 0.2, r, 0.25, 1, 0.45), {
          m: xf(x, y, z + 0.1),
          flat: true,
          color: (_q, nn, out) => out.copy(ctx.pal.grass).lerp(ctx.pal.earth, nn.y > 0.3 ? 0.1 : 0.7),
        });
      fn(x, z, y);
    }
    cursor = x + rad + r.range(0.15, 1.4);
    return true;
  };
  const big = s.w * s.d > 4;
  const rnd = () => r.next();
  let guard = 0;
  while (cursor < end && guard++ < 40) {
    const roll = rnd();
    let ok = true;
    switch (t) {
      case "morning":
        if (s.style === "garden") {
          if (roll < 0.35) ok = placeBehind(0.45, 4, (x, z, y) => cypress(b, r, x, y, z, r.range(2.6, 4.2), ctx));
          else if (roll < 0.6) ok = placeBehind(0.9, 3, (x, z, y) => roundTree(b, r, x, y, z, r.range(0.75, 1.0), ctx, "olive"));
          else if (roll < 0.75 && big) ok = placeBehind(1.3, 3, (x, z, y) => pergola(b, r, x - 1.0, x + 1.0, y, z, ctx));
          else ok = placeBehind(0.5, 1, (x, z, y) => shrub(b, r, x, y + 0.25, z, r.range(0.8, 1.3), ctx));
        } else if (s.style === "ruin" || s.style === "stone") {
          if (roll < 0.4) ok = placeBehind(0.35, 3, (x, z, y) => column(b, x, y, z, r.range(1.6, 2.8), 0.16, ctx, r.chance(0.6) ? r.range(0.3, 0.8) : 0, r));
          else if (roll < 0.65) ok = placeBehind(0.45, 4, (x, z, y) => cypress(b, r, x, y, z, r.range(2.4, 3.6), ctx));
          else ok = placeBehind(0.5, 1, (x, z, y) => shrub(b, r, x, y + 0.25, z, 1, ctx));
        } else cursor = end;
        break;
      case "noon":
        if (s.style === "stone" || s.style === "ruin") {
          if (roll < 0.45 && s.w > 3.2) {
            const span = Math.min(s.w - 0.8, r.range(3, 5));
            ok = placeBehind(span / 2, 3.2, (x, z, y) => arcade(b, x - span / 2, x + span / 2, y, z, 3.0, ctx, r, s.style === "ruin"));
          } else if (roll < 0.7) ok = placeBehind(0.45, 4, (x, z, y) => cypress(b, r, x, y, z, r.range(2.8, 4.2), ctx));
          else ok = placeBehind(0.45, 2, (x, z, y) => {
            urn(b, r, x, y + 0.35, z, 1.4, ctx, false);
            roundTree(b, r, x, y + 1.2, z, 0.45, ctx, "citrus");
          });
        } else if (s.style === "garden") {
          if (roll < 0.5) ok = placeBehind(0.45, 4, (x, z, y) => cypress(b, r, x, y, z, r.range(2.8, 4.4), ctx));
          else ok = placeBehind(0.8, 3, (x, z, y) => roundTree(b, r, x, y, z, 0.85, ctx, "citrus"));
        } else cursor = end;
        break;
      case "afternoon":
        if (s.style !== "bridge" && s.style !== "plinth") {
          if (roll < 0.4) ok = placeBehind(0.9, 3.5, (x, z, y) => gearTower(b, r, x, y, z, r.range(1.8, 3.0), ctx));
          else if (roll < 0.62) ok = placeBehind(0.5, 3.2, (x, z, y) => clockPylon(b, r, x, y, z, r.range(1.8, 2.6), ctx)); else if (roll < 0.8 && s.style === "garden") ok = placeBehind(0.8, 3, (x, z, y) => roundTree(b, r, x, y, z, 0.85, ctx, "olive"));
          else ok = placeBehind(0.35, 3, (x, z, y) => column(b, x, y, z, r.range(1.8, 2.6), 0.15, ctx, r.chance(0.4) ? 0.6 : 0, r));
        } else cursor = end;
        break;
      case "dusk":
        if (s.style !== "bridge" && s.style !== "plinth") {
          if (roll < 0.45 && s.w > 2.4) ok = placeBehind(0.9, 3.5, (x, z, y) => bookshelf(b, r, x, y, z, r.range(1.3, 1.8), r.range(2.4, 3.4), ctx));
          else if (roll < 0.7) ok = placeBehind(0.95, 3.5, (x, z, y) => roundTree(b, r, x, y, z, r.range(0.8, 1.05), ctx, "wisteria"));
          else
            ok = placeBehind(0.5, 3, (x, z, y) => {
              column(b, x, y, z, 2.6, 0.13, ctx);
              hangingLantern(b, x + 0.3, y + 2.4, z + 0.15, 0.4, ctx);
              b.metal.add(box(0.5, 0.04, 0.04), { m: xf(x + 0.18, y + 2.45, z + 0.15), color: ctx.pal.bronze });
            });
        } else cursor = end;
        break;
      case "night":
        if (s.style !== "bridge" && s.style !== "plinth") {
          if (roll < 0.3) ok = placeBehind(0.45, 2, (x, z, y) => crystals(b, r, x, y + 0.3, z, r.range(0.9, 1.4), ctx, new THREE.Color("#7fc4ff").multiplyScalar(0.85)));
          else if (roll < 0.6) ok = placeBehind(0.4, 3.5, (x, z, y) => obelisk(b, x, y, z, r.range(2.0, 3.2), ctx, true));
          else ok = placeBehind(0.45, 4, (x, z, y) => cypress(b, r, x, y, z, r.range(2.4, 3.8), ctx));
        } else cursor = end;
        break;
      case "dawn":
        if (s.style !== "bridge" && s.style !== "plinth") {
          if (roll < 0.25) ok = placeBehind(0.8, 3, (x, z, y) => telescope(b, r, x, y + 0.3, z, r.range(0.8, 1.1), ctx));
          else if (roll < 0.45) ok = placeBehind(0.6, 2.5, (x, z, y) => armillary(b, x, y + 0.3, z, r.range(0.9, 1.2), ctx));
          else if (roll < 0.65) ok = placeBehind(0.4, 3.5, (x, z, y) => obelisk(b, x, y, z, r.range(2.2, 3.2), ctx, false));
          else ok = placeBehind(0.45, 4, (x, z, y) => cypress(b, r, x, y, z, r.range(2.6, 4.0), ctx));
        } else cursor = end;
        break;
    }
    if (!ok) break;
  }
  if (!far) frontDecor(b, s, r, ctx);
}

/** Carvings, ivy and hanging pieces on the front face, below the walking surface. */
function frontDecor(b: Buckets, s: Shape, r: Rng, ctx: Ctx) {
  const pal = ctx.pal;
  const front = s.z + s.d / 2;
  if ((s.style === "stone" || s.style === "ruin") && s.h > 0.9) {
    const n = Math.floor(s.w / 2.2);
    for (let i = 0; i < n; i++) {
      const x = s.x - s.w / 2 + ((i + 0.5) * s.w) / n;
      const y = s.y - 0.26 - (s.h - 0.26) * 0.5;
      b.metal.add(torus(0.17, 0.022, 4, 24), { m: xf(x, y, front + 0.02), color: pal.gold });
      b.metal.add(sphere(0.06, 8, 6), { m: xf(x, y, front + 0.02, 0, 0, 0, 1, 1, 0.4), color: pal.gold });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        b.metal.add(box(0.07, 0.016, 0.02), { m: xf(x + Math.cos(a) * 0.25, y + Math.sin(a) * 0.25, front + 0.02, 0, 0, a), color: pal.gold });
      }
    }
  }
  if (ctx.time === "afternoon" && s.style !== "bridge") {
    const n = Math.floor(s.w / 2.5) + 1;
    for (let i = 0; i < n; i++) chain(b, s.x + r.range(-0.45, 0.45) * s.w, s.y - s.h, s.z + r.range(-0.3, 0.3) * s.d, r.range(1, 2.6), ctx);
  }
  if (ctx.time === "dusk" && (s.style === "stone" || s.style === "ruin") && s.h > 0.9) {
    const n = Math.max(1, Math.floor(s.w / 3.2));
    const cols = [mixCol("#6b3f8f", pal.ink, 0.15), mixCol("#3f4f8f", pal.ink, 0.1), mixCol("#8f6a3f", pal.ink, 0.1)];
    for (let i = 0; i < n; i++) banner(b, r, s.x - s.w / 2 + ((i + 0.5) * s.w) / n + r.range(-0.3, 0.3), s.y - 0.08, front + 0.06, r.range(0.9, 1.5), ctx, r.pick(cols));
  }
  if (ctx.time === "dusk" && s.style !== "plinth") {
    const n = Math.max(1, Math.floor(s.w / 3));
    for (let i = 0; i < n; i++) hangingLantern(b, s.x + r.range(-0.45, 0.45) * s.w, s.y - s.h, s.z + s.d * 0.3, r.range(0.4, 1.2), ctx);
  }
  if (ctx.time === "night" && s.style !== "plinth") {
    const n = Math.max(1, Math.floor(s.w / 2.5));
    for (let i = 0; i < n; i++)
      crystals(b, r, s.x + r.range(-0.4, 0.4) * s.w, s.y - s.h - 0.6, s.z + r.range(-0.2, 0.3) * s.d, 0.6, ctx, new THREE.Color("#8fc8ff").multiplyScalar(0.8));
  }
}

/** Big, lit scenery for background islands: domes, towers, groves. */
export function landmark(b: Buckets, s: Shape, r: Rng, ctx: Ctx) {
  const t = ctx.time;
  const roll = r.next();
  const y = s.y;
  if (t === "noon" && roll < 0.45 && s.w > 5) {
    fountain(b, r, s.x, y, s.z, 1.3, ctx);
    cypress(b, r, s.x - s.w * 0.35, y, s.z - 0.5, r.range(3, 4.5), ctx);
    cypress(b, r, s.x + s.w * 0.35, y, s.z - 0.5, r.range(3, 4.5), ctx);
    return;
  }
  if ((t === "dawn" || t === "noon" || roll < 0.25) && s.w > 7) {
    dome(b, s.x + r.range(-0.2, 0.2) * s.w, y, s.z - s.d * 0.1, Math.min(s.w, s.d) * r.range(0.22, 0.3), ctx, t === "dusk" || t === "night" || t === "dawn");
    if (r.chance(0.7)) cypress(b, r, s.x + s.w * 0.35, y, s.z, r.range(3, 5), ctx);
    return;
  }
  if (t === "afternoon") {
    gearTower(b, r, s.x - s.w * 0.2, y, s.z, r.range(3, 5), ctx);
    clockPylon(b, r, s.x + s.w * 0.25, y, s.z, r.range(2.4, 3.4), ctx);
    return;
  }
  if (t === "dusk" && roll < 0.6) {
    for (let i = 0; i < 3; i++) bookshelf(b, r, s.x - s.w * 0.3 + i * 1.9, y, s.z, 1.6, r.range(2.6, 3.6), ctx);
    roundTree(b, r, s.x + s.w * 0.3, y, s.z + 0.5, 1.1, ctx, "wisteria");
    return;
  }
  if (t === "night" && roll < 0.6) {
    obelisk(b, s.x, y, s.z, r.range(3, 5), ctx, true);
    crystals(b, r, s.x + 1.2, y, s.z + 0.5, 2.0, ctx, new THREE.Color("#8fd8ff").multiplyScalar(0.9));
    return;
  }
  // A grove with a ruined colonnade.
  const n = r.int(2, 5);
  for (let i = 0; i < n; i++) {
    const x = s.x + r.range(-0.4, 0.4) * s.w,
      z = s.z + r.range(-0.3, 0.3) * s.d;
    if (r.chance(0.6)) cypress(b, r, x, y, z, r.range(2.8, 4.8), ctx);
    else roundTree(b, r, x, y, z, r.range(0.8, 1.2), ctx, t === "dusk" ? "wisteria" : "olive");
  }
  if (r.chance(0.6)) for (let i = 0; i < 3; i++) column(b, s.x - 1.5 + i * 1.5, y, s.z - s.d * 0.25, r.range(2, 3), 0.18, ctx, r.chance(0.5) ? 0.5 : 0, r);
}

export function blockersFor(level: Level, exclude: string): Blocker[] {
  const out: Blocker[] = [];
  for (const i of level.islands) {
    if (i.id === exclude) continue;
    const rx = i.motion?.axis === "x" ? i.motion.range : 0,
      rz = i.motion?.axis === "z" ? i.motion.range : 0;
    out.push({ x0: i.x - i.w / 2 - rx, x1: i.x + i.w / 2 + rx, z0: i.z - i.d / 2 - rz, z1: i.z + i.d / 2 + rz, y0: i.y - i.h, y1: i.y + 2 });
  }
  for (const w of level.walls) out.push({ x0: w.x - w.w / 2, x1: w.x + w.w / 2, z0: w.z - w.d / 2, z1: w.z + w.d / 2, y0: w.y, y1: w.y + w.h });
  for (const s of level.sentinels) out.push({ x0: s.x - 1.5, x1: s.x + 1.5, z0: s.z - 1.5, z1: s.z + 1.5, y0: s.y - 1, y1: s.y + 1 });
  for (const p of level.pickups) out.push({ x0: p.x - 0.5, x1: p.x + 0.5, z0: p.z - 0.5, z1: p.z + 0.5, y0: p.y - 0.5, y1: p.y + 0.5 });
  return out;
}
