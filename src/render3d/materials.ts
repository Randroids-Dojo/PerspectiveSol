import * as THREE from "three";
import { makePavingTexture, patch } from "./shading";

/** Clone a patched material, keeping its shader defines and hooks. */
export function cloneSol<M extends THREE.Material>(m: M): M {
  const c = m.clone() as M;
  const src = (m as unknown as { defines?: Record<string, string> }).defines ?? {};
  (c as unknown as { defines: Record<string, string> }).defines = { ...src };
  c.onBeforeCompile = m.onBeforeCompile;
  c.customProgramCacheKey = m.customProgramCacheKey;
  return c;
}

/** The shared sculpted materials. Colours live in vertex colours, so one set serves every chapter. */
export class Mats {
  matte: THREE.MeshStandardMaterial;
  paving: THREE.MeshStandardMaterial;
  ruin: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
  crystal: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  flowers: THREE.MeshStandardMaterial;
  seed: THREE.MeshStandardMaterial;
  sentinel: THREE.MeshStandardMaterial;
  sentinelRing: THREE.MeshStandardMaterial;
  cpDull: THREE.MeshStandardMaterial;
  cpLit: THREE.MeshStandardMaterial;
  socketEmpty: THREE.MeshStandardMaterial;
  private textures: THREE.Texture[] = [];

  constructor() {
    const pave = makePavingTexture(false, 17);
    const ruin = makePavingTexture(true, 29);
    this.textures.push(pave, ruin);
    this.matte = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }), { grain: 0.22, rim: 1 });
    this.paving = patch(new THREE.MeshStandardMaterial({ vertexColors: true, map: pave, roughness: 0.82, metalness: 0 }), { grain: 0.12, rim: 1 });
    this.ruin = patch(new THREE.MeshStandardMaterial({ vertexColors: true, map: ruin, roughness: 0.88, metalness: 0 }), { grain: 0.16, rim: 1 });
    this.foliage = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }), { sway: "attr", foliage: true, rim: 0.8 });
    this.metal = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.85 }), { spin: true, rim: 0.5 });
    this.glow = patch(new THREE.MeshBasicMaterial({ vertexColors: true }), {});
    this.glass = patch(
      new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.32, roughness: 0.06, metalness: 0.1, depthWrite: false }),
      { rim: 2 },
    );
    this.crystal = patch(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
        roughness: 0.12,
        metalness: 0.05,
        emissive: new THREE.Color("#ff9a3a"),
        emissiveIntensity: 0.35,
      }),
      { rim: 3 },
    );
    this.grass = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), { sway: "y" });
    this.flowers = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), { sway: "y" });
    this.seed = patch(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color("#ffc94a"),
        emissive: new THREE.Color("#ffb21e"),
        emissiveIntensity: 1.7,
        roughness: 0.2,
        metalness: 0.6,
        flatShading: true,
      }),
      { rim: 2 },
    );
    this.sentinel = patch(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color("#4a0b18"),
        emissive: new THREE.Color("#ff1d45"),
        emissiveIntensity: 1.6,
        roughness: 0.2,
        metalness: 0.3,
        flatShading: true,
      }),
      { rim: 2 },
    );
    this.sentinelRing = patch(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color("#3a1a22"),
        emissive: new THREE.Color("#b3122e"),
        emissiveIntensity: 0.7,
        roughness: 0.35,
        metalness: 0.8,
        flatShading: true,
      }),
      { rim: 1.5 },
    );
    this.cpDull = patch(new THREE.MeshStandardMaterial({ color: new THREE.Color("#b89a6a"), roughness: 0.55, metalness: 0.3 }), {});
    this.cpLit = patch(
      new THREE.MeshStandardMaterial({ color: new THREE.Color("#ffcf6a"), emissive: new THREE.Color("#ffb53a"), emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.6 }),
      {},
    );
    this.socketEmpty = patch(new THREE.MeshStandardMaterial({ color: new THREE.Color("#3d4250"), roughness: 0.15, metalness: 0.2, flatShading: true }), { rim: 1 });
  }

  /** Assembling copies for lantern bridges, driven by one uniform. */
  assembling(uniform: { value: number }) {
    const mk = (m: THREE.MeshStandardMaterial) => {
      const c = m.clone();
      const key = m.customProgramCacheKey() + ":asm";
      const d = c as unknown as { defines: Record<string, string> };
      d.defines = { ...((m as unknown as { defines?: Record<string, string> }).defines ?? {}), SOL_ASSEMBLE: "" };
      const base = m.onBeforeCompile;
      c.onBeforeCompile = (shader, r) => {
        base.call(c, shader, r);
        shader.uniforms.uAssemble = uniform;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uAssemble;\n#ifndef SOL_SWAY_ATTR\nattribute float sway;\n#endif")
          .replace(
            "#include <morphtarget_vertex>",
            `#include <morphtarget_vertex>
            {
              float k = clamp( ( uAssemble * 1.6 - sway * 0.6 ) / 0.45, 0.0, 1.0 );
              float e = 1.0 - pow( 1.0 - k, 3.0 );
              transformed.y -= ( 1.0 - e ) * 2.4;
              transformed.y += sin( k * 3.14159 ) * 0.12;
            }`,
          );
      };
      c.customProgramCacheKey = () => key;
      return c;
    };
    return { matte: mk(this.matte), paving: mk(this.paving), metal: mk(this.metal) };
  }

  /** Clipped copies for a sinking gate. */
  clipped(plane: THREE.Plane) {
    const mk = (m: THREE.MeshStandardMaterial) => {
      const c = cloneSol(m);
      c.clippingPlanes = [plane];
      c.clipShadows = true;
      return c;
    };
    return { stone: mk(this.paving), metal: mk(this.metal), matte: mk(this.matte) };
  }

  dispose() {
    for (const m of Object.values(this)) if (m instanceof THREE.Material) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
