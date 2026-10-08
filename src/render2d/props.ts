import { HEIGHT } from "../sim/constants";
import type { Island, Level, Pickup, Sentinel, Wall } from "../sim/types";
import type { Art } from "./art";
import { blit, onScreen, place, sx, sy, type Draw } from "./draw";
import { glowAt } from "./glow";
import { texturize } from "./texture";
import type { IslandArt } from "./islands";
import {
  Rng,
  TAU,
  clamp,
  easeOutBack,
  hashString,
  hatch,
  makeCanvas,
  mix,
  rgba,
  smooth,
  sparkle,
  type Ctx,
  type Sprite,
} from "./util";

/** Paint local art (units, y down) into a sprite whose origin is (0, 0). */
function sprite(S: number, left: number, top: number, right: number, bottom: number, paint: (c: Ctx) => void): Sprite {
  const { canvas, ctx: c } = makeCanvas((right - left) * S, (bottom - top) * S);
  const ox = -left * S,
    oy = -top * S;
  c.setTransform(S, 0, 0, S, ox, oy);
  c.lineJoin = "round";
  c.lineCap = "round";
  paint(c);
  texturize(c, canvas, S / 60, 0.6);
  return { canvas, ox, oy };
}

const SOCKETS = [-0.36, 0, 0.36];
/** Lantern scale: posts stand a little taller than the keeper. */
const LS = 1.12;

export class Props {
  private S = 0;
  private walls = new Map<string, Sprite>();
  private post: Sprite | null = null;
  private observatory: Sprite | null = null;
  private trails = new Map<string, number[][]>();
  private touched = new Set<string>();
  lockedAt = -9;
  exitAt = -9;
  bytes = 0;

  constructor(
    private art: Art,
    private level: Level,
  ) {}

  ensure(S: number) {
    if (Math.abs(S - this.S) < 0.01) return;
    this.S = S;
    this.walls.clear();
    this.bytes = 0;
    this.post = sprite(S, -0.36, -2.2, 0.36, 0.06, (c) => {
      c.scale(LS, LS);
      lanternPost(c, this.art);
    });
    this.observatory = sprite(S, -1.75, -3.85, 1.75, 0.1, (c) => observatoryBody(c, this.art));
    this.bytes += (this.post.canvas.width * this.post.canvas.height + this.observatory.canvas.width * this.observatory.canvas.height) * 4;
  }

  // ---------------------------------------------------------------- walls

  wall(d: Draw, w: Wall) {
    const cur = d.game.wallHeight(w);
    if (cur < 0.02) return;
    if (!onScreen(d, w.x, w.y + w.h, w.w / 2 + 0.3, 0.5, w.h + 0.5)) return;
    let s = this.walls.get(w.id);
    if (!s) {
      const a = this.art,
        r = new Rng(hashString(w.id) ^ a.seed);
      s = sprite(this.S, -w.w / 2 - 0.25, -w.h - 0.45, w.w / 2 + 0.25, 0.25, (c) => {
        if (w.kind === "sunwall") sunwall(c, a, w.w, w.h, r);
        else if (w.kind === "gate") gate(c, a, w.w, w.h, r);
        else rockSpire(c, a, w.w, w.h, r);
      });
      this.walls.set(w.id, s);
      this.bytes += s.canvas.width * s.canvas.height * 4;
    }
    const c = d.c;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (cur < w.h - 0.001) {
      // A sinking gate is clipped at its base.
      c.save();
      c.beginPath();
      c.rect(0, 0, d.w * d.dpr, Math.round(sy(d, w.y)));
      c.clip();
      blit(d, s, w.x, w.y - (w.h - cur));
      c.restore();
    } else blit(d, s, w.x, w.y);
    if (w.kind === "gate") {
      // The sun-lock wakes when its lantern is lit.
      const lit = d.game.lanternProgress(w.lantern);
      const ey = w.y - (w.h - cur) + w.h * 0.55;
      if (lit > 0 && ey > w.y) {
        glowAt(d, this.art.warm, w.x, ey, 1.2, 0.6 * (1 - lit * 0.5));
      } else if (lit === 0) {
        const pulse = 0.5 + 0.5 * Math.sin(d.t * 2.2);
        glowAt(d, this.art.gold, w.x, ey, 0.55, 0.12 + pulse * 0.1);
      }
    }
  }

  // ------------------------------------------------------------- lanterns

