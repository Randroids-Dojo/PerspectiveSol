import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Mood } from "./mood";

/**
 * Render pipeline: the scene into an HDR multisampled target (with stencil
 * for the keeper's silhouette), selective bloom by threshold, then one final
 * pass for ACES tone mapping, a gentle grade, vignette and dither.
 */

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform float uTime;
uniform vec2 uRes;
varying vec2 vUv;
vec3 RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 aces( vec3 color ) {
  const mat3 ACESInputMat = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 ACESOutputMat = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit( color );
  color = ACESOutputMat * color;
  return clamp( color, 0.0, 1.0 );
}
vec3 toSRGB( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) );
}
float hash( vec2 p ) {
  return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
}
void main() {
  vec3 c = texture2D( tDiffuse, vUv ).rgb;
  if ( any( isnan( c ) ) || any( isinf( c ) ) ) c = vec3( 0.0 );
  c = aces( c );
  c = toSRGB( c );
  c = c * uGain + uLift * ( 1.0 - c );
  c = ( c - 0.5 ) * uContrast + 0.5;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( vec3( l ), c, uSat );
  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  float v = 1.0 - smoothstep( 0.35, 1.05, length( q ) );
  c *= mix( 1.0, v, uVignette );
  c += ( hash( gl_FragCoord.xy + fract( uTime ) * 97.0 ) - 0.5 ) / 255.0;
  gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

export class Post {
  rt: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  bloomOn = true;

  constructor(samples: number) {
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
      stencilBuffer: true,
    });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.9);
    // Never let a stray NaN or infinity smear across the frame through the blur.
    const hp = (this.bloom as unknown as { materialHighPassFilter: THREE.ShaderMaterial }).materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace(
      "vec4 texel = texture2D( tDiffuse, vUv );",
      "vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\tif ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 );\n\t\t\ttexel = min( texel, vec4( 64.0 ) );",
    );
    hp.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uExposure: { value: 1 },
        uLift: { value: new THREE.Color(0, 0, 0) },
        uGain: { value: new THREE.Color(1, 1, 1) },
        uSat: { value: 1 },
        uContrast: { value: 1 },
        uVignette: { value: 0.3 },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  setSamples(n: number) {
    if (this.rt.samples === n) return;
    this.rt.samples = n;
    this.rt.dispose();
  }

  setSize(w: number, h: number, bloomScale: number) {
    this.rt.setSize(w, h);
    this.bloom.setSize(Math.max(1, Math.round(w * bloomScale)), Math.max(1, Math.round(h * bloomScale)));
    (this.mat.uniforms.uRes.value as THREE.Vector2).set(w, h);
  }

  apply(mood: Mood, reduced: boolean) {
    const u = this.mat.uniforms;
    u.uExposure.value = mood.exposure;
    u.uLift.value.copy(mood.grade.lift);
    u.uGain.value.copy(mood.grade.gain);
    u.uSat.value = mood.grade.saturation;
    u.uContrast.value = mood.grade.contrast;
    u.uVignette.value = mood.grade.vignette;
    this.bloom.strength = mood.bloom.strength * (reduced ? 0.8 : 1);
    this.bloom.radius = mood.bloom.radius;
    this.bloom.threshold = mood.bloom.threshold;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number) {
    renderer.setRenderTarget(this.rt);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    if (this.bloomOn) this.bloom.render(renderer, this.rt, this.rt, 0, false);
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.tDiffuse.value = this.rt.texture;
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }

  dispose() {
    this.rt.dispose();
    this.bloom.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}
