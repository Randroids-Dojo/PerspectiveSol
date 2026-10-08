import * as THREE from "three";
import { Rng, clamp, lerp } from "./util";

/**
 * Light effects: persistent glow halos, a pooled particle system (additive
 * sparks and soft dust), travelling light threads, shock rings and the exit
 * beam. All of it lives in the flattened world group.
 */

const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  gl_PointSize = clamp( aSize * uScale / max( 0.5, -mv.z ), 0.0, 512.0 );
  if ( aColor.a <= 0.0 ) gl_PointSize = 0.0;
}`;

const HALO_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length( c ) * 2.0;
  if ( r > 1.0 ) discard;
  float core = exp( -r * r * 9.0 );
  float soft = pow( 1.0 - r, 2.2 );
  float a = ( core * 0.7 + soft * 0.45 ) * vColor.a;
  gl_FragColor = vec4( vColor.rgb * a, 1.0 );
}`;

const RAYS_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length( c ) * 2.0;
  if ( r > 1.0 ) discard;
  float a = atan( c.y, c.x );
  float rays = pow( abs( cos( a * 2.0 ) ), 60.0 ) + 0.45 * pow( abs( cos( a * 2.0 + 0.7854 ) ), 90.0 );
  float fall = pow( 1.0 - r, 1.6 );
  float v = rays * fall + exp( -r * r * 40.0 ) * 0.5;
  gl_FragColor = vec4( vColor.rgb * v * vColor.a, 1.0 );
}`;

const SPARK_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length( c ) * 2.0;
  if ( r > 1.0 ) discard;
  float a = ( exp( -r * r * 6.0 ) ) * vColor.a;
  gl_FragColor = vec4( vColor.rgb * a, 1.0 );
}`;

