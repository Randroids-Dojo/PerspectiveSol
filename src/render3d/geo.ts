import * as THREE from "three";
import { Rng, TAU } from "./util";

/**
 * Procedural geometry helpers and buckets that merge static pieces per
 * material so a whole chapter draws in a handful of calls.
 */

export type Paint = THREE.Color | ((p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void);
export type AddOpts = {
  m?: THREE.Matrix4;
  color?: Paint;
  /** Faceted: recompute per-face normals after transforming. */
  flat?: boolean;
  sway?: number | ((p: THREE.Vector3) => number);
  spin?: { pivot: THREE.Vector3; axis: THREE.Vector3; speed: number };
  /** World-mapped UVs for paving: called with the transformed position and normal. */
  uv?: (p: THREE.Vector3, n: THREE.Vector3) => [number, number];
};

const P = new THREE.Vector3();
const N = new THREE.Vector3();
const C = new THREE.Color();

type Chunk = {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  uv?: Float32Array;
  sway?: Float32Array;
  pivot?: Float32Array;
  axis?: Float32Array;
};

export class Bucket {
  private chunks: Chunk[] = [];
  vertices = 0;
  constructor(
    readonly name: string,
    readonly opts: { uv?: boolean; sway?: boolean; spin?: boolean } = {},
  ) {}

  add(g: THREE.BufferGeometry, o: AddOpts = {}) {
    let geo: THREE.BufferGeometry;
    if (g.index) {
      if (!o.flat && !g.attributes.normal) g.computeVertexNormals();
      geo = g.toNonIndexed();
    } else geo = g.clone();
    if (o.m) geo.applyMatrix4(o.m);
    if (o.flat || !geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position.array as Float32Array;
    const nor = geo.attributes.normal.array as Float32Array;
    const n = pos.length / 3;
    const col = new Float32Array(n * 3);
    const paint = o.color ?? new THREE.Color(1, 1, 1);
    const src = geo.attributes.color;
    for (let i = 0; i < n; i++) {
      if (typeof paint === "function") {
        P.fromArray(pos, i * 3);
        N.fromArray(nor, i * 3);
        C.setRGB(1, 1, 1);
        paint(P, N, C);
      } else C.copy(paint);
      if (src) C.multiply(new THREE.Color().fromBufferAttribute(src as THREE.BufferAttribute, i));
      col[i * 3] = C.r;
      col[i * 3 + 1] = C.g;
      col[i * 3 + 2] = C.b;
    }
    const chunk: Chunk = { pos: new Float32Array(pos), nor: new Float32Array(nor), col };
    if (this.opts.uv) {
      const uv = new Float32Array(n * 2);
      const srcUv = geo.attributes.uv;
      for (let i = 0; i < n; i++) {
        if (o.uv) {
          P.fromArray(pos, i * 3);
          N.fromArray(nor, i * 3);
          const [u, v] = o.uv(P, N);
          uv[i * 2] = u;
          uv[i * 2 + 1] = v;
        } else if (srcUv) {
          uv[i * 2] = srcUv.getX(i);
          uv[i * 2 + 1] = srcUv.getY(i);
        }
      }
      chunk.uv = uv;
    }
    if (this.opts.sway) {
      const sw = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        if (typeof o.sway === "function") {
          P.fromArray(pos, i * 3);
          sw[i] = o.sway(P);
        } else sw[i] = o.sway ?? 0;
      }
      chunk.sway = sw;
    }
    if (this.opts.spin) {
      const pv = new Float32Array(n * 4);
      const ax = new Float32Array(n * 3);
      const s = o.spin;
      for (let i = 0; i < n; i++) {
        if (s) {
          pv[i * 4] = s.pivot.x;
          pv[i * 4 + 1] = s.pivot.y;
          pv[i * 4 + 2] = s.pivot.z;
          pv[i * 4 + 3] = s.speed;
          ax[i * 3] = s.axis.x;
          ax[i * 3 + 1] = s.axis.y;
          ax[i * 3 + 2] = s.axis.z;
        } else ax[i * 3 + 1] = 1;
      }
      chunk.pivot = pv;
      chunk.axis = ax;
    }
    this.chunks.push(chunk);
    this.vertices += n;
    geo.dispose();
    return this;
  }

  get empty() {
    return this.vertices === 0;
  }

  build(): THREE.BufferGeometry | null {
    if (!this.vertices) return null;
    const n = this.vertices;
    const out = new THREE.BufferGeometry();
    const cat = (key: keyof Chunk, size: number) => {
      const arr = new Float32Array(n * size);
      let o = 0;
      for (const c of this.chunks) {
        const a = c[key] as Float32Array;
        arr.set(a, o);
        o += a.length;
      }
      return new THREE.BufferAttribute(arr, size);
    };
    out.setAttribute("position", cat("pos", 3));
    out.setAttribute("normal", cat("nor", 3));
    out.setAttribute("color", cat("col", 3));
    if (this.opts.uv) out.setAttribute("uv", cat("uv", 2));
    if (this.opts.sway) out.setAttribute("sway", cat("sway", 1));
    if (this.opts.spin) {
      out.setAttribute("aPivot", cat("pivot", 4));
      out.setAttribute("aAxis", cat("axis", 3));
    }
    out.computeBoundingSphere();
    out.computeBoundingBox();
    this.chunks = [];
    return out;
  }
}

/** All buckets for one group of static meshes. */
export class Buckets {
  matte = new Bucket("matte");
  paving = new Bucket("paving", { uv: true });
  ruin = new Bucket("ruin", { uv: true });
  foliage = new Bucket("foliage", { sway: true });
  metal = new Bucket("metal", { spin: true });
  glow = new Bucket("glow");
  glass = new Bucket("glass");
  list() {
    return [this.matte, this.paving, this.ruin, this.foliage, this.metal, this.glow, this.glass];
  }
}

// ---------------------------------------------------------------- transforms

const E = new THREE.Euler();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const T = new THREE.Vector3();
export function xf(
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
) {
  E.set(rx, ry, rz, "YXZ");
  Q.setFromEuler(E);
  return new THREE.Matrix4().compose(T.set(x, y, z), Q, S.set(sx, sy, sz));
}
/** Orient +y along a direction and place at a point. */
export function along(from: THREE.Vector3, dir: THREE.Vector3, scale = 1) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return new THREE.Matrix4().compose(from, q, S.set(scale, scale, scale));
}

