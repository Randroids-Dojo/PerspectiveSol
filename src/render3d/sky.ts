import * as THREE from "three";
import type { Mood } from "./mood";
import { U, makeCloudTexture } from "./shading";
import { Rng, TAU } from "./util";

/**
 * The backdrop: a gradient sky dome with sun or moon, high cirrus, stars and
 * constellations, and a layered, lit, animated cloud sea below the islands.
 * None of this flattens during the fold.
 */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uMid, uHorizon, uBelow, uSunDir, uSunCol, uGlow;
uniform float uSunSize, uNight, uMoon, uTime, uCirrus;
uniform sampler2D uNoise;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  float up = max( h, 0.0 );
  vec3 col = mix( uHorizon, uMid, smoothstep( 0.0, 0.2, up ) );
  col = mix( col, uTop, smoothstep( 0.1, 0.75, up ) );
  float sd = dot( d, uSunDir );
  float g = max( sd, 0.0 );
  vec3 dh = normalize( vec3( d.x, 0.0001, d.z ) );
  vec3 sh = normalize( vec3( uSunDir.x, 0.0001, uSunDir.z ) );
  float az = max( dot( dh, sh ), 0.0 );
  float band = exp( -max( h, 0.0 ) * 6.0 );
  col = mix( col, uGlow, pow( az, 4.0 ) * band * 0.8 );
  col += uGlow * ( pow( g, 10.0 ) * 0.45 + pow( g, 60.0 ) * 0.5 );
  // High cirrus.
  if ( uCirrus > 0.0 && h > 0.0 ) {
    vec2 q = d.xz / ( h + 0.12 ) * 0.11 + vec2( uTime * 0.0012, uTime * 0.0004 );
    float c = texture2D( uNoise, q ).r * 0.6 + texture2D( uNoise, q * 3.1 + 0.3 ).g * 0.4;
    float wisp = smoothstep( 0.52, 0.8, c ) * smoothstep( 0.02, 0.18, h ) * ( 1.0 - smoothstep( 0.45, 0.9, h ) );
    vec3 lit = mix( uHorizon * 1.1, uGlow * 1.2 + uSunCol * 0.4, pow( g, 3.0 ) );
    col = mix( col, lit, wisp * uCirrus );
  }
  // Below the horizon the sky meets the haze over the cloud sea.
  col = mix( col, uBelow, smoothstep( 0.0, -0.1, h ) * 0.0 );
  float ang = acos( clamp( sd, -1.0, 1.0 ) );
  if ( uMoon > 0.5 ) {
    float disc = smoothstep( uSunSize, uSunSize * 0.92, ang );
    vec3 tang = normalize( cross( uSunDir, vec3( 0.0, 1.0, 0.0 ) ) );
    vec3 bit = cross( tang, uSunDir );
    vec2 mp = vec2( dot( d, tang ), dot( d, bit ) ) / uSunSize;
    float mare = texture2D( uNoise, mp * 0.18 + 0.4 ).r;
    float shade = 0.72 + 0.4 * smoothstep( 0.35, 0.7, mare );
    col = mix( col, uSunCol * 2.6 * shade, disc );
    col += uGlow * pow( g, 300.0 ) * 0.9 + uSunCol * pow( g, 900.0 ) * 0.6;
  } else {
    float disc = smoothstep( uSunSize, uSunSize * 0.8, ang );
    col += uSunCol * disc * 3.2;
    col += uSunCol * pow( g, 400.0 ) * 0.8;
  }
  gl_FragColor = vec4( col, 1.0 );
}`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uPx;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
  float tw = 0.65 + 0.35 * sin( uTime * ( 1.3 + aPhase ) + aPhase * 17.0 );
  vAlpha = tw;
  gl_PointSize = aSize * uPx;
}`;
const STAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length( c ) * 2.0;
  float core = smoothstep( 1.0, 0.0, r );
  float a = core * core * vAlpha * uAmount;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( uColor * a * 2.2, 1.0 );
}`;

const CLOUD_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D uCloud;
uniform float uTime, uLayer, uAlpha, uScale, uCover, uOctaves;
uniform vec3 uLit, uShade, uDeep, uSunDir, uSunCol, uHaze, uHazeSun, uSky, uGlow, uSkyDir;
uniform float uHazeNear, uHazeFar;
varying vec3 vW;
// The sky's colour at the horizon in a view direction (matches the sky dome).
vec3 horizonAt( vec3 d ) {
  vec3 dh = normalize( vec3( d.x, 0.0001, d.z ) );
  vec3 sh = normalize( vec3( uSkyDir.x, 0.0001, uSkyDir.z ) );
  float az = max( dot( dh, sh ), 0.0 );
  vec3 c = mix( uHaze, uGlow, pow( az, 4.0 ) * 0.8 );
  float g = max( dot( normalize( vec3( d.x, 0.0, d.z ) ), uSkyDir ), 0.0 );
  return c + uGlow * ( pow( g, 10.0 ) * 0.45 + pow( g, 60.0 ) * 0.5 );
}
void main() {
  vec2 base = vW.xz * uScale + uLayer * vec2( 0.31, 0.17 );
  vec2 drift = vec2( uTime * 0.0021, uTime * 0.0009 ) * ( 1.0 + uLayer * 0.6 );
  float cov = texture2D( uNoise, base * 0.21 + drift * 0.2 ).r;
  vec4 a = texture2D( uCloud, base + drift );
  vec4 b = uOctaves > 2.5 ? texture2D( uCloud, base * 2.9 - drift * 1.6 + 0.37 ) : vec4( 0.5, 0.5, 1.0, 0.5 );
  float h = a.a * 0.75 + b.a * 0.25;
  float big = smoothstep( 0.2, 0.8, cov );
  h = clamp( h * ( 0.45 + 0.9 * big ) + ( uCover - 0.5 ) * 0.4, 0.0, 1.0 );
  vec2 tilt = ( a.rg * 2.0 - 1.0 ) + ( b.rg * 2.0 - 1.0 ) * 0.45;
  vec3 n = normalize( vec3( tilt.x * 2.2, 1.0, tilt.y * 2.2 ) );
  vec3 v = normalize( vW - cameraPosition );
  float ndl = dot( n, uSunDir );
  float wrap = clamp( ndl * 0.55 + 0.45, 0.0, 1.0 );
  // Self shadowing: is the surface toward the sun higher than here?
  vec2 sdir = normalize( uSunDir.xz + 0.0001 ) * 0.012;
  float h1 = texture2D( uCloud, base + drift + sdir ).a;
  float h2 = texture2D( uCloud, base + drift + sdir * 2.5 ).a;
  float occl = clamp( max( h1 - a.a - 0.02, ( h2 - a.a - 0.05 ) * 0.7 ) * 5.0, 0.0, 1.0 ) * ( 1.0 - uSunDir.y * 0.6 );
  wrap *= 1.0 - occl * 0.85;
  vec3 col = mix( uShade, uLit, smoothstep( 0.0, 1.0, wrap ) );
  float ao = smoothstep( 0.05, 0.7, h );
  col = mix( uDeep, col, 0.15 + 0.85 * ao );
  float fwd = pow( max( dot( v, uSunDir ), 0.0 ), 4.0 );
  float rim = pow( 1.0 - clamp( dot( n, -v ), 0.0, 1.0 ), 2.5 );
  col += uSunCol * fwd * ( 0.15 + rim * 0.9 ) * 0.5;
  col += uSky * n.y * 0.08;
  float dist = length( vW.xz - cameraPosition.xz );
  float haze = smoothstep( uHazeNear, uHazeFar, dist );
  haze = 1.0 - ( 1.0 - haze ) * ( 1.0 - haze * 0.3 );
  col = mix( col, horizonAt( v ), haze );
  float a2 = 1.0;
  if ( uLayer > 0.5 ) a2 = smoothstep( 0.52, 0.86, h ) * uAlpha * ( 1.0 - haze * 0.8 );
  if ( a2 < 0.003 ) discard;
  gl_FragColor = vec4( col, a2 );
}`;

