import type { Game } from "../sim/game";
import type { ViewFrame } from "../view";
import type { Art } from "./art";
import type { Ctx, Sprite } from "./util";

/** Everything a painter needs for one frame. Positions are device pixels unless noted. */
export type Draw = {
  c: Ctx;
  game: Game;
  view: ViewFrame;
  art: Art;
  /** CSS size. */
  w: number;
  h: number;
  /** Backing pixels per CSS pixel (capped on low quality). */
  dpr: number;
  /** CSS pixels per world unit. */
  k: number;
  /** Device pixels per world unit. */
  S: number;
  /** Focus with camera shake applied. */
  fx: number;
  fy: number;
  /** Resting camera height for vertical parallax. */
  refY: number;
  /** Ambient seconds (keeps running when paused). */
  clock: number;
  /** Gameplay animation seconds (holds while paused). */
  t: number;
  dt: number;
  paused: boolean;
  low: boolean;
};

export const sx = (d: Draw, x: number) => (d.w / 2 + (x - d.fx) * d.k) * d.dpr;
export const sy = (d: Draw, y: number) => (d.h / 2 - (y - d.fy) * d.k) * d.dpr;

/** Set the transform so local art (world units, y down) is drawn at world (x, y). */
export function place(d: Draw, x: number, y: number, flip = 1, scale = 1) {
  d.c.setTransform(d.S * flip * scale, 0, 0, d.S * scale, sx(d, x), sy(d, y));
}

/** Blit a cached sprite whose origin sits at world (x, y), snapped to device pixels. */
export function blit(d: Draw, s: Sprite, x: number, y: number) {
  d.c.drawImage(s.canvas, Math.round(sx(d, x) - s.ox), Math.round(sy(d, y) - s.oy));
}

/** Is a world-space box (centre x, top y, half width, extents below and above) on screen? */
export function onScreen(d: Draw, x: number, top: number, half: number, above: number, below: number) {
  const left = sx(d, x - half),
    right = sx(d, x + half);
  const t = sy(d, top + above),
    b = sy(d, top - below);
  return right > -40 && left < d.w * d.dpr + 40 && b > -40 && t < d.h * d.dpr + 40;
}