// ---------------------------------------------------------------- primitives

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** Box standing on y = 0. */
export const boxB = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
/** Cylinder or cone standing on y = 0. */
export const cylB = (rt: number, rb: number, h: number, seg = 10, open = false) =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(0, h / 2, 0);
export const sphere = (r: number, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
export const ico = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
export const torus = (R: number, r: number, rs = 6, ts = 24, arc = TAU) => new THREE.TorusGeometry(R, r, rs, ts, arc);
export const lathe = (pts: [number, number][], seg = 12) =>
  new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)),
    seg,
  );

/** A tapering tube along a polyline; r(t) gives the radius at t in [0, 1]. */
export function tube(points: THREE.Vector3[], r: (t: number) => number, radial = 5) {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = Math.max(2, points.length * 3);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const rad = r(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const nx = frames.normals[i],
        bx = frames.binormals[i];
      pos.push(
        c.x + (Math.cos(a) * nx.x + Math.sin(a) * bx.x) * rad,
        c.y + (Math.cos(a) * nx.y + Math.sin(a) * bx.y) * rad,
        c.z + (Math.cos(a) * nx.z + Math.sin(a) * bx.z) * rad,
      );
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j,
        b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A lumpy faceted blob, for canopies, shrubs and rocks. */
export function blob(r: number, rng: Rng, lump = 0.22, detail = 1, squash = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let s = seen.get(k);
    if (s === undefined) {
      s = 1 + (rng.next() - 0.5) * 2 * lump;
      seen.set(k, s);
    }
    p.setXYZ(i, x * s, y * s * squash, z * s);
  }
  g.computeVertexNormals();
  return g;
}

/** Points evenly spaced around a rounded rectangle (x, z), counter-clockwise seen from above. */
export function roundedRing(w: number, d: number, rc: number, spacing: number): [number, number][] {
  rc = Math.max(0.001, Math.min(rc, w / 2 - 0.001, d / 2 - 0.001));
  const hx = w / 2 - rc,
    hy = d / 2 - rc;
  const arc = (Math.PI / 2) * rc;
  const segs: [number, (u: number) => [number, number]][] = [
    [2 * hy, (u) => [w / 2, -hy + u]],
    [arc, (u) => [hx + rc * Math.cos(u / rc), hy + rc * Math.sin(u / rc)]],
    [2 * hx, (u) => [hx - u, d / 2]],
    [arc, (u) => [-hx + rc * Math.cos(Math.PI / 2 + u / rc), hy + rc * Math.sin(Math.PI / 2 + u / rc)]],
    [2 * hy, (u) => [-w / 2, hy - u]],
    [arc, (u) => [-hx + rc * Math.cos(Math.PI + u / rc), -hy + rc * Math.sin(Math.PI + u / rc)]],
    [2 * hx, (u) => [-hx + u, -d / 2]],
    [arc, (u) => [hx + rc * Math.cos(1.5 * Math.PI + u / rc), -hy + rc * Math.sin(1.5 * Math.PI + u / rc)]],
  ];
  const per = segs.reduce((a, s) => a + s[0], 0);
  const n = Math.max(16, Math.round(per / spacing));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let s = (i / n) * per;
    let pt: [number, number] | null = null;
    for (const [len, f] of segs) {
      if (s <= len) {
        pt = f(s);
        break;
      }
      s -= len;
    }
    pt ??= segs[segs.length - 1][1](segs[segs.length - 1][0]);
    // Plane Y maps to -z so the ring runs counter-clockwise seen from +y.
    out.push([pt[0], -pt[1]]);
  }
  return out;
}

