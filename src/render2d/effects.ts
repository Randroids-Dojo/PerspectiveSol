import { HEIGHT } from "../sim/constants";
import type { Game } from "../sim/game";
import type { GameEvent, Level } from "../sim/types";
import type { Art } from "./art";
import { place, sx, sy, type Draw } from "./draw";
import { glowAt } from "./glow";
import { Rng, TAU, clamp, easeInOutSine, easeOutCubic, makeCanvas, mix, rgba, sparkle } from "./util";

/** A soft horizontal light profile, stretched into beams. */
let beamSprite: HTMLCanvasElement | null = null;
function beam() {
  if (beamSprite) return beamSprite;
  const { canvas, ctx: c } = makeCanvas(128, 64);
  const g = c.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, "rgba(255,214,140,0)");
  g.addColorStop(0.25, "rgba(255,214,140,0.25)");
  g.addColorStop(0.42, "rgba(255,240,200,0.7)");
  g.addColorStop(0.5, "rgba(255,255,250,1)");
  g.addColorStop(0.58, "rgba(255,240,200,0.7)");
  g.addColorStop(0.75, "rgba(255,214,140,0.25)");
  g.addColorStop(1, "rgba(255,214,140,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 64);
  // Fade towards the top.
  c.globalCompositeOperation = "destination-in";
  const v = c.createLinearGradient(0, 0, 0, 64);
  v.addColorStop(0, "rgba(0,0,0,0.25)");
  v.addColorStop(0.5, "rgba(0,0,0,0.85)");
  v.addColorStop(1, "rgba(0,0,0,1)");
  c.fillStyle = v;
  c.fillRect(0, 0, 128, 64);
  beamSprite = canvas;
  return canvas;
}

type Kind = "puff" | "spark" | "mote" | "confetti" | "ink" | "swoosh" | "ray" | "ring" | "flourish" | "petal";

type P = {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  g: number;
  drag: number;
  delay: number;
};

type Thread = { x0: number; y0: number; x1: number; y1: number; start: number; dur: number; arrived: boolean; kind: "gate" | "bridge" };

/** Event-driven bursts and lights, simulated in world units. */
export class Effects {
  private ps: P[] = [];
  private threads: Thread[] = [];
  private rng = new Rng(1234);
  private exitAt = -99;
  private exitX = 0;
  private exitY = 0;
  private ripples: { x: number; y: number; start: number; dir: number }[] = [];
  flash = 0;
  low = false;
  private dust: string;
  private grit: string;
  private now = 0;

  constructor(
    private art: Art,
    private level: Level,
  ) {
    this.dust = mix(art.paper, art.stoneMid, 0.35);
    this.grit = mix(art.stoneMid, art.stoneDark, 0.5);
  }

  get count() {
    return this.ps.length;
  }

  reset() {
    this.ps = [];
    this.threads = [];
    this.ripples = [];
    this.exitAt = -99;
    this.flash = 0;
  }

  private add(kind: Kind, x: number, y: number, o: Partial<P> = {}) {
    if (this.ps.length > (this.low ? 220 : 700)) this.ps.shift();
    const life = o.life ?? 0.6;
    this.ps.push({
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      life,
      max: life,
      size: 0.1,
      rot: 0,
      vr: 0,
      color: this.art.gold,
      g: 0,
      drag: 0,
      delay: 0,
      ...o,
    });
  }

  private n(v: number) {
    return Math.max(1, Math.round(this.low ? v * 0.45 : v));
  }

