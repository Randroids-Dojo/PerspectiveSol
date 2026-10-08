import * as THREE from "three";
import type { Game } from "../sim/game";
import { JUMP_SPEED, RUN_SPEED, STRIDE } from "../sim/constants";
import type { Effects } from "./effects";
import { blob, cylB, lathe, sphere, torus, xf } from "./geo";
import { patch } from "./shading";
import { Rng, TAU, clamp, damp, dampAngle, smooth } from "./util";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * The Keeper: a small hooded figure in an ivory cloak with a vermilion scarf,
 * carrying a little sun. One skinned mesh (one draw call) animated
 * procedurally from the simulation, a verlet scarf, and an x-ray silhouette
 * that shows through anything in front of it.
 */

const BONES = ["root", "hips", "torso", "head", "armL", "armR", "legL", "legR"] as const;
type BoneName = (typeof BONES)[number];

const IVORY = new THREE.Color("#efe6d4");
const IVORY_SHADE = new THREE.Color("#d9cbb2");
const SCARF = new THREE.Color("#d8452a");
const SCARF_DARK = new THREE.Color("#a3281c");
const INK = new THREE.Color("#0d0c14");
const LEATHER = new THREE.Color("#6b4a36");
const GOLD = new THREE.Color("#e2a944");

export class Keeper {
  group = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  private xray: THREE.SkinnedMesh;
  private bones = {} as Record<BoneName, THREE.Bone>;
  private rest = {} as Record<BoneName, THREE.Vector3>;
  private eyes: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private xrayMat: THREE.MeshBasicMaterial;
  private dissolve = { value: 0 };
  private dissolveGlow = { value: new THREE.Color("#ffcf7a").multiplyScalar(3) };

  // Scarf.
  private scarf: THREE.Mesh;
  private scarfPts: THREE.Vector3[] = [];
  private scarfPrev: THREE.Vector3[] = [];
  private scarfGeo: THREE.BufferGeometry;
  private readonly SEG = 9;
  private readonly SEG_LEN = 0.085;

  // The little sun.
  sunPos = new THREE.Vector3();
  private sunVel = new THREE.Vector3();
  sunLight: THREE.PointLight;
  private sunCore: THREE.Mesh;
  sunColor = new THREE.Color("#ffd27a");

  // Ground cues.
  blob: THREE.Mesh;
  marker: THREE.Mesh;

  // Animation state.
  pos = new THREE.Vector3();
  private dispZ = 0;
  private yaw = 0;
  private run = 0;
  private air = 0;
  private landImpact = 0;
  private flourish = 9;
  private deadT = -1;
  private bornT = 9;
  private idleT = 0;
  private lean = 0;
  private prevVx = 0;
  private initialised = false;
  private trailAcc = 0;
  visibleAmount = 1;