const DUST_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length( c ) * 2.0;
  if ( r > 1.0 ) discard;
  float a = smoothstep( 1.0, 0.2, r ) * vColor.a;
  gl_FragColor = vec4( vColor.rgb, a );
}`;

function pointCloud(max: number, frag: string, blending: THREE.Blending) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const size = new Float32Array(max);
  const colr = new Float32Array(max * 4);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aColor", new THREE.BufferAttribute(colr, 4).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const m = new THREE.ShaderMaterial({
    vertexShader: POINT_VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending,
    uniforms: { uScale: { value: 600 } },
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return { pts, pos, size, colr, g, m };
}

/** Additive glows rebuilt every frame. */
export class Halos {
  readonly max: number;
  private c: ReturnType<typeof pointCloud>;
  private n = 0;
  constructor(max = 256, frag = HALO_FRAG) {
    this.max = max;
    this.c = pointCloud(max, frag, THREE.AdditiveBlending);
    this.c.pts.renderOrder = 20;
  }
  get object() {
    return this.c.pts;
  }
  set scale(v: number) {
    this.c.m.uniforms.uScale.value = v;
  }
  begin() {
    this.n = 0;
  }
  add(x: number, y: number, z: number, color: THREE.Color, size: number, alpha = 1) {
    if (this.n >= this.max || alpha <= 0.002) return;
    const i = this.n++;
    this.c.pos[i * 3] = x;
    this.c.pos[i * 3 + 1] = y;
    this.c.pos[i * 3 + 2] = z;
    this.c.size[i] = size;
    this.c.colr[i * 4] = color.r;
    this.c.colr[i * 4 + 1] = color.g;
    this.c.colr[i * 4 + 2] = color.b;
    this.c.colr[i * 4 + 3] = alpha;
  }
  end() {
    const g = this.c.g;
    g.setDrawRange(0, this.n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.c.g.dispose();
    this.c.m.dispose();
  }
}

type P = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  r: number;
  g: number;
  b: number;
  a: number;
  grav: number;
  drag: number;
  /** Fade curve: 0 linear out, 1 in-out. */
  curve: number;
};

export type SpawnOpts = {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  size1?: number;
  color: THREE.Color;
  alpha?: number;
  grav?: number;
  drag?: number;
  curve?: number;
};

class Pool {
  items: P[] = [];
  private c: ReturnType<typeof pointCloud>;
  constructor(
    public max: number,
    frag: string,
    blending: THREE.Blending,
  ) {
    this.c = pointCloud(max, frag, blending);
  }
  get object() {
    return this.c.pts;
  }
  set scale(v: number) {
    this.c.m.uniforms.uScale.value = v;
  }
  spawn(o: SpawnOpts) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      x: o.x,
      y: o.y,
      z: o.z,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      vz: o.vz ?? 0,
      life: 0,
      max: o.life,
      s0: o.size,
      s1: o.size1 ?? o.size,
      r: o.color.r,
      g: o.color.g,
      b: o.color.b,
      a: o.alpha ?? 1,
      grav: o.grav ?? 0,
      drag: o.drag ?? 1.5,
      curve: o.curve ?? 0,
    });
  }
  update(dt: number) {
    const keep: P[] = [];
    for (const p of this.items) {
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k - p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      keep.push(p);
    }
    this.items = keep;
    const { pos, size, colr, g } = this.c;
    for (let i = 0; i < keep.length; i++) {
      const p = keep[i];
      const t = p.life / p.max;
      const fade = p.curve === 1 ? Math.min(1, t * 6) * (1 - t) * 1.3 : 1 - t * t;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      size[i] = lerp(p.s0, p.s1, t);
      colr[i * 4] = p.r;
      colr[i * 4 + 1] = p.g;
      colr[i * 4 + 2] = p.b;
      colr[i * 4 + 3] = p.a * clamp(fade, 0, 1);
    }
    g.setDrawRange(0, keep.length);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }
  clear() {
    this.items = [];
    this.c.g.setDrawRange(0, 0);
  }
  dispose() {
    this.c.g.dispose();
    this.c.m.dispose();
  }
}

const THREAD_VERT = /* glsl */ `
varying float vU;
varying float vV;
void main() {
  vU = uv.x;
  vV = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
const THREAD_FRAG = /* glsl */ `
uniform float uHead;
uniform float uFade;
uniform vec3 uColor;
varying float vU;
varying float vV;
void main() {
  float dh = ( vU - uHead ) * 22.0;
  float behind = smoothstep( uHead + 0.002, uHead - 0.25, vU ) * 0.35 + exp( -dh * dh ) * 1.6;
  behind *= step( vU, uHead + 0.04 );
  float a = behind * uFade;
  gl_FragColor = vec4( uColor * a, 1.0 );
}`;

const RING_FRAG = /* glsl */ `
uniform float uT;
uniform vec3 uColor;
varying float vU;
varying float vV;
void main() {
  float edge = max( 1.0 - abs( vV - 0.5 ) * 2.0, 0.0 );
  float a = pow( edge, 1.5 ) * ( 1.0 - uT ) * ( 1.0 - uT );
  gl_FragColor = vec4( uColor * a, 1.0 );
}`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vN = normalize( normalMatrix * normal );
  vV = normalize( -mv.xyz );
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
uniform float uAmount;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs( dot( vN, vV ) );
  float core = pow( facing, 2.5 );
  float up = pow( 1.0 - vUv.y, 0.6 ) * smoothstep( 0.0, 0.03, vUv.y );
  float ripple = 0.8 + 0.2 * sin( vUv.y * 40.0 - uTime * 6.0 );
  float a = core * up * ripple * uAmount;
  gl_FragColor = vec4( uColor * a, 1.0 );
}`;

type Thread = { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; dur: number; active: boolean; arrived: boolean; to: THREE.Vector3 };
type Ring = { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; dur: number; size: number; active: boolean };

export class Effects {
  group = new THREE.Group();
  halos: Halos;
  rays: Halos;
  sparks: Pool;
  dust: Pool;
  private threads: Thread[] = [];
  private rings: Ring[] = [];
  private beam: THREE.Mesh;
  private beamMat: THREE.ShaderMaterial;
  beamAmount = 0;
  private rng = new Rng(99);
  /** Particle budget multiplier (low quality spawns fewer). */
  density = 1;

  constructor() {
    this.halos = new Halos(320);
    this.rays = new Halos(64, RAYS_FRAG);
    this.sparks = new Pool(900, SPARK_FRAG, THREE.AdditiveBlending);
    this.dust = new Pool(500, DUST_FRAG, THREE.NormalBlending);
    this.dust.object.renderOrder = 15;
    this.sparks.object.renderOrder = 21;
    this.group.add(this.halos.object, this.rays.object, this.sparks.object, this.dust.object);
    const ringGeo = new THREE.RingGeometry(0.8, 1, 64, 1);
    // Ring uv.y runs across the band for the shader.
    const uv = ringGeo.attributes.uv as THREE.BufferAttribute;
    const pos = ringGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, 0, (r - 0.8) / 0.2);
    }
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: THREAD_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color() } },
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 22;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, t: 0, dur: 1, size: 1, active: false });
    }
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uAmount: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color("#ffd98a").multiplyScalar(2) } },
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 60, 24, 1, true).translate(0, 30, 0), this.beamMat);
    this.beam.visible = false;
    this.beam.renderOrder = 23;
    this.group.add(this.beam);
  }

  set scale(v: number) {
    this.halos.scale = v;
    this.rays.scale = v;
    this.sparks.scale = v;
    this.dust.scale = v;
  }

  /** A burst of additive sparks. */
  burst(x: number, y: number, z: number, n: number, color: THREE.Color, speed: number, o: Partial<SpawnOpts> = {}) {
    const r = this.rng;
    const count = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < count; i++) {
      const a = r.range(0, Math.PI * 2),
        e = r.range(-0.6, 1.2);
      const s = speed * r.range(0.35, 1);
      this.sparks.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * Math.cos(e) * s,
        vy: Math.sin(e) * s,
        vz: Math.sin(a) * Math.cos(e) * s,
        life: r.range(0.5, 1.1),
        size: r.range(0.08, 0.16),
        size1: 0.02,
        color,
        grav: 1.5,
        drag: 2.2,
        ...o,
      });
    }
  }

  puff(x: number, y: number, z: number, n: number, color: THREE.Color, spread: number, o: Partial<SpawnOpts> = {}) {
    const r = this.rng;
    const count = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < count; i++) {
      const a = r.range(0, Math.PI * 2);
      const s = spread * r.range(0.5, 1.2);
      this.dust.spawn({
        x: x + Math.cos(a) * 0.1,
        y: y + 0.05,
        z: z + Math.sin(a) * 0.1,
        vx: Math.cos(a) * s,
        vy: r.range(0.2, 0.9),
        vz: Math.sin(a) * s,
        life: r.range(0.45, 0.8),
        size: r.range(0.14, 0.24),
        size1: r.range(0.35, 0.55),
        color,
        alpha: 0.55,
        grav: -0.3,
        drag: 4,
        ...o,
      });
    }
  }

  ring(x: number, y: number, z: number, size: number, color: THREE.Color, dur = 0.8, vertical = false) {
    const ring = this.rings.find((r) => !r.active) ?? this.rings[0];
    ring.active = true;
    ring.t = 0;
    ring.dur = dur;
    ring.size = size;
    ring.mesh.visible = true;
    ring.mesh.position.set(x, y, z);
    ring.mesh.rotation.set(vertical ? 0 : -Math.PI / 2, 0, 0);
    ring.mat.uniforms.uColor.value.copy(color);
  }

  thread(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, dur: number) {
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 1.5 + from.distanceTo(to) * 0.18;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const geo = new THREE.TubeGeometry(curve, 64, 0.05, 5, false);
    const mat = new THREE.ShaderMaterial({
      vertexShader: THREAD_VERT,
      fragmentShader: THREAD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uHead: { value: 0 }, uFade: { value: 1 }, uColor: { value: color.clone() } },
    });
    // TubeGeometry: uv.x along the tube, uv.y around it. Make uv.y a 0..1..0 profile.
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 22;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const t: Thread = { mesh, mat, t: 0, dur, active: true, arrived: false, to: to.clone() };
    this.threads.push(t);
    (mesh.userData as { curve: THREE.Curve<THREE.Vector3> }).curve = curve;
  }

  update(dt: number, clock: number) {
    this.sparks.update(dt);
    this.dust.update(dt);
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt / r.dur;
      if (r.t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const s = r.size * (0.25 + 0.75 * (1 - Math.pow(1 - r.t, 3)));
      r.mesh.scale.setScalar(s);
      r.mat.uniforms.uT.value = r.t;
    }
    for (const t of this.threads) {
      t.t += dt;
      const head = clamp(t.t / t.dur, 0, 1);
      t.mat.uniforms.uHead.value = head * 1.04;
      t.mat.uniforms.uFade.value = clamp(1 - (t.t - t.dur) / 0.7, 0, 1);
      if (head < 1 && dt > 0) {
        const curve = (t.mesh.userData as { curve: THREE.Curve<THREE.Vector3> }).curve;
        const p = curve.getPointAt(head);
        const c = t.mat.uniforms.uColor.value as THREE.Color;
        if (this.rng.chance(0.8 * this.density))
          this.sparks.spawn({ x: p.x, y: p.y, z: p.z, vx: this.rng.range(-0.3, 0.3), vy: this.rng.range(-0.2, 0.4), vz: this.rng.range(-0.3, 0.3), life: 0.6, size: 0.12, size1: 0.02, color: c, drag: 2 });
      }
      if (!t.arrived && head >= 1) {
        // The light lands on its gate or bridge.
        t.arrived = true;
        const c = (t.mat.uniforms.uColor.value as THREE.Color).clone();
        this.burst(t.to.x, t.to.y, t.to.z, 34, c, 3.4);
        this.ring(t.to.x, t.to.y, t.to.z, 2.2, c.clone().multiplyScalar(0.8), 0.8, true);
      }
      if (t.t > t.dur + 0.7) {
        t.active = false;
        this.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.mat.dispose();
      }
    }
    this.threads = this.threads.filter((t) => t.active);
    this.beamMat.uniforms.uTime.value = clock;
    this.beamMat.uniforms.uAmount.value = this.beamAmount;
    this.beam.visible = this.beamAmount > 0.01;
  }

  beamAt(x: number, y: number, z: number) {
    this.beam.position.set(x, y, z);
  }

  clear() {
    this.sparks.clear();
    this.dust.clear();
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const t of this.threads) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mat.dispose();
    }
    this.threads = [];
    this.beamAmount = 0;
    this.beam.visible = false;
  }
}
