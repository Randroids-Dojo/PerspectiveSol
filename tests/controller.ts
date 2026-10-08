import { Game, EMPTY, type Input } from "../src/core";
import { platformAt, type Platform } from "../src/levels";
const axis = (delta: number) => Math.max(-1, Math.min(1, delta * 2));
/** A route follower using the same move/jump/fold/kindle inputs as a player. */
export class RouteController {
  target = 1;
  jumpTime = 0;
  release = 0;
  wallPhase = 0;
  sentinel: { platform: Platform; x: number; phase: number } | null = null;
  decide(g: Game): Input {
    const b = g.player;
    const p =
      g.level.platforms[Math.min(this.target, g.level.platforms.length - 1)];
    const dest = platformAt(p, g.time);
    const supportOriginal = g.level.platforms.find((p) => p.id === g.support);
    const support = supportOriginal
      ? platformAt(supportOriginal, g.time)
      : null;
    let aimX =
        this.target >= g.level.platforms.length ? g.level.exit.x : dest.x,
      aimZ = dest.z,
      shift = false,
      jump = false;
    const wall =
      g.level.walls.find((w) => w.x === p.x) ||
      g.level.walls.find((w) => b.x < w.x + 1.2 && Math.abs(b.x - w.x) < 2.8);
    if (
      !this.sentinel &&
      b.grounded &&
      support &&
      support.id !== p.id &&
      b.x < support.x + support.w / 2 - 0.7 &&
      g.level.hazards.some(
        (h) => Math.abs(h.x - support.x) < support.w / 2 && h.z === support.z,
      )
    )
      this.sentinel = { platform: support, x: b.x, phase: 1 };
    if (this.sentinel) {
      const s = this.sentinel;
      aimX = s.x;
      aimZ = s.platform.z - 2;
      if (s.phase === 1) {
        if (g.mode === "2d") shift = true;
        else s.phase = 2;
      }
      if (s.phase === 2 && Math.abs(b.z - aimZ) < 0.15) s.phase = 3;
      if (s.phase === 3) {
        aimX = s.platform.x + s.platform.w / 2 - 0.2;
        if (Math.abs(b.x - aimX) < 0.1) s.phase = 4;
      }
      if (s.phase === 4) {
        aimX = s.platform.x + s.platform.w / 2 - 0.2;
        if (b.grounded) {
          this.jumpTime = 0.9;
          s.phase = 5;
        }
      }
      if (s.phase === 5) {
        aimX = dest.x;
        if (b.y > s.platform.y + 1.1) {
          if (g.mode === "3d") shift = true;
          else this.sentinel = null;
        }
      }
    } else if (wall) {
      if (!this.wallPhase) this.wallPhase = 1;
      if (this.wallPhase === 1) {
        aimX = wall.x - 2;
        aimZ = -3;
        if (b.grounded && Math.abs(b.x - aimX) < 0.25) {
          if (g.mode === "2d") shift = true;
          else this.wallPhase = 2;
        }
      }
      if (this.wallPhase === 2) {
        aimX = wall.x - 2;
        aimZ = -3;
        if (Math.abs(b.z + 3) < 0.2) this.wallPhase = 3;
      }
      if (this.wallPhase === 3) {
        aimX = wall.x + 2;
        aimZ = -3;
        if (Math.abs(b.x - aimX) < 0.2) this.wallPhase = 4;
      }
      if (this.wallPhase === 4) {
        aimX = wall.x + 2;
        aimZ = -3;
        if (g.mode === "3d") shift = true;
        else {
          this.target++;
          this.wallPhase = 0;
        }
      }
    }
    if (this.release > 0) this.release--;
    else if (this.jumpTime > 0) {
      jump = true;
      this.jumpTime -= 1 / 120;
    } else if (
      !this.sentinel &&
      b.grounded &&
      support &&
      support.id !== p.id &&
      b.x > support.x + support.w / 2 - 1.15
    ) {
      jump = true;
      this.jumpTime = 0.9;
    }
    return {
      ...EMPTY,
      x: axis(aimX - b.x),
      z: g.mode === "3d" ? axis(aimZ - b.z) : 0,
      jump,
      shift: shift && !g.lastShift && g.shiftCooldown <= 0,
      interact: this.target >= g.level.platforms.length,
    };
  }
  observe(g: Game) {
    for (const e of g.events) {
      if (e.type === "land") {
        this.jumpTime = 0;
        this.release = 2;
      }
      if (e.type === "fall") {
        this.target =
          g.checkpointIndex < 0
            ? 1
            : Math.max(
                1,
                g.level.platforms.findIndex(
                  (p) => Math.abs(p.x - g.checkpoint.x) < 3,
                ),
              );
        this.wallPhase = 0;
        this.jumpTime = 0;
        this.sentinel = null;
      }
    }
    const p =
      g.level.platforms[Math.min(this.target, g.level.platforms.length - 1)];
    if (
      !this.wallPhase &&
      !this.sentinel &&
      !g.level.walls.some((w) => w.x === p.x) &&
      g.support === p.id &&
      g.player.grounded &&
      Math.abs(g.player.x - platformAt(p, g.time).x) < 0.3
    )
      this.target++;
  }
}
export function runChapter(g: Game, maxTicks = 24000) {
  const controller = new RouteController();
  const trace: { type: string; time: number; mode: string }[] = [];
  // Start by folding via the normal input path.
  if (g.mode === "3d") {
    g.step({ ...EMPTY, shift: true }, 1 / 120);
    g.step(EMPTY, 1 / 120);
  }
  for (let i = 0; i < maxTicks && g.status === "playing"; i++) {
    g.step(controller.decide(g), 1 / 120);
    trace.push(
      ...g.events.map((e) => ({ type: e.type, time: g.time, mode: g.mode })),
    );
    controller.observe(g);
  }
  return { state: g.snapshot(), trace, target: controller.target };
}