  constructor() {
    const bone = (name: BoneName, x: number, y: number, z: number, parent?: THREE.Bone) => {
      const b = new THREE.Bone();
      b.name = name;
      const world = new THREE.Vector3(x, y, z);
      this.rest[name] = world.clone();
      if (parent) {
        const pw = this.rest[parent.name as BoneName];
        b.position.copy(world.clone().sub(pw));
        parent.add(b);
      } else b.position.copy(world);
      this.bones[name] = b;
      return b;
    };
    const root = bone("root", 0, 0, 0);
    const hips = bone("hips", 0, 0.3, 0, root);
    const torso = bone("torso", 0, 0.36, 0, hips);
    bone("head", 0, 0.74, 0, torso);
    bone("armL", 0.17, 0.64, 0, torso);
    bone("armR", -0.17, 0.64, 0, torso);
    bone("legL", 0.085, 0.3, 0, hips);
    bone("legR", -0.085, 0.3, 0, hips);
    const index = (n: BoneName) => BONES.indexOf(n);

    // Pieces, each rigidly bound to a bone, merged into one skinned geometry.
    const parts: { g: THREE.BufferGeometry; bone: BoneName; color: THREE.Color | ((p: THREE.Vector3) => THREE.Color) }[] = [];
    const add = (g: THREE.BufferGeometry, m: THREE.Matrix4, bone: BoneName, color: THREE.Color | ((p: THREE.Vector3) => THREE.Color)) => {
      g.applyMatrix4(m);
      parts.push({ g: g.index ? g.toNonIndexed() : g, bone, color });
    };
    // Cloak: a soft bell.
    const cloak = lathe(
      (
        [
          [0.001, 0.75],
          [0.11, 0.74],
          [0.16, 0.68],
          [0.19, 0.58],
          [0.215, 0.45],
          [0.245, 0.31],
          [0.275, 0.2],
          [0.268, 0.165],
          [0.2, 0.175],
          [0.001, 0.2],
        ] as [number, number][]
      ).reverse(),
      24,
    );
    {
      const p = cloak.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < 0.3) {
          const a = Math.atan2(p.getZ(i), p.getX(i));
          const wave = 1 + Math.sin(a * 5) * 0.035 * (0.3 - y) * 6;
          p.setX(i, p.getX(i) * wave);
          p.setZ(i, p.getZ(i) * wave);
        }
      }
      cloak.computeVertexNormals();
    }
    add(cloak, xf(), "torso", (p) => IVORY.clone().lerp(IVORY_SHADE, smooth(0.55, 0.18, p.y) * 0.8));
    // Inner hem shadow ring.
    add(torus(0.245, 0.02, 4, 22), xf(0, 0.185, 0, Math.PI / 2, 0, 0), "torso", IVORY_SHADE.clone().multiplyScalar(0.7));
    // Golden sun clasp.
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12).rotateX(Math.PI / 2), xf(0, 0.6, 0.175), "torso", GOLD);
    // Collar of the scarf.
    add(torus(0.125, 0.055, 7, 18), xf(0, 0.715, 0, Math.PI / 2 + 0.12, 0, 0), "torso", SCARF);
    add(blob(0.06, new Rng(5), 0.15, 0), xf(0.07, 0.69, 0.11), "torso", SCARF_DARK);
    // Hood: a round shell built around the face axis, with a smooth oval opening and a rolled lip.
    {
      const R = 0.255;
      const NU = 16,
        NV = 36;
      const pos: number[] = [];
      const idx: number[] = [];
      const tipDir = new THREE.Vector3(0, 0.25, -1).normalize();
      const tilt = new THREE.Matrix4().makeRotationX(0.12);
      const pt = (theta: number, phi: number, r: number) => {
        const v = new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)).applyMatrix4(tilt);
        const k = Math.max(0, v.dot(tipDir) - 0.62) / 0.38;
        v.multiplyScalar(r);
        v.addScaledVector(tipDir, k * k * 0.1);
        v.y = v.y * 1.05 - k * k * 0.05;
        return v;
      };
      const ta = 0.78,
        tb = 0.9;
      // Rows: the inner lip (rolled inward), the rim, then out over the crown to the back.
      const rows: { u: number; r: number }[] = [
        { u: -0.06, r: R * 0.86 },
        { u: -0.02, r: R * 0.97 },
        { u: 0, r: R * 1.02 },
      ];
      for (let i = 1; i <= NU; i++) rows.push({ u: i / NU, r: R });
      rows.forEach((row) => {
        for (let j = 0; j < NV; j++) {
          const phi = (j / NV) * Math.PI * 2;
          const t0 = (ta * tb) / Math.hypot(tb * Math.cos(phi), ta * Math.sin(phi));
          const theta = t0 + Math.max(0, row.u) * (Math.PI - 0.02 - t0) + Math.min(0, row.u) * 1.5;
          const v = pt(theta, phi, row.r);
          pos.push(v.x, v.y, v.z);
        }
      });
      for (let i = 0; i < rows.length - 1; i++)
        for (let j = 0; j < NV; j++) {
          const a0 = i * NV + j,
            a1 = i * NV + ((j + 1) % NV),
            b0 = a0 + NV,
            b1 = a1 + NV;
          idx.push(a0, b0, a1, a1, b0, b1);
        }
      const hood = new THREE.BufferGeometry();
      hood.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      hood.setIndex(idx);
      hood.computeVertexNormals();
      const flat = hood.toNonIndexed();
      add(flat, xf(0, 0.92, -0.02), "head", (q) => IVORY.clone().lerp(IVORY_SHADE, smooth(1.12, 0.78, q.y) * 0.45));
    }
    // The face in shadow, recessed inside the hood.
    add(sphere(0.2, 20, 14), xf(0, 0.9, -0.005, 0, 0, 0, 1, 1, 1), "head", INK);
    // Arms: sleeves with small hands.
    for (const side of ["armL", "armR"] as const) {
      const sx = side === "armL" ? 1 : -1;
      const s = new THREE.CapsuleGeometry(0.055, 0.17, 4, 10).translate(0, -0.12, 0);
      add(s, xf(0.17 * sx, 0.66, 0, 0, 0, 0.16 * sx), side, IVORY_SHADE);
      add(sphere(0.038, 8, 6), xf(0.2 * sx, 0.43, 0.02), side, new THREE.Color("#4a3a32"));
    }
    // Legs and boots.
    for (const side of ["legL", "legR"] as const) {
      const sx = side === "legL" ? 1 : -1;
      add(cylB(0.05, 0.045, 0.26, 8), xf(0.085 * sx, 0.04, 0), side, INK.clone().lerp(LEATHER, 0.3));
      const boot = sphere(0.075, 10, 6).scale(1, 0.62, 1.35);
      add(boot, xf(0.085 * sx, 0.04, 0.025), side, LEATHER);
    }

    let n = 0;
    for (const p of parts) n += p.g.attributes.position.count;
    const pos = new Float32Array(n * 3),
      nor = new Float32Array(n * 3),
      colr = new Float32Array(n * 3),
      si = new Uint16Array(n * 4),
      sw = new Float32Array(n * 4);
    let o = 0;
    const tmp = new THREE.Vector3();
    for (const p of parts) {
      const g = p.g;
      if (!g.attributes.normal) g.computeVertexNormals();
      const pp = g.attributes.position as THREE.BufferAttribute;
      const nn = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < pp.count; i++, o++) {
        tmp.fromBufferAttribute(pp, i);
        pos.set([tmp.x, tmp.y, tmp.z], o * 3);
        nor.set([nn.getX(i), nn.getY(i), nn.getZ(i)], o * 3);
        const c = typeof p.color === "function" ? p.color(tmp) : p.color;
        colr.set([c.r, c.g, c.b], o * 3);
        si[o * 4] = index(p.bone);
        sw[o * 4] = 1;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colr, 3));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    geo.computeBoundingSphere();

    this.mat = patch(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0,
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp,
      }),
      { rim: 1.2, dissolve: true },
      { uDissolve: this.dissolve, uDissolveGlow: this.dissolveGlow },
    );
    this.mesh = new THREE.SkinnedMesh(geo, this.mat);
    this.mesh.add(root);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const skeleton = new THREE.Skeleton(BONES.map((b) => this.bones[b]));
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(skeleton);
    this.group.add(this.mesh);

    this.xrayMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ffe6b0").multiplyScalar(0.9),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilWriteMask: 0,
    });
    this.xray = new THREE.SkinnedMesh(geo, this.xrayMat);
    this.xray.bind(skeleton, this.mesh.bindMatrix);
    this.xray.renderOrder = 30;
    this.xray.frustumCulled = false;
    this.group.add(this.xray);

    // Eyes glow from inside the hood.
    const eyeGeo = new THREE.SphereGeometry(0.028, 8, 6);
    const merged = mergeGeometries([
      eyeGeo.clone().scale(0.9, 1.3, 0.6).translate(0.06, 0, 0),
      eyeGeo.clone().scale(0.9, 1.3, 0.6).translate(-0.06, 0, 0),
    ])!;
    eyeGeo.dispose();
    this.eyes = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff1c4").multiplyScalar(4) }));
    this.eyes.position.set(0, 0.9 - 0.74, 0.19);
    this.bones.head.add(this.eyes);

    // Scarf tail ribbon, simulated in world space.
    this.scarfGeo = new THREE.BufferGeometry();
    const sv = (this.SEG + 1) * 2;
    this.scarfGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.scarfGeo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(sv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const sc = new Float32Array(sv * 3);
    for (let i = 0; i <= this.SEG; i++) {
      const t = i / this.SEG;
      const c = SCARF.clone().lerp(SCARF_DARK, t * 0.6);
      if (i >= this.SEG - 1) c.copy(GOLD).multiplyScalar(0.9);
      sc.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    }
    this.scarfGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
    const idx: number[] = [];
    for (let i = 0; i < this.SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.scarfGeo.setIndex(idx);
    this.scarf = new THREE.Mesh(
      this.scarfGeo,
      patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), { rim: 0.8 }),
    );
    this.scarf.castShadow = true;
    this.scarf.frustumCulled = false;
    for (let i = 0; i <= this.SEG; i++) {
      this.scarfPts.push(new THREE.Vector3());
      this.scarfPrev.push(new THREE.Vector3());
    }

    // The little sun.
    this.sunCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff0c0").multiplyScalar(6) }));
    this.sunLight = new THREE.PointLight(this.sunColor, 2.5, 9, 1.6);
    this.sunLight.castShadow = false;

    // Contact shadow and landing marker.
    const blobTex = makeBlobTexture();
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex, color: new THREE.Color("#141018"), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    this.blob.renderOrder = 5;
    const ringTex = makeRingTexture();
    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: ringTex,
        color: new THREE.Color("#ffe2a0").multiplyScalar(1.6),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.marker.renderOrder = 6;
    this.group.add(this.scarf, this.sunCore, this.sunLight, this.blob, this.marker);
  }

  get sunMaterialColor() {
    return (this.sunCore.material as THREE.MeshBasicMaterial).color;
  }

  /** Called on fold/unfold. */
  onFold() {
    this.flourish = 0;
  }
  onLand(impact: number) {
    this.landImpact = clamp(impact / 40, 0.06, 0.38);
  }
  onDie(effects: Effects, cause: string | undefined) {
    this.deadT = 0;
    const c = this.pos;
    effects.burst(c.x, c.y + 0.6, c.z, 50, new THREE.Color("#ffd690").multiplyScalar(2.5), 4.2, { grav: -0.6, drag: 1.4, life: 1.3 });
    effects.burst(c.x, c.y + 0.6, c.z, 18, SCARF.clone().multiplyScalar(2), 3, { grav: 0.5 });
    if (cause === "sentinel") effects.burst(c.x, c.y + 0.6, c.z, 24, new THREE.Color("#ff4f6e").multiplyScalar(3), 5);
  }
  onRespawn(effects: Effects) {
    this.deadT = -1;
    this.bornT = 0;
    this.initialised = false;
    const c = this.pos;
    effects.ring(c.x, c.y + 0.05, c.z, 1.6, new THREE.Color("#ffd98a").multiplyScalar(2.5), 0.9);
  }

  /** Highest solid top under the keeper (for the contact shadow and landing marker). */
  private groundBelow(game: Game) {
    const p = game.player;
    let best: number | null = null;
    const flat = game.mode === "2d";
    for (const b of game.solids()) {
      if (game.ghosts.has(b.id)) continue;
      if (p.x + 0.2 < b.x0 || p.x - 0.2 > b.x1) continue;
      if (!flat && (p.z + 0.2 < b.z0 || p.z - 0.2 > b.z1)) continue;
      if (b.y1 > p.y + 0.05) continue;
      if (best === null || b.y1 > best) best = b.y1;
    }
    return best;
  }

  update(game: Game, dt: number, t: number, fold: number, reduced: boolean, effects: Effects, sunBoost: number, exit: THREE.Vector3 | null) {
    const p = game.player;
    // Displayed depth eases out of unfold snaps.
    if (!this.initialised) {
      this.dispZ = p.z;
      this.yaw = Math.PI / 2 - p.heading;
    }
    if (Math.abs(p.z - this.dispZ) > 0.25) this.dispZ = damp(this.dispZ, p.z, 14, dt);
    else this.dispZ = p.z;
    this.pos.set(p.x, p.y, this.dispZ);
    const B = this.bones;

    const flat = game.mode === "2d";
    const speed = Math.hypot(p.vx, flat ? 0 : p.vz);
    const grounded = p.grounded;
    this.run = damp(this.run, grounded ? clamp(speed / RUN_SPEED, 0, 1) : 0, 14, dt);
    this.air = damp(this.air, grounded ? 0 : 1, grounded ? 22 : 10, dt);
    this.idleT += dt;
    const phase = (p.stride / STRIDE) * TAU;
    const breathe = Math.sin(this.idleT * 2.2) * (reduced ? 0.4 : 1);

    // Facing: smooth turn toward the heading, biased slightly toward the camera in 3D.
    let targetYaw = Math.PI / 2 - p.heading;
    if (!flat) {
      const toward = Math.cos(p.heading) * 0.42 * (1 - fold);
      targetYaw -= Math.sign(Math.cos(p.heading)) * Math.abs(toward);
    }
    if (game.status === "clearing") targetYaw = 0;
    this.yaw = dampAngle(this.yaw, targetYaw, 13, dt);

    // Lean with acceleration.
    const ax = dt > 0 ? (p.vx - this.prevVx) / dt : 0;
    this.prevVx = p.vx;
    this.lean = damp(this.lean, clamp(ax * 0.004, -0.12, 0.12), 8, dt);

    // Squash and stretch.
    const sinceLand = p.sinceLand;
    const land = this.landImpact * Math.exp(-sinceLand * 11) * (sinceLand < 0.45 ? 1 : 0);
    const rising = clamp(p.vy / JUMP_SPEED, 0, 1) * this.air;
    const falling = clamp(-p.vy / 18, 0, 1) * this.air;
    const stretch = rising * 0.13 + falling * 0.05 - land;
    const sy = 1 + stretch;
    const sxz = 1 / Math.sqrt(Math.max(0.4, sy));

    const root = B.root;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(sxz, sy, sxz);

    // Hips bob with the stride.
    const bob = Math.abs(Math.sin(phase)) * 0.055 * this.run;
    B.hips.position.set(0, 0.3 + bob - 0.03 * this.run + breathe * 0.004 * (1 - this.run), 0);
    B.hips.rotation.set(0, Math.sin(phase) * 0.12 * this.run, 0);
    B.torso.rotation.set(0.2 * this.run + 0.1 * rising - 0.08 * falling, -Math.sin(phase) * 0.1 * this.run, this.lean * 0);
    B.torso.scale.set(1 + breathe * 0.012 * (1 - this.run), 1 - breathe * 0.008 * (1 - this.run), 1 + breathe * 0.012 * (1 - this.run));
    B.head.rotation.set(-0.16 * this.run + Math.sin(phase * 2) * 0.03 * this.run + breathe * 0.02 * (1 - this.run) - 0.12 * falling, 0, Math.sin(this.idleT * 0.7) * 0.04 * (1 - this.run));

    // Legs.
    const swing = Math.sin(phase) * 1.1 * this.run;
    const tuckL = -0.55 * rising - 0.25 * falling;
    const tuckR = 0.35 * rising + 0.2 * falling;
    B.legL.rotation.set(-swing * (1 - this.air) + tuckL, 0, 0);
    B.legR.rotation.set(swing * (1 - this.air) + tuckR, 0, 0);

    // Arms: counter-swing when running, back when rising, up when falling.
    const armSwing = Math.sin(phase) * 1.0 * this.run;
    const up = falling * 2.0;
    const back = rising * 0.7;
    let raise = 0;
    if (game.status === "clearing") raise = 2.6;
    B.armL.rotation.set(armSwing * (1 - this.air) + back - raise * 0.2, 0, 0.12 + up * 0.55 + raise + breathe * 0.03);
    B.armR.rotation.set(-armSwing * (1 - this.air) + back - raise * 0.2, 0, -0.12 - up * 0.55 - raise - breathe * 0.03);

    // Place the keeper.
    this.group.position.set(0, 0, 0);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.yaw, 0);
    this.xray.position.copy(this.mesh.position);
    this.xray.rotation.copy(this.mesh.rotation);

    // Death and rebirth.
    let dissolve = 0;
    if (this.deadT >= 0) {
      this.deadT += dt;
      dissolve = clamp(this.deadT / 0.42, 0, 1);
    } else if (this.bornT < 0.6) {
      this.bornT += dt;
      dissolve = 1 - clamp(this.bornT / 0.55, 0, 1);
      if (dt > 0 && Math.random() < 0.9)
        effects.sparks.spawn({
          x: this.pos.x + (Math.random() - 0.5) * 0.8,
          y: this.pos.y + Math.random() * 1.2,
          z: this.pos.z + (Math.random() - 0.5) * 0.8,
          vx: 0,
          vy: 0.6,
          vz: 0,
          life: 0.4,
          size: 0.1,
          size1: 0.02,
          color: new THREE.Color("#ffd98a").multiplyScalar(2),
        });
    }
    this.dissolve.value = dissolve;
    const hidden = dissolve >= 0.999;
    this.mesh.visible = !hidden;
    this.eyes.visible = dissolve < 0.4;
    this.xray.visible = !hidden && fold < 0.5;
    this.xrayMat.opacity = 0.42 * (1 - dissolve);
    this.visibleAmount = 1 - dissolve;

    this.mesh.updateMatrixWorld(true);

    // Scarf.
    this.updateScarf(dt, t, hidden);

    // The little sun hovers behind the shoulder and trails.
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const target = this.pos
      .clone()
      .addScaledVector(right, -0.36)
      .addScaledVector(fwd, -0.22)
      .add(new THREE.Vector3(0, 1.32 + Math.sin(t * 2.1) * (reduced ? 0.02 : 0.06), 0));
    if (this.flourish < 0.7) {
      this.flourish += dt;
      const k = clamp(this.flourish / 0.6, 0, 1);
      const a = k * TAU;
      const r = 0.55 * Math.sin(k * Math.PI);
      target.add(new THREE.Vector3(Math.cos(a) * r, Math.sin(k * Math.PI) * 0.35, Math.sin(a) * r));
      if (dt > 0) effects.sparks.spawn({ x: this.sunPos.x, y: this.sunPos.y, z: this.sunPos.z, life: 0.5, size: 0.14, size1: 0.02, color: this.sunColor.clone().multiplyScalar(2), drag: 3 });
    }
    if (game.status === "clearing" || game.status === "clear") {
      const lift = new THREE.Vector3(this.pos.x, this.pos.y + 2.4, this.pos.z + 0.2);
      if (exit) lift.lerp(new THREE.Vector3(exit.x, exit.y + 3.2, exit.z), clamp(1 - game.sequence / 1.8, 0, 1));
      target.copy(lift);
    }
    if (this.deadT >= 0) target.copy(this.pos).add(new THREE.Vector3(0, 0.6, 0));
    if (!this.initialised || this.sunPos.distanceTo(target) > 3) {
      this.sunPos.copy(target);
      this.sunVel.set(0, 0, 0);
      this.initialised = true;
    }
    // Critically damped spring.
    const k = 60,
      c = 2 * Math.sqrt(k) * 0.85;
    if (dt > 0) {
      const steps = Math.ceil(dt / 0.008);
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a2 = target.clone().sub(this.sunPos).multiplyScalar(k).addScaledVector(this.sunVel, -c);
        this.sunVel.addScaledVector(a2, h);
        this.sunPos.addScaledVector(this.sunVel, h);
      }
    }
    this.sunCore.position.copy(this.sunPos);
    const deadDim = this.deadT >= 0 ? clamp(1 - this.deadT / 0.6, 0.15, 1) : 1;
    const pulse = 1 + Math.sin(t * 3.1) * 0.06;
    this.sunCore.scale.setScalar(pulse * (0.8 + 0.2 * deadDim));
    this.sunLight.position.copy(this.sunPos);
    this.sunLight.intensity = sunBoost * deadDim * pulse;

    // Trail.
    const moving = this.sunVel.length();
    this.trailAcc += dt * (4 + moving * 18) * effects.density;
    while (this.trailAcc > 1) {
      this.trailAcc -= 1;
      effects.sparks.spawn({
        x: this.sunPos.x + (Math.random() - 0.5) * 0.06,
        y: this.sunPos.y + (Math.random() - 0.5) * 0.06,
        z: this.sunPos.z + (Math.random() - 0.5) * 0.06,
        vx: (Math.random() - 0.5) * 0.2,
        vy: 0.15 + Math.random() * 0.2,
        vz: (Math.random() - 0.5) * 0.2,
        life: 0.55 + Math.random() * 0.3,
        size: 0.09,
        size1: 0.015,
        color: this.sunColor.clone().multiplyScalar(1.6),
        drag: 2.5,
      });
    }

    // Contact shadow and landing marker.
    const g = this.groundBelow(game);
    const cue = (1 - smooth(0, 0.45, fold)) * this.visibleAmount;
    if (g !== null && !hidden) {
      const h = Math.max(0, p.y - g);
      this.blob.visible = true;
      this.blob.position.set(p.x, g + 0.012, this.dispZ);
      const s = 0.78 + h * 0.08;
      this.blob.scale.set(s, 1, s * 0.85);
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.62 * clamp(1 - h / 7, 0.25, 1) * cue;
      const airborne = !p.grounded && h > 0.35;
      this.marker.visible = true;
      this.marker.position.set(p.x, g + 0.016, this.dispZ);
      const ms = 0.95 + Math.sin(t * 8) * 0.04;
      this.marker.scale.set(ms, 1, ms);
      const mm = this.marker.material as THREE.MeshBasicMaterial;
      mm.opacity = damp(mm.opacity, airborne ? 0.75 * cue : 0, 16, Math.max(dt, 0.016));
    } else {
      this.blob.visible = false;
      this.marker.visible = false;
    }
  }

  private updateScarf(dt: number, t: number, hidden: boolean) {
    // Anchor at the back of the neck, from the torso bone.
    const torso = this.bones.torso;
    const anchor = new THREE.Vector3(0.05, 0.705 - 0.36, -0.13).applyMatrix4(torso.matrixWorld);
    const parentInv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    anchor.applyMatrix4(parentInv);
    const n = this.SEG;
    const pts = this.scarfPts,
      prev = this.scarfPrev;
    if (!this.scarfReady || pts[0].distanceTo(anchor) > 0.6) {
      for (let i = 0; i <= n; i++) {
        pts[i].copy(anchor).add(new THREE.Vector3(0, -i * this.SEG_LEN, -i * 0.02));
        prev[i].copy(pts[i]);
      }
      this.scarfReady = true;
    }
    if (dt > 0) {
      const steps = Math.min(4, Math.ceil(dt / 0.009));
      const h = dt / steps;
      const flutter = new THREE.Vector3(Math.sin(t * 7.3) * 0.6, Math.sin(t * 5.1) * 0.3, Math.cos(t * 6.1) * 0.6);
      for (let s = 0; s < steps; s++) {
        for (let i = 1; i <= n; i++) {
          const p = pts[i];
          const v = p.clone().sub(prev[i]).multiplyScalar(0.94);
          prev[i].copy(p);
          const fl = flutter.clone().multiplyScalar((i / n) * 1.2);
          p.add(v).add(new THREE.Vector3(fl.x, -9.0 + fl.y, fl.z).multiplyScalar(h * h));
        }
        pts[0].copy(anchor);
        prev[0].copy(anchor);
        for (let it = 0; it < 4; it++) {
          for (let i = 0; i < n; i++) {
            const a = pts[i],
              b = pts[i + 1];
            const d = b.clone().sub(a);
            const len = d.length() || 1e-5;
            const diff = (len - this.SEG_LEN) / len;
            if (i === 0) b.addScaledVector(d, -diff);
            else {
              a.addScaledVector(d, diff * 0.5);
              b.addScaledVector(d, -diff * 0.5);
            }
          }
          // Keep clear of the body.
          const centre = new THREE.Vector3(0, 0.5, 0).applyMatrix4(torso.matrixWorld).applyMatrix4(parentInv);
          for (let i = 1; i <= n; i++) {
            const d = pts[i].clone().sub(centre);
            d.y *= 0.55;
            const l = d.length();
            if (l < 0.25 && l > 1e-4) pts[i].add(d.multiplyScalar((0.25 - l) / l));
          }
        }
      }
    }
    // Recover from any numerical blow-up.
    if (pts.some((p) => !Number.isFinite(p.x + p.y + p.z))) {
      for (let i = 0; i <= n; i++) {
        pts[i].copy(anchor).add(new THREE.Vector3(0, -i * this.SEG_LEN, 0));
        prev[i].copy(pts[i]);
      }
    }
    // Build the ribbon.
    const pos = this.scarfGeo.attributes.position as THREE.BufferAttribute;
    const nor = this.scarfGeo.attributes.normal as THREE.BufferAttribute;
    const side0 = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    for (let i = 0; i <= n; i++) {
      const a = pts[Math.max(0, i - 1)],
        b = pts[Math.min(n, i + 1)];
      const dir = b.clone().sub(a);
      if (dir.lengthSq() < 1e-10) dir.set(0, -1, 0);
      dir.normalize();
      const side = side0.clone().addScaledVector(dir, -side0.dot(dir));
      if (side.lengthSq() < 1e-8) side.set(0, 0, 1).addScaledVector(dir, -dir.z);
      side.normalize();
      const w = 0.075 * (1 - (i / n) * 0.2);
      const twist = Math.sin(t * 3 + i * 0.6) * 0.3 * (i / n);
      side.applyAxisAngle(dir, twist);
      const nn = side.clone().cross(dir);
      if (nn.lengthSq() < 1e-10) nn.set(0, 0, 1);
      nn.normalize();
      const p = pts[i];
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      nor.setXYZ(i * 2, nn.x, nn.y, nn.z);
      nor.setXYZ(i * 2 + 1, nn.x, nn.y, nn.z);
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    this.scarfGeo.computeBoundingSphere();
    this.scarf.visible = !hidden;
  }
  private scarfReady = false;

  /** Reset state for a new chapter. */
  reset() {
    this.initialised = false;
    this.scarfReady = false;
    this.deadT = -1;
    this.bornT = 9;
    this.flourish = 9;
    this.dissolve.value = 0;
  }

  /** Halos for the sun and eyes, added each frame. */
  glow(halos: { add: (x: number, y: number, z: number, c: THREE.Color, s: number, a?: number) => void }, night: number) {
    const s = this.sunPos;
    const dim = this.deadT >= 0 ? clamp(1 - this.deadT / 0.6, 0.15, 1) : 1;
    halos.add(s.x, s.y, s.z, this.sunColor.clone().multiplyScalar(0.6 + night * 0.6), 0.9 + night * 0.5, 0.7 * dim);
    halos.add(s.x, s.y, s.z, new THREE.Color("#fff4d8"), 0.32, 0.9 * dim);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.xrayMat.dispose();
    this.scarfGeo.dispose();
    (this.scarf.material as THREE.Material).dispose();
    this.eyes.geometry.dispose();
    (this.eyes.material as THREE.Material).dispose();
    this.sunCore.geometry.dispose();
    (this.sunCore.material as THREE.Material).dispose();
  }
}

function makeBlobTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeRingTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 12;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath();
    g.arc(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34, 3.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "rgba(255,255,255,0.8)";
  g.beginPath();
  g.arc(64, 64, 4, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
}

