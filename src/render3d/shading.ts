import * as THREE from "three";
import { Rng } from "./util";

/**
 * Shared shading for every sculpted material: atmospheric height fog that
 * glows toward the sun, a sky rim light, triplanar stone grain, wind sway for
 * foliage and spinning clockwork, all driven by one set of shared uniforms.
 */

export const U = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector4(1, 0.3, 0.06, 1.3) },
  uFogLow: { value: new THREE.Color("#ffffff") },
  /** x: height where low fog is full, y: height where it ends, z: max amount, w: near distance fade. */
  uFogH: { value: new THREE.Vector4(-14, -4, 0.9, 6) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunFog: { value: new THREE.Color("#ffffff") },
  uSunCol: { value: new THREE.Color("#ffffff") },
  uRim: { value: new THREE.Color("#000000") },
  uNoise: { value: null as THREE.Texture | null },
};

export type Flags = {
  /** Triplanar albedo grain in object space; value is strength (0.25 is typical). */
  grain?: number;
  /** "attr": per-vertex `sway` attribute; "y": sway grows with local height (instanced grass). */
  sway?: "attr" | "y";
  /** Per-vertex rotation about aAxis through aPivot.xyz at aPivot.w radians per second. */
  spin?: boolean;
  rim?: number;
  /** Leaves glow when the sun is behind them. */
  foliage?: boolean;
  /** Dissolve into sparks (the keeper). Uses uniform uDissolve. */
  dissolve?: boolean;
};

const VERT_PARS = /* glsl */ `
uniform float uTime;
uniform vec4 uWind;
varying vec3 vSolWorld;
varying vec3 vSolObj;
varying vec3 vSolObjN;
#ifdef SOL_SWAY_ATTR
attribute float sway;
#endif
#ifdef SOL_SPIN
attribute vec4 aPivot;
attribute vec3 aAxis;
mat3 solRot(vec3 a, float ang) {
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}
#endif
`;

const VERT_NORMAL = /* glsl */ `
vec3 objectNormal = vec3( normal );
#ifdef SOL_SPIN
  objectNormal = solRot( aAxis, uTime * aPivot.w ) * objectNormal;
#endif
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

const VERT_BEGIN = /* glsl */ `
vec3 transformed = vec3( position );
vSolObj = position;
vSolObjN = normal;
#ifdef SOL_SPIN
  transformed = solRot( aAxis, uTime * aPivot.w ) * ( transformed - aPivot.xyz ) + aPivot.xyz;
#endif
#if defined( SOL_SWAY_ATTR ) || defined( SOL_SWAY_Y )
  {
    vec4 swp = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      swp = instanceMatrix * swp;
    #endif
    swp = modelMatrix * swp;
    #ifdef SOL_SWAY_ATTR
      float sw = sway;
    #else
      float sw = max( position.y, 0.0 ) * 3.0;
    #endif
    float ph = dot( swp.xz, vec2( 0.23, 0.17 ) ) + uTime * uWind.w;
    float gust = 0.65 + 0.35 * sin( uTime * 0.37 + swp.x * 0.05 );
    vec2 w = uWind.xy * ( sin( ph ) * 0.7 + sin( ph * 2.7 + 1.3 ) * 0.3 + 0.35 ) * uWind.z * gust * sw;
    transformed.xz += w;
    transformed.y -= dot( w, w ) * 0.6;
  }
