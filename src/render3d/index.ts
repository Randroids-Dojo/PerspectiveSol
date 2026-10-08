import type { FrameInput, Quality, WorldRenderer } from "../contract";
import type { Game } from "../sim/game";
import type { GameEvent, Level, Vec3 } from "../sim/types";

/** Placeholder sculpted renderer. To be replaced. */
export class Sculpted implements WorldRenderer {
  frames = 0;
  constructor(private canvas: HTMLCanvasElement) {}
  load(_level: Level) {}
  resize(_w: number, _h: number, _dpr: number) {}
  setQuality(_q: Quality) {}
  event(_e: GameEvent, _g: Game) {}
  project(_p: Vec3) {
    return null;
  }
  frame(_i: FrameInput) {
    void this.canvas;
  }
  snapshot() {
    return { engine: "webgl", frames: this.frames };
  }
}
