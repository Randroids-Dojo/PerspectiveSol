import type { Game } from "./sim/game";
import type { Vec3 } from "./sim/types";

/**
 * The shared camera. Both renderers frame the same focus point at the same
 * scale, which is what lets the illustrated world reveal itself exactly over
 * the folded sculpted world.
 *
 * `fold` timeline (0 = sculpted 3D, 1 = illustrated 2D):
 *   0 .. CROSS   the 3D world folds: its camera swings to a side view and its
 *                depth flattens onto the keeper's plane.
 *   CROSS .. 1   the illustrated world opens from the keeper's sun over it.
 * Unfolding plays the same timeline backwards, so a switch can reverse at any
 * instant without a jump. Gameplay rules change at the instant of the press.
 */
export const FOLD_SECONDS = 0.6;
export const REDUCED_FOLD_SECONDS = 0.26;
export const CROSS = 0.6;

export type ViewFrame = {
  /** CSS pixels. */
  width: number;
  height: number;
  dpr: number;
  /** World point at the centre of both framings. */
  focus: Vec3;
  /** World units visible vertically in the flat framing (and on the focus plane in 3D side view). */
  viewHeight: number;
  /** Transition progress, see above. Linear in time; renderers apply their own easing. */
  fold: number;
  /** Direction of the latest switch. */
  heading: "fold" | "unfold";
  /** Seconds since the latest switch began. */
  sinceSwitch: number;
  /** Screen shake in world units, decays on its own. */
  shake: number;
  reduced: boolean;
  /** 0 during play; 1 on the title screen, where the 3D camera may pull back and drift. */
  cinematic: number;
};

export const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Opacity of each canvas for a fold value. */
export function layerOpacity(fold: number) {
  const flat = smoothstep(CROSS, 1, fold);
  return { flat, sculpted: fold >= 1 ? 0 : 1 };
}

/** Pixels per world unit in the flat framing. */
export const pixelsPerUnit = (v: ViewFrame) => v.height / v.viewHeight;

/** Flat framing: world (x, y) to CSS pixels. */
export function flatToScreen(v: ViewFrame, x: number, y: number) {
  const k = pixelsPerUnit(v);
  return {
    x: v.width / 2 + (x - v.focus.x) * k,
    y: v.height / 2 - (y - v.focus.y) * k,
  };
}

/** World units visible vertically, chosen so phones in portrait still see the path. */
export function viewHeightFor(width: number, height: number) {
  const aspect = width / Math.max(1, height);
  const minWidth = 17;
  return Math.max(12.5, Math.min(23, minWidth / aspect));
}

const damp = (current: number, target: number, rate: number, dt: number) =>
  target + (current - target) * Math.exp(-rate * dt);

/** Follows the keeper with look-ahead and a vertical dead zone. */
export class CameraRig {
  focus: Vec3 = { x: 0, y: 2, z: 0 };
  private look = 0;
  private groundY = 0;
  shake = 0;

  snap(game: Game, viewHeight: number) {
    const p = game.player;
    this.groundY = p.y;
    this.look = p.facing * 1.4;
    this.focus = { x: p.x + this.look, y: p.y + viewHeight * 0.12, z: p.z };
    this.clamp(game, viewHeight, 16 / 9);
  }

  update(game: Game, dt: number, viewHeight: number, aspect: number) {
    const p = game.player;
    const lookTarget = p.facing * 1.4 + p.vx * 0.12;
    this.look = damp(this.look, lookTarget, 2.2, dt);
    if (p.grounded || game.status !== "playing") this.groundY = p.y;
    else if (p.y < this.groundY - 0.5) this.groundY = p.y + 0.5;
    else if (p.y > this.groundY + 3.2) this.groundY = p.y - 3.2;
    const tx = p.x + this.look;
    const ty = this.groundY + viewHeight * 0.12;
    this.focus.x = damp(this.focus.x, tx, 5, dt);
    this.focus.y = damp(this.focus.y, ty, p.grounded ? 3.2 : 2.2, dt);
    this.focus.z = damp(this.focus.z, game.mode === "3d" ? p.z : this.focus.z, 3.5, dt);
    this.clamp(game, viewHeight, aspect);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  private clamp(game: Game, viewHeight: number, aspect: number) {
    const b = game.level.bounds;
    const half = (viewHeight * aspect) / 2;
    const lo = b.x0 + half * 0.6,
      hi = b.x1 - half * 0.6;
    this.focus.x = lo < hi ? Math.max(lo, Math.min(hi, this.focus.x)) : (b.x0 + b.x1) / 2;
  }

  kick(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }
}

/** Shared camera shake so both framings shake identically. World units. */
export function shakeOffset(v: ViewFrame, clock: number) {
  if (v.shake <= 0 || v.reduced) return { x: 0, y: 0 };
  const a = v.shake * v.shake;
  return {
    x: Math.sin(clock * 53.1) * a * 0.6 + Math.sin(clock * 31.7) * a * 0.4,
    y: Math.cos(clock * 47.3) * a * 0.6 + Math.sin(clock * 23.9) * a * 0.4,
  };
}
