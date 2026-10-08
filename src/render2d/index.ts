import type { FrameInput, Quality, WorldRenderer } from "../contract";
import type { Game } from "../sim/game";
import type { GameEvent, Island, Level, Vec3, Wall } from "../sim/types";
import { CROSS, flatToScreen, layerOpacity, pixelsPerUnit, shakeOffset, type ViewFrame } from "../view";
import { makeArt, type Art } from "./art";
import { blit, onScreen, sx, sy, type Draw } from "./draw";
import { Effects } from "./effects";
import { glowAt } from "./glow";
import { gearSprite, paintIsland, type IslandArt } from "./islands";
import { Keeper } from "./keeper";
import { Paper } from "./paper";
import { Props } from "./props";
import { Sky } from "./sky";
import { TAU, clamp, easeInOutSine, rgba, sparkle } from "./util";

/**
 * The illustrated world: an independent Canvas 2D renderer with its own
 * artwork. A celestial storybook of painted islands, ink, gold leaf, paper
 * grain and layered skies, drawn over the shared simulation in the flat
 * framing of src/view.ts.
 */
export class Illustrated implements WorldRenderer {
  private ctx: CanvasRenderingContext2D;
  private level: Level | null = null;
  private art: Art | null = null;
  private sky: Sky | null = null;
  private paper: Paper | null = null;
  private props: Props | null = null;
  private keeper: Keeper | null = null;
  private effects: Effects | null = null;
  private islands = new Map<string, IslandArt>();
  private quality: Quality = "high";
  private cssW = 0;
  private cssH = 0;
  private dprIn = 1;
  private dpr = 1;
  private S = 0;
  private refY = NaN;
  private t = 0;
  private view: ViewFrame | null = null;
  private shake = { x: 0, y: 0 };
  private cleared = true;
  private frames = 0;
  private builds = 0;
  private drawn = 0;
  private reveal = 0;
  private cpu = 0;
  private cpuAvg = 0;
  private lastGame: Game | null = null;
  private lastGameTime = 0;
  private buildMs = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("The illustrated world needs Canvas 2D.");
    this.ctx = ctx;
  }

  // ------------------------------------------------------------- contract

  load(level: Level) {
    this.level = level;
    const art = makeArt(level);
    this.art = art;
    this.sky = new Sky(art);
    this.paper = new Paper(art);
    this.props = new Props(art, level);
    this.keeper = new Keeper(art);
    this.effects = new Effects(art, level);
    this.effects.low = this.quality === "low";
    this.islands.clear();
    this.S = 0;
    this.refY = NaN;
    this.t = 0;
  }

  resize(width: number, height: number, dpr: number) {
    this.cssW = width;
    this.cssH = height;
    this.dprIn = dpr;
    this.applySize();
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    if (this.effects) this.effects.low = q === "low";
    if (this.cssW) this.applySize();
  }

  private applySize() {
    this.dpr = this.quality === "low" ? Math.min(this.dprIn, 1.25) : this.dprIn;
    this.canvas.width = Math.max(1, Math.round(this.cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.cssH * this.dpr));
    this.cleared = true;
  }

  event(e: GameEvent, game: Game) {
    if (!this.keeper || !this.effects || !this.props) return;
    this.keeper.event(e, this.t);
    this.effects.event(e, game, this.keeper.sunPos.x, this.keeper.sunPos.y);
    if (e.type === "locked") this.props.lockedAt = this.t;
  }

  project(p: Vec3) {
    if (!this.view) return null;
    return flatToScreen(this.view, p.x - this.shake.x, p.y - this.shake.y);
  }

  snapshot() {
    let bytes = 0;
    for (const a of this.islands.values()) bytes += a.bytes;
    bytes += (this.sky?.bytes ?? 0) + (this.paper?.bytes ?? 0) + (this.props?.bytes ?? 0);
    return {
      engine: "canvas2d",
      artwork: "illustrated",
      frames: this.frames,
      quality: this.quality,
      dpr: this.dpr,
      backing: [this.canvas.width, this.canvas.height],
      chapter: this.art?.time ?? null,
      islandsCached: this.islands.size,
      islandBuilds: this.builds,
      islandsDrawn: this.drawn,
      particles: this.effects?.count ?? 0,
      cacheMB: Math.round(bytes / 1e5) / 10,
      reveal: this.reveal,
      cpuMs: Math.round(this.cpuAvg * 100) / 100,
      maxIslandBuildMs: Math.round(this.buildMs * 10) / 10,
    };
  }

  // ---------------------------------------------------------------- frame

  frame(input: FrameInput) {
    const { game, view, clock, paused } = input;
    this.view = view;
    const level = this.level,
      art = this.art;
    if (!level || !art || !this.sky || !this.paper || !this.props || !this.keeper || !this.effects) return;
    const start = performance.now();
    if (!this.cssW || Math.abs(this.cssW - view.width) > 0.5 || Math.abs(this.cssH - view.height) > 0.5) {
      this.cssW = view.width;
      this.cssH = view.height;
      this.dprIn = this.dprIn || view.dpr;
      this.applySize();
    }
    // Gameplay animation follows simulation time so it holds while paused
    // and stays in step when the simulation is advanced frame by frame.
    const gd = this.lastGame === game ? game.time - this.lastGameTime : 0;
    this.lastGame = game;
    this.lastGameTime = game.time;
    const raw = paused ? 0 : clamp(Math.max(gd, input.dt), 0, 1);
    const dt = Math.min(raw, 0.1);
    this.t += dt;
    const k = pixelsPerUnit(view);
    const S = k * this.dpr;
    if (Math.abs(S - this.S) > 0.01) {
      this.S = S;
      this.islands.clear();
    }
    if (isNaN(this.refY)) this.refY = level.start.y + view.viewHeight * 0.12;
    this.shake = shakeOffset(view, clock);
    const low = this.quality === "low";
    const d: Draw = {
      c: this.ctx,
      game,
      view,
      art,
      w: this.cssW,
      h: this.cssH,
      dpr: this.dpr,
      k,
      S,
      fx: view.focus.x + this.shake.x,
      fy: view.focus.y + this.shake.y,
      refY: this.refY,
      clock,
      t: this.t,
      dt,
      paused,
      low,
    };
    // Keep the keeper and effects alive even while hidden so a fold opens
    // from the right place.
    this.keeper.update(d, raw);
    this.effects.update(d);
    if (dt > 0) this.props.updateTrails(d);

    const flat = layerOpacity(view.fold).flat;
    const c = this.ctx;
    if (flat <= 0) {
      if (!this.cleared) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.cleared = true;
      }
      this.reveal = 0;
      return;
    }
    this.cleared = false;
    this.props.ensure(S);
    this.sky.ensure(d.w, d.h, d.dpr, low);
    this.paper.ensure(d.w, d.h, d.dpr, low);

    const W = this.canvas.width,
      H = this.canvas.height;
    const reveal = !view.reduced && view.fold < 1;
    const fade = view.reduced && flat < 1;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    if (reveal || fade) c.clearRect(0, 0, W, H);
    let cx = 0,
      cy = 0,
      radius = 0;
    if (reveal) {
      cx = sx(d, this.keeper.sunPos.x);
      cy = sy(d, this.keeper.sunPos.y);
      const u = clamp((view.fold - CROSS) / (1 - CROSS));
      radius = easeInOutSine(u) * Math.hypot(W, H);
      this.reveal = radius / Math.hypot(W, H);
      c.save();
      c.beginPath();
      c.arc(cx, cy, Math.max(0.5, radius), 0, TAU);
      c.clip();
    } else this.reveal = 1;

    this.paint(d);

    if (reveal) {
      c.restore();
      this.rim(d, cx, cy, radius);
    }
    if (fade) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "destination-in";
      c.fillStyle = `rgba(0,0,0,${flat.toFixed(3)})`;
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = "source-over";
    }
    this.frames++;
    this.cpu = performance.now() - start;
    this.cpuAvg = this.cpuAvg ? this.cpuAvg * 0.95 + this.cpu * 0.05 : this.cpu;
  }

  /** The soft golden rim of the opening circle. */
  private rim(d: Draw, cx: number, cy: number, r: number) {
    if (r < 1) return;
    const c = d.c,
      a = d.art;
    const s = d.dpr;
    const band = Math.min(40 * s, r * 0.35);
    const wide = Math.min(26 * s, r * 0.25);
    c.setTransform(1, 0, 0, 1, 0, 0);
    // Inner shade like the edge of a turned page.
    const g = c.createRadialGradient(cx, cy, Math.max(0, r - band), cx, cy, r);
    g.addColorStop(0, rgba(a.ink, 0));
    g.addColorStop(1, rgba(a.ink, 0.2));
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.fillStyle = g;
    c.fill();
    c.globalCompositeOperation = "lighter";
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.strokeStyle = rgba(a.warm, 0.22);
    c.lineWidth = wide;
    c.stroke();
    c.strokeStyle = rgba(a.goldLight, 0.4);
    c.lineWidth = wide * 0.4;
    c.stroke();
    c.strokeStyle = rgba("#fffbe8", 0.55);
    c.lineWidth = Math.max(1, wide * 0.08);
    c.stroke();
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "#fffbe8";
    const n = d.low ? 10 : 22;
    const sp = Math.min(1, r / (120 * s));
    for (let k = 0; k < n; k++) {
      const an = (k / n) * TAU + d.clock * 0.6;
      const rr = r + Math.sin(k * 3.7 + d.clock * 5) * 6 * s * sp;
      c.beginPath();
      sparkle(c, cx + Math.cos(an) * rr, cy + Math.sin(an) * rr, (2 + (k % 3) * 1.6) * s * (0.4 + sp * 0.6));
      c.fill();
    }
  }

  // ---------------------------------------------------------------- paint

  private islandArt(d: Draw, i: Island, need: boolean) {
    let a = this.islands.get(i.id);
    if (a && a.S === d.S) return a;
    if (!need) return undefined;
    const t0 = performance.now();
    a = paintIsland(i, d.art, d.S, this.level!);
    this.buildMs = Math.max(this.buildMs, performance.now() - t0);
    this.islands.set(i.id, a);
    this.builds++;
    return a;
  }

  private paint(d: Draw) {
    const c = d.c,
      g = d.game,
      level = this.level!,
      props = this.props!;
    this.sky!.drawBack(d);
    this.sky!.seaLayer(d, 2, 3);

    // Gather islands with their current positions, far first.
    type Item = { z: number; island?: Island; wall?: Wall; x: number; y: number; art?: IslandArt };
    const items: Item[] = [];
    const viewUnits = d.w / d.k;
    let prebuilt = false;
    for (const i of level.islands) {
      const p = g.islandPosition(i);
      const visible = onScreen(d, p.x, p.y, i.w / 2 + 3, 4.5, i.h + 7);
      if (!visible) {
        const dist = Math.abs(p.x - d.fx);
        if (dist > viewUnits * 3) this.islands.delete(i.id);
        else if (!prebuilt && dist < viewUnits * 1.6 && i.only !== "3d" && !this.islands.has(i.id)) {
          // Paint ahead, one island per frame.
          this.islandArt(d, i, true);
          prebuilt = true;
        }
        continue;
      }
      items.push({ z: p.z, island: i, x: p.x, y: p.y, art: i.only === "3d" ? undefined : this.islandArt(d, i, true) });
    }
    for (const w of level.walls) items.push({ z: w.z + 0.001, wall: w, x: w.x, y: w.y });
    items.sort((a, b) => a.z - b.z);
    this.drawn = items.filter((v) => v.island).length;

    // Pass 1: undersides and scenery, behind every walkable surface.
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (const it of items) {
      const i = it.island,
        a = it.art;
      if (!i || !a?.back) continue;
      const presence = g.islandPresence(i);
      if (presence <= 0) continue;
      if (presence < 1) c.globalAlpha = presence;
      blit(d, a.back, it.x, it.y);
      c.globalAlpha = 1;
      this.gears(d, i, a, it.x, it.y, a.gears);
      if (a.keel && i.motion) {
        const moving = !i.lantern || g.lit.has(i.lantern);
        glowAt(d, d.art.warm, it.x + a.keel.x, it.y - a.keel.y, 0.9, moving ? 0.55 + 0.2 * Math.sin(d.t * 3 + it.x) : 0.15);
      }
    }

    // Pass 2: solid slabs and walls in depth order.
    for (const it of items) {
      if (it.wall) {
        props.wall(d, it.wall);
        continue;
      }
      const i = it.island!;
      if (i.only === "3d") {
        props.prism(d, i, it.x, it.y);
        continue;
      }
      const a = it.art;
      if (!a?.front) continue;
      if (i.lantern && !i.motion) {
        const presence = g.islandPresence(i);
        if (presence < 1) {
          props.lanternBridge(d, i, a, it.x, it.y, presence);
          continue;
        }
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
      blit(d, a.front, it.x, it.y);
      if (a.faceGears.length) this.gears(d, i, a, it.x, it.y, a.faceGears);
      if (i.only === "2d") props.starBridge(d, i, it.x, it.y);
    }

    props.checkpoints(d);
    props.observatoryDraw(d);
    props.lanterns(d);
    props.pickups(d);
    props.sentinels(d);
    this.keeper!.draw(d);
    this.effects!.draw(d);
    this.sky!.drawFront(d);
    this.paper!.draw(c, d.w, d.h, d.dpr);
    this.effects!.drawFlash(d);
  }

  /** Turning gears: decorative ones idle with the clock, plinth ones roll with motion. */
  private gears(d: Draw, i: Island, a: IslandArt, x: number, y: number, list: IslandArt["gears"]) {
    if (!list.length) return;
    const c = d.c;
    let roll = 0;
    if (i.motion) {
      const base = i[i.motion.axis];
      const now = i.motion.axis === "x" ? x : i.motion.axis === "y" ? y : d.game.islandPosition(i).z;
      roll = (now - base) * 2.2;
    }
    for (const gs of list) {
      const s = gearSprite(d.art, gs.teeth, gs.tone, gs.r * d.S);
      const ang = i.motion ? roll * gs.speed : d.clock * 0.5 * gs.speed;
      const ca = Math.cos(ang),
        sa = Math.sin(ang);
      c.setTransform(ca, sa, -sa, ca, sx(d, x + gs.x), sy(d, y - gs.y));
      c.drawImage(s.canvas, -s.ox, -s.oy);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    void a;
  }
}