#endif
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif
`;

const VERT_FOG = /* glsl */ `
{
  vec4 sw = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    sw = instanceMatrix * sw;
  #endif
  vSolWorld = ( modelMatrix * sw ).xyz;
}
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uFogLow;
uniform vec4 uFogH;
uniform vec3 uSunDir;
uniform vec3 uSunFog;
uniform vec3 uSunCol;
uniform vec3 uRim;
uniform sampler2D uNoise;
varying vec3 vSolWorld;
varying vec3 vSolObj;
varying vec3 vSolObjN;
#ifdef SOL_DISSOLVE
uniform float uDissolve;
uniform vec3 uDissolveGlow;
#endif
vec3 solFogColor( vec3 base, vec3 world ) {
  vec3 vd = normalize( world - cameraPosition );
  float s = max( dot( vd, uSunDir ), 0.0 );
  return mix( base, uSunFog, pow( s, 5.0 ) * 0.85 );
}
`;

const FRAG_GRAIN = /* glsl */ `
#include <color_fragment>
#ifdef SOL_GRAIN
{
  vec3 bw = abs( normalize( vSolObjN ) ) + 0.001;
  bw = pow( bw, vec3( 4.0 ) );
  bw /= ( bw.x + bw.y + bw.z );
  vec3 q = vSolObj * 0.31;
  float g = texture2D( uNoise, q.yz ).b * bw.x + texture2D( uNoise, q.xz ).b * bw.y + texture2D( uNoise, q.xy ).b * bw.z;
  float g2 = texture2D( uNoise, q.yz * 0.23 ).g * bw.x + texture2D( uNoise, q.xz * 0.23 ).g * bw.y + texture2D( uNoise, q.xy * 0.23 ).g * bw.z;
  diffuseColor.rgb *= 1.0 + ( g - 0.5 ) * SOL_GRAIN + ( g2 - 0.5 ) * SOL_GRAIN * 0.8;
}
#endif
`;

const FRAG_DISSOLVE = /* glsl */ `
#include <clipping_planes_fragment>
#ifdef SOL_DISSOLVE
  float solD = texture2D( uNoise, vSolObj.xy * 1.7 + vSolObj.zz * 0.9 ).a;
  if ( solD < uDissolve * 1.08 - 0.04 ) discard;