  event(e: GameEvent, game: Game, sunX: number, sunY: number) {
    const r = this.rng,
      a = this.art;
    const { x, y } = e.position;
    const p = game.player;
    const feet = p.y;
    switch (e.type) {
      case "land": {
        const impact = clamp((e.value ?? 6) / 22, 0.15, 1);
        for (let k = 0; k < this.n(6 + impact * 10); k++) {
          const s = r.sign();
          this.add("puff", p.x + s * r.range(0.1, 0.3), feet + 0.05, {
            vx: s * r.range(0.8, 2.4) * (0.6 + impact),
            vy: r.range(0.2, 0.9) * impact,
            life: r.range(0.35, 0.7),
            size: r.range(0.08, 0.16) * (0.7 + impact),
            color: this.dust,
            drag: 4,
          });
        }
        if (impact > 0.5) this.add("ring", p.x, feet + 0.02, { life: 0.35, size: 0.9 * impact, color: rgba(a.paper, 0.6) });
        break;
      }
      case "step":
        this.add("puff", p.x - p.facing * 0.12, feet + 0.04, {
          vx: -p.facing * r.range(0.4, 1.0),
          vy: r.range(0.2, 0.5),
          life: 0.4,
          size: r.range(0.05, 0.09),
          color: this.dust,
          drag: 3,
        });
        break;
      case "jump":
        for (let k = 0; k < 3; k++)
          this.add("swoosh", p.x + (k - 1) * 0.16, feet + 0.1 + k * 0.03, { vy: -2.5, life: 0.28, size: 0.35 + (k === 1 ? 0.12 : 0), color: rgba(a.paper, 0.9) });
        for (let k = 0; k < this.n(4); k++)
          this.add("puff", p.x + r.range(-0.2, 0.2), feet + 0.03, { vx: r.range(-1, 1), vy: r.range(0, 0.4), life: 0.35, size: 0.07, color: this.dust, drag: 4 });
        break;
      case "bump":
        this.add("spark", p.x, p.y + HEIGHT + 0.05, { life: 0.3, size: 0.18, color: a.paper });
        break;
      case "seed": {
        this.flash = 1;
        for (let k = 0; k < 16; k++)
          this.add("ray", x, y, { rot: (k / 16) * TAU + r.range(-0.08, 0.08), life: r.range(0.5, 0.8), size: r.range(1.6, 2.8), color: a.goldLight });
        for (let k = 0; k < this.n(34); k++) {
          const an = r.range(0, TAU),
            v = r.range(1.5, 5);
          this.add("spark", x, y, { vx: Math.cos(an) * v, vy: Math.sin(an) * v, life: r.range(0.6, 1.3), size: r.range(0.06, 0.15), color: r.chance(0.5) ? a.goldLight : "#fffbe8", drag: 2.5, g: -1.5, vr: r.range(-4, 4) });
        }
        this.add("ring", x, y, { life: 0.6, size: 2.4, color: rgba(a.goldLight, 0.9) });
        this.add("ring", x, y, { life: 0.9, size: 3.4, color: rgba(a.gold, 0.6), delay: 0.1 });
        this.add("flourish", x, y, { life: 1.2, size: 0.9, rot: r.range(0, TAU), color: a.ink });
        this.add("flourish", x, y, { life: 1.2, size: 0.7, rot: r.range(0, TAU) + Math.PI, color: a.goldDark, delay: 0.08 });
        break;
      }
      case "mote":
        for (let k = 0; k < this.n(12); k++) {
          const an = r.range(0, TAU),
            v = r.range(0.8, 2.4);
          this.add("spark", x, y, { vx: Math.cos(an) * v, vy: Math.sin(an) * v, life: r.range(0.4, 0.8), size: r.range(0.05, 0.1), color: "#fff6d0", drag: 3 });
        }
        this.add("ring", x, y, { life: 0.4, size: 0.8, color: rgba("#fff6d0", 0.8) });
        break;
      case "checkpoint":
        this.add("ring", x, y - 0.3, { life: 0.8, size: 1.6, color: rgba(a.goldLight, 0.9) });
        for (let k = 0; k < this.n(18); k++)
          this.add("mote", x + r.range(-0.6, 0.6), y - 0.35, { vx: r.range(-0.2, 0.2), vy: r.range(1.2, 3), life: r.range(0.8, 1.6), size: r.range(0.08, 0.16), color: a.goldLight, drag: 0.6 });
        break;
      case "lantern": {
        for (let k = 0; k < this.n(22); k++) {
          const an = r.range(0, TAU),
            v = r.range(1, 3.5);
          this.add("spark", x, y + 0.36, { vx: Math.cos(an) * v, vy: Math.sin(an) * v + 1, life: r.range(0.5, 1.0), size: r.range(0.05, 0.11), color: r.chance(0.5) ? a.warm : "#fff0c0", drag: 2, g: 2 });
        }
        this.add("ring", x, y + 0.36, { life: 0.5, size: 1.4, color: rgba(a.warm, 0.9) });
        const lit = this.level.lanterns.find((l) => l.id === e.id);
        const lx = lit ? lit.x : x,
          ly = lit ? lit.y + 1.52 : y + 0.5;
        for (const w of this.level.walls)
          if (w.lantern === e.id) this.threads.push({ x0: lx, y0: ly, x1: w.x, y1: w.y + w.h * 0.55, start: this.now, dur: 0.85, arrived: false, kind: "gate" });
        for (const i of this.level.islands)
          if (i.lantern === e.id) this.threads.push({ x0: lx, y0: ly, x1: i.x, y1: i.y - i.h / 2, start: this.now, dur: 0.75, arrived: false, kind: "bridge" });
        break;
      }
      case "gate":
        for (let k = 0; k < this.n(10); k++) {
          const w = this.level.walls.find((v) => v.id === e.id);
          if (!w) break;
          this.add("puff", w.x + r.range(-w.w / 2, w.w / 2), w.y + 0.1, { vx: r.range(-1.2, 1.2), vy: r.range(0.3, 1.0), life: r.range(0.6, 1.1), size: r.range(0.14, 0.26), color: this.grit, drag: 2, delay: 0.7 });
        }
        break;
      case "bridge": {
        const i = this.level.islands.find((v) => v.id === e.id);
        if (!i) break;
        for (let k = 0; k < this.n(16); k++)
          this.add("spark", i.x + r.range(-i.w / 2, i.w / 2), i.y - r.range(0, i.h), { vy: r.range(0.3, 1.2), life: r.range(0.6, 1.2), size: r.range(0.06, 0.12), color: a.goldLight, drag: 1, delay: 0.6 + r.range(0, 0.7) });
        break;
      }
      case "die": {
        const cx = p.x,
          cy = p.y + HEIGHT * 0.55;
        const cols = [a.ivory, a.ivory, a.paper, a.vermilion, a.vermilionLit, a.gold, a.ivoryShade];
        for (let k = 0; k < this.n(46); k++) {
          const an = r.range(0, TAU),
            v = r.range(1, 4.5);
          this.add("confetti", cx + r.range(-0.25, 0.25), cy + r.range(-0.45, 0.45), {
            vx: Math.cos(an) * v,
            vy: Math.sin(an) * v + 1.5,
            life: r.range(0.9, 1.6),
            size: r.range(0.06, 0.14),
            rot: r.range(0, TAU),
            vr: r.range(-9, 9),
            color: r.pick(cols),
            g: 3.2,
            drag: 2.2,
          });
        }
        for (let k = 0; k < this.n(5); k++)
          this.add("ink", cx + r.range(-0.45, 0.45), cy + r.range(-0.5, 0.4), { life: r.range(0.6, 0.9), size: r.range(0.06, 0.13), vy: -0.4, rot: r.range(0, TAU), color: a.ink, delay: r.range(0, 0.12) });
        this.add("ring", cx, cy, { life: 0.4, size: 1.3, color: rgba(e.cause === "sentinel" ? a.rose : a.ink, 0.7) });
        break;
      }
      case "respawn":
        for (let k = 0; k < this.n(20); k++)
          this.add("mote", p.x + r.range(-0.5, 0.5), p.y + r.range(0, 0.3), { vy: r.range(1, 3), vx: r.range(-0.3, 0.3), life: r.range(0.6, 1.2), size: r.range(0.06, 0.14), color: "#fff2c0", drag: 0.6 });
        this.add("ring", p.x, p.y + 0.05, { life: 0.5, size: 1.2, color: rgba(a.goldLight, 0.9) });
        break;
      case "exit":
        this.exitAt = this.now;
        this.exitX = this.level.exit.x;
        this.exitY = this.level.exit.y + 4.35;
        for (let k = 0; k < this.n(26); k++)
          this.add("spark", this.exitX + r.range(-0.6, 0.6), this.exitY + r.range(-0.4, 0.6), { vy: r.range(3, 8), vx: r.range(-0.4, 0.4), life: r.range(1, 2), size: r.range(0.06, 0.13), color: r.chance(0.5) ? "#fff6d8" : a.goldLight, drag: 0.3, vr: r.range(-3, 3) });
        break;
      case "fold":
        this.ripples.push({ x: sunX, y: sunY, start: this.now, dir: e.value ?? 1 });
        for (let k = 0; k < this.n(10); k++) {
          const an = r.range(0, TAU);
          this.add("spark", sunX, sunY, { vx: Math.cos(an) * 2.5, vy: Math.sin(an) * 2.5, life: 0.45, size: 0.08, color: "#fff6d8", drag: 3 });
        }
        break;
      case "locked":
        break;
    }
  }

