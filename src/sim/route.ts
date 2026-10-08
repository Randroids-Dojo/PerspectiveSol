import { STEP } from "./constants";
import { Game } from "./game";
import { IDLE, type Input, type Level } from "./types";

/**
 * Scripted play-throughs. A route drives the keeper with the same inputs a
 * player has (move, depth, jump, fold), so a passing route proves a chapter
 * can be finished as designed. Routes live with the chapters and double as
 * their documentation.
 */
export type Action =
  /** Walk on the ground until x (and z in 3D) is reached. */
  | { go: number; z?: number; tol?: number }
  /**
   * Jump toward x (and z). With `from`, run toward the target and take off once
   * past `from`. `tap` releases jump early for a short hop. Ends on landing.
   */
  | { jump: number; z?: number; from?: number; tap?: boolean; fold?: number; on?: string }
  /** Press fold once. */
  | { fold: true }
  /** Stand still. */
  | { wait: number }
  /** Hold a direction until a condition holds. */
  | { until: (g: Game) => boolean; x?: number; z?: number; timeout?: number; why: string }
  /** Check the state. */
  | { expect: (g: Game) => boolean; why: string };

export type RouteResult = {
  ok: boolean;
  reason?: string;
  action?: number;
  time: number;
  game: Game;
};

class Done extends Error {}

const steer = (from: number, to: number, gain = 2.5) =>
  Math.max(-1, Math.min(1, (to - from) * gain));

export function runRoute(level: Level, actions: Action[], limit = 600): RouteResult {
  const g = new Game(level);
  let frames = 0;
  const tick = (input: Partial<Input>) => {
    if (g.status === "clearing" || g.status === "clear") throw new Done();
    g.step({ ...IDLE, ...input });
    frames++;
    if (frames * STEP > limit) throw new Error("time limit");
    if (g.status === "dying") throw new Error(`lost the keeper (${g.events.find((e) => e.type === "die")?.cause})`);
  };
  try {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      try {
        if ("go" in a) {
          const tol = a.tol ?? 0.15;
          let n = 0;
          for (;;) {
            const p = g.player;
            const dx = a.go - p.x;
            const dz = g.mode === "3d" && a.z !== undefined ? a.z - p.z : 0;
            if (Math.abs(dx) < tol && Math.abs(dz) < tol && p.grounded) break;
            tick({ x: steer(p.x, a.go), z: g.mode === "3d" && a.z !== undefined ? steer(p.z, a.z) : 0 });
            if (++n > 120 * 20) throw new Error(`could not walk to ${a.go}`);
          }
          // Settle so the next jump starts from rest.
          for (let k = 0; k < 6; k++) tick({});
        } else if ("jump" in a) {
          const dir = Math.sign(a.jump - g.player.x) || 1;
          if (a.from !== undefined) {
            let n = 0;
            while ((g.player.x - a.from) * dir < 0) {
              tick({ x: dir, z: g.mode === "3d" && a.z !== undefined ? steer(g.player.z, a.z) * 0.6 : 0 });
              if (!g.player.grounded) throw new Error(`left the ground before ${a.from}`);
              if (++n > 120 * 10) throw new Error(`could not run to ${a.from}`);
            }
          }
          let held = 0,
            n = 0,
            left = false,
            folded = false;
          for (;;) {
            const p = g.player;
            const hold = a.tap ? held < 0.08 : held < 0.6;
            let fold = 0;
            if (a.fold !== undefined && !folded && held >= a.fold) {
              fold = 1;
              folded = true;
            }
            const z = g.mode === "3d" && a.z !== undefined ? steer(p.z, a.z) : 0;
            tick({ x: steer(p.x, a.jump, 3), z, jump: hold, fold });
            held += STEP;
            if (!g.player.grounded) left = true;
            if (left && g.player.grounded) break;
            if (++n > 120 * 4) throw new Error(`jump toward ${a.jump} never landed`);
          }
          if (a.on && g.player.support !== a.on)
            throw new Error(`landed on ${g.player.support} instead of ${a.on}`);
          for (let k = 0; k < 4; k++) tick({});
        } else if ("fold" in a) {
          tick({ fold: 1 });
        } else if ("wait" in a) {
          for (let t = 0; t < a.wait; t += STEP) tick({});
        } else if ("until" in a) {
          let t = 0;
          while (!a.until(g)) {
            const p = g.player;
            tick({
              x: a.x !== undefined ? steer(p.x, a.x) : 0,
              z: a.z !== undefined && g.mode === "3d" ? steer(p.z, a.z) : 0,
            });
            t += STEP;
            if (t > (a.timeout ?? 20)) throw new Error(`timed out waiting: ${a.why}`);
          }
        } else if ("expect" in a) {
          if (!a.expect(g)) throw new Error(`expected: ${a.why}`);
        }
      } catch (e) {
        if (e instanceof Done) break;
        return { ok: false, reason: (e as Error).message, action: i, time: g.time, game: g };
      }
      if (g.status === "clearing" || g.status === "clear") break;
    }
    // Let the clear sequence finish.
    for (let t = 0; t < 3 && g.status === "clearing"; t += STEP) g.step(IDLE);
  } catch (e) {
    return { ok: false, reason: (e as Error).message, time: g.time, game: g };
  }
  return {
    ok: g.status === "clear",
    reason: g.status === "clear" ? undefined : `ended ${g.status} with ${g.seeds} seeds`,
    time: g.time,
    game: g,
  };
}