#endif
`;

const FRAG_OUT = /* glsl */ `
#ifdef SOL_RIM
{
  vec3 vdir = normalize( vViewPosition );
  float f = 1.0 - saturate( dot( normal, vdir ) );
  outgoingLight += uRim * pow( f, 3.0 ) * SOL_RIM;
}
#endif
#ifdef SOL_FOLIAGE
{
  vec3 vd = normalize( vSolWorld - cameraPosition );
  float back = pow( saturate( dot( vd, uSunDir ) ), 3.0 );
  outgoingLight += diffuseColor.rgb * uSunCol * back * 0.55;
}
#endif
#ifdef SOL_DISSOLVE
{
  float solD2 = texture2D( uNoise, vSolObj.xy * 1.7 + vSolObj.zz * 0.9 ).a;
  float edge = 1.0 - smoothstep( 0.0, 0.08, solD2 - ( uDissolve * 1.08 - 0.04 ) );
  outgoingLight += uDissolveGlow * edge * step( 0.001, uDissolve );
}
#endif
#include <opaque_fragment>
`;

const FRAG_FOG = /* glsl */ `
#ifdef USE_FOG
{
  float fogF = smoothstep( fogNear, fogFar, vFogDepth );
  float low = ( 1.0 - smoothstep( uFogH.x, uFogH.y, vSolWorld.y ) ) * uFogH.z;
  low *= smoothstep( 0.0, uFogH.w, vFogDepth );
  vec3 fc = solFogColor( fogColor, vSolWorld );
  fc = mix( fc, uFogLow, saturate( low * ( 1.0 - fogF ) * 1.2 ) );
  float total = 1.0 - ( 1.0 - fogF ) * ( 1.0 - low );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fc, total );
}
#endif
`;

/** Install the shared sculpted shading on a built-in material. */
export function patch<M extends THREE.Material>(
  m: M,
  flags: Flags = {},
  extra: Record<string, THREE.IUniform> = {},
): M {
  const defines: Record<string, string> = {};
  if (flags.grain) defines.SOL_GRAIN = flags.grain.toFixed(3);
  if (flags.sway === "attr") defines.SOL_SWAY_ATTR = "";
  if (flags.sway === "y") defines.SOL_SWAY_Y = "";
  if (flags.spin) defines.SOL_SPIN = "";
  if (flags.rim) defines.SOL_RIM = flags.rim.toFixed(3);
  if (flags.foliage) defines.SOL_FOLIAGE = "";
  if (flags.dissolve) defines.SOL_DISSOLVE = "";
  (m as unknown as { defines: Record<string, string> }).defines = {
    ...((m as unknown as { defines?: Record<string, string> }).defines ?? {}),
    ...defines,
  };
  const key = "sol:" + Object.keys(defines).sort().join(",") + ":" + Object.values(defines).join(",");
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, extra);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <beginnormal_vertex>", VERT_NORMAL)
      .replace("#include <begin_vertex>", VERT_BEGIN)
      .replace("#include <fog_vertex>", VERT_FOG);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <color_fragment>", FRAG_GRAIN)
      .replace("#include <clipping_planes_fragment>", FRAG_DISSOLVE)
      .replace("#include <opaque_fragment>", FRAG_OUT)
      .replace("#include <fog_fragment>", FRAG_FOG);
  };
  return m;
}

// ------------------------------------------------------------------ textures

/** Tileable value noise; channels carry different scales, alpha is billowy. */
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const lattice = (period: number, seed: number) => {
    const r = new Rng(seed);
    const v = new Float32Array(period * period);
    for (let i = 0; i < v.length; i++) v[i] = r.next();
    return (x: number, y: number) => {
      const xi = Math.floor(x),
        yi = Math.floor(y);
      const fx = x - xi,
        fy = y - yi;
      const u = fx * fx * (3 - 2 * fx),
        w = fy * fy * (3 - 2 * fy);
      const m = (a: number) => ((a % period) + period) % period;
      const a = v[m(yi) * period + m(xi)],
        b = v[m(yi) * period + m(xi + 1)],
        c = v[m(yi + 1) * period + m(xi)],
        d = v[m(yi + 1) * period + m(xi + 1)];
      return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
    };
  };
  const fbm = (base: number, oct: number, seed: number) => {
    const layers = Array.from({ length: oct }, (_, i) => lattice(base << i, seed + i * 101));
    return (x: number, y: number) => {
      let s = 0,
        a = 0.5,
        n = 0;
      for (let i = 0; i < oct; i++) {
        const p = base << i;
        s += layers[i]((x * p) / size, (y * p) / size) * a;
        n += a;
        a *= 0.5;
      }
      return s / n;
    };
  };
  const r = fbm(4, 5, 11),
    g = fbm(8, 4, 23),
    b = fbm(32, 3, 37),
    a = fbm(16, 4, 53);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const stretch = (v: number) => Math.max(0, Math.min(255, Math.round(((v - 0.5) * 1.9 + 0.5) * 255)));
      data[i] = stretch(r(x, y));
      data[i + 1] = stretch(g(x, y));
      data[i + 2] = stretch(b(x, y));
      data[i + 3] = stretch(a(x, y));
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Limestone paving: running-bond slabs with soft joints. Ruined paving adds cracks. */
export function makePavingTexture(ruined: boolean, seed: number) {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = new Rng(seed);
  g.fillStyle = "#8c8478";
  g.fillRect(0, 0, S, S);
  const rows = 4;
  const rh = S / rows;
  const joint = 5;
  for (let row = 0; row < rows; row++) {
    let x = -r.range(0, 120);
    while (x < S) {
      const w = r.pick([128, 160, 192, 224, 256]);
      const tone = 214 + r.range(-14, 14);
      const warm = r.range(-5, 6);
      const draw = (ox: number) => {
        const x0 = x + ox + joint / 2,
          y0 = row * rh + joint / 2;
        const grad = g.createLinearGradient(x0, y0, x0, y0 + rh - joint);
        grad.addColorStop(0, `rgb(${tone + 10 + warm},${tone + 8},${tone + 4 - warm})`);
        grad.addColorStop(1, `rgb(${tone - 6 + warm},${tone - 8},${tone - 12 - warm})`);
        g.fillStyle = grad;
        const rr = 6;
        g.beginPath();
        g.roundRect(x0, y0, w - joint, rh - joint, rr);
        g.fill();
      };
      draw(0);
      if (x + w > S) draw(-S);
      if (x < 0) draw(S);
      x += w;
    }
  }
  // Speckle and wear.
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r.next() - 0.5) * 18;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(${r.next() < 0.5 ? "90,80,70" : "255,250,240"},${r.range(0.03, 0.1)})`;
    const x = r.range(0, S),
      y = r.range(0, S),
      s = r.range(1, 5);
    g.beginPath();
    g.arc(x, y, s, 0, Math.PI * 2);
    g.fill();
  }
  if (ruined) {
    g.lineCap = "round";
    for (let k = 0; k < 14; k++) {
      let x = r.range(0, S),
        y = r.range(0, S);
      let a = r.range(0, Math.PI * 2);
      g.strokeStyle = `rgba(60,52,44,${r.range(0.45, 0.8)})`;
      g.lineWidth = r.range(1.2, 2.6);
      g.beginPath();
      g.moveTo(x, y);
      const n = r.int(4, 9);
      for (let s = 0; s < n; s++) {
        a += r.range(-0.8, 0.8);
        x += Math.cos(a) * r.range(10, 30);
        y += Math.sin(a) * r.range(10, 30);
        g.lineTo(x, y);
        if (r.chance(0.25)) {
          g.moveTo(x, y);
          const bx = x + Math.cos(a + 1.2) * 14,
            by = y + Math.sin(a + 1.2) * 14;
          g.lineTo(bx, by);
          g.moveTo(x, y);
        }
      }
      g.stroke();
    }
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(110,96,80,${r.range(0.08, 0.2)})`;
      g.beginPath();
      g.ellipse(r.range(0, S), r.range(0, S), r.range(6, 26), r.range(4, 14), r.range(0, 3), 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/**
 * Tileable billowy cloud tops: RGB holds the surface normal, A the height.
 * Built from layered soft domes so the sea reads as rounded cumulus.
 */
export function makeCloudTexture(size = 512, seed = 7) {
  const H = new Float32Array(size * size);
  const r = new Rng(seed);
  const dome = (cx: number, cy: number, rad: number, amp: number, mode: "union" | "add") => {
    const r2 = rad * rad;
    const x0 = Math.floor(cx - rad),
      x1 = Math.ceil(cx + rad),
      y0 = Math.floor(cy - rad),
      y1 = Math.ceil(cy + rad);
    for (let y = y0; y <= y1; y++) {
      const yy = ((y % size) + size) % size;
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        const xx = ((x % size) + size) % size;
        const q = 1 - d2 / r2;
        const i = yy * size + xx;
        if (mode === "add") {
          H[i] += amp * q * q;
          continue;
        }
        const h = amp * Math.sqrt(q) * (0.6 + 0.4 * q);
        // Smooth union: domes merge into rounded masses.
        const a = H[i];
        const k = amp * 0.4;
        const m = Math.max(a, h);
        const t = Math.max(0, k - Math.abs(a - h)) / k;
        H[i] = m + t * t * k * 0.25;
      }
    }
  };
  // Large masses, then billows on them, then small puffs.
  for (let i = 0; i < 46; i++) dome(r.range(0, size), r.range(0, size), r.range(55, 115), r.range(0.65, 0.95), "union");
  for (let i = 0; i < 260; i++) dome(r.range(0, size), r.range(0, size), r.range(16, 40), r.range(0.12, 0.26), "add");
  for (let i = 0; i < 700; i++) dome(r.range(0, size), r.range(0, size), r.range(5, 12), r.range(0.04, 0.09), "add");
  let lo = 1e9,
    hi = -1e9;
  for (const v of H) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => (H[((y + size) % size) * size + ((x + size) % size)] - lo) / (hi - lo);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = (at(x - 1, y) - at(x + 1, y)) * 9;
      const ny = (at(x, y - 1) - at(x, y + 1)) * 9;
      const l = Math.hypot(nx, ny, 1);
      data[i] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[i + 3] = Math.round(at(x, y) * 255);
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
