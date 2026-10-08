import { CLEAR_TIME, DEATH_TIME, HEIGHT, JUMP_SPEED, RUN_SPEED, STRIDE } from "../sim/constants";
import type { GameEvent } from "../sim/types";
import type { Art } from "./art";
import { place, sx, sy, type Draw } from "./draw";
import { glowAt } from "./glow";
import { TAU, clamp, easeInOutSine, easeOutCubic, lerp, mix, rgba, sparkle, type Ctx } from "./util";

type Pt = { x: number; y: number; px: number; py: number };

const SEG = 0.085;
const LEG = 0.18;

/**
 * The Keeper in vector: ivory hooded cloak, dark face with two bright eyes,
 * short legs, a vermilion verlet scarf and the little sun at the shoulder.
 * Animation reads the simulation (stride, velocity, airTime, sinceLand) so a
 * frozen frame always shows the right pose.
 */
export class Keeper {
  private tails: Pt[][] = [[], []];
  private ready = false;
  private sun = { x: 0, y: 0, vx: 0, vy: 0 };
  private trail: number[][] = [];
  private impact = 0.2;
  private dieAt = -99;
  private dieX = 0;
  private dieY = 0;
  private dieFacing = 1;
  private respawnAt = -99;
  private foldAt = -99;
  private lastFacing = 1;
  private turnAt = -99;
  private cloak: CanvasGradient | null = null;
  private lastCtx: Ctx | null = null;
  private lastAnchor: { x: number; y: number } | null = null;
  /** World position of the little sun, for the reveal circle. */
  sunPos = { x: 0, y: 0 };

  private col: { leg: string; legBack: string; boot: string; bootBack: string; hand: string; face: string };

  constructor(private art: Art) {
    const leg = mix(art.ink, "#3b3a58", 0.45);
    this.col = {
      leg,
      legBack: mix(leg, art.ink, 0.35),
      boot: art.bronzeDark,
      bootBack: mix(art.bronzeDark, art.ink, 0.3),
      hand: mix(art.ivoryShade, art.ink, 0.25),
      face: mix(art.ink, "#1b1530", 0.4),
    };
  }

  reset() {
    this.ready = false;
    this.dieAt = this.respawnAt = this.foldAt = this.turnAt = -99;
  }

  event(e: GameEvent, t: number) {
    if (e.type === "land") this.impact = clamp((e.value ?? 6) / 26, 0.1, 0.36);
    else if (e.type === "die") {
      this.dieAt = t;
      this.dieX = e.position.x;
      this.dieY = e.position.y - HEIGHT / 2;
    } else if (e.type === "respawn") {
      this.respawnAt = t;
      this.ready = false;
    } else if (e.type === "fold") this.foldAt = t;
  }

  // ----------------------------------------------------------- simulation

  private squashY = 1;

  private anchor(d: Draw) {
    const p = d.game.player;
    return { x: p.x - p.facing * 0.1, y: p.y + 0.8 * this.squashY };
  }

  private sunTarget(d: Draw) {
    const g = d.game,
      p = g.player;
    const t = d.t;
    if (g.status === "dying") {
      const u = easeInOutSine(clamp((t - this.dieAt - 0.2) / (DEATH_TIME - 0.25)));
      return { x: lerp(this.dieX, g.checkpoint.x, u), y: lerp(this.dieY + 1.3, g.checkpoint.y + 1.2, u) };
    }
    if (g.status === "clearing" || g.status === "clear") {
      const u = easeInOutSine(1 - clamp(g.sequence / CLEAR_TIME));
      return { x: p.x + p.facing * 0.15, y: p.y + 1.7 + u * 2.6 };
    }
    const f = t - this.foldAt;
    const base = { x: p.x - p.facing * 0.42, y: p.y + 1.42 + Math.sin(t * 2.3) * 0.06 };
    if (f >= 0 && f < 0.7) {
      // The fold flourish: one loop around the keeper.
      const u = easeOutCubic(f / 0.7);
      const an = u * TAU;
      const r = Math.sin(u * Math.PI) * 0.75;
      return { x: base.x + Math.sin(an) * r * 1.3, y: base.y - 0.6 + Math.cos(an) * r + 0.6 * Math.cos(u * Math.PI * 0.5) * 0 };
    }
    return base;
  }