  lanterns(d: Draw) {
    const a = this.art,
      c = d.c,
      g = d.game;
    for (const l of this.level.lanterns) {
      if (!onScreen(d, l.x, l.y, 0.5, 2.2, 0.2)) continue;
      const lit = g.lit.has(l.id);
      const prog = g.lanternProgress(l.id);
      const flick = 0.85 + 0.1 * Math.sin(d.t * 13 + l.x) + 0.05 * Math.sin(d.t * 23.7 + l.y);
      if (lit) {
        glowAt(d, a.warm, l.x, l.y + 0.03, 1.7, 0.32 * flick, true, 1.1);
        glowAt(d, a.warm, l.x, l.y + 1.36 * LS, 2.6, 0.5 * flick * (0.4 + 0.6 * prog));
      }
      // Glass.
      place(d, l.x, l.y, 1, LS);
      c.beginPath();
      cagePath(c);
      if (lit) {
        c.fillStyle = rgba(mix(a.warm, "#fff4cf", 0.3), 0.85);
      } else c.fillStyle = rgba(mix("#9fb5c8", a.p.fog, 0.3), 0.55);
      c.fill();
      if (lit) {
        const s = flick * (0.85 + 0.15 * prog);
        c.beginPath();
        c.moveTo(0, -1.36 + 0.1 * s);
        c.bezierCurveTo(0.09 * s, -1.36 + 0.04 * s, 0.05 * s, -1.36 - 0.1 * s, 0.005 * Math.sin(d.t * 9), -1.36 - 0.2 * s);
        c.bezierCurveTo(-0.05 * s, -1.36 - 0.1 * s, -0.09 * s, -1.36 + 0.04 * s, 0, -1.36 + 0.1 * s);
        c.fillStyle = "#ffb43d";
        c.fill();
        c.beginPath();
        c.ellipse(0, -1.34, 0.035 * s, 0.07 * s, 0, 0, TAU);
        c.fillStyle = "#fffbe6";
        c.fill();
      } else {
        const e = 0.5 + 0.5 * Math.sin(d.t * 1.7 + l.x);
        c.beginPath();
        c.arc(0, -1.28, 0.03, 0, TAU);
        c.fillStyle = rgba("#ff8a3c", 0.5 + e * 0.4);
        c.fill();
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (this.post) blit(d, this.post, l.x, l.y);
      if (!lit) glowAt(d, "#ff8a3c", l.x, l.y + 1.28 * LS, 0.22, 0.35);
      else glowAt(d, "#fff2c0", l.x, l.y + 1.36 * LS, 0.5, 0.85 * flick);
    }
  }

  // ---------------------------------------------------------- checkpoints

  checkpoints(d: Draw) {
    const a = this.art,
      c = d.c,
      g = d.game;
    const cur = this.level.checkpoints.findIndex((v) => v.id === g.checkpointId);
    this.level.checkpoints.forEach((cp, idx) => {
      if (idx <= cur) this.touched.add(cp.id);
      if (!onScreen(d, cp.x, cp.y, 1, 2, 0.4)) return;
      const touched = this.touched.has(cp.id);
      const active = cp.id === g.checkpointId;
      if (touched) {
        glowAt(d, a.gold, cp.x, cp.y + 0.05, 1.0, active ? 0.45 : 0.22, true, 1.4);
        if (active) {
          // Rising motes in a soft column.
          for (let k = 0; k < 6; k++) {
            const u = (d.t * 0.35 + k / 6) % 1;
            const mx = cp.x + Math.sin(k * 2.3 + d.t) * 0.35;
            glowAt(d, a.goldLight, mx, cp.y + 0.1 + u * 1.8, 0.14, (1 - u) * 0.7);
          }
        }
      }
      place(d, cp.x, cp.y);
      const metal = touched ? a.gold : mix(a.bronze, a.stoneDark, 0.35);
      const metalLit = touched ? a.goldLight : mix(a.bronze, a.stone, 0.3);
      // Inlaid floor ring, seen at a grazing angle.
      c.beginPath();
      c.ellipse(0, 0.0, 0.68, 0.085, 0, 0, TAU);
      c.fillStyle = rgba(mix(a.stoneDeep, a.ink, 0.2), 0.75);
      c.fill();
      c.lineWidth = 0.045;
      c.strokeStyle = metal;
      c.stroke();
      c.beginPath();
      for (let k = 0; k < 12; k++) {
        const an = (k / 12) * TAU + (active ? d.t * 0.4 : 0);
        c.moveTo(Math.cos(an) * 0.5, Math.sin(an) * 0.06);
        c.lineTo(Math.cos(an) * 0.6, Math.sin(an) * 0.075);
      }
      c.strokeStyle = metalLit;
      c.lineWidth = 0.02;
      c.stroke();
      // Gnomon.
      c.beginPath();
      c.moveTo(-0.32, 0.0);
      c.lineTo(0.3, 0.0);
      c.lineTo(-0.26, -0.52);
      c.closePath();
      c.fillStyle = metal;
      c.fill();
      c.strokeStyle = rgba(a.ink, 0.7);
      c.lineWidth = 0.022;
      c.stroke();
      c.beginPath();
      c.moveTo(-0.24, -0.06);
      c.lineTo(-0.22, -0.4);
      c.strokeStyle = metalLit;
      c.lineWidth = 0.018;
      c.stroke();
      {
        // Hour ring: resting on the gnomon when dormant, hovering and turning once touched.
        const y = touched ? -0.66 + Math.sin(d.t * 1.4 + idx) * 0.04 : -0.36;
        const spin = touched ? d.t * 0.6 : 0;
        c.beginPath();
        c.ellipse(0, y, 0.44, 0.12, 0, 0, TAU);
        c.strokeStyle = rgba(a.ink, 0.6);
        c.lineWidth = 0.05;
        c.stroke();
        c.strokeStyle = touched ? rgba(a.goldLight, active ? 1 : 0.7) : metal;
        c.lineWidth = 0.03;
        c.stroke();
        c.beginPath();
        for (let k = 0; k < 8; k++) {
          const an = (k / 8) * TAU + spin;
          const px = Math.cos(an) * 0.44,
            py = y + Math.sin(an) * 0.12;
          c.moveTo(px + 0.035, py);
          c.arc(px, py, 0.035, 0, TAU);
        }
        c.fillStyle = touched ? rgba("#fff6d8", active ? 0.95 : 0.6) : metalLit;
        c.fill();
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
    });
  }

  // ---------------------------------------------------------- observatory

  observatoryDraw(d: Draw) {
    const a = this.art,
      c = d.c,
      g = d.game;
    const e = this.level.exit;
    if (!onScreen(d, e.x, e.y, 2.2, 30, 0.5) || !this.observatory) return;
    const seeds = g.seeds,
      total = Math.max(1, g.seedTotal);
    const awake = seeds >= total;
    const clearing = g.status === "clearing" || g.status === "clear";
    const pulse = 0.5 + 0.5 * Math.sin(d.t * 2);
    if (awake) glowAt(d, a.warm, e.x, e.y + 2.4, 4.2, 0.35 + 0.1 * pulse);
    c.setTransform(1, 0, 0, 1, 0, 0);
    blit(d, this.observatory, e.x, e.y);
    // Doorway: a window onto the night sky; warm when awake.
    place(d, e.x, e.y);
    c.beginPath();
    c.moveTo(-0.4, -0.25);
    c.lineTo(-0.4, -1.25);
    c.arc(0, -1.25, 0.4, Math.PI, 0);
    c.lineTo(0.4, -0.25);
    c.closePath();
    c.fillStyle = awake ? rgba(a.warm, 0.25 + 0.15 * pulse) : rgba(a.ink, 0.0);
    c.fill();
    // Seed sockets.
    const locked = clamp(1 - (d.t - this.lockedAt) / 1.2);
    SOCKETS.forEach((x, k) => {
      const filled = k < seeds;
      c.beginPath();
      c.arc(x, -1.92, 0.11, 0, TAU);
      c.fillStyle = filled ? "#fff3c4" : mix(a.stoneDeep, a.ink, 0.4);
      c.fill();
      c.lineWidth = 0.035;
      c.strokeStyle = filled ? a.goldLight : a.bronzeDark;
      c.stroke();
      if (!filled && locked > 0) {
        c.beginPath();
        c.arc(x, -1.92, 0.11 + (1 - locked) * 0.25, 0, TAU);
        c.strokeStyle = rgba(a.goldLight, locked);
        c.lineWidth = 0.03;
        c.stroke();
      }
    });
    c.setTransform(1, 0, 0, 1, 0, 0);
    SOCKETS.forEach((x, k) => {
      if (k < seeds) glowAt(d, a.warm, e.x + x, e.y + 1.92, 0.45, 0.8);
    });
    // Armillary sphere on the cupola.
    const cy = e.y + 4.35;
    const speed = clearing ? 2.4 : awake ? 0.9 : 0.12;
    const spin = d.t * speed;
    if (awake) glowAt(d, "#fff2c0", e.x, cy, 1.4, 0.55 + 0.2 * pulse);
    place(d, e.x, cy);
    const ring = (rx: number, ry: number, rot: number, col: string, wd: number) => {
      c.beginPath();
      c.ellipse(0, 0, Math.abs(rx), Math.abs(ry), rot, 0, TAU);
      c.strokeStyle = col;
      c.lineWidth = wd;
      c.stroke();
    };
    const metal = awake ? a.goldLight : a.bronze;
    ring(0.58, 0.58, 0, rgba(a.ink, 0.6), 0.075);
    ring(0.58, 0.58, 0, metal, 0.045);
    ring(0.58 * Math.cos(spin), 0.58, 0, metal, 0.035);
    ring(0.58, 0.58 * Math.cos(spin * 0.7 + 1), 0.4, metal, 0.03);
    ring(0.58, 0.16, -0.42, rgba(metal, 0.9), 0.03);
    c.beginPath();
    c.moveTo(-0.8, 0.45);
    c.lineTo(0.8, -0.45);
    c.strokeStyle = a.bronzeDark;
    c.lineWidth = 0.03;
    c.stroke();
    c.beginPath();
    c.arc(0, 0, awake ? 0.17 : 0.11, 0, TAU);
    c.fillStyle = awake ? "#fff6d6" : a.goldDark;
    c.fill();
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (awake) glowAt(d, "#fffbe8", e.x, cy, 0.5, 0.9);
  }

  // -------------------------------------------------------------- pickups

  pickups(d: Draw) {
    const g = d.game;
    this.level.pickups.forEach((p, idx) => {
      if (g.collected.has(p.id)) return;
      const pos = g.pickupPosition(p);
      if (!onScreen(d, pos.x, pos.y, 1.5, 1.5, 1.5)) return;
      if (p.kind === "seed") this.seed(d, p, pos.x, pos.y, idx);
      else this.mote(d, pos.x, pos.y, idx);
    });
  }

  private seed(d: Draw, _p: Pickup, x: number, y0: number, idx: number) {
    const a = this.art,
      c = d.c;
    const t = d.t;
    const y = y0 + Math.sin(t * 2.1 + idx) * 0.12;
    const breathe = 0.85 + 0.15 * Math.sin(t * 3 + idx);
    // A tinted halo (visible on bright skies) under the additive bloom.
    glowAt(d, mix(a.warm, a.gold, 0.4), x, y, 1.5, 0.35 * breathe, false);
    glowAt(d, a.warm, x, y, 3.2, 0.5 * breathe);
    glowAt(d, "#fff0b8", x, y, 1.2, 0.85);
    // Rays.
    place(d, x, y);
    c.rotate(t * 0.35 + idx);
    c.globalCompositeOperation = "lighter";
    c.beginPath();
    for (let k = 0; k < 14; k++) {
      const an = (k / 14) * TAU;
      const len = k % 2 ? 0.95 : 1.55 + 0.15 * Math.sin(t * 4 + k);
      const wd = 0.06;
      c.moveTo(Math.cos(an - wd) * 0.28, Math.sin(an - wd) * 0.28);
      c.lineTo(Math.cos(an) * len, Math.sin(an) * len);
      c.lineTo(Math.cos(an + wd) * 0.28, Math.sin(an + wd) * 0.28);
    }
    c.fillStyle = rgba(a.goldLight, 0.5);
    c.fill();
    c.globalCompositeOperation = "source-over";
    // Orbit ring: back half, crystal, front half.
    place(d, x, y, 1, 1.25);
    c.rotate(-0.38);
    const orbit = t * 2.3 + idx;
    c.beginPath();
    c.ellipse(0, 0, 0.56, 0.16, 0, Math.PI, TAU);
    c.strokeStyle = rgba(a.goldLight, 0.55);
    c.lineWidth = 0.025;
    c.stroke();
    if (Math.sin(orbit) < 0) this.orbitSpark(c, orbit);
    c.rotate(0.38);
    // Faceted seed crystal: a hexagonal bipyramid turning about its axis.
    const spin = t * 1.3 + idx * 1.7;
    const R = 0.21,
      top = -0.4,
      belt = -0.06,
      bot = 0.3;
    const faces: [number, number, number][] = [];
    for (let k = 0; k < 6; k++) {
      const a0 = spin + (k / 6) * TAU,
        a1 = spin + ((k + 1) / 6) * TAU;
      const mid = (a0 + a1) / 2;
      if (Math.cos(mid) <= 0) continue;
      faces.push([Math.sin(a0) * R, Math.sin(a1) * R, Math.cos(mid - 0.6)]);
    }
    const tone = (v: number, lower: boolean) => {
      const b = v * (lower ? 0.75 : 1);
      return b > 0.75 ? "#fff3c4" : b > 0.45 ? a.goldLight : b > 0.15 ? a.gold : a.goldDark;
    };
    for (const [x0, x1, v] of faces) {
      c.beginPath();
      c.moveTo(0, top);
      c.lineTo(x0, belt);
      c.lineTo(x1, belt);
      c.closePath();
      c.fillStyle = tone(v, false);
      c.fill();
      c.beginPath();
      c.moveTo(0, bot);
      c.lineTo(x0, belt);
      c.lineTo(x1, belt);
      c.closePath();
      c.fillStyle = tone(v, true);
      c.fill();
    }
    c.beginPath();
    for (const [x0] of faces) {
      c.moveTo(0, top);
      c.lineTo(x0, belt);
      c.lineTo(0, bot);
    }
    c.moveTo(-R, belt);
    c.lineTo(R, belt);
    c.strokeStyle = rgba(a.goldDark, 0.55);
    c.lineWidth = 0.012;
    c.stroke();
    c.beginPath();
    c.moveTo(0, top);
    c.lineTo(R, belt);
    c.lineTo(0, bot);
    c.lineTo(-R, belt);
    c.closePath();
    c.strokeStyle = a.goldDark;
    c.lineWidth = 0.028;
    c.stroke();
    c.beginPath();
    sparkle(c, -0.06, -0.2, 0.07);
    c.fillStyle = "#ffffff";
    c.fill();
    // A tiny sprout curl.
    c.beginPath();
    c.moveTo(0, -0.4);
    c.quadraticCurveTo(0.02, -0.52, 0.11, -0.54);
    c.strokeStyle = a.goldDark;
    c.lineWidth = 0.02;
    c.stroke();
    c.rotate(-0.38);
    c.beginPath();
    c.ellipse(0, 0, 0.56, 0.16, 0, 0, Math.PI);
    c.strokeStyle = rgba(a.goldLight, 0.9);
    c.lineWidth = 0.03;
    c.stroke();
    if (Math.sin(orbit) >= 0) this.orbitSpark(c, orbit);
    c.setTransform(1, 0, 0, 1, 0, 0);
    // Twinkles.
    for (let k = 0; k < 3; k++) {
      const v = Math.max(0, Math.sin(t * 2.4 + k * 2.1 + idx));
      if (v < 0.2) continue;
      const an = k * 2.1 + idx;
      place(d, x + Math.cos(an) * 0.75, y + Math.sin(an) * 0.6);
      c.beginPath();
      sparkle(c, 0, 0, 0.11 * v);
      c.fillStyle = "#fffbe6";
      c.fill();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    glowAt(d, "#ffffff", x, y - 0.05, 0.3, 0.5 * breathe);
  }

  private orbitSpark(c: Ctx, orbit: number) {
    const px = Math.cos(orbit) * 0.56,
      py = Math.sin(orbit) * 0.16;
    c.beginPath();
    sparkle(c, px, py, 0.09);
    c.fillStyle = "#fffbe6";
    c.fill();
  }

  private mote(d: Draw, x: number, y0: number, idx: number) {
    const c = d.c;
    const t = d.t;
    const y = y0 + Math.sin(t * 2.6 + idx * 1.7) * 0.1;
    const tw = 0.6 + 0.4 * Math.sin(t * 5 + idx);
    glowAt(d, "#ffe9a8", x, y, 0.7, 0.5);
    place(d, x, y);
    c.beginPath();
    c.arc(0, 0, 0.085, 0, TAU);
    c.fillStyle = "#fff8de";
    c.fill();
    c.rotate(t * 0.8 + idx);
    c.beginPath();
    sparkle(c, 0, 0, 0.22 * tw, 0.12);
    c.fillStyle = rgba("#fffbe8", 0.85);
    c.fill();
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ------------------------------------------------------------ sentinels

  updateTrails(d: Draw) {
    for (const s of this.level.sentinels) {
      const p = d.game.sentinelPosition(s);
      let tr = this.trails.get(s.id);
      if (!tr) this.trails.set(s.id, (tr = []));
      const last = tr[tr.length - 1];
      if (!last || Math.hypot(last[0] - p.x, last[1] - p.y) > 0.06) tr.push([p.x, p.y]);
      if (tr.length > 14) tr.shift();
    }
  }

  sentinels(d: Draw) {
    const a = this.art,
      g = d.game;
    const kx = g.player.x,
      ky = g.player.y + HEIGHT * 0.6;
    for (const s of this.level.sentinels) {
      const p = g.sentinelPosition(s);
      if (!onScreen(d, p.x, p.y, 2, 2, 2)) continue;
      const r = s.r;
      const tr = this.trails.get(s.id) ?? [];
      for (let k = 0; k < tr.length - 1; k++) {
        const u = k / tr.length;
        glowAt(d, a.crimson, tr[k][0], tr[k][1], r * (0.4 + u * 0.7), u * 0.22);
      }
      const pulse = 0.5 + 0.5 * Math.sin(d.t * 3.2 + s.x);
      glowAt(d, a.crimson, p.x, p.y, r * 3.2, 0.35 + pulse * 0.15);
      glowAt(d, a.rose, p.x, p.y, r * 1.4, 0.35);
      this.sentinelBody(d, s, p.x, p.y, kx, ky, pulse);
    }
  }

  private sentinelBody(d: Draw, s: Sentinel, x: number, y: number, kx: number, ky: number, pulse: number) {
    const a = this.art,
      c = d.c;
    const r = s.r;
    const t = d.t;
    // Thorned outer ring.
    place(d, x, y);
    c.rotate(t * 0.9);
    c.beginPath();
    const n = 14;
    for (let k = 0; k < n * 2; k++) {
      const an = (k / (n * 2)) * TAU;
      const rr = r * (k % 2 ? 1.08 : 1.38);
      if (k === 0) c.moveTo(Math.cos(an) * rr, Math.sin(an) * rr);
      else c.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
    }
    c.closePath();
    c.moveTo(r * 0.98, 0);
    c.arc(0, 0, r * 0.98, 0, TAU, true);
    c.fillStyle = a.crimson;
    c.fill("evenodd");
    c.strokeStyle = a.wine;
    c.lineWidth = 0.035;
    c.stroke();
    // Counter-rotating tick ring.
    c.rotate(-t * 2.1);
    c.beginPath();
    c.arc(0, 0, r * 0.9, 0, TAU);
    c.strokeStyle = rgba(a.rose, 0.9);
    c.lineWidth = 0.03;
    c.stroke();
    c.beginPath();
    for (let k = 0; k < 8; k++) {
      const an = (k / 8) * TAU;
      c.moveTo(Math.cos(an) * r * 0.78, Math.sin(an) * r * 0.78);
      c.lineTo(Math.cos(an) * r * 0.9, Math.sin(an) * r * 0.9);
    }
    c.stroke();
    // Gyroscope rings turning through the crystal.
    place(d, x, y);
    for (let k = 0; k < 2; k++) {
      const tilt = t * (k ? -1.3 : 0.9) + k * 1.4;
      c.beginPath();
      c.ellipse(0, 0, r * 1.22, Math.abs(Math.cos(tilt)) * r * 1.22 + 0.01, k ? 0.7 : -0.5, 0, TAU);
      c.strokeStyle = rgba(k ? a.rose : mix(a.rose, "#ffffff", 0.3), 0.75);
      c.lineWidth = 0.022;
      c.stroke();
    }
    // Faceted crystal.
    const R = r * 0.72;
    const facets: [number, string][] = [
      [0, mix(a.rose, "#ffffff", 0.25)],
      [1, a.rose],
      [2, a.crimson],
      [3, mix(a.crimson, a.wine, 0.5)],
      [4, a.wine],
      [5, mix(a.crimson, a.wine, 0.3)],
      [6, a.crimson],
      [7, mix(a.rose, a.crimson, 0.4)],
    ];
    for (const [k, col] of facets) {
      const a0 = (k / 8) * TAU - Math.PI * 0.62,
        a1 = ((k + 1) / 8) * TAU - Math.PI * 0.62;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
      c.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
      c.closePath();
      c.fillStyle = col;
      c.fill();
    }
    c.beginPath();
    for (let k = 0; k < 8; k++) {
      const an = (k / 8) * TAU - Math.PI * 0.62;
      c.lineTo(Math.cos(an) * R, Math.sin(an) * R);
    }
    c.closePath();
    c.strokeStyle = a.wine;
    c.lineWidth = 0.035;
    c.stroke();
    // The eye watches the keeper.
    const dx = kx - x,
      dy = ky - y;
    const dl = Math.hypot(dx, dy) || 1;
    const lx = (dx / dl) * r * 0.14,
      ly = (-dy / dl) * r * 0.1;
    const blink = Math.sin(t * 0.7 + s.x * 3) > 0.985 ? 0.15 : 1;
    c.beginPath();
    c.moveTo(-R * 0.62, 0);
    c.quadraticCurveTo(0, -R * 0.55 * blink, R * 0.62, 0);
    c.quadraticCurveTo(0, R * 0.55 * blink, -R * 0.62, 0);
    c.closePath();
    c.fillStyle = "#ffe3e6";
    c.fill();
    c.strokeStyle = a.wine;
    c.lineWidth = 0.025;
    c.stroke();
    if (blink > 0.5) {
      c.beginPath();
      c.arc(lx, ly, R * 0.26, 0, TAU);
      c.fillStyle = a.crimson;
      c.fill();
      c.beginPath();
      c.ellipse(lx, ly, R * 0.07, R * 0.2, 0, 0, TAU);
      c.fillStyle = a.wine;
      c.fill();
      c.beginPath();
      c.arc(lx - R * 0.08, ly - R * 0.09, R * 0.05, 0, TAU);
      c.fillStyle = "#ffffff";
      c.fill();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    glowAt(d, a.rose, x, y, r * 0.5, 0.25 + 0.2 * pulse);
  }

  // ------------------------------------------------------ special islands

  /** Sunglass prism: real only unfolded. A dashed ghost with hatching and a cube glyph. */
  prism(d: Draw, i: Island, x: number, y: number) {
    if (!onScreen(d, x, y, i.w / 2 + 0.5, 0.5, i.h + 0.5)) return;
    const a = this.art,
      c = d.c;
    const W = i.w / 2,
      h = i.h;
    const col = a.night ? "#dfe9ff" : mix(a.goldLight, "#ffffff", 0.4);
    const shimmer = 0.75 + 0.25 * Math.sin(d.clock * 2 + x);
    glowAt(d, col, x, y - h / 2, Math.max(W, h) * 1.3, 0.1 * shimmer);
    place(d, x, y);
    c.save();
    c.beginPath();
    c.rect(-W, 0, W * 2, h);
    c.clip();
    c.beginPath();
    hatch(c, -W, 0, W, h, 0.14, -0.78);
    c.strokeStyle = rgba(col, 0.32 * shimmer);
    c.lineWidth = 0.02;
    c.stroke();
    c.restore();
    c.beginPath();
    c.rect(-W, 0, W * 2, h);
    c.setLineDash([0.16, 0.11]);
    c.lineDashOffset = -d.clock * 0.25;
    c.strokeStyle = rgba(col, 0.85);
    c.lineWidth = 0.035;
    c.stroke();
    c.setLineDash([]);
    // Unfold glyph: a small cube.
    const s = Math.min(0.17, h * 0.32, W * 0.4);
    const cy = h / 2;
    c.beginPath();
    c.moveTo(0, cy - s);
    c.lineTo(s * 0.9, cy - s * 0.5);
    c.lineTo(s * 0.9, cy + s * 0.5);
    c.lineTo(0, cy + s);
    c.lineTo(-s * 0.9, cy + s * 0.5);
    c.lineTo(-s * 0.9, cy - s * 0.5);
    c.closePath();
    c.moveTo(-s * 0.9, cy - s * 0.5);
    c.lineTo(0, cy);
    c.lineTo(s * 0.9, cy - s * 0.5);
    c.moveTo(0, cy);
    c.lineTo(0, cy + s);
    c.strokeStyle = rgba(col, 0.95);
    c.lineWidth = 0.028;
    c.stroke();
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Star bridge glow and twinkles over its cached plank. */
  starBridge(d: Draw, i: Island, x: number, y: number) {
    const a = this.art;
    const W = i.w / 2;
    glowAt(d, a.goldLight, x, y - i.h / 2, W + 0.6, 0.22, true, 1);
    const c = d.c;
    const n = Math.round(W * 3);
    for (let k = 0; k < n; k++) {
      const v = Math.max(0, Math.sin(d.clock * 2.2 + k * 1.9));
      if (v < 0.3) continue;
      const px = x - W + ((k + 0.5) / n) * W * 2;
      place(d, px, y - i.h * (k % 2 ? 0.7 : 0.35));
      c.beginPath();
      sparkle(c, 0, 0, 0.14 * v);
      c.fillStyle = "#fffbe8";
      c.fill();
    }
    // Dust of light drifting down from the plank.
    for (let k = 0; k < 4; k++) {
      const u = (d.clock * 0.3 + k / 4) % 1;
      glowAt(d, a.goldLight, x - W + ((k * 0.37 + 0.2) % 1) * W * 2, y - i.h - u * 1.2, 0.12, (1 - u) * 0.6);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Lantern bridge: a dotted promise, then planks assembling with islandPresence. */
  lanternBridge(d: Draw, i: Island, art: IslandArt, x: number, y: number, presence: number) {
    const a = this.art,
      c = d.c;
    const W = i.w / 2,
      h = i.h;
    if (presence < 1) {
      // The promise.
      const fade = 1 - smooth(presence * 1.5);
      if (fade > 0) {
        place(d, x, y);
        c.beginPath();
        c.rect(-W, 0, W * 2, h);
        c.fillStyle = rgba(a.goldLight, 0.08 * fade);
        c.fill();
        c.setLineDash([0.01, 0.13]);
        c.lineDashOffset = d.clock * 0.2;
        c.strokeStyle = rgba(a.goldLight, (0.7 + 0.25 * Math.sin(d.clock * 2.4)) * fade);
        c.lineWidth = 0.075;
        c.stroke();
        c.setLineDash([]);
        for (let k = 0; k <= Math.round(W * 2); k++) {
          const px = -W + (k / Math.round(W * 2)) * W * 2;
          c.beginPath();
          sparkle(c, px, 0, 0.08);
          c.fillStyle = rgba("#fff6d8", 0.7 * fade);
          c.fill();
        }
        c.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    if (presence <= 0 || !art.front) return;
    const lantern = this.level.lanterns.find((l) => l.id === i.lantern);
    const fromLeft = !lantern || lantern.x < x;
    const N = Math.max(4, Math.round(i.w * 2.5));
    const f = art.front;
    const S = d.S;
    const left = Math.round(sx(d, x) - f.ox),
      top = Math.round(sy(d, y) - f.oy);
    const sliceW = f.canvas.width / N;
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (let k = 0; k < N; k++) {
      const order = fromLeft ? k : N - 1 - k;
      const q = clamp((presence - (order / N) * 0.6) / 0.4);
      if (q <= 0) continue;
      const drop = (1 - easeOutBack(q)) * 0.8 * S;
      c.globalAlpha = clamp(q * 1.6);
      const sx0 = Math.floor(k * sliceW),
        sw = Math.ceil(sliceW) + 1;
      c.drawImage(f.canvas, sx0, 0, Math.min(sw, f.canvas.width - sx0), f.canvas.height, left + sx0, top + drop, Math.min(sw, f.canvas.width - sx0), f.canvas.height);
      if (q < 1 && q > 0.3) glowAt(d, a.goldLight, x - W - 0.2 + ((k + 0.5) / N) * (i.w + 0.4), y - drop / S, 0.3, (1 - q) * 1.2);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    c.globalAlpha = 1;
  }
}

// ------------------------------------------------------------- painters

function cagePath(c: Ctx) {
  c.moveTo(-0.12, -1.16);
  c.lineTo(0.12, -1.16);
  c.lineTo(0.15, -1.36);
  c.lineTo(0.12, -1.56);
  c.lineTo(-0.12, -1.56);
  c.lineTo(-0.15, -1.36);
  c.closePath();
}

function lanternPost(c: Ctx, a: Art) {
  const bronze = (x0: number, x1: number) => {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, a.bronzeLit);
    g.addColorStop(0.5, a.bronze);
    g.addColorStop(1, a.bronzeDark);
    return g;
  };
  const ink = (w = 0.025) => {
    c.strokeStyle = a.ink;
    c.lineWidth = w;
    c.stroke();
  };
  c.beginPath();
  c.moveTo(-0.22, 0);
  c.lineTo(0.22, 0);
  c.lineTo(0.18, -0.1);
  c.lineTo(0.1, -0.14);
  c.lineTo(0.1, -0.22);
  c.lineTo(-0.1, -0.22);
  c.lineTo(-0.1, -0.14);
  c.lineTo(-0.18, -0.1);
  c.closePath();
  c.fillStyle = bronze(-0.22, 0.22);
  c.fill();
  ink();
  c.beginPath();
  c.rect(-0.045, -1.12, 0.09, 0.9);
  c.fillStyle = bronze(-0.045, 0.045);
  c.fill();
  ink(0.02);
  for (const y of [-0.5, -0.95]) {
    c.beginPath();
    c.rect(-0.07, y - 0.03, 0.14, 0.05);
    c.fillStyle = a.gold;
    c.fill();
    ink(0.015);
  }
  // Scroll brackets.
  c.beginPath();
  c.moveTo(-0.04, -0.95);
  c.bezierCurveTo(-0.22, -1.0, -0.2, -1.15, -0.12, -1.16);
  c.moveTo(0.04, -0.95);
  c.bezierCurveTo(0.22, -1.0, 0.2, -1.15, 0.12, -1.16);
  c.strokeStyle = a.bronzeDark;
  c.lineWidth = 0.03;
  c.stroke();
  // Cage frame.
  c.beginPath();
  cagePath(c);
  ink(0.035);
  c.beginPath();
  c.moveTo(0, -1.16);
  c.lineTo(0, -1.56);
  c.moveTo(-0.15, -1.36);
  c.lineTo(0.15, -1.36);
  c.strokeStyle = rgba(a.bronzeDark, 0.8);
  c.lineWidth = 0.018;
  c.stroke();
  c.beginPath();
  c.rect(-0.16, -1.2, 0.32, 0.05);
  c.fillStyle = a.bronze;
  c.fill();
  ink(0.015);
  // Roof and finial ring.
  c.beginPath();
  c.moveTo(-0.2, -1.56);
  c.lineTo(0.2, -1.56);
  c.quadraticCurveTo(0.08, -1.62, 0, -1.76);
  c.quadraticCurveTo(-0.08, -1.62, -0.2, -1.56);
  c.closePath();
  c.fillStyle = bronze(-0.2, 0.2);
  c.fill();
  ink(0.022);
  c.beginPath();
  c.arc(0, -1.83, 0.06, 0, TAU);
  c.strokeStyle = a.gold;
  c.lineWidth = 0.025;
  c.stroke();
}

function wallGrad(c: Ctx, a: Art, W: number, lit: string, mid: string, dark: string) {
  const g = c.createLinearGradient(-W, 0, W, 0);
  const left = a.light <= 0;
  g.addColorStop(0, left ? lit : dark);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, left ? dark : lit);
  return g;
}

function engrave(c: Ctx, a: Art, draw: () => void, w: number) {
  c.save();
  c.translate(0.012, 0.012);
  c.beginPath();
  draw();
  c.strokeStyle = rgba(a.ink, 0.35);
  c.lineWidth = w * 1.3;
  c.stroke();
  c.restore();
  c.beginPath();
  draw();
  c.strokeStyle = a.gold;
  c.lineWidth = w;
  c.stroke();
}

function sunFace(c: Ctx, a: Art, x: number, y: number, R: number) {
  engrave(
    c,
    a,
    () => {
      for (let k = 0; k < 16; k++) {
        const an = (k / 16) * TAU;
        c.moveTo(x + Math.cos(an) * R * 1.12, y + Math.sin(an) * R * 1.12);
        c.lineTo(x + Math.cos(an) * R * (k % 2 ? 1.45 : 1.7), y + Math.sin(an) * R * (k % 2 ? 1.45 : 1.7));
      }
    },
    R * 0.1,
  );
  const g = c.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.1, x, y, R);
  g.addColorStop(0, a.goldLight);
  g.addColorStop(0.6, a.gold);
  g.addColorStop(1, a.goldDark);
  c.beginPath();
  c.arc(x, y, R, 0, TAU);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = a.goldDark;
  c.lineWidth = R * 0.08;
  c.stroke();
  // A serene sleeping face.
  c.beginPath();
  c.arc(x - R * 0.33, y - R * 0.08, R * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
  c.moveTo(x + R * 0.49, y - R * 0.08);
  c.arc(x + R * 0.33, y - R * 0.08, R * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
  c.moveTo(x - R * 0.2, y + R * 0.35);
  c.quadraticCurveTo(x, y + R * 0.5, x + R * 0.2, y + R * 0.35);
  c.strokeStyle = a.goldDark;
  c.lineWidth = R * 0.07;
  c.stroke();
}

function sunwall(c: Ctx, a: Art, w: number, h: number, r: Rng) {
  const W = w / 2;
  c.beginPath();
  c.rect(-W, -h, w, h);
  c.fillStyle = wallGrad(c, a, W, a.stoneLit, a.stone, a.stoneMid);
  c.fill();
  c.save();
  c.clip();
  // Courses.
  c.beginPath();
  for (let y = -0.45; y > -h + 0.3; y -= 0.55) {
    c.moveTo(-W, y);
    c.lineTo(W, y);
  }
  c.strokeStyle = rgba(a.stoneDark, 0.35);
  c.lineWidth = 0.014;
  c.stroke();
  // Inset panel.
  c.beginPath();
  c.rect(-W + 0.16, -h + 0.42, w - 0.32, h - 0.95);
  c.strokeStyle = rgba(a.ink, 0.3);
  c.lineWidth = 0.02;
  c.stroke();
  c.beginPath();
  c.rect(-W + 0.2, -h + 0.46, w - 0.4, h - 1.03);
  c.strokeStyle = rgba(a.gold, 0.8);
  c.lineWidth = 0.014;
  c.stroke();
  const R = Math.min(W * 0.48, 0.38);
  const cy = -h + 0.46 + R * 1.9 + 0.1;
  sunFace(c, a, 0, cy, R);
  // Flutes below the sun.
  engrave(
    c,
    a,
    () => {
      for (let x = -W + 0.34; x < W - 0.3; x += 0.17) {
        c.moveTo(x, cy + R * 2);
        c.lineTo(x, -0.62);
      }
    },
    0.014,
  );
  // Constellation chips.
  for (let k = 0; k < 5; k++) {
    c.beginPath();
    sparkle(c, r.range(-W + 0.3, W - 0.3), r.range(cy + R * 2.2, -0.8), 0.04);
    c.fillStyle = a.goldLight;
    c.fill();
  }
  // Base with relief buttresses.
  c.fillStyle = rgba(a.stoneDark, 0.3);
  c.fillRect(-W, -0.45, w, 0.45);
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(s * W, 0);
    c.lineTo(s * W, -1.0);
    c.quadraticCurveTo(s * (W - 0.05), -0.4, s * (W - 0.3), 0);
    c.closePath();
    c.fillStyle = a.stoneMid;
    c.fill();
    c.strokeStyle = rgba(a.ink, 0.45);
    c.lineWidth = 0.018;
    c.stroke();
  }
  c.beginPath();
  c.moveTo(-W, -0.45);
  c.lineTo(W, -0.45);
  c.strokeStyle = a.gold;
  c.lineWidth = 0.025;
  c.stroke();
  // Shadow hatching.
  const side = a.light <= 0 ? 1 : -1;
  c.save();
  c.beginPath();
  c.rect(side > 0 ? W * 0.35 : -W, -h, W * 0.65, h);
  c.clip();
  c.beginPath();
  hatch(c, -W, -h, W, 0, 0.08, -0.9);
  c.strokeStyle = rgba(a.ink, 0.12);
  c.lineWidth = 0.014;
  c.stroke();
  c.restore();
  // Cornice.
  c.fillStyle = mix(a.stoneLit, "#ffffff", 0.25);
  c.fillRect(-W, -h, w, 0.26);
  c.fillStyle = rgba(a.ink, 0.25);
  c.fillRect(-W, -h + 0.26, w, 0.025);
  c.fillStyle = a.stoneMid;
  for (let x = -W + 0.05; x < W - 0.05; x += 0.14) c.fillRect(x, -h + 0.285, 0.07, 0.06);
  c.fillStyle = a.gold;
  c.fillRect(-W, -h + 0.14, w, 0.03);
  c.restore();
  c.beginPath();
  c.rect(-W, -h, w, h);
  c.strokeStyle = a.ink;
  c.lineWidth = 0.045;
  c.stroke();
  c.beginPath();
  c.moveTo(-W + 0.02, -h + 0.02);
  c.lineTo(W - 0.02, -h + 0.02);
  c.strokeStyle = "rgba(255,255,255,0.75)";
  c.lineWidth = 0.04;
  c.stroke();
}

function gate(c: Ctx, a: Art, w: number, h: number, r: Rng) {
  const W = w / 2;
  const jamb = Math.min(0.2, W * 0.36);
  const lintel = 0.36;
  // Bronze door.
  c.beginPath();
  c.rect(-W, -h, w, h);
  c.fillStyle = wallGrad(c, a, W, a.bronzeLit, a.bronze, a.bronzeDark);
  c.fill();
  c.save();
  c.clip();
  c.beginPath();
  for (let x = -W + jamb + 0.14; x < W - jamb; x += 0.14) {
    c.moveTo(x, -h + lintel);
    c.lineTo(x, 0);
  }
  c.strokeStyle = rgba(a.ink, 0.25);
  c.lineWidth = 0.014;
  c.stroke();
  for (const y of [-h * 0.82, -h * 0.28]) {
    c.fillStyle = a.bronzeDark;
    c.fillRect(-W, y - 0.06, w, 0.12);
    c.fillStyle = rgba(a.bronzeLit, 0.7);
    c.fillRect(-W, y - 0.06, w, 0.025);
    for (let x = -W + jamb + 0.08; x < W - jamb; x += 0.16) {
      c.beginPath();
      c.arc(x, y, 0.025, 0, TAU);
      c.fillStyle = a.goldLight;
      c.fill();
    }
  }
  // Sun-lock.
  const R = Math.min(W * 0.55, 0.32);
  const cy = -h * 0.55;
  c.beginPath();
  c.arc(0, cy, R * 1.25, 0, TAU);
  c.fillStyle = a.bronzeDark;
  c.fill();
  c.strokeStyle = a.ink;
  c.lineWidth = 0.02;
  c.stroke();
  sunFace(c, a, 0, cy, R * 0.62);
  c.beginPath();
  c.arc(0, cy, R * 1.25, 0, TAU);
  c.strokeStyle = a.gold;
  c.lineWidth = 0.03;
  c.stroke();
  // Stone frame.
  c.fillStyle = wallGrad(c, a, W, a.stoneLit, a.stone, a.stoneMid);
  c.fillRect(-W, -h, jamb, h);
  c.fillRect(W - jamb, -h, jamb, h);
  c.fillRect(-W, -h, w, lintel);
  c.beginPath();
  for (let y = -h + lintel + 0.4; y < 0; y += 0.45) {
    c.moveTo(-W, y);
    c.lineTo(-W + jamb, y);
    c.moveTo(W - jamb, y);
    c.lineTo(W, y);
  }
  c.moveTo(-W + jamb, -h + lintel);
  c.lineTo(-W + jamb, 0);
  c.moveTo(W - jamb, -h + lintel);
  c.lineTo(W - jamb, 0);
  c.moveTo(-W + jamb, -h + lintel);
  c.lineTo(W - jamb, -h + lintel);
  c.strokeStyle = rgba(a.ink, 0.45);
  c.lineWidth = 0.018;
  c.stroke();
  c.beginPath();
  c.moveTo(-0.1, -h + lintel);
  c.lineTo(0.1, -h + lintel);
  c.lineTo(0.13, -h + 0.02);
  c.lineTo(-0.13, -h + 0.02);
  c.closePath();
  c.fillStyle = a.gold;
  c.fill();
  c.strokeStyle = rgba(a.ink, 0.5);
  c.lineWidth = 0.015;
  c.stroke();
  c.restore();
  c.beginPath();
  c.rect(-W, -h, w, h);
  c.strokeStyle = a.ink;
  c.lineWidth = 0.045;
  c.stroke();
  c.beginPath();
  c.moveTo(-W + 0.02, -h + 0.02);
  c.lineTo(W - 0.02, -h + 0.02);
  c.strokeStyle = "rgba(255,255,255,0.7)";
  c.lineWidth = 0.04;
  c.stroke();
  void r;
}

function rockSpire(c: Ctx, a: Art, w: number, h: number, r: Rng) {
  const W = w / 2;
  const left: number[][] = [],
    right: number[][] = [];
  for (let y = 0; y > -h; y -= r.range(0.35, 0.7)) {
    const near = clamp((h + y) / 0.6);
    left.push([-W + r.range(0, 0.12) * near, y]);
    right.push([W - r.range(0, 0.12) * near, y]);
  }
  const shape = () => {
    c.beginPath();
    c.moveTo(-W, 0);
    for (const p of left) c.lineTo(p[0], p[1]);
    c.lineTo(-W, -h + 0.08);
    c.quadraticCurveTo(-W, -h, -W + 0.08, -h);
    c.lineTo(W - 0.08, -h);
    c.quadraticCurveTo(W, -h, W, -h + 0.08);
    for (let k = right.length - 1; k >= 0; k--) c.lineTo(right[k][0], right[k][1]);
    c.lineTo(W, 0);
    c.closePath();
  };
  shape();
  c.fillStyle = wallGrad(c, a, W, mix(a.stoneMid, a.stoneLit, 0.4), mix(a.stoneMid, a.rockTop, 0.4), a.rockMid);
  c.fill();
  c.save();
  shape();
  c.clip();
  // Strata.
  let k = 0;
  for (let y = -h + 0.5; y < 0; y += r.range(0.3, 0.6), k++) {
    const pts: number[][] = [];
    for (let x = -W - 0.1; x <= W + 0.1; x += 0.25) pts.push([x, y + Math.sin(x * 2.3 + y) * 0.05 + r.range(-0.02, 0.02)]);
    if (k % 2) {
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) c.lineTo(p[0], p[1]);
      for (let q = pts.length - 1; q >= 0; q--) c.lineTo(pts[q][0], pts[q][1] + 0.18);
      c.closePath();
      c.fillStyle = rgba(a.ink, 0.07);
      c.fill();
    }
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) c.lineTo(p[0], p[1]);
    c.strokeStyle = rgba(a.ink, 0.3);
    c.lineWidth = 0.016;
    c.stroke();
    // Moss ledges on the lit side.
    if (r.chance(0.35)) {
      const side = a.light <= 0 ? -1 : 1;
      c.beginPath();
      c.ellipse(side * W * r.range(0.3, 0.8), y - 0.02, r.range(0.15, 0.35), 0.05, 0, 0, TAU);
      c.fillStyle = rgba(a.grass, 0.85);
      c.fill();
    }
  }
  c.beginPath();
  for (let q = 0; q < h; q++) {
    let x = r.range(-W * 0.7, W * 0.7),
      y = -r.range(0.3, h);
    c.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += r.range(-0.08, 0.08);
      y += 0.25;
      c.lineTo(x, y);
    }
  }
  c.strokeStyle = rgba(a.ink, 0.28);
  c.lineWidth = 0.016;
  c.stroke();
  const side = a.light <= 0 ? 1 : -1;
  c.save();
  c.beginPath();
  c.rect(side > 0 ? 0 : -W, -h, W, h);
  c.clip();
  c.beginPath();
  hatch(c, -W, -h, W, 0, 0.08, -0.9);
  c.strokeStyle = rgba(a.ink, 0.15);
  c.lineWidth = 0.014;
  c.stroke();
  c.restore();
  const fade = c.createLinearGradient(0, -h * 0.3, 0, 0);
  fade.addColorStop(0, rgba(a.air, 0));
  fade.addColorStop(1, rgba(a.air, 0.5));
  c.fillStyle = fade;
  c.fillRect(-W - 0.2, -h, w + 0.4, h);
  c.restore();
  shape();
  c.strokeStyle = a.ink;
  c.lineWidth = 0.045;
  c.stroke();
  // Mossy cap.
  c.beginPath();
  c.moveTo(-W + 0.02, -h);
  c.lineTo(W - 0.02, -h);
  for (let x = W - 0.02; x > -W; x -= 0.1) c.lineTo(x, -h + 0.08 + r.range(0, 0.1) + (r.chance(0.12) ? 0.15 : 0));
  c.closePath();
  c.fillStyle = a.grass;
  c.fill();
  c.strokeStyle = rgba(a.ink, 0.5);
  c.lineWidth = 0.018;
  c.stroke();
  c.beginPath();
  c.moveTo(-W + 0.04, -h + 0.02);
  c.lineTo(W - 0.04, -h + 0.02);
  c.strokeStyle = a.grassLit;
  c.lineWidth = 0.04;
  c.stroke();
  for (let x = -W + 0.05; x < W - 0.05; x += r.range(0.08, 0.16)) {
    const hh = r.range(0.05, 0.13);
    c.beginPath();
    c.moveTo(x - 0.015, -h + 0.02);
    c.lineTo(x + r.range(-0.04, 0.04), -h - hh);
    c.lineTo(x + 0.015, -h + 0.02);
    c.fillStyle = r.chance(0.5) ? a.grass : a.grassDark;
    c.fill();
  }
}

function observatoryBody(c: Ctx, a: Art) {
  const ink = (w = 0.035) => {
    c.strokeStyle = a.ink;
    c.lineWidth = w;
    c.stroke();
  };
  const stoneG = wallGrad(c, a, 1.3, a.stoneLit, a.stone, a.stoneMid);
  // Plinth.
  c.beginPath();
  c.rect(-1.55, -0.22, 3.1, 0.22);
  c.fillStyle = a.stoneMid;
  c.fill();
  ink(0.03);
  // Drum.
  c.beginPath();
  c.rect(-1.25, -2.12, 2.5, 1.9);
  c.fillStyle = stoneG;
  c.fill();
  ink();
  // Pilasters with gilt capitals.
  for (const x of [-1.08, -0.68, 0.68, 1.08]) {
    c.beginPath();
    c.rect(x - 0.08, -2.05, 0.16, 1.83);
    c.fillStyle = a.stoneLit;
    c.fill();
    c.strokeStyle = rgba(a.ink, 0.4);
    c.lineWidth = 0.018;
    c.stroke();
    c.fillStyle = a.gold;
    c.fillRect(x - 0.11, -2.1, 0.22, 0.07);
  }
  // Doorway onto the night sky.
  c.beginPath();
  c.moveTo(-0.4, -0.22);
  c.lineTo(-0.4, -1.25);
  c.arc(0, -1.25, 0.4, Math.PI, 0);
  c.lineTo(0.4, -0.22);
  c.closePath();
  const night = c.createLinearGradient(0, -1.65, 0, -0.22);
  night.addColorStop(0, "#141a3a");
  night.addColorStop(1, "#2b2f5c");
  c.fillStyle = night;
  c.fill();
  const r = new Rng(77);
  c.save();
  c.clip();
  for (let k = 0; k < 18; k++) {
    c.beginPath();
    sparkle(c, r.range(-0.38, 0.38), r.range(-1.6, -0.3), r.range(0.015, 0.04));
    c.fillStyle = "#fff6d8";
    c.fill();
  }
  c.restore();
  c.beginPath();
  c.moveTo(-0.4, -0.22);
  c.lineTo(-0.4, -1.25);
  c.arc(0, -1.25, 0.4, Math.PI, 0);
  c.lineTo(0.4, -0.22);
  c.strokeStyle = a.gold;
  c.lineWidth = 0.05;
  c.stroke();
  c.beginPath();
  c.arc(0, -1.25, 0.5, Math.PI, 0);
  c.strokeStyle = rgba(a.ink, 0.45);
  c.lineWidth = 0.02;
  c.stroke();
  // Socket plate.
  c.beginPath();
  c.roundRect(-0.6, -2.06, 1.2, 0.28, 0.12);
  c.fillStyle = a.stoneMid;
  c.fill();
  c.strokeStyle = a.gold;
  c.lineWidth = 0.025;
  c.stroke();
  // Cornice.
  c.beginPath();
  c.rect(-1.42, -2.34, 2.84, 0.24);
  c.fillStyle = mix(a.stoneLit, "#ffffff", 0.2);
  c.fill();
  ink(0.03);
  c.fillStyle = a.gold;
  c.fillRect(-1.42, -2.22, 2.84, 0.035);
  // Lapis dome with gilt stars and ribs.
  c.beginPath();
  c.moveTo(-1.18, -2.34);
  c.bezierCurveTo(-1.18, -3.62, 1.18, -3.62, 1.18, -2.34);
  c.closePath();
  const dome = c.createLinearGradient(-1.2, -3.4, 1.2, -2.3);
  dome.addColorStop(0, "#3f5aa6");
  dome.addColorStop(0.6, "#273d7c");
  dome.addColorStop(1, "#1b2a58");
  c.fillStyle = dome;
  c.fill();
  c.save();
  c.clip();
  for (let k = 0; k < 26; k++) {
    c.beginPath();
    sparkle(c, r.range(-1.1, 1.1), r.range(-3.4, -2.4), r.range(0.02, 0.05));
    c.fillStyle = a.goldLight;
    c.fill();
  }
  c.beginPath();
  for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) {
    c.moveTo(x * 1.4, -2.34);
    c.quadraticCurveTo(x * 1.1, -3.3, 0, -3.3);
  }
  c.strokeStyle = a.gold;
  c.lineWidth = 0.03;
  c.stroke();
  // Shutter slit with a telescope.
  c.fillStyle = "#0f1530";
  c.fillRect(0.28, -3.4, 0.2, 1.06);
  c.restore();
  c.beginPath();
  c.moveTo(-1.18, -2.34);
  c.bezierCurveTo(-1.18, -3.62, 1.18, -3.62, 1.18, -2.34);
  ink();
  c.save();
  c.translate(0.38, -2.95);
  c.rotate(-0.75);
  c.beginPath();
  c.rect(0, -0.09, 0.95, 0.18);
  c.fillStyle = a.bronze;
  c.fill();
  ink(0.025);
  c.fillStyle = a.gold;
  c.fillRect(0.8, -0.11, 0.07, 0.22);
  c.fillRect(0.3, -0.1, 0.05, 0.2);
  c.restore();
  // Cupola and pedestal for the armillary.
  c.beginPath();
  c.rect(-0.22, -3.62, 0.44, 0.3);
  c.fillStyle = a.stoneLit;
  c.fill();
  ink(0.025);
  c.beginPath();
  c.moveTo(-0.14, -3.62);
  c.lineTo(-0.05, -3.8);
  c.lineTo(0.05, -3.8);
  c.lineTo(0.14, -3.62);
  c.closePath();
  c.fillStyle = a.gold;
  c.fill();
  ink(0.02);
}