  update(d: Draw) {
    const dt = d.dt;
    this.now = d.t;
    if (dt <= 0) return;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const keep: P[] = [];
    for (const p of this.ps) {
      if (p.delay > 0) {
        p.delay -= dt;
        keep.push(p);
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) continue;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag - p.g * dt;
      if (p.kind === "confetti") {
        p.vx += Math.sin(p.rot * 1.3) * 0.6 * dt;
        p.vy = Math.max(p.vy, -1.6);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      keep.push(p);
    }
    this.ps = keep;
    // Gates shed dust while they sink.
    const g = d.game;
    for (const w of this.level.walls) {
      if (w.kind !== "gate" || !w.lantern) continue;
      const prog = g.lanternProgress(w.lantern);
      if (prog <= 0 || prog >= 1) continue;
      if (this.rng.next() < dt * (this.low ? 14 : 30)) {
        const side = this.rng.sign();
        this.add("puff", w.x + side * this.rng.range(w.w * 0.2, w.w / 2 + 0.3), w.y + 0.08, {
          vx: side * this.rng.range(0.4, 1.4),
          vy: this.rng.range(0.3, 1.1),
          life: this.rng.range(0.6, 1.1),
          size: this.rng.range(0.14, 0.28),
          color: this.grit,
          drag: 2,
        });
        if (this.rng.chance(0.5))
          this.add("confetti", w.x + side * w.w * 0.5, w.y + 0.15, {
            vx: side * this.rng.range(0.8, 2),
            vy: this.rng.range(1, 2.5),
            life: 0.6,
            size: 0.04,
            rot: this.rng.range(0, TAU),
            vr: 8,
            color: this.art.stoneDark,
            g: 9,
          });
      }
    }
    this.threads = this.threads.filter((t) => d.t - t.start < t.dur + 0.8);
    this.ripples = this.ripples.filter((r) => d.t - r.start < 0.8);
  }

  draw(d: Draw) {
    const c = d.c,
      a = this.art;
    const t = d.t;
    // Threads of light from lanterns to what they wake.
    for (const th of this.threads) {
      const u = clamp((t - th.start) / th.dur);
      const e = easeInOutSine(u);
      const fade = clamp(1 - (t - th.start - th.dur) / 0.8);
      const mx = (th.x0 + th.x1) / 2,
        my = Math.max(th.y0, th.y1) + 1.6 + Math.abs(th.x1 - th.x0) * 0.08;
      const pt = (s: number) => {
        const q = 1 - s;
        return [q * q * th.x0 + 2 * q * s * mx + s * s * th.x1, q * q * th.y0 + 2 * q * s * my + s * s * th.y1];
      };
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.beginPath();
      const steps = 24;
      for (let k = 0; k <= steps; k++) {
        const [px, py] = pt((k / steps) * e);
        if (k === 0) c.moveTo(sx(d, px), sy(d, py));
        else c.lineTo(sx(d, px), sy(d, py));
      }
      c.globalCompositeOperation = "lighter";
      c.strokeStyle = rgba(a.warm, 0.35 * fade);
      c.lineWidth = 0.16 * d.S;
      c.lineCap = "round";
      c.stroke();
      c.strokeStyle = rgba("#fff6d8", 0.9 * fade);
      c.lineWidth = 0.045 * d.S;
      c.stroke();
      c.globalCompositeOperation = "source-over";
      const [hx, hy] = pt(e);
      if (u < 1) {
        glowAt(d, a.warm, hx, hy, 0.8, 0.9);
        glowAt(d, "#ffffff", hx, hy, 0.25, 1);
      } else glowAt(d, a.warm, th.x1, th.y1, 1.4 * (1 + (1 - fade)), 0.8 * fade);
    }
    // Fold ripples.
    for (const r of this.ripples) {
      const u = clamp((t - r.start) / 0.8);
      const R = easeOutCubic(u) * 4.5;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.beginPath();
      c.arc(sx(d, r.x), sy(d, r.y), R * d.S, 0, TAU);
      c.strokeStyle = rgba(a.goldLight, (1 - u) * 0.8);
      c.lineWidth = (0.06 + (1 - u) * 0.08) * d.S;
      c.stroke();
      c.beginPath();
      for (let k = 0; k < 8; k++) {
        const an = (k / 8) * TAU + u;
        c.moveTo(sx(d, r.x) + Math.cos(an) * R * d.S * 0.6, sy(d, r.y) + Math.sin(an) * R * d.S * 0.6);
        c.lineTo(sx(d, r.x) + Math.cos(an) * R * d.S * 0.95, sy(d, r.y) + Math.sin(an) * R * d.S * 0.95);
      }
      c.strokeStyle = rgba(a.paper, (1 - u) * 0.5);
      c.lineWidth = 0.02 * d.S;
      c.stroke();
    }
    // Exit beam.
    if (this.exitAt > -90) {
      const u = clamp((t - this.exitAt) / 0.6);
      const wv = easeOutCubic(u);
      const topY = d.fy + d.h / d.k;
      const bx = sx(d, this.exitX),
        by = sy(d, this.exitY);
      const ty = sy(d, topY);
      const wpx = (0.4 + wv * 1.6) * d.S;
      const pulse = 0.9 + 0.1 * Math.sin(t * 7);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.55 * wv * pulse;
      c.drawImage(beam(), bx - wpx * 1.6, ty, wpx * 3.2, by - ty);
      c.globalAlpha = 0.9 * wv;
      c.drawImage(beam(), bx - wpx * 0.45, ty, wpx * 0.9, by - ty);
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
      glowAt(d, "#fff2c0", this.exitX, this.exitY, 1.8 * wv + 0.5, 0.85);
    }
    // Particles.
    for (const p of this.ps) {
      if (p.delay > 0) continue;
      const u = 1 - p.life / p.max;
      const fade = 1 - u;
      switch (p.kind) {
        case "puff": {
          // Soft dust with a small inked curl on the larger puffs.
          const rr = p.size * (0.7 + easeOutCubic(u) * 1.3);
          glowAt(d, p.color, p.x, p.y, rr * 1.6, 0.85 * fade, false);
          if (p.size > 0.11 && u < 0.7) {
            place(d, p.x, p.y);
            c.beginPath();
            c.arc(0, 0, rr * 0.5, Math.PI * 0.9, Math.PI * 2.1);
            c.strokeStyle = rgba(a.ink, 0.25 * fade);
            c.lineWidth = 0.015;
            c.stroke();
          }
          break;
        }
        case "spark": {
          place(d, p.x, p.y);
          c.rotate(p.rot);
          c.beginPath();
          sparkle(c, 0, 0, p.size * (0.5 + fade * 0.6));
          c.globalAlpha = clamp(fade * 1.4);
          c.fillStyle = p.color;
          c.fill();
          c.globalAlpha = 1;
          break;
        }
        case "mote":
          glowAt(d, p.color, p.x, p.y, p.size * 2.4, fade * 0.9);
          break;
        case "confetti": {
          place(d, p.x, p.y);
          c.rotate(p.rot);
          c.scale(Math.cos(p.rot * 1.7), 1);
          c.globalAlpha = clamp(fade * 2);
          c.fillStyle = p.color;
          c.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
          c.strokeStyle = rgba(a.ink, 0.5);
          c.lineWidth = 0.012;
          c.strokeRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
          c.globalAlpha = 1;
          break;
        }
        case "ink": {
          place(d, p.x, p.y);
          c.rotate(p.rot);
          const s = p.size * (0.4 + easeOutCubic(Math.min(1, u * 3)) * 0.8);
          c.globalAlpha = clamp(fade * 1.3) * 0.7;
          c.fillStyle = p.color;
          c.beginPath();
          c.arc(0, 0, s, 0, TAU);
          c.moveTo(s * 1.1, s * 0.3);
          c.arc(s * 0.9, s * 0.3, s * 0.32, 0, TAU);
          c.moveTo(-s * 0.6, -s * 0.9);
          c.arc(-s * 0.7, -s * 0.9, s * 0.22, 0, TAU);
          c.moveTo(s * 0.2, s * 1.5);
          c.arc(s * 0.1, s * 1.5, s * 0.12, 0, TAU);
          c.fill();
          c.globalAlpha = 1;
          break;
        }
        case "swoosh": {
          place(d, p.x, p.y);
          c.beginPath();
          c.moveTo(-p.size * 0.2, 0);
          c.quadraticCurveTo(0, p.size * 0.5, p.size * 0.2, 0);
          c.strokeStyle = rgba(a.ink, 0.5 * fade);
          c.lineWidth = 0.03;
          c.stroke();
          c.beginPath();
          c.moveTo(0, -0.05);
          c.lineTo(0, p.size * 0.7 * (0.4 + u));
          c.strokeStyle = rgba(p.color, 0.8 * fade);
          c.lineWidth = 0.035;
          c.stroke();
          break;
        }
        case "ray": {
          place(d, p.x, p.y);
          c.rotate(p.rot);
          const r0 = 0.3 + easeOutCubic(u) * p.size * 0.5,
            r1 = 0.4 + easeOutCubic(u) * p.size;
          c.globalCompositeOperation = "lighter";
          c.beginPath();
          c.moveTo(r0, -0.03);
          c.lineTo(r1, 0);
          c.lineTo(r0, 0.03);
          c.closePath();
          c.fillStyle = rgba(p.color, fade);
          c.fill();
          c.globalCompositeOperation = "source-over";
          break;
        }
        case "ring": {
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.beginPath();
          c.arc(sx(d, p.x), sy(d, p.y), easeOutCubic(u) * p.size * d.S, 0, TAU);
          c.strokeStyle = p.color;
          c.globalAlpha = fade;
          c.lineWidth = 0.05 * d.S * fade + 1;
          c.stroke();
          c.globalAlpha = 1;
          break;
        }
        case "flourish": {
          // A calligraphic spiral drawn on, then fading.
          place(d, p.x, p.y);
          c.rotate(p.rot);
          const draw = easeOutCubic(Math.min(1, u * 2.2));
          c.beginPath();
          const turns = 1.6;
          const n = 40;
          for (let k = 0; k <= n * draw; k++) {
            const s = k / n;
            const an = s * turns * TAU;
            const rr = p.size * (1 - s * 0.75);
            const px = Math.cos(an) * rr,
              py = Math.sin(an) * rr * 0.8;
            if (k === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
          }
          c.strokeStyle = rgba(p.color, 0.7 * clamp(fade * 1.8));
          c.lineWidth = 0.035;
          c.stroke();
          break;
        }
        case "petal":
          break;
      }
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Screen-space warm flash after a seed. */
  drawFlash(d: Draw) {
    if (this.flash <= 0.01) return;
    const c = d.c;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "lighter";
    c.fillStyle = rgba(this.art.warm, this.flash * 0.12);
    c.fillRect(0, 0, d.w * d.dpr, d.h * d.dpr);
    c.globalCompositeOperation = "source-over";
  }
}