/** A flat polygon (fan from centre) in the XZ plane at height y, facing +y. */
export function capFan(ring: [number, number][], y: number, cx = 0, cz = 0) {
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    pos.push(cx, y, cz, b[0], y, b[1], a[0], y, a[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // Fan winding: make sure normals point up.
  const nrm = g.attributes.normal;
  if (nrm.getY(0) < 0) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i + 1),
        yy = p.getY(i + 1),
        z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, yy, z);
    }
    g.computeVertexNormals();
  }
  return g;
}

/**
 * Stitch a stack of rings (same point count) into a side wall. rings[k] is a
 * list of 3D points; faces wind outward when the rings run counter-clockwise
 * from above and go downward.
 */
export function stitch(rings: THREE.Vector3[][], closeBottom?: THREE.Vector3) {
  const pos: number[] = [];
  const push = (v: THREE.Vector3) => pos.push(v.x, v.y, v.z);
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k],
      B = rings[k + 1];
    const n = A.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      push(A[i]);
      push(B[i]);
      push(A[j]);
      push(A[j]);
      push(B[i]);
      push(B[j]);
    }
  }
  if (closeBottom) {
    const A = rings[rings.length - 1];
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      push(A[i]);
      push(closeBottom);
      push(A[j]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Flip triangle winding if the average normal points the wrong way relative to a probe direction. */
export function orientOutward(g: THREE.BufferGeometry, centre: THREE.Vector3) {
  const p = g.attributes.position as THREE.BufferAttribute;
  let score = 0;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    n = new THREE.Vector3(),
    m = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    m.copy(a).add(b).add(c).divideScalar(3).sub(centre);
    m.y = 0;
    score += Math.sign(n.dot(m));
  }
  if (score < 0)
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i + 1),
        y = p.getY(i + 1),
        z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
  return g;
}

/** A 2D outline (x, y) extruded along z by depth, centred on z = 0. */
export function extrude(shape: THREE.Shape, depth: number, bevel = 0, curveSegments = 10) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A gear: toothed disc in the XY plane, facing +z, centred at the origin. */
export function gear(r: number, teeth: number, thick: number, hole = 0.35) {
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const tooth = i % 4 < 2 ? 1 : 0.86;
    const x = Math.cos(a) * r * tooth,
      y = Math.sin(a) * r * tooth;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  if (hole > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, r * hole, 0, TAU, true);
    s.holes.push(h);
    // Spoke windows.
    const spokes = r > 0.5 ? (teeth > 14 ? 6 : 4) : 0;
    for (let k = 0; k < spokes; k++) {
      const a0 = (k / spokes) * TAU + 0.25,
        a1 = ((k + 1) / spokes) * TAU - 0.25;
      const w = new THREE.Path();
      const r0 = r * (hole + 0.12),
        r1 = r * 0.68;
      w.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
      w.absarc(0, 0, r1, a0, a1, false);
      w.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
      w.absarc(0, 0, r0, a1, a0, true);
      s.holes.push(w);
    }
  }
  return extrude(s, thick, r > 0.5 ? Math.min(0.02, thick * 0.2) : 0, 4);
}
