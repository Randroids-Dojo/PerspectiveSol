import * as THREE from "three";
import type { FrameInput, Quality, WorldRenderer } from "../contract";
import type { Game } from "../sim/game";
import type { GameEvent, Level, Vec3 } from "../sim/types";
import { CROSS, layerOpacity, type ViewFrame } from "../view";
import { FOV, pose, type Pose } from "./camera";
import { Effects } from "./effects";
import { Elements, type LightCandidate } from "./elements";
import { Bucket, Buckets } from "./geo";
import { type Ctx, type Scatter, buildIsland } from "./islands";
import { Keeper } from "./keeper";
import { Mats } from "./materials";
import { type Mood, makeMood, makePal } from "./mood";
import { Post } from "./post";
import { blockersFor, dress } from "./props";
import { buildScenery } from "./scenery";
import { U, makeNoiseTexture } from "./shading";
import { Backdrop, Birds, Wisps } from "./sky";
import { Rng, clamp, hashString, mixCol, smooth } from "./util";


/**
 * The sculpted world: carved limestone, bronze and glass above a cloud sea,
 * rendered with three.js. See docs/WORLD.md.
 */
export class Sculpted implements WorldRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.3, 4000);
  /** Everything that flattens during the fold. */
  private world = new THREE.Group();
  private backdrop = new Backdrop();
  private birds = new Birds();
  private wisps = new Wisps();
  private scenery = new THREE.Group();
  private statics = new THREE.Group();
  private mats = new Mats();
  private elements = new Elements(this.mats);
  private keeper = new Keeper();
  private effects = new Effects();
  private post: Post;
  private hemi = new THREE.HemisphereLight("#ffffff", "#444444", 1);
  private key = new THREE.DirectionalLight("#ffffff", 3);
  private pool: THREE.PointLight[] = [];
  private env: THREE.Texture | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator;
  private noise = makeNoiseTexture();

  private level: Level | null = null;
  private mood: Mood | null = null;
  private quality: Quality = "high";
  private width = 1280;
  private height = 720;
  private dpr = 1;
  private frames = 0;
  private playTime = 0;
  private lastView: ViewFrame | null = null;
  private pose: Pose = { position: new THREE.Vector3(), target: new THREE.Vector3(), depth: 1, side: 0 };
  private disposables: { dispose(): void }[] = [];
  private lastInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };
  private exitPos = new THREE.Vector3();
  private compiled = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    this.renderer.info.autoReset = false;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.post = new Post(4);
    U.uNoise.value = this.noise;

    this.scene.add(this.backdrop.group, this.birds.group, this.wisps.points, this.scenery, this.world, this.hemi, this.key, this.key.target);
    this.world.add(this.statics, this.elements.group, this.keeper.group, this.effects.group);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.035;
    this.key.shadow.radius = 3;
    const sc = this.key.shadow.camera;
    sc.near = 1;
    sc.far = 140;
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight("#ffffff", 0, 8, 1.7);
      this.pool.push(l);
      this.world.add(l);
    }
    this.resize(innerWidth || 1280, innerHeight || 720, Math.min(2, devicePixelRatio || 1));
  }

  // ------------------------------------------------------------------ load

  load(level: Level) {
    this.clearLevel();
    this.level = level;
    const time = level.theme.time;
    const pal = makePal(level.theme.palette, time);
    const mood = makeMood(time, pal);
    this.mood = mood;
    const high = this.quality === "high";
    const scatter: Scatter = { grass: [], flowers: [] };
    const ctx: Ctx = { pal, time, seed: level.theme.seed, detail: high ? 1 : 0.55, scatter };

    // Static islands and their dressing.
    const stat = new Buckets();
    const keepClear = [
      ...level.lanterns.map((l) => ({ x: l.x, z: l.z, r: 0.4 })),
      { x: level.exit.x, z: level.exit.z, r: 2.4 },
    ];
    for (const i of level.islands) {
      if (i.only || i.motion || i.lantern) continue;
      const r = new Rng(hashString(i.id) ^ (level.theme.seed * 2654435761));
      const shape = { id: i.id, x: i.x, y: i.y, z: i.z, w: i.w, d: i.d, h: i.h, style: i.style };
      buildIsland(stat, shape, r, ctx);
      const blockers = blockersFor(level, i.id);
      const clear = i.id === level.exit.island ? keepClear : keepClear.slice(0, -1);
      dress(stat, shape, r, ctx, blockers, clear);
    }
    this.elements.build(level, ctx, stat);
    this.addBuckets(stat, this.statics, true);
    this.addScatter(scatter);

    // Background scenery (never flattens).
    this.addBuckets(buildScenery(level, ctx, false, high ? 1 : 0.6), this.scenery, false);
    this.addBuckets(buildScenery(level, ctx, true, high ? 1 : 0.6), this.scenery, false);

    // Lighting, sky and atmosphere.
    const cloudY = level.bounds.floor - 3;
    this.backdrop.apply(mood, cloudY);
    this.backdrop.setQuality(high);
    const midY = level.islands.reduce((a, i) => a + i.y, 0) / Math.max(1, level.islands.length);
    this.wisps.build(level.bounds.x0 - 30, level.bounds.x1 + 30, midY, cloudY, mood, Math.round(((level.bounds.x1 - level.bounds.x0) / 5 + 10) * (high ? 1 : 0.5)), level.theme.seed);
    this.birds.apply(
      time !== "night" && time !== "dusk",
      mixCol(pal.ink, mood.fogColor, 0.15),
      mood.fogColor,
      level.bounds.x0,
      level.bounds.x1,
      level.islands.reduce((a, i) => a + i.y, 0) / Math.max(1, level.islands.length),
    );
    this.scene.fog = new THREE.Fog(mood.fogColor, mood.fogNear, mood.fogFar);
    U.uFogLow.value.copy(mood.fogLow);
    U.uFogH.value.set(cloudY + 0.5, cloudY + 10, 0.92, 3);
    U.uSunDir.value.copy(mood.sunDir);
    U.uSunFog.value.copy(mood.sunFog);
    U.uSunCol.value.copy(mood.keyColor).multiplyScalar(mood.keyIntensity * 0.25);
    U.uRim.value.copy(mood.rim);
    U.uWind.value.set(0.9, 0.35, mood.wind, 1.2);
    this.hemi.color.copy(mood.hemiSky);
    this.hemi.groundColor.copy(mood.hemiGround);
    this.hemi.intensity = mood.hemiIntensity;
    this.key.color.copy(mood.keyColor);
    this.key.intensity = mood.keyIntensity;
    this.keeper.sunLight.color.copy(mood.night > 0.5 ? new THREE.Color("#ffc870") : new THREE.Color("#ffd690"));
    this.env = this.makeEnv(mood);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = mood.envIntensity;
    this.scene.background = null;
    this.post.apply(mood, false);
    this.keeper.reset();
    this.effects.clear();
    const e = level.exit;
    this.exitPos.set(e.x, e.y, e.z);
    this.compiled = false;
  }

  private addBuckets(b: Buckets, parent: THREE.Object3D, shadows: boolean) {
    const M = this.mats;
    const pairs: [Bucket, THREE.Material, boolean][] = [
      [b.matte, M.matte, true],
      [b.paving, M.paving, true],
      [b.ruin, M.ruin, true],
      [b.foliage, M.foliage, true],
      [b.metal, M.metal, true],
      [b.glow, M.glow, false],
      [b.glass, M.glass, false],
    ];
    for (const [bk, mat, cast] of pairs) {
      const g = bk.build();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = shadows && cast;
      mesh.receiveShadow = shadows || mat !== M.glow;
      mesh.frustumCulled = parent !== this.statics;
      parent.add(mesh);
      this.disposables.push(g);
    }
  }

  private addScatter(sc: Scatter) {
    const tuft = grassTuft();
    const flower = flowerGeo();
    this.disposables.push(tuft, flower);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: { m: THREE.Matrix4; c: THREE.Color }[]) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        im.setColorAt(i, it.c);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.statics.add(im);
      this.disposables.push({ dispose: () => im.dispose() });
    };
    mk(tuft, this.mats.grass, sc.grass);
    mk(flower, this.mats.flowers, sc.flowers);
  }

  /** A soft image-based light from the chapter's sky and cloud sea. */
  private makeEnv(mood: Mood) {
    const s = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: mood.skyTop },
        uHorizon: { value: mood.skyHorizon },
        uBelow: { value: mixCol(mood.cloudLit, mood.cloudShade, 0.5).multiplyScalar(0.55) },
        uSun: { value: mood.sunDir },
        uGlow: { value: mood.glow.clone().multiplyScalar(mood.night > 0.5 ? 0.6 : 1.6) },
      },
      vertexShader: "varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader:
        "uniform vec3 uTop, uHorizon, uBelow, uSun, uGlow; varying vec3 vD; void main(){ vec3 d = normalize(vD); float h = d.y; vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.7, h)); c = mix(c, uBelow, smoothstep(0.0, -0.25, h)); c += uGlow * pow(max(dot(d, uSun), 0.0), 6.0); gl_FragColor = vec4(c, 1.0); }",
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
    const rt = this.pmrem.fromScene(s, 0.02);
    mat.dispose();
    (s.children[0] as THREE.Mesh).geometry.dispose();
    this.envTarget = rt;
    return rt.texture;
  }

  private clearLevel() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.statics.clear();
    this.scenery.clear();
    this.elements.dispose();
    this.envTarget?.dispose();
    this.envTarget = null;
    this.env = null;
  }

  // --------------------------------------------------------------- settings

  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    const pr = Math.min(dpr, this.quality === "high" ? 2 : 1.25);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    const pw = Math.round(this.width * pr),
      ph = Math.round(this.height * pr);
    this.post.setSize(pw, ph, this.quality === "high" ? 1 : 0.5);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const scale = ph / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));
    this.effects.scale = scale;
    this.wisps.scale = scale;
    this.elementScale = scale;
  }
  private elementScale = 600;

  setQuality(q: Quality) {
    const changed = q !== this.quality;
    this.quality = q;
    const high = q === "high";
    this.key.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
    this.post.bloomOn = high;
    this.effects.density = high ? 1 : 0.45;
    this.backdrop.setQuality(high);
    this.resize(this.width, this.height, this.dpr);
    if (changed && this.level) this.load(this.level);
  }

  // ------------------------------------------------------------------ frame

  frame(input: FrameInput) {
    const { game, view, dt, clock, paused } = input;
    this.lastView = view;
    this.placeCamera(view, clock);
    if (layerOpacity(view.fold).sculpted === 0 || !this.level || !this.mood) return;
    const mood = this.mood;
    const playDt = paused ? 0 : dt;
    this.playTime += playDt;
    const t = this.playTime;
    U.uTime.value = clock;
    U.uWind.value.z = mood.wind * (view.reduced ? 0.35 : 1);
    this.effects.density = (this.quality === "high" ? 1 : 0.45) * (view.reduced ? 0.6 : 1);
    this.world.updateMatrixWorld(true);

    this.effects.halos.begin();
    this.effects.rays.begin();
    const lights: LightCandidate[] = [];
    this.elements.update(game, playDt, t, view.fold, this.effects, this.keeper.pos, mood, lights, view.reduced);
    const exit = this.elements.exitSphere;
    this.keeper.update(game, playDt, t, view.fold, view.reduced, this.effects, mood.keeperLight, exit);
    this.keeper.glow(this.effects.halos, mood.night);
    this.ambient(view, mood, playDt);
    this.effects.update(playDt, clock);
    this.effects.halos.end();
    this.effects.rays.end();
    this.updateUniformScale();

    // Pooled point lights go to the light sources nearest the focus.
    const f = view.focus;
    lights.sort((a, b) => a.pos.distanceToSquared(f as THREE.Vector3) - b.pos.distanceToSquared(f as THREE.Vector3));
    const active = this.quality === "high" ? 4 : 2;
    this.pool.forEach((l, i) => {
      const c = i < active ? lights[i] : undefined;
      if (c) {
        l.position.copy(c.pos);
        l.color.copy(c.color);
        l.intensity = c.intensity;
        l.distance = c.range;
      } else l.intensity = 0;
    });

    // The key light and its shadow follow the focus.
    const side = this.pose.side;
    const span = Math.max(view.viewHeight * (view.width / view.height), view.viewHeight) * 0.62 + 5 + view.cinematic * 20;
    const sc = this.key.shadow.camera;
    if (sc.right !== span) {
      sc.left = -span;
      sc.right = span;
      sc.top = span;
      sc.bottom = -span;
      sc.updateProjectionMatrix();
    }
    const tgt = new THREE.Vector3(f.x + 2, f.y - 1, f.z);
    const texel = (2 * span) / this.key.shadow.mapSize.x;
    const dir = mood.keyDir;
    const rightV = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const upV = new THREE.Vector3().crossVectors(dir, rightV).normalize();
    const a = Math.round(tgt.dot(rightV) / texel) * texel,
      b = Math.round(tgt.dot(upV) / texel) * texel,
      c = tgt.dot(dir);
    tgt.copy(rightV).multiplyScalar(a).addScaledVector(upV, b).addScaledVector(dir, c);
    this.key.target.position.copy(tgt);
    this.key.position.copy(tgt).addScaledVector(dir, 60);
    this.key.shadow.intensity = 1 - smooth(0.1, 0.8, side);
    this.key.target.updateMatrixWorld();

    this.backdrop.update(this.camera, this.renderer.getPixelRatio());
    this.birds.update(clock);
    this.post.apply(mood, view.reduced);

    this.renderer.info.reset();
    if (!this.compiled) {
      this.renderer.compile(this.scene, this.camera);
      this.compiled = true;
    }
    this.post.render(this.renderer, this.scene, this.camera, clock);
    const info = this.renderer.info.render;
    this.lastInfo = { calls: info.calls, triangles: info.triangles, points: info.points, lines: info.lines };
    this.frames++;
  }

  private ambientAcc = 0;
  private ambientRng = new Rng(77);
  /** Drifting life in the air: pollen, golden dust, petals, fireflies, motes. */
  private ambient(view: ViewFrame, mood: Mood, dt: number) {
    const fx = this.effects;
    const r = this.ambientRng;
    const rate = { morning: 14, noon: 8, afternoon: 14, dusk: 12, night: 10, dawn: 16 }[mood.time] * fx.density;
    this.ambientAcc += dt * rate;
    const f = view.focus;
    while (this.ambientAcc > 1) {
      this.ambientAcc -= 1;
      const x = f.x + r.range(-15, 15),
        y = f.y + r.range(-4, 6),
        z = f.z + r.range(-7, 5);
      switch (mood.time) {
        case "night":
          fx.sparks.spawn({ x, y, z, vx: r.range(-0.3, 0.3), vy: r.range(-0.1, 0.2), vz: r.range(-0.3, 0.3), life: r.range(2, 4), size: 0.09, size1: 0.07, color: new THREE.Color("#d8ff8a").multiplyScalar(2.4), drag: 0.2, curve: 1 });
          break;
        case "dusk":
          if (r.chance(0.5))
            fx.dust.spawn({ x, y, z, vx: r.range(0.2, 0.6), vy: r.range(-0.35, -0.1), vz: r.range(-0.2, 0.2), life: r.range(4, 7), size: 0.07, size1: 0.07, color: new THREE.Color(r.pick(["#d6b4ff", "#f2d8ff", "#b892f0"])), alpha: 0.85, drag: 0.1, curve: 1 });
          else fx.sparks.spawn({ x, y, z, vx: r.range(-0.1, 0.1), vy: r.range(0.1, 0.3), vz: 0, life: r.range(3, 5), size: 0.07, size1: 0.03, color: new THREE.Color("#ffb070").multiplyScalar(1.6), drag: 0.2, curve: 1 });
          break;
        default: {
          const warm = mood.time === "afternoon" || mood.time === "dawn";
          fx.sparks.spawn({
            x,
            y,
            z,
            vx: r.range(0.05, 0.35),
            vy: r.range(-0.05, 0.12),
            vz: r.range(-0.1, 0.1),
            life: r.range(3, 6),
            size: r.range(0.04, 0.08),
            size1: 0.03,
            color: new THREE.Color(warm ? "#ffd38a" : "#fff4d6").multiplyScalar(warm ? 1.3 : 1.0),
            drag: 0.1,
            curve: 1,
          });
        }
      }
    }
  }

  private updateUniformScale() {
    // Element dot materials share the point scale.
    this.elements.group.traverse((o) => {
      const m = (o as THREE.Points).material as THREE.ShaderMaterial | undefined;
      if (m && (o as THREE.Points).isPoints && m.uniforms?.uScale) m.uniforms.uScale.value = this.elementScale;
    });
  }

  private placeCamera(view: ViewFrame, clock: number) {
    const p = pose(view, clock, this.pose);
    this.camera.position.copy(p.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(p.target);
    if (this.camera.aspect !== view.width / view.height) {
      this.camera.aspect = view.width / view.height;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    // Flatten depth onto the focus plane.
    this.world.scale.z = p.depth;
    this.world.position.z = view.focus.z * (1 - p.depth);
  }

  // ----------------------------------------------------------------- events

  event(e: GameEvent, game: Game) {
    const fx = this.effects;
    const p = e.position;
    const time = this.mood?.time;
    const dustCol = new THREE.Color(time === "night" ? "#4e5a74" : time === "dusk" ? "#b9a6b8" : "#e2d6c2");
    switch (e.type) {
      case "jump":
        fx.puff(p.x, p.y - 0.6, p.z, 5, dustCol, 1.4);
        break;
      case "land": {
        const v = e.value ?? 0;
        this.keeper.onLand(v);
        fx.puff(p.x, p.y - 0.6, p.z, clamp(Math.round(v / 2), 3, 16), dustCol, 1 + v * 0.08);
        if (v > 15) fx.ring(p.x, p.y - 0.58, p.z, 1.4, dustCol.clone().multiplyScalar(0.8), 0.45);
        break;
      }
      case "step": {
        const side = (e.value ?? 0) ? 1 : -1;
        const h = game.player.heading;
        fx.puff(p.x - Math.sin(h) * side * 0.1, p.y - 0.6, p.z + Math.cos(h) * side * 0.1, 1, dustCol, 0.5, { size: 0.12, size1: 0.26, alpha: 0.4 });
        break;
      }
      case "bump":
        fx.burst(p.x, p.y + 0.6, p.z, 6, new THREE.Color("#fff0d0").multiplyScalar(1.5), 1.5);
        break;
      case "fold":
        this.keeper.onFold();
        fx.ring(this.keeper.sunPos.x, this.keeper.sunPos.y, this.keeper.sunPos.z, 1.2, new THREE.Color("#ffd98a").multiplyScalar(2), 0.5, true);
        break;
      case "seed":
        fx.burst(p.x, p.y, p.z, 70, new THREE.Color("#ffcc55").multiplyScalar(3), 6, { life: 1.2 });
        fx.burst(p.x, p.y, p.z, 30, new THREE.Color("#fff3c8").multiplyScalar(3), 3, { grav: -1.5 });
        fx.ring(p.x, p.y, p.z, 3.2, new THREE.Color("#ffd27a").multiplyScalar(3), 0.9, true);
        fx.ring(p.x, p.y - 0.9, p.z, 2.4, new THREE.Color("#ffd27a").multiplyScalar(2), 1.1);
        break;
      case "mote":
        fx.burst(p.x, p.y, p.z, 18, new THREE.Color("#fff1c8").multiplyScalar(2.4), 2.4);
        break;
      case "checkpoint":
        if (e.id) this.elements.lightCheckpoint(e.id);
        fx.ring(p.x, p.y - 0.38, p.z, 2.4, new THREE.Color("#ffc65a").multiplyScalar(2.5), 1);
        fx.burst(p.x, p.y, p.z, 30, new THREE.Color("#ffd27a").multiplyScalar(2.5), 3, { grav: -1 });
        break;
      case "lantern": {
        const from = e.id ? this.elements.lanternFlame(e.id) : null;
        if (from) {
          fx.burst(from.x, from.y, from.z, 36, new THREE.Color("#ffb45a").multiplyScalar(3), 3.2);
          fx.ring(from.x, from.y, from.z, 1.8, new THREE.Color("#ffbe6a").multiplyScalar(2.5), 0.7, true);
          for (const w of game.level.walls)
            if (w.lantern === e.id) fx.thread(from, new THREE.Vector3(w.x, w.y + w.h * 0.55, w.z), new THREE.Color("#ffc66a").multiplyScalar(3), 0.55);
          for (const i of game.level.islands)
            if (i.lantern === e.id) fx.thread(from, new THREE.Vector3(i.x, i.y, i.z), new THREE.Color("#ffc66a").multiplyScalar(3), 0.55);
        }
        break;
      }
      case "gate":
      case "bridge":
        break;
      case "die":
        this.keeper.onDie(fx, e.cause);
        break;
      case "respawn":
        this.keeper.onRespawn(fx);
        break;
      case "exit": {
        const s = this.elements.exitSphere ?? this.exitPos;
        fx.burst(s.x, s.y, s.z, 90, new THREE.Color("#ffd27a").multiplyScalar(3), 7, { life: 1.6 });
        fx.ring(this.exitPos.x, this.exitPos.y + 0.1, this.exitPos.z, 4.5, new THREE.Color("#ffd27a").multiplyScalar(3), 1.4);
        break;
      }
      case "locked":
        fx.burst(this.exitPos.x, this.exitPos.y + 0.7, this.exitPos.z - 1.05, 14, new THREE.Color("#b8c4d8").multiplyScalar(1.5), 1.2);
        break;
      case "hint":
        break;
    }
  }

  // ------------------------------------------------------------- reporting

  project(p: Vec3) {
    const v = this.lastView;
    if (!v) return null;
    const d = this.pose.depth;
    const z = v.focus.z + (p.z - v.focus.z) * d;
    const q = new THREE.Vector3(p.x, p.y, z).project(this.camera);
    if (q.z > 1 || q.z < -1) return null;
    return { x: ((q.x + 1) / 2) * this.width, y: ((1 - q.y) / 2) * this.height };
  }

  snapshot() {
    const info = this.renderer.info;
    return {
      engine: "webgl",
      frames: this.frames,
      drawCalls: this.lastInfo.calls,
      triangles: this.lastInfo.triangles,
      points: this.lastInfo.points,
      lines: this.lastInfo.lines,
      quality: this.quality,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      pixelRatio: this.renderer.getPixelRatio(),
      level: this.level?.id ?? null,
      time: this.level?.theme.time ?? null,
      depth: this.pose.depth,
      side: this.pose.side,
      cross: CROSS,
    };
  }
}

// ------------------------------------------------------------ scatter bits

function grassTuft() {
  const pos: number[] = [];
  const colr: number[] = [];
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i * 0.7;
    const lean = 0.05 + (i % 3) * 0.03;
    const h = 0.17 + ((i * 37) % 10) * 0.012;
    const bx = Math.cos(a) * 0.03,
      bz = Math.sin(a) * 0.03;
    const w = 0.022;
    const px = -Math.sin(a) * w,
      pz = Math.cos(a) * w;
    const tx = bx + Math.cos(a) * lean,
      tz = bz + Math.sin(a) * lean;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz);
    colr.push(0.82, 0.86, 0.78, 0.82, 0.86, 0.78, 1.18, 1.16, 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
  g.computeVertexNormals();
  // Normals up for soft, grassy lighting.
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function flowerGeo() {
  const parts: THREE.BufferGeometry[] = [];
  const stem = new THREE.CylinderGeometry(0.006, 0.008, 0.2, 3).translate(0, 0.1, 0);
  const head = new THREE.CircleGeometry(0.05, 5).rotateX(-Math.PI / 2 + 0.3).translate(0, 0.205, 0.01);
  const centre = new THREE.IcosahedronGeometry(0.018, 0).translate(0, 0.215, 0.012);
  const col = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  parts.push(col(stem, new THREE.Color("#3f6b3a")), col(head, new THREE.Color(1, 1, 1)), col(centre, new THREE.Color("#ffd23a")));
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3),
    colr = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    if (!p.attributes.normal) p.computeVertexNormals();
    pos.set(p.attributes.position.array as Float32Array, o);
    nor.set(p.attributes.normal.array as Float32Array, o);
    colr.set(p.attributes.color.array as Float32Array, o);
    o += p.attributes.position.array.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colr, 3));
  return g;
}
