import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Game, type Event } from "./core";
import { platformAt, hazardAt, type Level, type Platform } from "./levels";

const TAU = Math.PI * 2;
const lerp = T.MathUtils.lerp;
const rand = (seed: number) => {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
function mat(color: string, roughness = 0.8, metalness = 0) {
  return new T.MeshStandardMaterial({ color, roughness, metalness });
}
const boxGeo = new T.BoxGeometry(1, 1, 1),
  sphereGeo = new T.SphereGeometry(1, 20, 12),
  icoGeo = new T.IcosahedronGeometry(1, 1),
  cylinderGeo = new T.CylinderGeometry(1, 1, 1, 16);
const bevelGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.045);
function batch(group: T.Group, exclude: T.Object3D[] = []) {
  const sets = new Map<
    T.Material,
    { mesh: T.Mesh; geometry: T.BufferGeometry }[]
  >();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      Array.isArray(o.material) ||
      exclude.includes(o)
    )
      return;
    const relative = new T.Matrix4()
      .copy(group.matrixWorld)
      .invert()
      .multiply(o.matrixWorld);
    let geometry = o.geometry.clone();
    if (geometry.index) {
      const flat = geometry.toNonIndexed();
      geometry.dispose();
      geometry = flat;
    }
    geometry.applyMatrix4(relative);
    const entries = sets.get(o.material) ?? [];
    entries.push({ mesh: o, geometry });
    sets.set(o.material, entries);
  });
  for (const [material, entries] of sets) {
    if (entries.length < 2) {
      entries[0]?.geometry.dispose();
      continue;
    }
    const combined = mergeGeometries(
      entries.map((e) => e.geometry),
      false,
    );
    entries.forEach((e) => {
      e.mesh.removeFromParent();
      e.geometry.dispose();
    });
    if (combined) {
      const mesh = new T.Mesh(combined, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}
function stoneTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      const vein = Math.sin(x * 0.06 + y * 0.02 + Math.sin(y * 0.023) * 6);
      const value = 239 + rand(x + y * 256) * 12 - vein * vein * 9;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}
function box(
  parent: T.Object3D,
  material: T.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  const m = new T.Mesh(boxGeo, material);
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function ball(
  parent: T.Object3D,
  material: T.Material,
  x: number,
  y: number,
  z: number,
  r: number,
  geo: T.BufferGeometry = sphereGeo,
) {
  const m = new T.Mesh(geo, material);
  m.position.set(x, y, z);
  m.scale.setScalar(r);
  parent.add(m);
  return m;
}
function cylinder(
  parent: T.Object3D,
  material: T.Material,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
) {
  const m = new T.Mesh(cylinderGeo, material);
  m.position.set(x, y, z);
  m.scale.set(r, h, r);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function ring(
  parent: T.Object3D,
  material: T.Material,
  x: number,
  y: number,
  z: number,
  r: number,
  tube = 0.035,
) {
  const m = new T.Mesh(new T.TorusGeometry(r, tube, 6, 64), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const glow = (color: string, intensity = 1) =>
  new T.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.25,
  });
type Particle = {
  mesh: T.Mesh;
  velocity: T.Vector3;
  life: number;
  max: number;
};
export class World {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(40, 1, 0.1, 400);
  ortho = new T.OrthographicCamera();
  perspective = new T.PerspectiveCamera(40, 1, 0.1, 400);
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  root = new T.Group();
  background = new T.Group();
  keeper = new T.Group();
  scarf: T.Mesh;
  body: T.Group;
  legs: T.Mesh[] = [];
  arms: T.Mesh[] = [];
  light: T.PointLight;
  platformObjects = new Map<string, T.Group>();
  collectObjects = new Map<string, T.Group>();
  hazardObjects: T.Group[] = [];
  checkpointObjects: T.Group[] = [];
  portal = new T.Group();
  portalRings: T.Mesh[] = [];
  particles: Particle[] = [];
  moths: T.Object3D[] = [];
  grass: T.Mesh[] = [];
  sun: T.Group;
  clouds: T.Mesh[] = [];
  water: T.Mesh;
  sky: T.Mesh;
  blend = 1;
  target = new T.Vector3(10, 1, 0);
  visualPosition = new T.Vector3();
  clock = 0;
  shake = 0;
  width = 1280;
  height = 800;
  low = false;
  reduced = false;
  fps = 60;
  frames = 0;
  fpsTime = 0;
  level: Level | null = null;
  beacon = 0;
  private ambient: T.HemisphereLight;
  private sunlight: T.DirectionalLight;
  private leafMaterial: T.MeshStandardMaterial;
  private metal = mat("#b89b61", 0.35, 0.65);
  private white = mat("#e7e9df", 0.65);
  private dark = mat("#163e4c", 0.42, 0.3);
  private red = mat("#d46858", 0.7);
  private stoneMap = stoneTexture();
  private leafGeo = new T.SphereGeometry(1, 8, 4);
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.scene.add(this.root, this.background, this.keeper);
    this.scene.fog = new T.FogExp2("#bfd9dc", 0.012);
    this.ambient = new T.HemisphereLight("#fff6df", "#315566", 2.0);
    this.scene.add(this.ambient);
    this.sunlight = new T.DirectionalLight("#fff0c8", 2.5);
    this.sunlight.position.set(-8, 20, 12);
    this.sunlight.castShadow = true;
    this.sunlight.shadow.mapSize.set(2048, 2048);
    this.sunlight.shadow.camera.left = -25;
    this.sunlight.shadow.camera.right = 25;
    this.sunlight.shadow.camera.top = 20;
    this.sunlight.shadow.camera.bottom = -20;
    this.sunlight.shadow.normalBias = 0.045;
    this.sunlight.shadow.bias = -0.0002;
    this.scene.add(this.sunlight, this.sunlight.target);
    this.leafMaterial = mat("#63897a");
    this.sky = new T.Mesh(
      new T.SphereGeometry(190, 32, 20),
      new T.ShaderMaterial({
        side: T.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new T.Color("#619cb9") },
          bottom: { value: new T.Color("#e2ebda") },
        },
        vertexShader:
          "varying vec3 v; void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader:
          "varying vec3 v; uniform vec3 top;uniform vec3 bottom;void main(){float h=clamp(normalize(v).y*.9+.4,0.,1.);gl_FragColor=vec4(mix(bottom,top,h),1.);}",
      }),
    );
    this.scene.add(this.sky);
    this.sun = new T.Group();
    this.background.add(this.sun);
    const disk = ball(
      this.sun,
      new T.MeshBasicMaterial({ color: "#ffedb2" }),
      0,
      0,
      0,
      5,
    );
    disk.scale.z = 0.1;
    ring(
      this.sun,
      new T.MeshBasicMaterial({
        color: "#ffe3a0",
        transparent: true,
        opacity: 0.25,
      }),
      0,
      0,
      0,
      6.2,
      0.02,
    );
    ring(
      this.sun,
      new T.MeshBasicMaterial({
        color: "#ffe3a0",
        transparent: true,
        opacity: 0.16,
      }),
      0,
      0,
      0,
      7.3,
      0.025,
    );
    this.sun.position.set(-20, 14, -70);
    const waterMaterial = new T.ShaderMaterial({
      transparent: true,
      uniforms: {
        time: { value: 0 },
        a: { value: new T.Color("#86b6bc") },
        b: { value: new T.Color("#d8e2d1") },
      },
      vertexShader:
        "varying vec2 uvv;uniform float time; void main(){uvv=uv;vec3 p=position;p.z+=sin(p.x*.12+time*.25)*.5+cos(p.y*.09+time*.21)*.4;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}",
      fragmentShader:
        "varying vec2 uvv; uniform float time;uniform vec3 a;uniform vec3 b;void main(){float w=sin(uvv.x*200.+sin(uvv.y*50.+time*.3)*2.)*sin(uvv.y*240.+time*.25);gl_FragColor=vec4(mix(a,b,smoothstep(.4,.99,w)*.5),.9);}",
    });
    this.water = new T.Mesh(
      new T.PlaneGeometry(500, 500, 80, 80),
      waterMaterial,
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -16;
    this.scene.add(this.water);
    this.buildKeeper();
    this.body = this.keeper.getObjectByName("body") as T.Group;
    this.scarf = this.keeper.getObjectByName("scarf") as T.Mesh;
    this.light = new T.PointLight("#ffd886", 3, 8, 2);
    this.light.position.set(0, 1.1, 0);
    this.keeper.add(this.light);
    const cloudMat = new T.MeshBasicMaterial({
      color: "#e2e8dc",
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });
    for (let i = 0; i < 40; i++) {
      const m = new T.Mesh(icoGeo, cloudMat);
      m.position.set(
        rand(i) * 160 - 45,
        -9 + rand(i + 1) * 5,
        rand(i + 2) * 100 - 70,
      );
      m.scale.set(
        7 + rand(i + 3) * 8,
        1 + rand(i + 4) * 1.6,
        4 + rand(i + 5) * 7,
      );
      this.background.add(m);
      this.clouds.push(m);
    }
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new T.Vector2(1280, 800), 0.28, 0.55, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }
  buildKeeper() {
    const b = new T.Group();
    b.name = "body";
    this.keeper.add(b);
    cylinder(b, this.white, 0, 0.57, 0, 0.23, 0.43);
    ball(b, this.white, 0, 0.88, 0, 0.29);
    const visor = ball(b, this.dark, 0, 0.91, 0.226, 0.21);
    visor.scale.multiply(new T.Vector3(1, 0.63, 0.46));
    const eyes = glow("#f5d48a", 1.2);
    ball(b, eyes, -0.075, 0.92, 0.322, 0.028);
    ball(b, eyes, 0.075, 0.92, 0.322, 0.028);
    cylinder(b, this.metal, 0, 0.68, 0, 0.245, 0.06);
    const collar = new T.Mesh(
      new T.TorusGeometry(0.22, 0.045, 8, 20),
      this.red,
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.75;
    b.add(collar);
    const scarf = box(b, this.red, -0.32, 0.62, 0.05, 0.5, 0.09, 0.17);
    scarf.name = "scarf";
    scarf.rotation.z = 0.23;
    for (const side of [-1, 1]) {
      const leg = box(b, this.dark, side * 0.125, 0.2, 0, 0.135, 0.34, 0.16);
      const boot = box(leg, this.white, 0, -0.48, 0.16, 1.1, 0.4, 1.4);
      boot.castShadow = true;
      this.legs.push(leg);
      const arm = box(b, this.white, side * 0.31, 0.55, 0, 0.13, 0.38, 0.15);
      this.arms.push(arm);
    }
    const pack = box(b, this.metal, 0, 0.55, -0.21, 0.28, 0.32, 0.13);
    ball(pack, glow("#ffd285", 1.8), 0, 0.1, -0.65, 0.42);
    const shadow = new T.Mesh(
      new T.CircleGeometry(0.48, 32),
      new T.MeshBasicMaterial({
        color: "#193e45",
        opacity: 0.18,
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.008;
    this.keeper.add(shadow);
  }
  clearRoot() {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        if (
          ![
            boxGeo,
            sphereGeo,
            icoGeo,
            cylinderGeo,
            bevelGeo,
            this.leafGeo,
          ].includes(o.geometry)
        )
          geometries.add(o.geometry);
        if (Array.isArray(o.material))
          o.material.forEach((m) => materials.add(m));
        else if (
          ![
            this.metal,
            this.white,
            this.dark,
            this.red,
            this.leafMaterial,
          ].includes(o.material)
        )
          materials.add(o.material);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.root.clear();
    this.platformObjects.clear();
    this.collectObjects.clear();
    this.hazardObjects = [];
    this.checkpointObjects = [];
    this.grass = [];
    this.moths = [];
    this.portalRings = [];
    this.particles.forEach((p) => {
      this.scene.remove(p.mesh);
      p.mesh.material instanceof T.Material && p.mesh.material.dispose();
    });
    this.particles = [];
  }
  load(level: Level) {
    this.clearRoot();
    this.level = level;
    this.beacon = 0;
    this.target.set(level.start.x + 5, 2, 0);
    this.visualPosition.set(level.start.x, level.start.y, level.start.z);
    const stone = mat(level.stone, 0.95);
    stone.map = this.stoneMap;
    const edge = mat(new T.Color(level.stone).multiplyScalar(0.72).getStyle());
    this.leafMaterial.color.set(level.leaf);
    const flower = mat(level.accent);
    const leafLight = mat(
      new T.Color(level.leaf).lerp(new T.Color("#cee0a4"), 0.35).getStyle(),
    );
    const wood = mat("#806f53");
    (this.scene.fog as T.FogExp2).color.set(level.mist);
    const sky = this.sky.material as T.ShaderMaterial;
    sky.uniforms.top.value.set(level.sky);
    sky.uniforms.bottom.value.set(level.mist);
    const water = this.water.material as T.ShaderMaterial;
    water.uniforms.a.value.set(level.sky);
    water.uniforms.b.value.set(level.mist);
    (this.clouds[0].material as T.MeshBasicMaterial).color.set(level.mist);
    this.sunlight.color.set(level.accent);
    level.platforms.forEach((p, i) => {
      const group = new T.Group();
      group.position.set(p.x, p.y, p.z);
      this.root.add(group);
      this.platformObjects.set(p.id, group);
      const carved = new T.Mesh(bevelGeo, stone);
      carved.scale.set(p.w, 0.96, p.d);
      carved.position.y = -0.48;
      carved.castShadow = true;
      carved.receiveShadow = true;
      group.add(carved);
      box(group, edge, 0, -1.08, 0, p.w * 0.83, 0.27, p.d * 0.83);
      // Layered carved plinth, broken rock keel, and restrained gilded paving.
      box(group, this.metal, 0, -0.08, 0, p.w + 0.04, 0.055, p.d + 0.04);
      box(group, stone, 0, -0.015, 0, p.w, 0.08, p.d);
      for (let k = 0; k < Math.floor(p.w); k++) {
        box(group, edge, -p.w / 2 + k + 1, 0.031, 0, 0.013, 0.012, p.d * 0.9);
      }
      for (const z of [-p.d * 0.31, p.d * 0.31])
        box(group, this.metal, 0, 0.032, z, p.w * 0.88, 0.012, 0.024);
      for (const x of [-p.w * 0.4, p.w * 0.4])
        box(group, this.metal, x, 0.035, 0, 0.025, 0.013, p.d * 0.62);
      for (let rock = 0; rock < 4; rock++) {
        const keel = new T.Mesh(
          new T.ConeGeometry(
            Math.min(p.w, p.d) * (0.3 + rand(i * 31 + rock) * 0.25),
            2 + rand(i * 33 + rock) * 2,
            5,
          ),
          rock % 2 ? edge : stone,
        );
        keel.rotation.z = Math.PI;
        keel.rotation.y = rock * 0.7;
        keel.position.set(
          (rand(i * 37 + rock) - 0.5) * p.w * 0.36,
          -1.5 - rand(i * 39 + rock),
          (rand(i * 43 + rock) - 0.5) * p.d * 0.4,
        );
        keel.castShadow = true;
        group.add(keel);
      }
      const halo = ring(
        group,
        new T.MeshBasicMaterial({
          color: level.accent,
          transparent: true,
          opacity: 0.25,
        }),
        0,
        -1.15,
        0,
        Math.min(p.w, p.d) * 0.55,
        0.024,
      );
      halo.rotation.x = Math.PI / 2;
      if (p.kind === "lift") {
        for (const x of [-p.w * 0.45, p.w * 0.45])
          box(
            group,
            glow(level.accent, 0.5),
            x,
            -0.38,
            p.d * 0.51,
            0.1,
            0.6,
            0.04,
          );
      }
      // Gardens live at the rear edge, keeping the playable silhouette unobstructed.
      for (let j = 0; j < 12; j++) {
        const seed = i * 41 + j * 7;
        const x = (rand(seed) - 0.5) * p.w * 0.86,
          z = -p.d / 2 + 0.25 + rand(seed + 1) * 0.9;
        const h = 0.35 + rand(seed + 2) * 0.6;
        box(group, this.leafMaterial, x, h / 2, z, 0.026, h, 0.026);
        for (let l = 0; l < 3; l++) {
          const side = l % 2 ? 1 : -1;
          const leaf = ball(
            group,
            l % 2 ? this.leafMaterial : leafLight,
            x + side * 0.12,
            h * (0.35 + l * 0.18),
            z,
            0.15,
            this.leafGeo,
          );
          leaf.scale.multiply(new T.Vector3(1.9, 0.35, 0.9));
          leaf.rotation.z = side * 0.5;
        }
        if (j % 3 === 0) {
          ball(group, flower, x, h, z, 0.09, icoGeo);
          for (let petal = 0; petal < 5; petal++)
            ball(
              group,
              flower,
              x + Math.cos((petal * TAU) / 5) * 0.1,
              h,
              z + Math.sin((petal * TAU) / 5) * 0.1,
              0.07,
              this.leafGeo,
            );
        }
      }
      // Trailing vines, relief medallions, and a wind-shaped tree break the plinth silhouette.
      for (let v = 0; v < 3; v++) {
        const x = (rand(i * 91 + v) - 0.5) * p.w * 0.75;
        for (let l = 0; l < 6; l++) {
          const leaf = ball(
            group,
            this.leafMaterial,
            x + Math.sin(l * 0.9) * 0.15,
            -0.15 - l * 0.21,
            p.d / 2 + 0.02,
            0.14,
            this.leafGeo,
          );
          leaf.scale.multiply(new T.Vector3(1, 0.45, 0.55));
          leaf.rotation.z = l * 0.8;
        }
      }
      for (const x of [-p.w * 0.28, 0, p.w * 0.28]) {
        ring(group, this.metal, x, -0.49, p.d / 2 + 0.016, 0.17, 0.018);
        box(group, this.metal, x, -0.47, p.d / 2 + 0.026, 0.025, 0.23, 0.012);
      }
      if (i % 2 === 0) {
        const tree = new T.Group();
        tree.position.set(-p.w * 0.34, 0, -p.d * 0.32);
        group.add(tree);
        const trunk = cylinder(tree, wood, 0, 0.75, 0, 0.09, 1.5);
        trunk.rotation.z = -0.17;
        for (let b = 0; b < 5; b++) {
          const canopy = ball(
            tree,
            b % 2 ? leafLight : this.leafMaterial,
            Math.sin(b * 1.7) * 0.5 - 0.25,
            1.5 + rand(i * 101 + b) * 0.6,
            Math.cos(b * 1.7) * 0.3,
            0.5,
            icoGeo,
          );
          canopy.scale.multiply(new T.Vector3(1.3, 0.7, 1));
          canopy.castShadow = true;
        }
      }
      if (i === 0 || i === level.platforms.length - 1 || i % 3 === 0)
        this.architecture(group, p, i === level.platforms.length - 1, stone);
      batch(group);
    });
    level.walls.forEach((w) => {
      const group = new T.Group();
      group.position.set(w.x, w.y, w.z);
      this.root.add(group);
      box(group, stone, 0, w.h / 2, 0, w.w, w.h, w.d);
      box(group, this.metal, 0, w.h - 0.2, 0, w.w + 0.15, 0.14, w.d + 0.15);
      for (const z of [-w.d / 2 - 0.018, w.d / 2 + 0.018]) {
        ring(group, this.metal, 0, w.h * 0.6, z, 0.42, 0.055);
        box(group, this.metal, 0, w.h * 0.35, z, 0.06, w.h * 0.55, 0.025);
      }
    });
    level.collectibles.forEach((c) => {
      const group = new T.Group();
      group.position.set(c.x, c.y, c.z);
      this.root.add(group);
      this.collectObjects.set(c.id, group);
      const light = glow(
        c.kind === "shard" ? level.accent : "#e6fcf3",
        c.kind === "shard" ? 1.6 : 1.1,
      );
      const seed = ball(
        group,
        light,
        0,
        0,
        0,
        c.kind === "shard" ? 0.22 : 0.11,
        new T.OctahedronGeometry(1, 0),
      );
      seed.rotation.z = Math.PI / 4;
      if (c.kind === "shard") {
        ring(group, this.metal, 0, 0, 0, 0.4, 0.035);
        const second = ring(group, this.metal, 0, 0, 0, 0.31, 0.022);
        second.rotation.y = Math.PI / 2;
        const ray = new T.Mesh(
          new T.CylinderGeometry(0.018, 0.06, 1.2, 6),
          new T.MeshBasicMaterial({
            color: level.accent,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
          }),
        );
        ray.position.y = -0.7;
        group.add(ray);
      }
    });
    level.hazards.forEach((h) => {
      const g = new T.Group();
      this.root.add(g);
      this.hazardObjects.push(g);
      ball(
        g,
        glow("#f09997", 1),
        0,
        0,
        0,
        h.r * 0.6,
        new T.OctahedronGeometry(1, 0),
      );
      const orbit = ring(g, this.dark, 0, 0, 0, h.r, 0.07);
      orbit.rotation.x = 0.7;
      const orbit2 = ring(g, this.metal, 0, 0, 0, h.r * 0.8, 0.04);
      orbit2.rotation.y = 0.9;
      for (let j = 0; j < 6; j++) {
        ball(
          g,
          this.red,
          Math.cos((j * TAU) / 6) * h.r,
          Math.sin((j * TAU) / 6) * h.r,
          0,
          0.07,
          icoGeo,
        );
      }
    });
    level.checkpoints.forEach((c) => {
      const g = new T.Group();
      g.position.set(c.x, c.y + 0.025, c.z);
      this.root.add(g);
      this.checkpointObjects.push(g);
      const r = ring(g, this.metal, 0, 0, 0, 0.65, 0.05);
      r.rotation.x = Math.PI / 2;
      const inner = ring(g, glow(level.accent, 0.4), 0, 0, 0, 0.43, 0.026);
      inner.rotation.x = Math.PI / 2;
    });
    this.portal = new T.Group();
    this.portal.position.set(level.exit.x, level.exit.y, level.exit.z);
    this.root.add(this.portal);
    const plinth = cylinder(this.portal, stone, 0, 0.1, 0, 1.2, 0.2);
    plinth.castShadow = true;
    for (let i = 0; i < 3; i++) {
      const r = ring(
        this.portal,
        this.metal,
        0,
        1.7,
        0,
        1.15 + i * 0.15,
        0.055,
      );
      r.rotation.y = (i * Math.PI) / 3;
      this.portalRings.push(r);
    }
    ball(
      this.portal,
      glow(level.accent, 0.3),
      0,
      1.7,
      0,
      0.36,
      new T.IcosahedronGeometry(1, 2),
    );
    cylinder(this.portal, this.metal, 0, 0.65, 0, 0.11, 1.2);
    // Monumental distant observatories make the level read as a place.
    const pale = mat(
      new T.Color(level.mist)
        .lerp(new T.Color(level.sky), 0.55)
        .multiplyScalar(0.85)
        .getStyle(),
    );
    for (let i = 0; i < 9; i++) {
      const g = new T.Group();
      g.position.set(
        i * 14 - 18,
        -10 + rand(i + 80) * 2,
        -48 - rand(i + 90) * 35,
      );
      const h = 3 + rand(i + 100) * 5;
      cylinder(g, pale, 0, h / 2, 0, 1.3, h);
      cylinder(g, pale, 0, h, 0, 2.3, 0.4);
      const dome = ball(g, pale, 0, h + 0.3, 0, 2.2);
      dome.scale.y = 0.7;
      ring(g, pale, 0, h + 2, 0, 2.9, 0.085);
      for (const side of [-1, 1])
        cylinder(g, pale, side * 2.8, h / 2, 0, 0.3, h + 1);
      batch(g);
      this.root.add(g);
    }
    for (let i = 0; i < 25; i++) {
      const moth = new T.Group();
      ball(
        moth,
        new T.MeshBasicMaterial({ color: level.accent }),
        0,
        0,
        0,
        0.027,
      );
      moth.position.set(
        rand(i + 211) * 50,
        -1 + rand(i + 215) * 6,
        rand(i + 216) * 15 - 8,
      );
      this.root.add(moth);
      this.moths.push(moth);
    }
  }
  architecture(group: T.Group, p: Platform, final: boolean, stone: T.Material) {
    const z = -p.d / 2 + 0.5;
    for (const x of [-p.w * 0.34, p.w * 0.34]) {
      cylinder(group, stone, x, 1.35, z, 0.24, 2.7);
      cylinder(group, this.metal, x, 0.13, z, 0.32, 0.12);
      cylinder(group, this.metal, x, 2.65, z, 0.31, 0.15);
      for (let i = 0; i < 5; i++) {
        const a = (i * TAU) / 5;
        box(
          group,
          this.metal,
          x + Math.cos(a) * 0.245,
          1.4,
          z + Math.sin(a) * 0.245,
          0.035,
          2.3,
          0.035,
        );
      }
    }
    box(group, stone, 0, 2.95, z, p.w * 0.78, 0.35, 0.7);
    box(group, this.metal, 0, 3.14, z, p.w * 0.8, 0.06, 0.74);
    if (final) {
      const instrument = new T.Group();
      instrument.position.set(0, 4.5, z);
      group.add(instrument);
      for (let j = 0; j < 3; j++) {
        const r = ring(instrument, this.metal, 0, 0, 0, 1.7 + j * 0.25, 0.06);
        r.rotation.y = j * 0.8;
        r.rotation.x = j * 0.5;
      }
      ball(instrument, glow("#ffe5a3", 0.9), 0, 0, 0, 0.55);
      const sail = box(
        group,
        mat("#edf1df"),
        0,
        2.15,
        z - 0.4,
        p.w * 0.25,
        1.4,
        0.025,
      );
      sail.rotation.z = 0.08;
    } else {
      const moon = ring(group, this.metal, 0, 3.7, z, 0.57, 0.06);
      moon.rotation.y = 0.5;
    }
  }
  resize() {
    this.width = innerWidth;
    this.height = innerHeight;
    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
  }
  quality(low: boolean) {
    this.low = low;
    this.renderer.setPixelRatio(
      low
        ? Math.min(devicePixelRatio * 0.75, 1)
        : Math.min(devicePixelRatio, 1.7),
    );
    this.renderer.shadowMap.enabled = !low;
    this.bloom.enabled = !low;
    this.resize();
  }
  event(e: Event) {
    if (e.type === "fall") this.shake = 0.13;
    if (e.type === "shift") this.shake = this.reduced ? 0 : 0.045;
    if (e.type === "clear") {
      this.beacon = 1;
      this.shake = 0.1;
    }
    if (
      ["shard", "mote", "checkpoint", "land", "clear", "shift"].includes(e.type)
    ) {
      const count =
        e.type === "clear"
          ? 70
          : e.type === "shard"
            ? 22
            : e.type === "shift"
              ? 14
              : 8;
      for (let i = 0; i < count; i++) {
        const m = new T.Mesh(
          icoGeo,
          new T.MeshBasicMaterial({
            color:
              e.type === "land" ? "#d6e0d0" : (this.level?.accent ?? "#ffda8b"),
            transparent: true,
          }),
        );
        m.position.set(e.position.x, e.position.y, e.position.z);
        m.scale.setScalar(e.type === "clear" ? 0.075 : 0.045);
        this.scene.add(m);
        const life = 0.5 + Math.random() * 1.1;
        this.particles.push({
          mesh: m,
          velocity: new T.Vector3(
            (Math.random() - 0.5) * 4,
            Math.random() * 3,
            (Math.random() - 0.5) * 4,
          ),
          life,
          max: life,
        });
      }
    }
  }
  update(game: Game, dt: number, menu: boolean, paused: boolean, frameDt = dt) {
    this.clock += dt;
    this.frames++;
    this.fpsTime += frameDt;
    if (this.fpsTime > 1) {
      this.fps = this.frames / this.fpsTime;
      this.frames = 0;
      this.fpsTime = 0;
    }
    const t = paused ? game.time : menu ? this.clock : game.time;
    const goal = menu ? 1 : game.mode === "3d" ? 1 : 0;
    this.blend = lerp(
      this.blend,
      goal,
      Math.min(1, dt * (this.reduced ? 24 : 7)),
    );
    if (Math.abs(goal - this.blend) < 0.001) this.blend = goal;
    const b = game.player;
    const targetZ = menu ? 0 : b.z * 0.55;
    const targetX = menu ? 11 : Math.max(1, b.x + 2.3);
    const targetY = menu ? 1.8 : Math.max(1.5, b.y + 1.6);
    this.target.x = lerp(this.target.x, targetX, Math.min(1, dt * 3.8));
    this.target.y = lerp(this.target.y, targetY, Math.min(1, dt * 3.8));
    this.target.z = lerp(this.target.z, targetZ, Math.min(1, dt * 4));
    const aspect = this.width / this.height;
    const viewHeight = aspect < 0.8 ? 19 : aspect < 1.3 ? 16 : 13.6;
    const distance = viewHeight / (2 * Math.tan(T.MathUtils.degToRad(40) / 2));
    this.camera.position
      .copy(this.target)
      .add(new T.Vector3(this.blend * 6, this.blend * 7.8, distance));
    this.camera.lookAt(this.target);
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const actualDistance = this.camera.position.distanceTo(this.target);
    const orthoHeight =
      actualDistance * Math.tan(T.MathUtils.degToRad(40) / 2) * 2;
    this.ortho.left = (-orthoHeight * aspect) / 2;
    this.ortho.right = (orthoHeight * aspect) / 2;
    this.ortho.top = orthoHeight / 2;
    this.ortho.bottom = -orthoHeight / 2;
    this.ortho.near = 0.1;
    this.ortho.far = 400;
    this.ortho.updateProjectionMatrix();
    const pm = this.perspective.projectionMatrix.elements,
      om = this.ortho.projectionMatrix.elements,
      out = this.camera.projectionMatrix.elements;
    // Homogeneous matrices must share their focal-plane scale before interpolation.
    for (let i = 0; i < 16; i++)
      out[i] = lerp(om[i], pm[i] / actualDistance, this.blend);
    this.camera.projectionMatrixInverse
      .copy(this.camera.projectionMatrix)
      .invert();
    if (this.shake > 0 && !this.reduced) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 12);
    }
    this.sky.position.copy(this.camera.position);
    this.sun.position.set(this.target.x + 4, lerp(8, -1, this.blend), -70);
    this.sun.scale.setScalar(lerp(0.4, 1, this.blend));
    this.sunlight.position.set(b.x - 8, 20, 12);
    this.sunlight.target.position.set(b.x, 0, 0);
    this.keeper.position.set(b.x, b.y, b.z);
    this.keeper.visible =
      game.invincible === 0 || Math.floor(game.invincible * 12) % 2 === 0;
    const velocity = Math.hypot(b.vx, b.vz),
      stride = t * 13;
    this.body.rotation.y = lerp(
      this.body.rotation.y,
      b.facing * 0.5 + Math.atan2(b.vx, b.vz || 0.001) * 0.45,
      Math.min(1, dt * 9),
    );
    this.body.position.y = b.grounded
      ? Math.abs(Math.sin(stride)) * 0.025 * velocity
      : 0.04;
    this.body.rotation.z = lerp(this.body.rotation.z, -b.vx * 0.015, dt * 6);
    this.legs.forEach(
      (l, i) =>
        (l.rotation.x = b.grounded
          ? Math.sin(stride + i * Math.PI) * 0.5 * (velocity / 5.9)
          : i === 0
            ? -0.5
            : 0.45),
    );
    this.arms.forEach(
      (a, i) =>
        (a.rotation.x = b.grounded
          ? Math.sin(stride + i * Math.PI) * -0.5 * (velocity / 5.9)
          : -0.7),
    );
    this.scarf.rotation.z = 0.2 + Math.sin(t * 7) * 0.12 + velocity * 0.04;
    if (this.level) {
      for (const original of this.level.platforms) {
        const p = platformAt(original, t);
        this.platformObjects.get(p.id)?.position.set(p.x, p.y, p.z);
      }
      this.level.collectibles.forEach((c, i) => {
        const g = this.collectObjects.get(c.id)!;
        g.visible = !game.collected.has(c.id);
        const original = this.level!.platforms.find(
          (p) => p.id === c.platform,
        )!;
        const p = platformAt(original, t);
        g.position.set(
          c.x + p.x - original.x,
          c.y + p.y - original.y + Math.sin(t * 2 + i) * 0.13,
          c.z + p.z - original.z,
        );
        g.rotation.y = t * 0.65 + i;
      });
      this.level.hazards.forEach((original, i) => {
        const h = hazardAt(original, t);
        const g = this.hazardObjects[i];
        g.position.set(h.x, h.y, h.z);
        g.rotation.y = t * 0.6;
        g.rotation.z = Math.sin(t) * 0.15;
      });
      this.checkpointObjects.forEach((g, i) =>
        g.scale.setScalar(
          i === game.checkpointIndex ? 1 + Math.sin(t * 2) * 0.06 : 1,
        ),
      );
    }
    this.portalRings.forEach((r, i) => {
      r.rotation.y = t * 0.2 * (i + 1) + (i * Math.PI) / 3;
      r.rotation.z = Math.sin(t * 0.3 + i) * 0.22;
    });
    this.portal.scale.setScalar(
      1 + this.beacon * 0.2 * Math.sin(Math.min(this.clock, 2)),
    );
    this.grass.forEach((m, i) => (m.rotation.x = Math.sin(t * 1.5 + i) * 0.13));
    this.moths.forEach((m, i) => {
      m.position.y += Math.sin(t + i) * dt * 0.06;
      m.position.x += Math.cos(t * 0.4 + i) * dt * 0.05;
    });
    this.clouds.forEach((c, i) => {
      c.position.x += dt * 0.04 * (1 + (i % 3));
      if (c.position.x > 130) c.position.x = -40;
    });
    (this.water.material as T.ShaderMaterial).uniforms.time.value = this.clock;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= dt * 2;
      (p.mesh.material as T.MeshBasicMaterial).opacity = Math.max(
        0,
        p.life / p.max,
      );
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as T.Material).dispose();
        this.particles.splice(i, 1);
      }
    }
    this.renderer.info.reset();
    this.composer.render();
  }
  snapshot() {
    return {
      blend: this.blend,
      fps: Math.round(this.fps),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      quality: this.low ? "performance" : "cinematic",
      projection:
        this.blend === 0
          ? "orthographic"
          : this.blend === 1
            ? "perspective"
            : "transition",
      viewport: [this.width, this.height],
    };
  }
}
