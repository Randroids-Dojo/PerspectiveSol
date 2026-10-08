import type { FrameInput, Quality, WorldRenderer } from "../contract";
import type { Game } from "../sim/game";
import type { GameEvent, Level, Vec3 } from "../sim/types";
import { flatToScreen, layerOpacity, type ViewFrame } from "../view";

/** Placeholder illustrated renderer: flat boxes. To be replaced. */
export class Illustrated implements WorldRenderer {
  private ctx: CanvasRenderingContext2D;
  private level: Level | null = null;
  private view: ViewFrame | null = null;
  frames = 0;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }
  load(level: Level) {
    this.level = level;
  }
  resize(w: number, h: number, dpr: number) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }
  setQuality(_q: Quality) {}
  event(_e: GameEvent, _g: Game) {}
  project(p: Vec3) {
    return this.view ? flatToScreen(this.view, p.x, p.y) : null;
  }
  frame({ game, view }: FrameInput) {
    this.view = view;
    if (layerOpacity(view.fold).flat <= 0 || !this.level) return;
    this.frames++;
    const c = this.ctx,
      k = view.height / view.viewHeight,
      dpr = this.canvas.width / view.width;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = layerOpacity(view.fold).flat;
    c.fillStyle = this.level.theme.palette.skyTop;
    c.fillRect(0, 0, view.width, view.height);
    for (const b of game.solids("2d")) {
      const a = flatToScreen(view, b.x0, b.y1);
      c.fillStyle = this.level.theme.palette.stone;
      c.fillRect(a.x, a.y, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
    }
    const p = flatToScreen(view, game.player.x, game.player.y);
    c.fillStyle = "#fff";
    c.fillRect(p.x - 0.3 * k, p.y - 1.2 * k, 0.6 * k, 1.2 * k);
    c.globalAlpha = 1;
  }
  snapshot() {
    return { engine: "canvas2d", frames: this.frames };
  }
}