  update(d: Draw, total = d.dt) {
    // Sub-step the cloth and the sun over the whole simulated interval.
    let left = total;
    let n = 0;
    do {
      const step = Math.min(left, 1 / 60);
      this.step(d, step);
      left -= step;
      n++;
    } while (left > 1e-6 && n < 40);
  }

  private step(d: Draw, dt: number) {
    const g = d.game,
      p = g.player;
    const a = this.anchor(d);
    if (!this.ready) {
      for (let k = 0; k < 2; k++) {
        const n = k ? 6 : 9;
        this.tails[k] = [];
        for (let i = 0; i < n; i++) {
          const x = a.x - p.facing * i * SEG * 0.7,
            y = a.y - i * SEG * 0.7;
          this.tails[k].push({ x, y, px: x, py: y });
        }
      }
      const s = this.sunTarget(d);
      this.sun = { x: s.x, y: s.y, vx: 0, vy: 0 };
      this.trail = [];
      this.ready = true;
    }
    if (p.facing !== this.lastFacing) {
      this.turnAt = d.t;
      this.lastFacing = p.facing;
    }
    // Large jumps (teleports, respawns, frame stepping) carry the cloth rigidly.
    if (this.lastAnchor) {
      const mx = a.x - this.lastAnchor.x,
        my = a.y - this.lastAnchor.y;
      if (Math.hypot(mx, my) > 0.4 + dt * 9) {
        for (const tail of this.tails)
          for (const q of tail) {
            q.x += mx;
            q.px += mx;
            q.y += my;
            q.py += my;
          }
        if (Math.hypot(mx, my) > 3) {
          const s = this.sunTarget(d);
          this.sun = { x: s.x, y: s.y, vx: 0, vy: 0 };
          this.trail = [];
        } else {
          this.sun.x += mx;
          this.sun.y += my;
          for (const q of this.trail) {
            q[0] += mx;
            q[1] += my;
          }
        }
      }
    }
    this.lastAnchor = a;
    if (dt > 0) {
      const steps = 2;
      const h = dt / steps;
      const wind = 1.4 * Math.sin(d.t * 1.3) + 0.7 * Math.sin(d.t * 3.7) - p.facing * 3.2;
      for (let s = 0; s < steps; s++)
        for (const tail of this.tails) {
          tail[0].x = a.x;
          tail[0].y = a.y;
          for (let i = 1; i < tail.length; i++) {
            const q = tail[i];
            const vx = (q.x - q.px) * 0.985,
              vy = (q.y - q.py) * 0.985;
            q.px = q.x;
            q.py = q.y;
            q.x += vx + wind * h * h * (0.5 + i / tail.length);
            q.y += vy - 5.5 * h * h;
            // Unless falling, the cloth never whips up over the hood.
            if (p.vy > -3) q.y = Math.min(q.y, a.y + 0.1 + i * 0.012);
          }
          for (let it = 0; it < 4; it++)
            for (let i = 1; i < tail.length; i++) {
              const p0 = tail[i - 1],
                p1 = tail[i];
              const dx = p1.x - p0.x,
                dy = p1.y - p0.y;
              const l = Math.hypot(dx, dy) || 1e-6;
              const diff = (l - SEG) / l;
              if (i === 1) {
                p1.x -= dx * diff;
                p1.y -= dy * diff;
              } else {
                p0.x += dx * diff * 0.5;
                p0.y += dy * diff * 0.5;
                p1.x -= dx * diff * 0.5;
                p1.y -= dy * diff * 0.5;
              }
            }
        }
      // The little sun follows on a soft spring.
      const s = this.sunTarget(d);
      const k = g.status === "dying" ? 30 : 60;
      for (let q = 0; q < 2; q++) {
        const hd = dt / 2;
        this.sun.vx += (s.x - this.sun.x) * k * hd;
        this.sun.vy += (s.y - this.sun.y) * k * hd;
        const damp = Math.exp(-11 * hd);
        this.sun.vx *= damp;
        this.sun.vy *= damp;
        this.sun.x += this.sun.vx * hd;
        this.sun.y += this.sun.vy * hd;
      }
      this.trail.push([this.sun.x, this.sun.y]);
      if (this.trail.length > 10) this.trail.shift();
    }
    this.sunPos = { x: this.sun.x, y: this.sun.y };
  }

