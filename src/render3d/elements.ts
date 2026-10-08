import * as THREE from "three";
import type { Game } from "../sim/game";
import type { Checkpoint, Island, Lantern, Level, Pickup, Sentinel, Wall } from "../sim/types";
import { CROSS } from "../view";
import type { Effects } from "./effects";
import { Buckets, box, boxB, cylB, extrude, lathe, sphere, torus, xf } from "./geo";
import { type Ctx, buildIsland, spire } from "./islands";
import { type Mats, cloneSol } from "./materials";
import type { Mood } from "./mood";
import { dome } from "./props";
import { Rng, TAU, clamp, hashString, mixCol, smooth } from "./util";

/**
 * Everything that moves or changes state: moving plinths, lantern bridges,
 * star bridges, sunglass prisms, walls, lanterns, sentinels, seeds, motes,
 * checkpoints and the observatory.
 */

export type LightCandidate = { pos: THREE.Vector3; color: THREE.Color; intensity: number; range: number };

const DOT_VERT = /* glsl */ `
attribute float aPhase;
uniform float uTime;
uniform float uScale;
uniform float uSize;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  float tw = 0.55 + 0.45 * sin( uTime * 2.6 + aPhase * 6.2831 );
  vA = tw;
  gl_PointSize = uSize * ( 0.7 + 0.5 * tw ) * uScale / max( 0.5, -mv.z );
}`;
const DOT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length( c ) * 2.0;
  if ( r > 1.0 ) discard;
  float a = exp( -r * r * 5.0 ) * vA * uAlpha;
  gl_FragColor = vec4( uColor * a, 1.0 );
}`;

function dotsMaterial(color: THREE.Color, size: number) {
  return new THREE.ShaderMaterial({
    vertexShader: DOT_VERT,
    fragmentShader: DOT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 600 },
      uSize: { value: size },
      uColor: { value: color.clone() },
      uAlpha: { value: 1 },
    },
  });
}

/** Dots along the edges of a box (and a sparse grid on its top), for unsolid promises. */
function boxDots(x: number, y: number, z: number, w: number, d: number, h: number, spacing: number, r: Rng) {
  const pts: number[] = [];
  const ph: number[] = [];
  const line = (a: THREE.Vector3, b: THREE.Vector3) => {
    const n = Math.max(1, Math.round(a.distanceTo(b) / spacing));
    for (let i = 0; i < n; i++) {
      const p = a.clone().lerp(b, i / n);
      pts.push(p.x, p.y, p.z);
      ph.push(r.next());
    }
  };
  const x0 = x - w / 2,
    x1 = x + w / 2,
    z0 = z - d / 2,
    z1 = z + d / 2,
    y1 = y,
    y0 = y - h;
  const c = (xx: number, yy: number, zz: number) => new THREE.Vector3(xx, yy, zz);
  for (const yy of [y0, y1]) {
    line(c(x0, yy, z0), c(x1, yy, z0));
    line(c(x1, yy, z0), c(x1, yy, z1));
    line(c(x1, yy, z1), c(x0, yy, z1));
    line(c(x0, yy, z1), c(x0, yy, z0));
  }
  for (const [xx, zz] of [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ])
    line(c(xx, y0, zz), c(xx, y1, zz));
  // Sparse top grid.
  const gx = Math.max(1, Math.round(w / (spacing * 3))),
    gz = Math.max(1, Math.round(d / (spacing * 3)));
  for (let i = 1; i < gx; i++)
    for (let k = 1; k < gz + (gz === 1 ? 1 : 0); k++) {
      pts.push(x0 + (i * w) / gx, y1, gz === 1 ? z : z0 + (k * d) / gz);
      ph.push(r.next());
    }
  return { pts, ph };
}

type Mover = { island: Island; group: THREE.Group };
type LanternBridge = { island: Island; group: THREE.Group; uniform: { value: number }; dots: THREE.Points; dotMat: THREE.ShaderMaterial; mats: THREE.Material[]; was: number };
type Prism = { island: Island; group: THREE.Group; mat: THREE.MeshStandardMaterial; edgeMat: THREE.LineBasicMaterial; core: THREE.Mesh };
type Gate = { wall: Wall; group: THREE.Group; mats: THREE.Material[]; emblem: THREE.Mesh; was: number };
type LanternV = { l: Lantern; flame: THREE.Mesh; lit: number; seed: number };
type SentinelV = { s: Sentinel; group: THREE.Group; eye: THREE.Group; rings: THREE.Mesh[]; trail: number };
type SeedV = { p: Pickup; group: THREE.Group; crystal: THREE.Mesh; ring: THREE.Mesh; phase: number };
type CheckV = { c: Checkpoint; mesh: THREE.Mesh; lit: boolean; t: number };

export class Elements {
  group = new THREE.Group();
  private movers: Mover[] = [];
  private bridges: LanternBridge[] = [];
  private prisms: Prism[] = [];
  private gates: Gate[] = [];
  private lanterns: LanternV[] = [];
  private sentinels: SentinelV[] = [];
  private seeds: SeedV[] = [];
  private motes: { p: Pickup; index: number; phase: number }[] = [];
  private moteMesh: THREE.InstancedMesh | null = null;
  private checks: CheckV[] = [];
  private starBridges: { island: Island; group: THREE.Group; glyph: THREE.LineSegments }[] = [];
  private starMat: THREE.ShaderMaterial | null = null;
  private glyphMat: THREE.LineBasicMaterial | null = null;
  private exit: {
    pos: THREE.Vector3;
    rings: THREE.Mesh[];
    core: THREE.Mesh;
    sockets: THREE.Mesh[];
    awake: number;
    beam: number;
    sphere: THREE.Group;
  } | null = null;
  private disposables: { dispose(): void }[] = [];
  private level: Level | null = null;
  private moteDummy = new THREE.Object3D();

  constructor(private mats: Mats) {}

  private mesh(g: THREE.BufferGeometry | null, m: THREE.Material, parent: THREE.Object3D, cast = true) {
    if (!g) return null;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    this.disposables.push(g);
    return mesh;
  }

  /** Build dynamic elements; static parts (sunwalls, rocks, lantern posts, observatory stone) go into `stat`. */
  build(level: Level, ctx: Ctx, stat: Buckets) {
    this.level = level;
    const pal = ctx.pal;
    const M = this.mats;
    const seedR = new Rng(level.theme.seed * 7919 + 13);

    // Moving islands: plinths that carry their own geometry.
    for (const i of level.islands) {
      if (i.only || !(i.motion || i.lantern)) continue;
      if (i.motion) {
        const g = new THREE.Group();
        const b = new Buckets();
        buildIsland(b, { id: i.id, x: 0, y: 0, z: 0, w: i.w, d: i.d, h: i.h, style: "plinth" }, new Rng(hashString(i.id) + level.theme.seed), ctx);
        this.mesh(b.paving.build(), M.paving, g);
        this.mesh(b.metal.build(), M.metal, g);
        this.mesh(b.matte.build(), M.matte, g);
        this.mesh(b.glow.build(), M.glow, g, false);
        g.position.set(i.x, i.y, i.z);
        this.group.add(g);
        this.movers.push({ island: i, group: g });
      } else {
        // Lantern bridge: a promise of dots until lit, then rises into place.
        const g = new THREE.Group();
        const b = new Buckets();
        buildIsland(b, { id: i.id, x: i.x, y: i.y, z: i.z, w: i.w, d: i.d, h: i.h, style: i.style }, new Rng(hashString(i.id) + level.theme.seed), ctx, {
          depth: Math.min(2.4, 0.6 * Math.min(i.w, i.d) + 0.6),
        });
        const l = level.lanterns.find((v) => v.id === i.lantern);
        const fromLeft = !l || l.x <= i.x;
        const uniform = { value: 0 };
        const am = M.assembling(uniform);
        const seg = (geo: THREE.BufferGeometry | null) => {
          if (!geo) return null;
          const p = geo.attributes.position as THREE.BufferAttribute;
          const s = new Float32Array(p.count);
          for (let k = 0; k < p.count; k++) {
            const t = clamp((p.getX(k) - (i.x - i.w / 2)) / i.w, 0, 1);
            s[k] = fromLeft ? t : 1 - t;
          }
          geo.setAttribute("sway", new THREE.BufferAttribute(s, 1));
          return geo;
        };
        this.mesh(seg(b.paving.build()), am.paving, g);
        this.mesh(seg(b.metal.build()), am.metal, g);
        this.mesh(seg(b.matte.build()), am.matte, g);
        // Ruin tops would need their own copy; bridges use paving.
        const ruin = seg(b.ruin.build());
        if (ruin) this.mesh(ruin, am.paving, g);
        const { pts, ph } = boxDots(i.x, i.y, i.z, i.w, i.d, i.h, 0.24, seedR);
        const dg = new THREE.BufferGeometry();
        dg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        dg.setAttribute("aPhase", new THREE.Float32BufferAttribute(ph, 1));
        const dm = dotsMaterial(new THREE.Color("#ffc46a").multiplyScalar(1.6), 0.12);
        const dots = new THREE.Points(dg, dm);
        dots.frustumCulled = false;
        dots.renderOrder = 19;
        g.add(dots);
        this.disposables.push(dg, dm, am.paving, am.metal, am.matte);
        this.group.add(g);
        this.bridges.push({ island: i, group: g, uniform, dots, dotMat: dm, mats: [am.paving, am.metal, am.matte], was: -1 });
      }
    }

    // Star bridges (2D only): shimmering dotted outlines with a fold glyph.
    {
      const stars = level.islands.filter((i) => i.only === "2d");
      if (stars.length) {
        this.starMat = dotsMaterial(new THREE.Color("#fff2c8").multiplyScalar(1.4), 0.11);
        this.glyphMat = new THREE.LineBasicMaterial({ color: new THREE.Color("#fff0c0").multiplyScalar(2), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
        this.disposables.push(this.starMat, this.glyphMat);
      }
      for (const i of stars) {
        const g = new THREE.Group();
        const d = boxDots(0, 0, 0, i.w, i.d, i.h, 0.2, seedR);
        const pg = new THREE.BufferGeometry();
        pg.setAttribute("position", new THREE.Float32BufferAttribute(d.pts, 3));
        pg.setAttribute("aPhase", new THREE.Float32BufferAttribute(d.ph, 1));
        const dots = new THREE.Points(pg, this.starMat!);
        dots.frustumCulled = false;
        dots.renderOrder = 19;
        // Fold glyph: a square with a folded corner, floating above the centre.
        const gs = 0.22,
          gy = 0.75;
        const sq: [number, number][] = [
          [-gs, -gs],
          [gs, -gs],
          [gs, gs * 0.2],
          [gs * 0.2, gs],
          [-gs, gs],
        ];
        const glyph: number[] = [];
        for (let k = 0; k < sq.length; k++) {
          const a = sq[k],
            b = sq[(k + 1) % sq.length];
          glyph.push(a[0], gy + a[1], 0, b[0], gy + b[1], 0);
        }
        glyph.push(gs, gy + gs * 0.2, 0, gs * 0.2, gy + gs * 0.2, 0, gs * 0.2, gy + gs * 0.2, 0, gs * 0.2, gy + gs, 0);
        const lg = new THREE.BufferGeometry();
        lg.setAttribute("position", new THREE.Float32BufferAttribute(glyph, 3));
        const lines = new THREE.LineSegments(lg, this.glyphMat!);
        lines.frustumCulled = false;
        g.add(dots, lines);
        g.position.set(i.x, i.y, i.z);
        this.group.add(g);
        this.disposables.push(pg, lg);
        this.starBridges.push({ island: i, group: g, glyph: lines });
      }
    }

    // Sunglass prisms (3D only): warm crystal with a bright rim and inner glow.
    for (const i of level.islands) {
      if (i.only !== "3d") continue;
      const g = new THREE.Group();
      // A chamfered slab so the facets catch the light.
      const bev = Math.min(0.1, i.h * 0.22, i.w * 0.1);
      const sh = new THREE.Shape();
      sh.moveTo(-i.w / 2 + bev, -i.d / 2 + bev);
      sh.lineTo(i.w / 2 - bev, -i.d / 2 + bev);
      sh.lineTo(i.w / 2 - bev, i.d / 2 - bev);
      sh.lineTo(-i.w / 2 + bev, i.d / 2 - bev);
      sh.lineTo(-i.w / 2 + bev, -i.d / 2 + bev);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: i.h - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 1 });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, -bev, 0);
      geo.computeBoundingBox();
      const cg = geo.toNonIndexed();
      cg.computeVertexNormals();
      const cc = new Float32Array(cg.attributes.position.count * 3);
      const pp = cg.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pp.count; k++) {
        const t = clamp(-pp.getY(k) / i.h, 0, 1);
        const c = new THREE.Color("#ffe2b0").lerp(new THREE.Color("#ff9e3a"), t * 0.7);
        cc.set([c.r, c.g, c.b], k * 3);
      }
      cg.setAttribute("color", new THREE.BufferAttribute(cc, 3));
      const mat = cloneSol(M.crystal);
      const crystal = new THREE.Mesh(cg, mat);
      crystal.receiveShadow = true;
      crystal.renderOrder = 10;
      g.add(crystal);
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(Math.min(i.w, i.d, i.h * 2) * 0.34, 0).scale(1.4, 0.55, 1.4), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb85a").multiplyScalar(2.6), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
      core.position.y = -i.h / 2;
      g.add(core);
      const edges = new THREE.EdgesGeometry(geo, 15);
      const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color("#ffe2a8").multiplyScalar(3), transparent: true, depthWrite: false });
      g.add(new THREE.LineSegments(edges, edgeMat));
      // Shards beneath.
      const r = new Rng(hashString(i.id));
      const shards = new Buckets();
      for (let k = 0; k < 4; k++) {
        const sh = new THREE.OctahedronGeometry(r.range(0.08, 0.16), 0).scale(1, 2.2, 1);
        shards.glow.add(sh, { m: xf(r.range(-0.4, 0.4) * i.w, -i.h - r.range(0.3, 0.9), r.range(-0.4, 0.4) * i.d, r.range(-0.3, 0.3), r.range(0, 3), 0), color: new THREE.Color("#ffbf70").multiplyScalar(2), flat: true });
      }
      this.mesh(shards.glow.build(), M.glow, g, false);
      g.position.set(i.x, i.y, i.z);
      this.group.add(g);
      this.disposables.push(geo, cg, edges, mat, edgeMat, core.geometry, core.material as THREE.Material);
      this.prisms.push({ island: i, group: g, mat, edgeMat, core });
    }

    // Walls.
    for (const w of level.walls) {
      if (w.kind === "sunwall") sunwall(stat, w, ctx);
      else if (w.kind === "rock") spire(stat, w, new Rng(hashString(w.id)), ctx);
      else {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -w.y + 0.002);
        const cm = M.clipped(plane);
        const b = new Buckets();
        gate(b, w, ctx);
        const g = new THREE.Group();
        this.mesh(b.paving.build(), cm.stone, g);
        this.mesh(b.metal.build(), cm.metal, g);
        this.mesh(b.matte.build(), cm.matte, g);
        const emblemGeo = new THREE.CircleGeometry(0.3, 24);
        const emblem = new THREE.Mesh(emblemGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffcf6a").multiplyScalar(0.25), clippingPlanes: [plane], side: THREE.DoubleSide }));
        const ex = w.w / 2 + 0.035;
        emblem.position.set(w.x - ex, w.y + w.h * 0.55, w.z);
        emblem.rotation.y = -Math.PI / 2;
        const emblem2 = emblem.clone();
        emblem2.position.x = w.x + ex;
        emblem2.rotation.y = Math.PI / 2;
        const emblem3 = emblem.clone();
        emblem3.position.set(w.x, w.y + w.h * 0.55, w.z + w.d / 2 + 0.035);
        emblem3.rotation.y = 0;
        g.add(emblem, emblem2, emblem3);
        this.group.add(g);
        this.disposables.push(cm.stone, cm.metal, cm.matte, emblemGeo, emblem.material as THREE.Material);
        this.gates.push({ wall: w, group: g, mats: [cm.stone, cm.metal, cm.matte], emblem, was: -1 });
      }
    }

    // Lanterns: posts are static, flames are live.
    const flameGeo = (() => {
      const g = lathe(
        [
          [0.001, 0],
          [0.05, 0.03],
          [0.065, 0.08],
          [0.045, 0.15],
          [0.001, 0.24],
        ],
        8,
      );
      return g;
    })();
    this.disposables.push(flameGeo);
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffbe5c").multiplyScalar(5) });
    this.disposables.push(flameMat);
    for (const l of level.lanterns) {
      lanternPost(stat, l, ctx);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(l.x, l.y + 1.13, l.z);
      this.group.add(flame);
      this.lanterns.push({ l, flame, lit: 0, seed: hashString(l.id) % 100 });
    }

    // Sentinels.
    const eyeGeo = new THREE.IcosahedronGeometry(1, 0);
    const irisGeo = new THREE.TorusGeometry(0.34, 0.07, 6, 20);
    const pupilGeo = new THREE.SphereGeometry(0.2, 12, 8).scale(1, 1, 0.4);
    const ringA = spikedRing(1.25, 0.05, 10);
    const ringB = spikedRing(1.5, 0.04, 14);
    const irisMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff6f8a").multiplyScalar(3.5) });
    const pupilMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#12040a") });
    this.disposables.push(eyeGeo, irisGeo, pupilGeo, ringA, ringB, irisMat, pupilMat);
    for (const s of level.sentinels) {
      const g = new THREE.Group();
      const eye = new THREE.Group();
      const core = new THREE.Mesh(eyeGeo, M.sentinel);
      core.scale.set(0.62, 0.62, 0.5);
      const iris = new THREE.Mesh(irisGeo, irisMat);
      iris.position.z = 0.36;
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.z = 0.33;
      eye.add(core, iris, pupil);
      eye.scale.setScalar(s.r);
      const r1 = new THREE.Mesh(ringA, M.sentinelRing);
      const r2 = new THREE.Mesh(ringB, M.sentinelRing);
      r1.scale.setScalar(s.r);
      r2.scale.setScalar(s.r);
      g.add(eye, r1, r2);
      g.position.set(s.x, s.y, s.z);
      this.group.add(g);
      this.sentinels.push({ s, group: g, eye, rings: [r1, r2], trail: 0 });
    }

    // Seeds and motes.
    const seedGeo = (() => {
      // A faceted seed: a tall central crystal with two small companions.
      const b = new Buckets();
      b.matte.add(new THREE.OctahedronGeometry(0.26, 0).scale(1, 1.75, 1), { flat: true });
      b.matte.add(new THREE.OctahedronGeometry(0.11, 0).scale(1, 1.8, 1), { m: xf(0.2, -0.12, 0.05, 0, 0, -0.5), flat: true });
      b.matte.add(new THREE.OctahedronGeometry(0.09, 0).scale(1, 1.8, 1), { m: xf(-0.17, -0.16, -0.06, 0, 0, 0.55), flat: true });
      const g = b.matte.build()!;
      g.deleteAttribute("color");
      return g;
    })();
    const seedRing = new THREE.TorusGeometry(0.56, 0.022, 4, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd67a").multiplyScalar(3.2) });
    this.disposables.push(seedGeo, seedRing, ringMat);
    const motes = level.pickups.filter((p) => p.kind === "mote");
    if (motes.length) {
      const mg = new THREE.IcosahedronGeometry(0.075, 1);
      this.moteMesh = new THREE.InstancedMesh(mg, new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff1c8").multiplyScalar(2.6) }), motes.length);
      this.moteMesh.frustumCulled = false;
      this.group.add(this.moteMesh);
      this.disposables.push(mg, this.moteMesh.material as THREE.Material);
    }
    let mi = 0;
    for (const p of level.pickups) {
      if (p.kind === "mote") {
        this.motes.push({ p, index: mi++, phase: seedR.range(0, TAU) });
        continue;
      }
      const g = new THREE.Group();
      const crystal = new THREE.Mesh(seedGeo, M.seed);
      const ring = new THREE.Mesh(seedRing, ringMat);
      ring.rotation.x = Math.PI / 2 - 0.35;
      const ring2 = new THREE.Mesh(seedRing, ringMat);
      ring2.scale.setScalar(0.78);
      ring.add(ring2);
      ring2.rotation.set(0.9, 0.4, 0);
      g.add(crystal, ring);
      this.group.add(g);
      this.seeds.push({ p, group: g, crystal, ring, phase: seedR.range(0, TAU) });
    }

    // Checkpoints: sundial rings inlaid in the floor.
    const dial = sundialGeometry();
    this.disposables.push(dial);
    for (const c of level.checkpoints) {
      const mesh = new THREE.Mesh(dial, M.cpDull);
      mesh.position.set(c.x, c.y + 0.006, c.z);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.checks.push({ c, mesh, lit: false, t: 9 });
    }

    // The observatory.
    {
      const e = level.exit;
      const pos = new THREE.Vector3(e.x, e.y, e.z);
      const exitIsland = level.islands.find((i) => i.id === e.island);
      const back = exitIsland ? exitIsland.z - exitIsland.d / 2 : e.z - 3;
      // Dais.
      stat.paving.add(cylB(1.45, 1.5, 0.08, 40), { m: xf(e.x, e.y - 0.02, e.z), color: mixCol(pal.stone, "#ffffff", 0.1), uv: (p) => [p.x / 2.4, p.z / 2.4] });
      stat.metal.add(torus(1.32, 0.03, 4, 64), { m: xf(e.x, e.y + 0.062, e.z, Math.PI / 2, 0, 0, 1, 1, 0.3), color: pal.gold });
      stat.metal.add(torus(0.7, 0.025, 4, 48), { m: xf(e.x, e.y + 0.062, e.z, Math.PI / 2, 0, 0, 1, 1, 0.3), color: pal.gold });
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU;
        stat.metal.add(box(k % 4 === 0 ? 0.42 : 0.22, 0.01, 0.035), { m: xf(e.x + Math.cos(a) * 1.0, e.y + 0.062, e.z + Math.sin(a) * 1.0, 0, -a, 0), color: pal.gold });
      }
      // The domed observatory behind.
      const dz = Math.max(back + 0.6, e.z - 2.9);
      dome(stat, e.x, e.y, dz - 0.6, 1.3, ctx, true);
      // Sockets on short pedestals at the back of the dais.
      const sockets: THREE.Mesh[] = [];
      const sockGeo = new THREE.OctahedronGeometry(0.11, 0).scale(1, 1.5, 1);
      this.disposables.push(sockGeo);
      for (let k = 0; k < 3; k++) {
        const sx = e.x + (k - 1) * 0.62,
          sz = e.z - 1.05 + Math.abs(k - 1) * 0.12;
        stat.matte.add(
          lathe(
            [
              [0.001, 0],
              [0.14, 0],
              [0.14, 0.05],
              [0.07, 0.1],
              [0.06, 0.38],
              [0.15, 0.46],
              [0.16, 0.5],
              [0.001, 0.48],
            ],
            12,
          ),
          { m: xf(sx, e.y, sz), color: mixCol(pal.stone, pal.stoneShade, 0.15) },
        );
        stat.metal.add(torus(0.15, 0.02, 4, 20), { m: xf(sx, e.y + 0.5, sz, Math.PI / 2, 0, 0), color: pal.gold });
        const m = new THREE.Mesh(sockGeo, M.socketEmpty);
        m.position.set(sx, e.y + 0.66, sz);
        this.group.add(m);
        sockets.push(m);
      }
      // The armillary sphere floats high above the dais.
      const sphereG = new THREE.Group();
      const rings: THREE.Mesh[] = [];
      for (const [R, rx, rz] of [
        [0.95, 0, 0],
        [0.85, Math.PI / 2, 0.3],
        [0.75, 0.8, -0.6],
      ] as [number, number, number][]) {
        const tg = new THREE.TorusGeometry(R, 0.035, 6, 64);
        const m = new THREE.Mesh(tg, M.cpDull);
        m.rotation.set(rx, 0, rz);
        sphereG.add(m);
        rings.push(m);
        this.disposables.push(tg);
      }
      const coreG = new THREE.IcosahedronGeometry(0.22, 2);
      const core = new THREE.Mesh(coreG, M.socketEmpty);
      sphereG.add(core);
      this.disposables.push(coreG);
      sphereG.position.set(e.x, e.y + 3.4, e.z - 0.3);
      this.group.add(sphereG);
      // Bronze meridian arc holding the sphere from the dome side.
      stat.metal.add(torus(1.15, 0.04, 5, 40, Math.PI), { m: xf(e.x, e.y + 3.4, e.z - 0.3, 0, Math.PI / 2, 0), color: pal.bronze });
      stat.metal.add(cylB(0.05, 0.08, 2.3, 8), { m: xf(e.x, e.y + 0.0, e.z - 1.45), color: pal.bronze });
      stat.metal.add(torus(0.75, 0.035, 4, 30, Math.PI / 2), { m: xf(e.x, e.y + 2.25, e.z - 0.7, 0, Math.PI / 2, Math.PI), color: pal.bronze });
      this.exit = { pos, rings, core, sockets, awake: 0, beam: 0, sphere: sphereG };
    }
  }

  get lanternsLit() {
    return this.lanterns;
  }

  /** Per-frame update. Returns light candidates for the pooled point lights. */
  update(game: Game, dt: number, t: number, fold: number, effects: Effects, keeperPos: THREE.Vector3, mood: Mood, lights: LightCandidate[], reduced = false) {
    const halos = effects.halos;
    const calm = reduced ? 0.35 : 1;
    const foldE = smooth(0, CROSS, fold);
    for (const m of this.movers) {
      const p = game.islandPosition(m.island);
      m.group.position.set(p.x, p.y, p.z);
    }
    for (const b of this.bridges) {
      const pres = game.islandPresence(b.island);
      const prog = game.lanternProgress(b.island.lantern);
      b.uniform.value = prog;
      b.group.children.forEach((c) => {
        if (c !== b.dots) c.visible = prog > 0.001;
      });
      b.dotMat.uniforms.uTime.value = t;
      b.dotMat.uniforms.uAlpha.value = (1 - pres) * (0.75 + 0.25 * Math.sin(t * 2));
      b.dots.visible = pres < 0.999;
      if (prog > 0 && prog < 1 && dt > 0) {
        const i = b.island;
        const l = this.level!.lanterns.find((v) => v.id === i.lantern);
        const fromLeft = !l || l.x <= i.x;
        const k = clamp(prog * 1.6 - 0.2, 0, 1);
        const fx = fromLeft ? i.x - i.w / 2 + i.w * k : i.x + i.w / 2 - i.w * k;
        for (let n = 0; n < 2; n++)
          effects.sparks.spawn({ x: fx, y: i.y - Math.random() * 0.3, z: i.z + (Math.random() - 0.5) * i.d, vx: (Math.random() - 0.5) * 0.6, vy: Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.6, life: 0.7, size: 0.13, size1: 0.02, color: new THREE.Color("#ffd27a").multiplyScalar(2.2), drag: 2 });
        if (Math.random() < 0.4) effects.puff(fx, i.y - i.h, i.z, 1, new THREE.Color(mood.time === "night" ? "#6b7690" : "#d9ccb8"), 0.4);
      }
    }
    if (this.starMat && this.glyphMat) {
      this.starMat.uniforms.uTime.value = t;
      // Star bridges brighten as the world folds toward the flat view where they are solid.
      this.starMat.uniforms.uAlpha.value = 0.55 + 0.9 * foldE;
      this.starMat.uniforms.uSize.value = 0.11 + 0.08 * foldE;
      this.glyphMat.opacity = (0.55 + 0.25 * Math.sin(t * 2.4)) * (1 - foldE * 0.5);
      for (const sb of this.starBridges) {
        const p = game.islandPosition(sb.island);
        sb.group.position.set(p.x, p.y, p.z);
        sb.glyph.position.y = Math.sin(t * 1.6 + p.x) * 0.05;
      }
    }
    for (const p of this.prisms) {
      const pos = game.islandPosition(p.island);
      p.group.position.set(pos.x, pos.y, pos.z);
      const ghost = foldE;
      p.mat.opacity = 0.72 * (1 - ghost * 0.65);
      p.mat.emissiveIntensity = 0.35 + 0.15 * Math.sin(t * 1.7 + pos.x);
      p.edgeMat.opacity = 1 - ghost * 0.5;
      p.core.rotation.y = t * 0.6;
      (p.core.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - ghost * 0.6);
      halos.add(pos.x, pos.y - p.island.h / 2, pos.z, new THREE.Color("#ffb45a"), Math.max(p.island.w, p.island.d) * 1.4, 0.35 * (1 - ghost));
    }
    for (const g of this.gates) {
      const h = game.wallHeight(g.wall);
      const sink = g.wall.h - h;
      g.group.position.y = -sink;
      const prog = game.lanternProgress(g.wall.lantern);
      (g.emblem.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.78, 0.38).multiplyScalar(0.25 + 3.2 * Math.min(1, prog * 4));
      g.group.visible = h > 0.02;
      for (const c of g.group.children) if ((c as THREE.Mesh).geometry?.type === "CircleGeometry") c.visible = prog > 0;
      if (prog > 0 && prog < 1 && dt > 0) {
        const w = g.wall;
        for (let n = 0; n < 3; n++)
          effects.puff(w.x + (Math.random() - 0.5) * w.w * 1.6, w.y, w.z + (Math.random() - 0.5) * w.d, 1, new THREE.Color(mood.time === "night" ? "#5d6a85" : "#d8ccb6"), 0.9, { vy: Math.random() * 1.4 });
        if (Math.random() < 0.4) effects.burst(w.x, w.y + 0.1, w.z + (Math.random() - 0.5) * w.d, 1, new THREE.Color("#ffcf7a").multiplyScalar(2), 1.5);
      }
    }
    for (const l of this.lanterns) {
      const lit = game.lit.has(l.l.id);
      l.lit = lit ? Math.min(1, l.lit + dt * 3) : 0;
      const fl = 1 + Math.sin(t * 13 + l.seed) * 0.06 + Math.sin(t * 23 + l.seed * 3) * 0.04;
      l.flame.visible = l.lit > 0.01;
      l.flame.scale.set(fl * l.lit, (0.8 + 0.25 * Math.sin(t * 9 + l.seed)) * l.lit, fl * l.lit);
      const fp = new THREE.Vector3(l.l.x, l.l.y + 1.24, l.l.z);
      if (l.lit > 0) {
        halos.add(fp.x, fp.y, fp.z, new THREE.Color("#ffb85c").multiplyScalar(1.1 + mood.night * 0.4), 1.2 + mood.night * 0.5, l.lit * fl * 0.85);
        lights.push({ pos: fp, color: new THREE.Color("#ffb066"), intensity: mood.propLight * l.lit * fl, range: 9 });
      } else {
        // A cold ember waiting.
        halos.add(fp.x, fp.y - 0.08, fp.z, new THREE.Color("#ff6a3a"), 0.32, 0.5 + 0.25 * Math.sin(t * 2.3 + l.seed));
      }
    }
    for (const s of this.sentinels) {
      const p = game.sentinelPosition(s.s);
      const prev = s.group.position.clone();
      s.group.position.set(p.x, p.y + Math.sin(t * 1.9 + s.s.x) * 0.06 * calm, p.z);
      const rt = t * calm;
      s.rings[0].rotation.set(rt * 1.1, rt * 0.7, 0.4);
      s.rings[1].rotation.set(-rt * 0.6 + 1.2, 0.3, rt * 0.9);
      // The eye watches the keeper.
      const look = keeperPos.clone().add(new THREE.Vector3(0, 0.6, 0));
      s.eye.lookAt(look.x, look.y, look.z);
      const pulse = 0.8 + 0.2 * Math.sin(t * 4.2 + s.s.x);
      halos.add(p.x, p.y, p.z, new THREE.Color("#ff3a5c").multiplyScalar(1.2), s.s.r * 4.2, 0.55 * pulse);
      halos.add(p.x, p.y, p.z, new THREE.Color("#ff9aae"), s.s.r * 1.4, 0.7 * pulse);
      lights.push({ pos: new THREE.Vector3(p.x, p.y - s.s.r - 0.3, p.z), color: new THREE.Color("#ff2a4a"), intensity: mood.propLight * 0.35, range: 5 });
      // A faint trail.
      const v = s.group.position.clone().sub(prev);
      s.trail += dt * (3 + v.length() * 300) * effects.density;
      while (s.trail > 1 && dt > 0) {
        s.trail -= 1;
        effects.sparks.spawn({ x: p.x + (Math.random() - 0.5) * 0.3, y: p.y + (Math.random() - 0.5) * 0.3, z: p.z + (Math.random() - 0.5) * 0.3, life: 0.7, size: 0.12, size1: 0.02, color: new THREE.Color("#ff4a6a").multiplyScalar(1.6), drag: 3 });
      }
    }
    for (const s of this.seeds) {
      const taken = game.collected.has(s.p.id);
      s.group.visible = !taken;
      if (taken) continue;
      const p = game.pickupPosition(s.p);
      const bob = Math.sin(t * 2 + s.phase) * 0.12 * calm;
      s.group.position.set(p.x, p.y + bob, p.z);
      s.crystal.rotation.y = t * 1.4 * calm + s.phase;
      s.ring.rotation.z = t * 0.9;
      s.ring.children[0].rotation.y = -t * 1.7;
      s.ring.rotation.x = Math.PI / 2 - 0.4 + Math.sin(t * 0.7 + s.phase) * 0.2;
      const pulse = 0.85 + 0.15 * Math.sin(t * 3 + s.phase);
      halos.add(p.x, p.y + bob, p.z, new THREE.Color("#ffb03a").multiplyScalar(0.9 - mood.night * 0.3), 3.4, 0.75 * pulse);
      effects.rays.add(p.x, p.y + bob, p.z, new THREE.Color("#ffdf9a").multiplyScalar(1.8 - mood.night * 0.9), 3.2, 0.8 * pulse);
      lights.push({ pos: new THREE.Vector3(p.x, p.y - 0.75, p.z + 0.3), color: new THREE.Color("#ffc65a"), intensity: mood.propLight * 0.7, range: 7 });
      if (dt > 0 && Math.random() < 0.35 * effects.density)
        effects.sparks.spawn({ x: p.x + (Math.random() - 0.5) * 0.5, y: p.y + bob + (Math.random() - 0.5) * 0.5, z: p.z + (Math.random() - 0.5) * 0.5, vy: 0.4, life: 0.9, size: 0.09, size1: 0.01, color: new THREE.Color("#ffe39a").multiplyScalar(2), drag: 1 });
    }
    if (this.moteMesh) {
      for (const m of this.motes) {
        const taken = game.collected.has(m.p.id);
        const p = game.pickupPosition(m.p);
        const d = this.moteDummy;
        const by = Math.sin(t * 2.4 + m.phase) * 0.1 * calm;
        d.position.set(p.x + Math.sin(t * 1.3 + m.phase) * 0.05, p.y + by, p.z);
        d.scale.setScalar(taken ? 0 : 1 + 0.15 * Math.sin(t * 5 + m.phase));
        d.updateMatrix();
        this.moteMesh.setMatrixAt(m.index, d.matrix);
        if (!taken) {
          halos.add(d.position.x, d.position.y, d.position.z, new THREE.Color("#ffe7b0").multiplyScalar(1.2 + mood.night * 0.6), 0.9, 0.7);
          if (Math.sin(t * 3.7 + m.phase * 5) > 0.97) effects.rays.add(d.position.x, d.position.y, d.position.z, new THREE.Color("#fff3d0"), 0.7, 0.8);
        }
      }
      this.moteMesh.instanceMatrix.needsUpdate = true;
    }
    // Checkpoints are reached in order, so every one up to the current one is lit.
    const current = game.level.checkpoints.findIndex((v) => v.id === game.checkpointId);
    for (const c of this.checks) {
      if (current >= 0 && game.level.checkpoints.indexOf(c.c) <= current && !c.lit) {
        c.lit = true;
        c.t = 0;
      }
      c.t += dt;
      c.mesh.material = c.lit ? this.mats.cpLit : this.mats.cpDull;
      if (c.lit) {
        const flare = Math.max(0, 1 - c.t / 1.2);
        halos.add(c.c.x, c.c.y + 0.12, c.c.z, new THREE.Color("#ffc65a").multiplyScalar(0.7 + mood.night * 0.3), 1.8 + flare * 3, 0.22 + flare * 0.6);
        lights.push({ pos: new THREE.Vector3(c.c.x, c.c.y + 0.5, c.c.z), color: new THREE.Color("#ffc062"), intensity: mood.propLight * 0.4 * (1 + flare * 2), range: 5 });
        if (dt > 0 && Math.random() < 0.35 * effects.density) {
          const a = Math.random() * TAU;
          effects.sparks.spawn({ x: c.c.x + Math.cos(a) * 0.75, y: c.c.y + 0.05, z: c.c.z + Math.sin(a) * 0.75, vy: 0.7 + Math.random() * 0.5, life: 1.4, size: 0.1, size1: 0.02, color: new THREE.Color("#ffd27a").multiplyScalar(2), drag: 0.5, curve: 1 });
        }
      }
    }
    if (this.exit) {
      const e = this.exit;
      const seeds = game.seeds,
        total = game.seedTotal;
      const awake = seeds >= total;
      e.awake = clamp(e.awake + (awake ? dt : -dt) * 1.2, 0, 1);
      e.sockets.forEach((m, k) => {
        const filled = k < seeds;
        m.material = filled ? this.mats.seed : this.mats.socketEmpty;
        m.rotation.y = t * (filled ? 1.2 : 0.2) + k;
        if (filled) halos.add(m.position.x, m.position.y, m.position.z, new THREE.Color("#ffc24a").multiplyScalar(1.4), 1.2, 0.8);
      });
      const speed = 0.12 + e.awake * 0.9;
      e.rings[0].rotation.y += dt * speed;
      e.rings[1].rotation.x += dt * speed * 0.8;
      e.rings[2].rotation.z += dt * speed * 1.3;
      for (const r of e.rings) r.material = e.awake > 0.5 ? this.mats.cpLit : this.mats.cpDull;
      e.core.material = e.awake > 0.3 ? this.mats.seed : this.mats.socketEmpty;
      const sp = e.sphere.position;
      e.sphere.position.y = this.level!.exit.y + 3.4 + Math.sin(t * 0.9) * 0.08;
      if (e.awake > 0) {
        halos.add(sp.x, sp.y, sp.z, new THREE.Color("#ffc24a").multiplyScalar(1.6), 4.5 * e.awake, 0.7 * e.awake);
        lights.push({ pos: sp.clone().add(new THREE.Vector3(0, -1.4, 0.6)), color: new THREE.Color("#ffcb6a"), intensity: mood.propLight * 1.3 * e.awake, range: 12 });
        if (dt > 0 && Math.random() < 0.5 * e.awake * effects.density) {
          const a = Math.random() * TAU;
          effects.sparks.spawn({ x: e.pos.x + Math.cos(a) * 1.3, y: e.pos.y + 0.1, z: e.pos.z + Math.sin(a) * 1.3, vy: 1 + Math.random(), life: 1.6, size: 0.1, size1: 0.02, color: new THREE.Color("#ffd27a").multiplyScalar(2), drag: 0.3, curve: 1 });
        }
      } else halos.add(sp.x, sp.y, sp.z, new THREE.Color("#c8b48a"), 1.2, 0.25);
      effects.beamAt(e.pos.x, e.pos.y, e.pos.z);
      if (game.status === "clearing" || game.status === "clear") e.beam = Math.min(1, e.beam + dt * 1.5);
      else e.beam = Math.max(0, e.beam - dt * 2);
      effects.beamAmount = e.beam;
    }
  }

  /** Where the observatory's armillary floats, for the keeper's clearing pose. */
  get exitSphere() {
    return this.exit?.sphere.position ?? null;
  }

  lanternFlame(id: string) {
    const l = this.lanterns.find((v) => v.l.id === id);
    return l ? new THREE.Vector3(l.l.x, l.l.y + 1.24, l.l.z) : null;
  }

  lightCheckpoint(id: string) {
    const c = this.checks.find((v) => v.c.id === id);
    if (c && !c.lit) {
      c.lit = true;
      c.t = 0;
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.group.clear();
    this.movers = [];
    this.bridges = [];
    this.prisms = [];
    this.gates = [];
    this.lanterns = [];
    this.sentinels = [];
    this.seeds = [];
    this.motes = [];
    this.moteMesh = null;
    this.checks = [];
    this.starBridges = [];
    this.starMat = null;
    this.glyphMat = null;
    this.exit = null;
  }
}

// ----------------------------------------------------------------- builders

function spikedRing(R: number, tube: number, spikes: number) {
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(R, tube, 5, 48).toNonIndexed()];
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * TAU;
    const s = new THREE.OctahedronGeometry(tube * 2.2, 0).scale(1, 2.2, 1) as THREE.BufferGeometry;
    s.rotateZ(a - Math.PI / 2);
    s.translate(Math.cos(a) * (R + tube * 2.5), Math.sin(a) * (R + tube * 2.5), 0);
    parts.push(s.index ? s.toNonIndexed() : s);
  }
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o);
    o += p.attributes.position.array.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function sundialGeometry() {
  const b = new Buckets();
  b.matte.add(new THREE.RingGeometry(0.66, 0.86, 48, 1).rotateX(-Math.PI / 2), {});
  b.matte.add(new THREE.RingGeometry(0.3, 0.36, 32, 1).rotateX(-Math.PI / 2), {});
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const len = i % 3 === 0 ? 0.2 : 0.12;
    b.matte.add(new THREE.PlaneGeometry(len, 0.035).rotateX(-Math.PI / 2), { m: xf(Math.cos(a) * (0.56 - len / 2 + 0.06), 0, Math.sin(a) * (0.56 - len / 2 + 0.06), 0, -a, 0) });
  }
  b.matte.add(new THREE.CircleGeometry(0.12, 16).rotateX(-Math.PI / 2), {});
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.matte.add(new THREE.PlaneGeometry(0.1, 0.03).rotateX(-Math.PI / 2), { m: xf(Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19, 0, -a, 0) });
  }
  const g = b.matte.build()!;
  g.deleteAttribute("color");
  return g;
}

function sunwall(b: Buckets, w: Wall, ctx: Ctx) {
  const pal = ctx.pal;
  const stone = mixCol(pal.stone, "#ffffff", 0.05);
  const shade = mixCol(pal.stone, pal.stoneShade, 0.3);
  const uv = (p: THREE.Vector3, n: THREE.Vector3): [number, number] =>
    Math.abs(n.y) > 0.6 ? [p.x / 2.2, p.z / 2.2] : Math.abs(n.x) > Math.abs(n.z) ? [p.z / 2.2, p.y / 2.2] : [p.x / 2.2, p.y / 2.2];
  // Base plinth (the full footprint), body, capstone.
  b.paving.add(boxB(w.w, 0.35, w.d), { m: xf(w.x, w.y, w.z), color: shade, uv });
  const bw = w.w * 0.8,
    bd = w.d * 0.86;
  b.paving.add(boxB(bw, w.h - 0.7, bd), { m: xf(w.x, w.y + 0.35, w.z), color: stone, uv });
  b.paving.add(boxB(w.w, 0.35, w.d), { m: xf(w.x, w.y + w.h - 0.35, w.z), color: shade, uv });
  // Stepped buttresses on the long faces, inside the footprint.
  const n = Math.max(1, Math.round(w.d / 1.4));
  const out = (w.w - bw) / 2;
  for (let i = 0; i <= n; i++) {
    const z = w.z - bd / 2 + 0.2 + (i * (bd - 0.4)) / n;
    for (const side of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.lineTo(out, 0);
      sh.lineTo(out, 0.35);
      sh.lineTo(out * 0.55, 0.9);
      sh.lineTo(out * 0.55, 1.15);
      sh.lineTo(0, 1.5);
      sh.lineTo(0, 0);
      const g = extrude(sh, 0.3, 0.015);
      b.paving.add(g, { m: xf(w.x + side * (bw / 2), w.y + 0.35, z, 0, side > 0 ? 0 : Math.PI, 0), color: shade, uv, flat: true });
    }
  }
  // Carved grooves and the gold sun disc on each face.
  for (const side of [-1, 1]) {
    const fx = w.x + side * (bw / 2 + 0.012);
    const cy = w.y + w.h * 0.58;
    b.metal.add(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 32).rotateZ(Math.PI / 2), { m: xf(fx, cy, w.z), color: pal.gold });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      const len = k % 2 ? 0.22 : 0.36;
      b.metal.add(box(0.02, 0.05, len), { m: xf(fx, cy + Math.sin(a) * (0.44 + len / 2), w.z + Math.cos(a) * (0.44 + len / 2), a, 0, 0), color: pal.gold });
    }
    b.metal.add(torus(0.62, 0.02, 4, 40), { m: xf(fx, cy, w.z, 0, Math.PI / 2, 0), color: pal.gold });
    for (const dz of [-1, 1]) b.matte.add(box(0.03, w.h - 1.2, 0.05), { m: xf(fx, w.y + w.h / 2, w.z + dz * (bd / 2 - 0.2)), color: mixCol(shade, pal.ink, 0.25) });
  }
  // Front face: a smaller disc.
  b.metal.add(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24).rotateX(Math.PI / 2), { m: xf(w.x, w.y + w.h * 0.58, w.z + bd / 2 + 0.012), color: pal.gold });
}

function gate(b: Buckets, w: Wall, ctx: Ctx) {
  const pal = ctx.pal;
  const pillar = Math.min(0.55, w.d * 0.16);
  const stone = mixCol(pal.stone, pal.stoneShade, 0.15);
  const uv = (p: THREE.Vector3, n: THREE.Vector3): [number, number] => (Math.abs(n.x) > Math.abs(n.z) ? [p.z / 2, p.y / 2] : [p.x / 2, p.y / 2]);
  for (const side of [-1, 1]) {
    const z = w.z + side * (w.d / 2 - pillar / 2);
    b.paving.add(boxB(w.w, w.h, pillar), { m: xf(w.x, w.y, z), color: stone, uv });
    b.paving.add(boxB(w.w + 0.0, 0.18, pillar + 0.0), { m: xf(w.x, w.y + w.h - 0.18, z), color: mixCol(stone, "#ffffff", 0.1), uv });
  }
  // Bronze door between the pillars.
  const dd = w.d - pillar * 2;
  const dw = w.w * 0.72;
  b.metal.add(boxB(dw, w.h - 0.1, dd), { m: xf(w.x, w.y, w.z), color: mixCol(pal.bronze, pal.ink, 0.25) });
  const bands = Math.max(2, Math.round(w.h / 0.9));
  for (let k = 1; k < bands; k++) {
    const y = w.y + (k * (w.h - 0.1)) / bands;
    b.metal.add(box(w.w * 0.8, 0.07, dd), { m: xf(w.x, y, w.z), color: pal.bronze });
  }
  for (const sx of [-1, 1]) {
    const fx = w.x + sx * (dw / 2 + 0.02);
    b.metal.add(torus(0.42, 0.04, 4, 32), { m: xf(fx, w.y + w.h * 0.55, w.z, 0, Math.PI / 2, 0), color: pal.gold });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      b.metal.add(box(0.03, 0.05, 0.2), { m: xf(fx, w.y + w.h * 0.55 + Math.sin(a) * 0.55, w.z + Math.cos(a) * 0.55, a, 0, 0), color: pal.gold });
    }
  }
  b.matte.add(boxB(w.w + 0.1, 0.06, w.d + 0.1), { m: xf(w.x, w.y + w.h, w.z), color: mixCol(stone, pal.ink, 0.15) });
}

function lanternPost(b: Buckets, l: Lantern, ctx: Ctx) {
  const pal = ctx.pal;
  const bronze = pal.bronze,
    dark = mixCol(pal.bronze, pal.ink, 0.45);
  const stone = mixCol(pal.stone, pal.stoneShade, 0.3);
  b.matte.add(boxB(0.48, 0.1, 0.48), { m: xf(l.x, l.y, l.z), color: stone });
  b.matte.add(boxB(0.34, 0.08, 0.34), { m: xf(l.x, l.y + 0.1, l.z), color: mixCol(stone, "#ffffff", 0.1) });
  b.metal.add(
    lathe(
      [
        [0.001, 0],
        [0.12, 0],
        [0.12, 0.05],
        [0.075, 0.12],
        [0.06, 0.3],
        [0.048, 0.82],
        [0.075, 0.86],
        [0.16, 0.9],
        [0.001, 0.92],
      ],
      12,
    ),
    { m: xf(l.x, l.y + 0.18, l.z), color: dark },
  );
  // Cage of four bars around warm glass, with a roof and finial.
  const cy = l.y + 1.1;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    b.metal.add(box(0.03, 0.36, 0.03), { m: xf(l.x + Math.cos(a) * 0.15, cy + 0.18, l.z + Math.sin(a) * 0.15), color: bronze });
  }
  b.glass.add(new THREE.CylinderGeometry(0.135, 0.135, 0.34, 10).translate(0, 0.17, 0), { m: xf(l.x, cy + 0.01, l.z), color: new THREE.Color("#ffd9a0") });
  b.metal.add(cylB(0.19, 0.17, 0.03, 12), { m: xf(l.x, cy - 0.01, l.z), color: bronze });
  b.metal.add(cylB(0.05, 0.22, 0.15, 10), { m: xf(l.x, cy + 0.36, l.z), color: bronze });
  b.metal.add(cylB(0.008, 0.035, 0.14, 6), { m: xf(l.x, cy + 0.5, l.z), color: pal.gold });
  b.metal.add(sphere(0.04, 8, 6), { m: xf(l.x, cy + 0.66, l.z), color: pal.gold });
  b.metal.add(torus(0.19, 0.018, 4, 18), { m: xf(l.x, cy + 0.36, l.z, Math.PI / 2, 0, 0), color: pal.gold });
}