export class Backdrop {
  group = new THREE.Group();
  private skyMat: THREE.ShaderMaterial;
  private sky: THREE.Mesh;
  private stars: THREE.Points;
  private starMat: THREE.ShaderMaterial;
  private lines: THREE.LineSegments;
  private lineMat: THREE.LineBasicMaterial;
  private clouds: THREE.Mesh[] = [];
  private cloudMats: THREE.ShaderMaterial[] = [];
  cloudY = -14;
  private cloudTex: THREE.Texture | null = null;
  private layersActive = 3;

  constructor() {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uBelow: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uSunSize: { value: 0.04 },
        uNight: { value: 0 },
        uMoon: { value: 0 },
        uCirrus: { value: 1 },
        uTime: U.uTime,
        uNoise: U.uNoise,
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // Stars and constellations.
    const r = new Rng(4242);
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    const bright: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const y = Math.pow(r.next(), 0.8) * 0.98 + 0.02;
      const a = r.range(0, TAU);
      const s = Math.sqrt(1 - y * y);
      const v = new THREE.Vector3(Math.cos(a) * s, y, Math.sin(a) * s).multiplyScalar(900);
      pos.set([v.x, v.y, v.z], i * 3);
      const big = r.chance(0.05);
      size[i] = big ? r.range(2.6, 4.2) : r.range(1.0, 2.2);
      phase[i] = r.range(0, 3);
      if (big && v.z < 0) bright.push(v);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    sg.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: U.uTime,
        uPx: { value: 1 },
        uColor: { value: new THREE.Color("#fff6e8") },
        uAmount: { value: 0 },
      },
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -999;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Constellations: short chains between nearby bright stars behind the scene.
    const segs: number[] = [];
    const used = new Set<number>();
    for (let c = 0; c < 7 && bright.length > 4; c++) {
      let cur = r.int(0, bright.length - 1);
      if (used.has(cur)) continue;
      const len = r.int(3, 6);
      for (let k = 0; k < len; k++) {
        used.add(cur);
        let best = -1,
          bd = 1e9;
        for (let j = 0; j < bright.length; j++) {
          if (used.has(j)) continue;
          const dd = bright[j].distanceTo(bright[cur]);
          if (dd < bd && dd > 40) {
            bd = dd;
            best = j;
          }
        }
        if (best < 0 || bd > 260) break;
        segs.push(...bright[cur].toArray(), ...bright[best].toArray());
        cur = best;
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
    this.lineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color("#ffd98a").multiplyScalar(0.5),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    this.lines.renderOrder = -998;
    this.lines.frustumCulled = false;
    this.group.add(this.lines);

    // Cloud sea: an opaque floor and two translucent layers above it for parallax.
    const cloudTex = makeCloudTexture(512, 11);
    this.cloudTex = cloudTex;
    const plane = new THREE.PlaneGeometry(4000, 4000, 1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        transparent: i > 0,
        depthWrite: i === 0,
        uniforms: {
          uNoise: U.uNoise,
          uCloud: { value: cloudTex },
          uSky: { value: new THREE.Color() },
          uGlow: { value: new THREE.Color() },
          uSkyDir: { value: new THREE.Vector3(0, 1, 0) },
          uTime: U.uTime,
          uLayer: { value: i },
          uAlpha: { value: i === 1 ? 0.85 : 0.6 },
          uScale: { value: i === 0 ? 0.0062 : i === 1 ? 0.0085 : 0.013 },
          uCover: { value: 0.5 },
          uOctaves: { value: 3 },
          uLit: { value: new THREE.Color() },
          uShade: { value: new THREE.Color() },
          uDeep: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunCol: { value: new THREE.Color() },
          uHaze: { value: new THREE.Color() },
          uHazeSun: { value: new THREE.Color() },
          uHazeNear: { value: 60 },
          uHazeFar: { value: 700 },
        },
      });
      const mesh = new THREE.Mesh(plane, m);
      mesh.renderOrder = -900 + i;
      mesh.frustumCulled = false;
      this.clouds.push(mesh);
      this.cloudMats.push(m);
      this.group.add(mesh);
    }
  }

  apply(mood: Mood, cloudY: number) {
    this.cloudY = cloudY;
    const u = this.skyMat.uniforms;
    u.uTop.value.copy(mood.skyTop);
    u.uMid.value.copy(mood.skyMid);
    u.uHorizon.value.copy(mood.skyHorizon);
    u.uBelow.value.copy(mood.skyBelow);
    u.uSunDir.value.copy(mood.sunDir);
    u.uSunCol.value.copy(mood.sunColor);
    u.uGlow.value.copy(mood.glow);
    u.uSunSize.value = mood.sunSize;
    u.uNight.value = mood.night;
    u.uMoon.value = mood.moon;
    u.uCirrus.value = mood.night > 0.5 ? 0.2 : 0.5;
    this.starMat.uniforms.uAmount.value = mood.stars;
    this.stars.visible = mood.stars > 0.01;
    this.lineMat.opacity = mood.night > 0.5 ? 0.55 : 0;
    this.lines.visible = mood.night > 0.5;
    const sunDir = mood.sunDir.clone();
    if (mood.night > 0.5) sunDir.set(mood.sunDir.x, Math.max(0.25, mood.sunDir.y), mood.sunDir.z).normalize();
    for (const m of this.cloudMats) {
      const c = m.uniforms;
      c.uLit.value.copy(mood.cloudLit);
      c.uShade.value.copy(mood.cloudShade);
      c.uDeep.value.copy(mood.cloudDeep);
      c.uSunDir.value.copy(sunDir);
      c.uSunCol.value.copy(mood.glow);
      c.uHaze.value.copy(mood.skyHorizon);
      c.uGlow.value.copy(mood.glow);
      c.uSkyDir.value.copy(mood.sunDir);
      c.uHazeSun.value.copy(mood.skyBelow).lerp(mood.glow, 0.45);
      c.uSky.value.copy(mood.skyTop);
      c.uCover.value = mood.cloudCover;
    }
    this.clouds[0].position.y = cloudY;
    this.clouds[1].position.y = cloudY + 1.6;
    this.clouds[2].position.y = cloudY + 3.6;
  }

  setQuality(high: boolean) {
    this.layersActive = high ? 3 : 2;
    for (const m of this.cloudMats) m.uniforms.uOctaves.value = high ? 3 : 2;
    this.clouds.forEach((c, i) => (c.visible = i < this.layersActive));
  }

  update(camera: THREE.PerspectiveCamera, pxScale: number) {
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.lines.position.copy(camera.position);
    this.starMat.uniforms.uPx.value = pxScale;
    for (const c of this.clouds) {
      c.position.x = Math.round(camera.position.x / 50) * 50;
      c.position.z = Math.round(camera.position.z / 50) * 50;
    }
  }

  dispose() {
    this.cloudTex?.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }
}