  // -------------------------------------------------------------- drawing

  draw(d: Draw) {
    const g = d.game,
      p = g.player,
      c = d.c,
      a = this.art;
    if (this.lastCtx !== c) {
      this.lastCtx = c;
      this.cloak = null;
    }
    const t = d.t;
    const dying = g.status === "dying";
    const since = t - this.dieAt;
    if (!dying || since < 0.24) {
      // Ground shadow.
      if (!dying) this.shadow(d);
      const reform = clamp((t - this.respawnAt) / 0.55);
      const alpha = dying ? 1 - since / 0.24 : 1;
      if (reform < 1) {
        // Redraw from light: the figure is inked in from the feet up.
        const top = sy(d, p.y + reform * (HEIGHT + 0.2));
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.beginPath();
        c.rect(0, top, d.w * d.dpr, d.h * d.dpr);
        c.clip();
        this.figure(d, alpha);
        c.restore();
        glowAt(d, "#fff3c4", p.x, p.y + reform * (HEIGHT + 0.2), 0.7, 0.9 * (1 - reform * 0.5), true, 1.4);
        glowAt(d, a.warm, p.x, p.y + 1.0, 1.6, 0.5 * (1 - reform), true, 0.5);
      } else this.figure(d, alpha * (g.grace > 0 ? 0.88 + 0.12 * Math.sin(t * 24) : 1));
    }
    this.drawSun(d);
  }

  private shadow(d: Draw) {
    const g = d.game,
      p = g.player;
    let ground = p.y;
    if (!p.grounded) {
      let best = -Infinity;
      for (const b of g.solids()) {
        if (p.x + 0.2 < b.x0 || p.x - 0.2 > b.x1 || b.y1 > p.y + 0.01) continue;
        if (g.mode === "3d" && (p.z + 0.3 < b.z0 || p.z - 0.3 > b.z1)) continue;
        if (b.y1 > best) best = b.y1;
      }
      ground = best;
    }
    const hgt = p.y - ground;
    if (!isFinite(hgt) || hgt > 6) return;
    const s = 1 - clamp(hgt / 6) * 0.6;
    place(d, p.x, ground);
    d.c.beginPath();
    d.c.ellipse(0, 0.0, 0.34 * s, 0.07 * s, 0, 0, TAU);
    d.c.fillStyle = rgba(this.art.ink, 0.28 * s);
    d.c.fill();
    d.c.setTransform(1, 0, 0, 1, 0, 0);
  }

