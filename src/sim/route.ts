import { STEP } from "./constants";
import { Game } from "./game";
import { IDLE, type Input, type Level } from "./types";

/**
 * Scripted play-throughs. A route drives the keeper with the same inputs a
 * player has (move, depth, jump, fold), so a passing route proves a chapter
 * can be finished as designed. Routes live with the chapters, double as their
 * documentation, and play the title screen's demonstration.
 */
export type Action =
  /** Walk on the ground until x (and z in 3D) is reached. */
  | { go: number; z?: number; tol?: number }
  /**
   * Jump toward x (and z). With `from`, run toward the target and take off once
   * past `from`. `tap` releases jump early for a short hop. `fold` presses fold
   * that many seconds into the jump. Ends on landing.
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

export class RouteError extends Error {
  constructor(
    message: string,
    readonly action: number,
  ) {
    super(message);
  }
}

const steer = (from: number, to: number, gain = 2.5) =>
  Math.max(-1, Math.min(1, (to - from) * gain));

/**
 * Yields one input per simulation step. The caller steps `g` with each input
 * before asking for the next. Throws RouteError when the plan cannot proceed.
 */
export function* drive(g: Game, actions: Action[]): Generator<Partial<Input>, void, void> {
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const fail = (why: string): never => {
      throw new RouteError(why, i);
    };
    if ("go" in a) {
      const tol = a.tol ?? 0.15;
      for (let n = 0; ; n++) {
        const p = g.player;
        const dz = g.mode === "3d" && a.z !== undefined ? a.z - p.z : 0;
        if (Math.abs(a.go - p.x) < tol && Math.abs(dz) < tol && p.grounded) break;
        if (n > 120 * 20) fail(`could not walk to ${a.go}`);
        yield { x: steer(p.x, a.go), z: g.mode === "3d" && a.z !== undefined ? steer(p.z, a.z) : 0 };
      }
      for (let k = 0; k < 6; k++) yield {};
    } else if ("jump" in a) {
      const dir = Math.sign(a.jump - g.player.x) || 1;
      if (a.from !== undefined)
        for (let n = 0; (g.player.x - a.from) * dir < 0; n++) {
          if (!g.player.grounded) fail(`left the ground before ${a.from}`);
          if (n > 120 * 10) fail(`could not run to ${a.from}`);
          yield { x: dir, z: g.mode === "3d" && a.z !== undefined ? steer(g.player.z, a.z) * 0.6 : 0 };
        }
      let held = 0,
        left = false,
        folded = false;
      for (let n = 0; ; n++) {
        const p = g.player;
        let fold = 0;
        if (a.fold !== undefined && !folded && held >= a.fold) {
          fold = 1;
          folded = true;
        }
        yield {
          x: steer(p.x, a.jump, 3),
          z: g.mode === "3d" && a.z !== undefined ? steer(p.z, a.z) : 0,
          jump: a.tap ? held < 0.08 : held < 0.6,
          fold,
        };
        held += STEP;
        if (!g.player.grounded) left = true;
        if (left && g.player.grounded) break;
        if (n > 120 * 4) fail(`jump toward ${a.jump} never landed`);
      }
      if (a.on && g.player.support !== a.on) fail(`landed on ${g.player.support} instead of ${a.on}`);
      for (let k = 0; k < 4; k++) yield {};
    } else if ("fold" in a) {
      yield { fold: 1 };
    } else if ("wait" in a) {
      for (let t = 0; t < a.wait; t += STEP) yield {};
    } else if ("until" in a) {
      for (let t = 0; !a.until(g); t += STEP) {
        if (t > (a.timeout ?? 20)) fail(`timed out waiting: ${a.why}`);
        const p = g.player;
        yield {
          x: a.x !== undefined ? steer(p.x, a.x) : 0,
          z: a.z !== undefined && g.mode === "3d" ? steer(p.z, a.z) : 0,
        };
      }
    } else if ("expect" in a) {
      if (!a.expect(g)) fail(`expected: ${a.why}`);
    }
  }
}

export type RouteResult = {
  ok: boolean;
  reason?: string;
  action?: number;
  time: number;
  game: Game;
};

/** Play a route to the end in a fresh game. */
export function runRoute(level: Level, actions: Action[], limit = 600): RouteResult {
  const g = new Game(level);
  const steps = drive(g, actions);
  try {
    for (let n = 0; ; n++) {
      if (g.status === "clearing" || g.status === "clear") break;
      const next = steps.next();
      if (next.done) break;
      g.step({ ...IDLE, ...next.value });
      if (g.status === "dying")
        throw new RouteError(`lost the keeper (${g.events.find((e) => e.type === "die")?.cause})`, -1);
      if (n * STEP > limit) throw new RouteError("time limit", -1);
    }
    for (let t = 0; t < 3 && g.status === "clearing"; t += STEP) g.step(IDLE);
  } catch (e) {
    const action = e instanceof RouteError ? e.action : undefined;
    return { ok: false, reason: (e as Error).message, action, time: g.time, game: g };
  }
  return {
    ok: g.status === "clear",
    reason: g.status === "clear" ? undefined : `ended ${g.status} with ${g.seeds} seeds`,
    time: g.time,
    game: g,
  };
}