const BIRD_VERT = /* glsl */ `
attribute float aWing;
attribute float aPhase;
uniform float uTime;
varying float vFade;
void main() {
  vec3 p = position;
  float flap = sin( uTime * ( 7.0 + aPhase * 2.0 ) + aPhase * 6.2831 );
  p.y += abs( aWing ) * flap * 0.28;
  p.x *= 1.0 - abs( aWing ) * 0.15 * ( 1.0 - flap );
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  vFade = smoothstep( 260.0, 60.0, -mv.z );
  gl_Position = projectionMatrix * mv;
}`;
const BIRD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHaze;
varying float vFade;
void main() {
  gl_FragColor = vec4( mix( uHaze, uColor, vFade ), 1.0 );
}`;

/** Small flocks wheeling in the middle distance (daytime chapters). */
export class Birds {
  group = new THREE.Group();
  private flocks: { g: THREE.Mesh; cx: number; cy: number; cz: number; r: number; speed: number; phase: number }[] = [];
  private mat: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;
  constructor() {
    const r = new Rng(31);
    const pos: number[] = [],
      wing: number[] = [],
      phase: number[] = [];
    for (let i = 0; i < 9; i++) {
      const ox = r.range(-3, 3),
        oy = r.range(-1, 1),
        oz = r.range(-3, 3);
      const ph = r.next();
      const s = r.range(0.8, 1.1);
      // Left and right wings: body point, then the swept wing tips.
      for (const side of [-1, 1]) {
        pos.push(ox, oy, oz + 0.12 * s, ox + side * 0.55 * s, oy + 0.05, oz - 0.1 * s, ox, oy, oz - 0.12 * s);
        wing.push(0, side, 0);
        phase.push(ph, ph, ph);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
    this.geo.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BIRD_VERT,
      fragmentShader: BIRD_FRAG,
      side: THREE.DoubleSide,
      uniforms: { uTime: U.uTime, uColor: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() } },
    });
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(this.geo, this.mat);
      m.frustumCulled = false;
      this.group.add(m);
      this.flocks.push({ g: m, cx: 0, cy: 0, cz: 0, r: 30, speed: 0.05, phase: k * 2.4 });
    }
  }
  apply(active: boolean, color: THREE.Color, haze: THREE.Color, x0: number, x1: number, y: number) {
    this.group.visible = active;
    this.mat.uniforms.uColor.value.copy(color);
    this.mat.uniforms.uHaze.value.copy(haze);
    this.flocks.forEach((f, i) => {
      f.cx = x0 + (x1 - x0) * (0.3 + 0.4 * i);
      f.cy = y + 6 + i * 3;
      f.cz = -45 - i * 15;
      f.r = 26 + i * 8;
      f.speed = (0.045 + i * 0.012) * (i % 2 ? -1 : 1);
    });
  }
  update(t: number) {
    if (!this.group.visible) return;
    for (const f of this.flocks) {
      const a = t * f.speed + f.phase;
      f.g.position.set(f.cx + Math.cos(a) * f.r, f.cy + Math.sin(a * 2.3) * 2, f.cz + Math.sin(a) * f.r * 0.4);
      f.g.rotation.y = -a - (f.speed > 0 ? 0 : Math.PI);
    }
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const WISP_VERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform float uScale;
uniform float uSpan;
uniform float uX0;
varying float vSeed;
varying float vDist;
void main() {
  vec3 p = position;
  p.x = uX0 + mod( p.x - uX0 + uTime * ( 0.25 + aSeed * 0.35 ), uSpan );
  p.y += sin( uTime * 0.05 + aSeed * 30.0 ) * 0.6;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  vSeed = aSeed;
  vDist = -mv.z;
  gl_PointSize = clamp( aSize * uScale / max( 1.0, -mv.z ), 0.0, 900.0 );
}`;
const WISP_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uLit, uShade, uHaze;
uniform float uAlpha;
varying float vSeed;
varying float vDist;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  q.y *= 1.8;
  float d = length( q ) * 2.0;
  float n = texture2D( uNoise, gl_PointCoord * 0.55 + vSeed * 7.0 ).r;
  float n2 = texture2D( uNoise, gl_PointCoord * 1.3 - vSeed * 3.0 ).g;
  float a = smoothstep( 1.0, 0.25, d + ( n - 0.5 ) * 0.9 + ( n2 - 0.5 ) * 0.35 );
  a *= uAlpha * smoothstep( 4.0, 14.0, vDist );
  if ( a < 0.004 ) discard;
  vec3 c = mix( uShade, uLit, clamp( 1.0 - gl_PointCoord.y + ( n - 0.5 ) * 0.6, 0.0, 1.0 ) );
  c = mix( c, uHaze, smoothstep( 40.0, 160.0, vDist ) );
  gl_FragColor = vec4( c, a );
}`;

/** Soft cloud wisps drifting below and behind the islands. */
export class Wisps {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: WISP_VERT,
      fragmentShader: WISP_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uNoise: U.uNoise,
        uTime: U.uTime,
        uScale: { value: 600 },
        uSpan: { value: 100 },
        uX0: { value: 0 },
        uLit: { value: new THREE.Color() },
        uShade: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uAlpha: { value: 0.5 },
      },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = -800;
  }
  build(x0: number, x1: number, midY: number, cloudY: number, mood: Mood, count: number, seed: number) {
    const r = new Rng(seed);
    const pos: number[] = [],
      size: number[] = [],
      sd: number[] = [];
    for (let i = 0; i < count; i++) {
      const low = r.chance(0.6);
      pos.push(r.range(x0, x1), low ? r.range(cloudY + 2, midY - 6) : r.range(midY - 6, midY + 1), low ? r.range(-26, 2) : r.range(-34, -10));
      size.push(r.range(10, 22));
      sd.push(r.next());
    }
    this.geo.dispose();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
    this.geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(sd, 1));
    this.points.geometry = this.geo;
    const u = this.mat.uniforms;
    u.uX0.value = x0;
    u.uSpan.value = x1 - x0;
    u.uLit.value.copy(mood.cloudLit);
    u.uShade.value.copy(mood.cloudShade);
    u.uHaze.value.copy(mood.fogColor);
    u.uAlpha.value = mood.night > 0.5 ? 0.35 : 0.5;
  }
  set scale(v: number) {
    this.mat.uniforms.uScale.value = v;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