  private figure(d: Draw, alpha: number) {
    const g = d.game,
      p = g.player,
      c = d.c,
      a = this.art;
    const t = d.t;
    const dying = g.status === "dying";
    const clearing = g.status === "clearing" || g.status === "clear";
    const facing = dying ? this.dieFacing : p.facing;
    if (!dying) this.dieFacing = p.facing;
    const speed = Math.abs(p.vx);
    const sp = p.grounded ? clamp(speed / RUN_SPEED) : 0;
    const phase = (p.stride / STRIDE) * TAU;
    const vy = p.vy / JUMP_SPEED;

    // Squash and stretch.
    let sxs = 1,
      sys = 1;
    if (p.grounded) {
      const s = p.sinceLand;
      const sq = s < 0.6 ? this.impact * Math.exp(-s * 9) * Math.cos(s * 17) : 0;
      sys *= 1 - sq;
      sxs *= 1 + sq * 0.7;
      if (sp < 0.15) sys *= 1 + Math.sin(t * 2.4) * 0.014;
    } else {
      const v = clamp(vy, -0.8, 1);
      sys *= 1 + v * 0.11 + 0.08 * Math.exp(-p.airTime * 10);
      sxs *= 1 - v * 0.06;
    }
    this.squashY = sys;
    const turn = clamp((t - this.turnAt) / 0.14);
    if (turn < 1) sxs *= 0.8 + 0.2 * turn;
    const dissolve = dying ? clamp((t - this.dieAt) / 0.24) : 0;
    // The scarf tails live in world space, behind the body.
    if (!dying) this.drawScarf(d, alpha);
    const bob = p.grounded ? Math.abs(Math.cos(phase)) * 0.05 * sp : 0;
    const lean = p.grounded ? 0.13 * sp : clamp((p.vx * facing) / RUN_SPEED, -1, 1) * 0.06;

    const baseY = dying ? this.dieY : p.y;
    const baseX = dying ? this.dieX : p.x;
    place(d, baseX, baseY, facing);
    c.scale(sxs * (1 + dissolve * 0.25), sys * (1 + dissolve * 0.25));
    c.translate(0, -bob);
    c.rotate(lean);
    c.globalAlpha = alpha;
    c.lineJoin = "round";
    c.lineCap = "round";

    // Legs.
    const legPose = (i: number) => {
      const th = phase + i * Math.PI;
      if (p.grounded || dying || clearing) {
        if (sp > 0.05)
          return { fx: Math.sin(th) * 0.2 * sp + 0.02, fy: -Math.max(0, Math.cos(th)) * 0.14 * sp };
        return { fx: i ? -0.07 : 0.08, fy: 0 };
      }
      if (vy > 0) return i ? { fx: -0.12, fy: -0.06 } : { fx: 0.13, fy: -0.17 };
      const flutter = Math.sin(t * 14 + i * 2) * 0.02;
      return i ? { fx: -0.09, fy: -0.02 + flutter } : { fx: 0.1, fy: -0.06 - flutter };
    };
    const col = this.col;
    const leg = (i: number) => {
      const { fx, fy } = legPose(i);
      const hx = i ? -0.06 : 0.05,
        hy = -0.36;
      const dx = fx - hx,
        dy = fy - hy;
      const dl = Math.min(Math.hypot(dx, dy), LEG * 2 - 0.001);
      const mx = hx + dx / 2,
        my = hy + dy / 2;
      const hh = Math.sqrt(Math.max(0, LEG * LEG - (dl / 2) ** 2));
      const nx = -dy / (Math.hypot(dx, dy) || 1),
        ny = dx / (Math.hypot(dx, dy) || 1);
      const kx = mx - nx * hh,
        ky = my - ny * hh;
      c.beginPath();
      c.moveTo(hx, hy);
      c.lineTo(kx, ky);
      c.lineTo(fx, fy - 0.04);
      c.strokeStyle = a.ink;
      c.lineWidth = 0.115;
      c.stroke();
      c.strokeStyle = i ? col.legBack : col.leg;
      c.lineWidth = 0.075;
      c.stroke();
      // Boot.
      c.beginPath();
      c.ellipse(fx + 0.035, fy - 0.045, 0.085, 0.055, 0, 0, TAU);
      c.fillStyle = i ? col.bootBack : col.boot;
      c.fill();
      c.strokeStyle = a.ink;
      c.lineWidth = 0.022;
      c.stroke();
      c.beginPath();
      c.moveTo(fx - 0.03, fy - 0.075);
      c.lineTo(fx + 0.08, fy - 0.075);
      c.strokeStyle = a.gold;
      c.lineWidth = 0.016;
      c.stroke();
    };

    // Arms: 0 = hanging, positive swings forward.
    const armAngle = (i: number) => {
      if (clearing && i === 0) return 2.7;
      if (dying) return i ? -2.4 : 2.4;
      if (!p.grounded) return vy > 0 ? (i ? -2.2 : -1.6) : i ? 2.6 : 2.2;
      if (sp > 0.05) return -Math.sin(phase + i * Math.PI) * 1.0 * sp - 0.1;
      return (i ? -0.15 : 0.25) + Math.sin(t * 2.4 + i) * 0.05;
    };
    const arm = (i: number) => {
      const ang = armAngle(i);
      c.save();
      c.translate(i ? -0.05 : 0.07, -0.72);
      c.rotate(-ang);
      c.beginPath();
      c.moveTo(-0.055, 0);
      c.quadraticCurveTo(-0.07, 0.13, -0.045, 0.24);
      c.lineTo(0.045, 0.24);
      c.quadraticCurveTo(0.07, 0.13, 0.055, 0);
      c.closePath();
      c.fillStyle = i ? a.ivoryShade : a.ivory;
      c.fill();
      c.strokeStyle = a.ink;
      c.lineWidth = 0.022;
      c.stroke();
      c.beginPath();
      c.arc(0, 0.265, 0.042, 0, TAU);
      c.fillStyle = col.face;
      c.fill();
      c.restore();
    };

    leg(1);
    arm(1);
    leg(0);

    // Cloak.
    const trail = 0.09 * sp + (p.grounded ? 0 : 0.05) + (dying ? 0.1 : 0);
    const lift = p.grounded ? 0 : clamp(-vy, 0, 1) * 0.07;
    const sway = Math.sin(phase * 2) * 0.015 * sp + Math.sin(t * 1.9) * 0.008;
    c.beginPath();
    c.moveTo(-0.12, -0.84);
    c.bezierCurveTo(-0.2, -0.7, -0.26 - trail * 0.5, -0.5, -0.28 - trail, -0.3 - lift);
    const hemN = 5;
    for (let k = 1; k <= hemN; k++) {
      const u = k / hemN;
      const x = lerp(-0.28 - trail, 0.25 - trail * 0.3, u) + sway;
      const y = -0.3 - lift * (1 - u) + (k % 2 ? 0.025 : -0.005) + Math.sin(t * 6 + k) * 0.006 * (sp + (p.grounded ? 0 : 1));
      c.lineTo(x, y);
    }
    c.bezierCurveTo(0.22, -0.48, 0.18, -0.66, 0.12, -0.84);
    c.closePath();
    if (!this.cloak) {
      const gr = c.createLinearGradient(-0.3, 0, 0.3, 0);
      gr.addColorStop(0, a.ivoryShade);
      gr.addColorStop(0.55, a.ivory);
      gr.addColorStop(1, "#fffaf0");
      this.cloak = gr;
    }
    c.fillStyle = this.cloak;
    c.fill();
    c.strokeStyle = a.ink;
    c.lineWidth = 0.026;
    c.stroke();
    // Gold hem and a fold line.
    c.beginPath();
    c.moveTo(-0.27 - trail, -0.34 - lift);
    c.lineTo(0.24 - trail * 0.3 + sway, -0.335);
    c.strokeStyle = a.gold;
    c.lineWidth = 0.022;
    c.stroke();
    c.beginPath();
    c.moveTo(-0.04, -0.74);
    c.quadraticCurveTo(-0.1 - trail * 0.4, -0.55, -0.12 - trail * 0.6, -0.36);
    c.strokeStyle = rgba(a.ink, 0.25);
    c.lineWidth = 0.016;
    c.stroke();
    c.beginPath();
    sparkle(c, 0.11, -0.68, 0.035);
    c.fillStyle = a.gold;
    c.fill();

    // Hood: a soft teardrop whose tip droops behind and streams when running.
    const hx = 0.02,
      hy = -0.985;
    // A rounded cowl whose soft tail droops down the back.
    const tipX = -0.31 - trail * 0.8,
      tipY = -0.9 - lift * 0.6 - trail * 0.5;
    c.beginPath();
    c.moveTo(0.19, -0.83);
    c.bezierCurveTo(0.26, -0.9, 0.27, -0.98, 0.255, -1.04);
    c.bezierCurveTo(0.24, -1.17, 0.12, -1.235, -0.01, -1.235);
    c.bezierCurveTo(-0.17, -1.235, -0.26, -1.14, tipX + 0.02, tipY - 0.1);
    c.quadraticCurveTo(tipX - 0.02, tipY - 0.02, tipX + 0.03, tipY + 0.02);
    c.quadraticCurveTo(tipX + 0.08, tipY + 0.02, -0.21, -0.88);
    c.quadraticCurveTo(-0.22, -0.84, -0.17, -0.82);
    c.closePath();
    c.fillStyle = this.cloak;
    c.fill();
    c.strokeStyle = a.ink;
    c.lineWidth = 0.026;
    c.stroke();
    c.beginPath();
    c.moveTo(-0.05, -1.22);
    c.quadraticCurveTo(-0.16, -1.1, -0.14, -0.9);
    c.strokeStyle = rgba(a.ink, 0.18);
    c.lineWidth = 0.018;
    c.stroke();
    c.beginPath();
    c.ellipse(hx + 0.08, hy + 0.025, 0.155, 0.14, 0.05, 0, TAU);
    c.fillStyle = a.ivoryShade;
    c.fill();
    c.beginPath();
    c.ellipse(hx + 0.09, hy + 0.03, 0.135, 0.12, 0.05, 0, TAU);
    c.fillStyle = col.face;
    c.fill();
    c.beginPath();
    c.ellipse(hx + 0.08, hy + 0.025, 0.152, 0.137, 0.05, -2.2, 1.2);
    c.strokeStyle = a.gold;
    c.lineWidth = 0.016;
    c.stroke();
    const blinkPhase = (t + 1.3) % 3.7;
    const open = dying ? 0.2 : blinkPhase < 0.12 ? 0.15 : 1;
    const look = clamp(p.vy / 20, -0.4, 0.4);
    for (const ex of [0.05, 0.15]) {
      c.beginPath();
      c.ellipse(hx + ex, hy + 0.025 - look * 0.04, 0.023, 0.033 * open, 0, 0, TAU);
      c.fillStyle = "#fff3cc";
      c.fill();
    }
    // Scarf wrap and knot.
    c.beginPath();
    c.roundRect(-0.16, -0.86, 0.33, 0.1, 0.05);
    c.fillStyle = a.vermilion;
    c.fill();
    c.strokeStyle = a.ink;
    c.lineWidth = 0.022;
    c.stroke();
    c.beginPath();
    c.moveTo(-0.12, -0.84);
    c.lineTo(0.14, -0.84);
    c.strokeStyle = a.vermilionLit;
    c.lineWidth = 0.02;
    c.stroke();
    c.beginPath();
    c.arc(-0.13, -0.81, 0.055, 0, TAU);
    c.fillStyle = a.vermilionDark;
    c.fill();
    c.strokeStyle = a.ink;
    c.lineWidth = 0.02;
    c.stroke();

    arm(0);
    c.globalAlpha = 1;
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawScarf(d: Draw, alpha: number) {
    const c = d.c,
      a = this.art;
    c.globalAlpha = alpha;
    this.tails.forEach((tail, k) => {
      const pts = tail.map((q) => [sx(d, q.x), sy(d, q.y)]);
      const n = pts.length;
      const w0 = (k ? 0.07 : 0.085) * d.S,
        w1 = (k ? 0.055 : 0.07) * d.S;
      const left: number[][] = [],
        right: number[][] = [];
      for (let i = 0; i < n; i++) {
        const p0 = pts[Math.max(0, i - 1)],
          p1 = pts[Math.min(n - 1, i + 1)];
        let dx = p1[0] - p0[0],
          dy = p1[1] - p0[1];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const w = lerp(w0, w1, i / (n - 1)) / 2;
        left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
        right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
      }
      const end = pts[n - 1],
        prev = pts[n - 2];
      let ex = end[0] - prev[0],
        ey = end[1] - prev[1];
      const el = Math.hypot(ex, ey) || 1;
      ex /= el;
      ey /= el;
      const fork = 0.06 * d.S;
      c.beginPath();
      c.moveTo(left[0][0], left[0][1]);
      for (let i = 1; i < n; i++) c.lineTo(left[i][0], left[i][1]);
      c.lineTo(left[n - 1][0] + ex * fork, left[n - 1][1] + ey * fork);
      c.lineTo(end[0] + ex * fork * 0.3, end[1] + ey * fork * 0.3);
      c.lineTo(right[n - 1][0] + ex * fork, right[n - 1][1] + ey * fork);
      for (let i = n - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
      c.closePath();
      c.fillStyle = k ? a.vermilionDark : a.vermilion;
      c.fill();
      c.strokeStyle = rgba(a.ink, 0.8);
      c.lineWidth = 0.022 * d.S;
      c.lineJoin = "round";
      c.stroke();
      if (!k) {
        c.beginPath();
        c.moveTo(pts[1][0], pts[1][1]);
        for (let i = 2; i < n - 1; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.strokeStyle = rgba(a.vermilionLit, 0.8);
        c.lineWidth = 0.018 * d.S;
        c.stroke();
      }
    });
    c.globalAlpha = 1;
  }

  private drawSun(d: Draw) {
    const c = d.c,
      a = this.art,
      g = d.game;
    const { x, y } = this.sun;
    const t = d.t;
    const clearing = g.status === "clearing" || g.status === "clear";
    const dying = g.status === "dying";
    const boost = clearing ? 1 + (1 - clamp(g.sequence / CLEAR_TIME)) * 1.2 : dying ? 0.6 : 1;
    const fold = clamp(1 - (t - this.foldAt) / 0.7);
    for (let k = 0; k < this.trail.length - 1; k++) {
      const u = k / this.trail.length;
      glowAt(d, a.warm, this.trail[k][0], this.trail[k][1], 0.18 + u * 0.12, u * 0.25 * boost);
    }
    glowAt(d, a.warm, x, y, 1.1 * boost + fold * 0.6, (0.42 + fold * 0.3) * Math.min(1.4, boost));
    glowAt(d, "#fff4cc", x, y, 0.38 * boost, 0.9);
    place(d, x, y, 1, boost > 1 ? 1 + (boost - 1) * 0.5 : 1);
    c.rotate(t * 0.8);
    c.beginPath();
    for (let k = 0; k < 8; k++) {
      const an = (k / 8) * TAU;
      const len = k % 2 ? 0.17 : 0.24;
      c.moveTo(Math.cos(an - 0.18) * 0.1, Math.sin(an - 0.18) * 0.1);
      c.lineTo(Math.cos(an) * len, Math.sin(an) * len);
      c.lineTo(Math.cos(an + 0.18) * 0.1, Math.sin(an + 0.18) * 0.1);
    }
    c.fillStyle = a.goldLight;
    c.fill();
    c.beginPath();
    c.arc(0, 0, 0.105, 0, TAU);
    c.fillStyle = a.gold;
    c.fill();
    c.strokeStyle = rgba(a.goldDark, 0.9);
    c.lineWidth = 0.02;
    c.stroke();
    c.beginPath();
    c.arc(-0.02, -0.02, 0.06, 0, TAU);
    c.fillStyle = "#fffbe8";
    c.fill();
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
}

