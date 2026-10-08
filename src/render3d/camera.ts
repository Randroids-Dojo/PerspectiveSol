import * as THREE from "three";
import { CROSS, shakeOffset, type ViewFrame } from "../view";
import { clamp, lerp, smoother } from "./util";

/**
 * The sculpted camera and the fold.
 *
 * fold 0: a three-quarter view (yaw and pitch) following view.focus.
 * fold 0..CROSS: yaw and pitch ease to zero, distance eases to the flat
 *   framing distance D, and the world group's depth is squashed onto the plane
 *   z = focus.z. At CROSS the projection of any point (x, y) on that plane is
 *   exactly flatToScreen(view, x, y).
 * fold CROSS..1: held at the flat framing.
 */

export const FOV = 38;
/** Depth scale at full flatten. Not zero so normals stay finite. */
export const FLAT_MIN = 0.002;

export type Pose = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** World group depth scale (1 = full depth). */
  depth: number;
  /** 0 = three-quarter, 1 = side. */
  side: number;
};

const YAW = 0.38; // radians, camera to the right of the keeper looking a little left
const PITCH = 0.4; // radians, looking down

export function flatDistance(view: ViewFrame, fovDeg = FOV) {
  return view.viewHeight / 2 / Math.tan(((fovDeg / 2) * Math.PI) / 180);
}

export function pose(view: ViewFrame, clock: number, out: Pose): Pose {
  const side = smoother(clamp(view.fold / CROSS, 0, 1));
  const D = flatDistance(view);
  const f = view.focus;
  const portrait = view.width < view.height;
  // Three-quarter framing: a little closer than the flat view so the keeper reads large.
  const R3 = D * (portrait ? 0.72 : 0.78);
  let yaw = YAW * (1 - side);
  let pitch = PITCH * (1 - side);
  let R = lerp(R3, D, side);
  const target = out.target.set(f.x, f.y, f.z);
  // In 3D the camera aims a little ahead and below the focus so the keeper sits nicely.
  target.y -= 0.6 * (1 - side);
  target.x += 0.4 * (1 - side);

  const c = view.cinematic;
  if (c > 0) {
    const drift = view.reduced ? 0 : Math.sin(clock * 0.045) * 0.22;
    yaw = lerp(yaw, -0.32 + drift, c);
    pitch = lerp(pitch, 0.16 + (view.reduced ? 0 : Math.sin(clock * 0.031) * 0.03), c);
    R = lerp(R, D * 2.3, c);
    target.y += c * 2.6;
    target.x += c * (6 + (view.reduced ? 0 : Math.sin(clock * 0.027) * 3));
  }

  const cp = Math.cos(pitch);
  out.position.set(target.x + Math.sin(yaw) * cp * R, target.y + Math.sin(pitch) * R, target.z + Math.cos(yaw) * cp * R);
  const s = shakeOffset(view, clock);
  out.position.x += s.x;
  out.position.y += s.y;
  target.x += s.x;
  target.y += s.y;
  out.depth = lerp(1, FLAT_MIN, side);
  out.side = side;
  return out;
}
