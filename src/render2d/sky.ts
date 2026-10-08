import type { Art } from "./art";
import type { Draw } from "./draw";
import { glow } from "./glow";
import {
  Rng,
  TAU,
  clamp,
  makeCanvas,
  mix,
  noise1,
  rgba,
  sparkle,
  type Ctx,
} from "./util";

/**
 * The illustrated sky: a painted gradient with stars and constellations,
 * the sun or moon with an engraved halo, two strips of distant floating
 * islands, two cloud banks, an animated cloud sea and foreground wisps. Every
 * layer is cached as a bitmap; per frame we only blit and scroll.
 */
type Strip = { canvas: HTMLCanvasElement; w: number; h: number; scale: number };

type Ambient = { x: number; y: number; z: number; ph: number; sp: number; kind: number };

export class Sky {
  private sky: HTMLCanvasElement | null = null;
  private body: HTMLCanvasElement | null = null;
  private far: Strip | null = null;
  private mid: Strip | null = null;
  private clouds: Strip[] = [];
  private sea: Strip[] = [];
  private wisp: HTMLCanvasElement | null = null;
  private ray: HTMLCanvasElement | null = null;
  private twinkles: { x: number; y: number; r: number; ph: number }[] = [];
  private ambient: Ambient[] = [];
  private key = "";
  private rayGrad: CanvasGradient | null = null;
  private rayGradR = 0;
  bytes = 0;

  constructor(private art: Art) {}

  /** Rebuild caches when the screen or quality changes. */
  ensure(w: number, h: number, dpr: number, low: boolean) {
    const key = `${w}x${h}@${dpr}${low ? "l" : "h"}`;
    if (key === this.key) return;
    this.key = key;
    const a = this.art;
    const r = new Rng(a.seed * 977 + 13);
    this.bytes = 0;
    this.sky = this.paintSky(w, h, dpr, r);
    this.body = this.paintBody(Math.min(h, w * 1.25), dpr);
    const bg = Math.min(dpr, low ? 1 : 1.5);
    const tile = Math.max(1400, Math.round(w * 1.4));
    this.far = this.paintIslands(tile, h * 0.34, bg, r, 0);
    this.mid = this.paintIslands(tile, h * 0.42, bg, r, 1);
    this.clouds = [this.paintClouds(tile, h * 0.3, bg, r, 0), this.paintClouds(tile, h * 0.3, bg, r, 1)];
    this.sea = [0, 1, 2].map((k) => this.paintSea(tile, h * (0.16 + k * 0.03), bg, r, k));
    this.seaColors = [];
    this.depths = [];
    this.wisp = this.paintWisp(Math.round(h * 0.5), bg);
    this.ray = this.paintRay(bg);
    for (const s of [this.far, this.mid, ...this.clouds, ...this.sea]) this.bytes += s.canvas.width * s.canvas.height * 4;
    this.bytes += (this.sky?.width ?? 0) * (this.sky?.height ?? 0) * 4;
    // Live twinkles and ambient particles.
    this.twinkles = [];
    const nt = a.night ? (low ? 18 : 40) : a.time === "dusk" || a.time === "dawn" ? (low ? 6 : 14) : 0;
    for (let k = 0; k < nt; k++)
      this.twinkles.push({ x: r.next(), y: r.next() * (a.night ? 0.62 : 0.32), r: r.range(2, 4.5), ph: r.range(0, TAU) });
    this.ambient = [];
    const na = low ? 22 : 56;
    for (let k = 0; k < na; k++)
      this.ambient.push({ x: r.next(), y: r.next(), z: r.range(0.2, 1.3), ph: r.range(0, TAU), sp: r.range(0.6, 1.4), kind: r.int(0, 3) });
  }

  // ------------------------------------------------------------- painting

  private paintSky(w: number, h: number, dpr: number, r: Rng) {
    const a = this.art,
      p = a.p;
    const { canvas, ctx: c } = makeCanvas(w * dpr, h * dpr);
    c.scale(dpr, dpr);
    const g = c.createLinearGradient(0, 0, 0, h);
    const top = a.night ? mix(p.skyTop, "#000814", 0.3) : mix(p.skyTop, p.ink, 0.12);
    g.addColorStop(0, top);
    g.addColorStop(0.42, mix(p.skyTop, p.skyHorizon, 0.4));
    g.addColorStop(0.72, p.skyHorizon);
    g.addColorStop(1, mix(p.skyHorizon, p.fog, 0.5));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // Warm bloom around the sun or moon.
    const bx = a.body.x * w,
      by = a.body.y * h;
    const bloom = c.createRadialGradient(bx, by, 0, bx, by, h * (a.night ? 0.7 : 1.0));
    const bc = a.night ? "#9fb6e8" : p.sun;
    bloom.addColorStop(0, rgba(bc, a.night ? 0.28 : 0.55));
    bloom.addColorStop(0.35, rgba(bc, a.night ? 0.08 : 0.18));
    bloom.addColorStop(1, rgba(bc, 0));
    c.fillStyle = bloom;
    c.fillRect(0, 0, w, h);
    // Watercolour streaks.
    for (let k = 0; k < 18; k++) {
      const y = r.next() * h * 0.75;
      c.beginPath();
      c.ellipse(r.next() * w, y, r.range(w * 0.15, w * 0.45), r.range(4, 14), r.range(-0.03, 0.03), 0, TAU);
      c.fillStyle = rgba("#ffffff", r.range(0.02, 0.05));
      c.fill();
    }
    if (a.time === "dusk" || a.time === "dawn") {
      // Glowing bands of high cloud across the horizon.
      for (let k = 0; k < 7; k++) {
        const y = h * r.range(0.35, 0.68);
        c.beginPath();
        c.ellipse(r.next() * w, y, r.range(w * 0.2, w * 0.5), r.range(3, 9), 0, 0, TAU);
        c.fillStyle = rgba(mix(p.sun, p.accent, 0.4), r.range(0.15, 0.3));
        c.fill();
      }
    }
    const stars = a.night ? 520 : a.time === "dusk" ? 90 : a.time === "dawn" ? 50 : 0;
    const top01 = a.night ? 0.75 : 0.4;
    if (a.night) {
      // Milky way.
      c.save();
      c.translate(w * 0.5, h * 0.3);
      c.rotate(-0.35);
      const mw = c.createLinearGradient(0, -h * 0.12, 0, h * 0.12);
      mw.addColorStop(0, "rgba(180,200,255,0)");
      mw.addColorStop(0.5, "rgba(190,205,255,0.13)");
      mw.addColorStop(1, "rgba(180,200,255,0)");
      c.fillStyle = mw;
      c.fillRect(-w, -h * 0.12, w * 2, h * 0.24);
      for (let k = 0; k < 600; k++) {
        const x = r.range(-w, w),
          y = (r.next() + r.next() + r.next() - 1.5) * h * 0.08;
        c.fillStyle = rgba("#e8eeff", r.range(0.15, 0.6));
        c.fillRect(x, y, 0.8, 0.8);
      }
      for (let k = 0; k < 18; k++) {
        c.beginPath();
        c.ellipse(r.range(-w * 0.8, w * 0.8), r.range(-h * 0.05, h * 0.05), r.range(30, 90), r.range(8, 20), 0, 0, TAU);
        c.fillStyle = rgba("#c8d4ff", 0.04);
        c.fill();
      }
      c.restore();
    }
    for (let k = 0; k < stars; k++) {
      const x = r.next() * w,
        y = Math.pow(r.next(), 1.3) * h * top01;
      const fade = a.night ? 1 : 1 - y / (h * top01);
      const big = r.chance(0.05);
      c.fillStyle = rgba(r.chance(0.2) ? "#ffe9b8" : "#eef2ff", (big ? 0.95 : r.range(0.3, 0.8)) * fade);
      if (big) {
        c.beginPath();
        sparkle(c, x, y, r.range(2.5, 4));
        c.fill();
      } else {
        c.beginPath();
        c.arc(x, y, r.range(0.4, 1.1), 0, TAU);
        c.fill();
      }
    }
    if (a.night || a.time === "dusk") {
      // Constellations, engraved in gold.
      const n = a.night ? 4 : 2;
      for (let k = 0; k < n; k++) {
        const cx = (0.12 + (k / n) * 0.8 + r.range(-0.04, 0.04)) * w,
          cy = r.range(0.1, a.night ? 0.42 : 0.25) * h;
        const pts: number[][] = [];
        const m = r.int(4, 7);
        for (let q = 0; q < m; q++) pts.push([cx + r.range(-90, 90), cy + r.range(-55, 55)]);
        pts.sort((u, v) => u[0] - v[0]);
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        for (const q of pts) c.lineTo(q[0], q[1]);
        if (r.chance(0.5)) c.lineTo(pts[1][0], pts[1][1]);
        c.strokeStyle = rgba(a.goldLight, a.night ? 0.32 : 0.2);
        c.lineWidth = 0.8;
        c.setLineDash([3, 3]);
        c.stroke();
        c.setLineDash([]);
        for (const [x, y] of pts) {
          c.beginPath();
          sparkle(c, x, y, r.range(2.5, 4.5));
          c.fillStyle = rgba("#fff7dd", a.night ? 0.95 : 0.7);
          c.fill();
          c.beginPath();
          c.arc(x, y, 5.5, 0, TAU);
          c.strokeStyle = rgba(a.goldLight, 0.25);
          c.lineWidth = 0.6;
          c.stroke();
        }
      }
    }
    return canvas;
  }

  private paintBody(h: number, dpr: number) {
    const a = this.art;
    const R = a.body.r * h * dpr;
    const size = Math.ceil(R * 6);
    const { canvas, ctx: c } = makeCanvas(size, size);
    c.translate(size / 2, size / 2);
    const halo = c.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 3);
    const hc = a.night ? "#cfdcff" : a.p.sun;
    halo.addColorStop(0, rgba(hc, a.night ? 0.35 : 0.55));
    halo.addColorStop(0.4, rgba(hc, a.night ? 0.1 : 0.18));
    halo.addColorStop(1, rgba(hc, 0));
    c.fillStyle = halo;
    c.fillRect(-size / 2, -size / 2, size, size);
    if (a.body.kind === "moon") {
      const g = c.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
      g.addColorStop(0, "#fbfcff");
      g.addColorStop(0.7, "#dfe7f8");
      g.addColorStop(1, "#b8c6e2");
      c.beginPath();
      c.arc(0, 0, R, 0, TAU);
      c.fillStyle = g;
      c.fill();
      const r = new Rng(31);
      for (let k = 0; k < 9; k++) {
        c.beginPath();
        c.arc(r.range(-0.6, 0.6) * R, r.range(-0.6, 0.6) * R, r.range(0.08, 0.22) * R, 0, TAU);
        c.fillStyle = "rgba(140,160,200,0.22)";
        c.fill();
      }
      c.beginPath();
      c.arc(0, 0, R, 0, TAU);
      c.strokeStyle = rgba(a.ink, 0.35);
      c.lineWidth = Math.max(1, R * 0.03);
      c.stroke();
    } else {
      const g = c.createRadialGradient(-R * 0.25, -R * 0.25, R * 0.1, 0, 0, R);
      g.addColorStop(0, "#fffdf2");
      g.addColorStop(0.55, mix(a.p.sun, "#ffffff", 0.35));
      g.addColorStop(1, mix(a.p.sun, a.gold, a.time === "dusk" ? 0.6 : 0.3));
      c.beginPath();
      c.arc(0, 0, R, 0, TAU);
      c.fillStyle = g;
      c.fill();
      if (a.time === "dusk" || a.time === "dawn") {
        // Bars of cloud across the low sun.
        c.save();
        c.clip();
        for (let k = 0; k < 4; k++) {
          c.fillStyle = rgba(mix(a.p.cloud, a.p.accent, 0.3), 0.35 + k * 0.08);
          c.fillRect(-R, R * (0.05 + k * 0.22), R * 2, R * (0.05 + k * 0.03));
        }
        c.restore();
      }
      c.beginPath();
      c.arc(0, 0, R, 0, TAU);
      c.strokeStyle = rgba(a.goldDark, 0.45);
      c.lineWidth = Math.max(1, R * 0.025);
      c.stroke();
    }
    // Engraved astrolabe ring.
    c.beginPath();
    c.arc(0, 0, R * 1.35, 0, TAU);
    c.strokeStyle = rgba(a.night ? "#e4ecff" : a.goldDark, 0.35);
    c.lineWidth = Math.max(1, R * 0.015);
    c.stroke();
    c.beginPath();
    for (let k = 0; k < 72; k++) {
      const an = (k / 72) * TAU;
      const r0 = R * 1.35,
        r1 = R * (k % 6 ? 1.42 : 1.5);
      c.moveTo(Math.cos(an) * r0, Math.sin(an) * r0);
      c.lineTo(Math.cos(an) * r1, Math.sin(an) * r1);
    }
    c.stroke();
    return canvas;
  }

  /** Distant floating islands with chapter silhouettes, tiling horizontally. */
  private paintIslands(tileW: number, H: number, scale: number, r: Rng, layer: number): Strip {
    const a = this.art,
      p = a.p;
    const { canvas, ctx: c } = makeCanvas(tileW * scale, H * scale);
    c.scale(scale, scale);
    const haze = layer === 0 ? 0.72 : 0.5;
    const base = mix(mix(p.stoneShade, p.foliage, 0.25), mix(p.skyHorizon, p.fog, 0.5), haze);
    const dark = mix(base, p.ink, layer === 0 ? 0.08 : 0.18);
    const rim = rgba(a.rim, layer === 0 ? 0.35 : 0.55);
    const n = layer === 0 ? 8 : 5;
    for (let k = 0; k < n; k++) {
      const x = ((k + r.range(0.1, 0.9)) / n) * tileW;
      const s = (layer === 0 ? r.range(0.4, 0.75) : r.range(0.75, 1.2)) * (H / 260);
      const y = H * (layer === 0 ? r.range(0.3, 0.55) : r.range(0.25, 0.5));
      for (const dx of [-tileW, 0, tileW]) this.farIsland(c, x + dx, y, s, base, dark, rim, new Rng(k * 31 + layer * 7 + a.seed));
    }
    return { canvas, w: tileW, h: H, scale };
  }

  private farIsland(c: Ctx, x: number, y: number, s: number, base: string, dark: string, rim: string, r: Rng) {
    const a = this.art;
    const W = r.range(45, 95) * s,
      D = W * r.range(0.8, 1.35);
    c.save();
    c.translate(x, y);
    // Underside: a lobed, tapering mass fading into the air.
    const tip = r.range(-0.3, 0.3) * W;
    const pts: number[][] = [];
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const px = -W + u * W * 2;
      const toward = 1 - Math.abs(px - tip) / (W * 1.3);
      pts.push([px, 4 * s + D * Math.max(0.08, toward) ** 1.6 * r.range(0.75, 1.1)]);
    }
    const g = c.createLinearGradient(0, 0, 0, D);
    g.addColorStop(0, dark);
    g.addColorStop(1, mix(dark, mix(a.p.skyHorizon, a.p.fog, 0.5), 0.55));
    c.beginPath();
    c.moveTo(-W, 0);
    for (let k = 0; k < pts.length - 1; k++) {
      const mx = (pts[k][0] + pts[k + 1][0]) / 2,
        my = (pts[k][1] + pts[k + 1][1]) / 2;
      c.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
    }
    c.lineTo(W, 0);
    c.closePath();
    c.fillStyle = g;
    c.fill();
    // Grassy or paved mound on top.
    c.beginPath();
    c.moveTo(-W, 2 * s);
    c.quadraticCurveTo(-W * 0.6, -9 * s, 0, -9 * s);
    c.quadraticCurveTo(W * 0.6, -9 * s, W, 2 * s);
    c.closePath();
    c.fillStyle = base;
    c.fill();
    // Silhouettes on top.
    const kinds: Record<Art["time"], string[]> = {
      morning: ["cypress", "cypress", "dome", "tree", "tower"],
      noon: ["arcade", "tower", "cypress", "dome"],
      afternoon: ["gear", "tower", "chimney", "dome"],
      dusk: ["spire", "tower", "dome", "spire"],
      night: ["dome", "spire", "tower", "telescope"],
      dawn: ["dome", "dome", "telescope", "tower"],
    };
    const list = kinds[a.time];
    const m = r.int(1, 3);
    c.fillStyle = base;
    for (let k = 0; k < m; k++) {
      const px = r.range(-W * 0.7, W * 0.7);
      const kind = r.pick(list);
      c.beginPath();
      if (kind === "cypress") {
        const hh = r.range(40, 70) * s;
        c.moveTo(px - 7 * s, -4 * s);
        c.quadraticCurveTo(px - 9 * s, -hh * 0.6, px, -hh);
        c.quadraticCurveTo(px + 9 * s, -hh * 0.6, px + 7 * s, -4 * s);
      } else if (kind === "tree") {
        c.arc(px, -30 * s, 20 * s, 0, TAU);
        c.rect(px - 2 * s, -14 * s, 4 * s, 12 * s);
      } else if (kind === "dome") {
        const rw = r.range(18, 30) * s;
        c.rect(px - rw, -rw * 0.9, rw * 2, rw * 0.9);
        c.moveTo(px + rw * 0.9, -rw * 0.9);
        c.arc(px, -rw * 0.9, rw * 0.9, 0, Math.PI, true);
        c.rect(px - 1.5 * s, -rw * 2.1, 3 * s, rw * 0.4);
      } else if (kind === "tower") {
        const hh = r.range(60, 100) * s;
        c.rect(px - 8 * s, -hh, 16 * s, hh);
        c.moveTo(px - 11 * s, -hh);
        c.lineTo(px, -hh - 18 * s);
        c.lineTo(px + 11 * s, -hh);
      } else if (kind === "spire") {
        const hh = r.range(70, 120) * s;
        c.moveTo(px - 10 * s, 0);
        c.lineTo(px - 6 * s, -hh * 0.7);
        c.lineTo(px, -hh);
        c.lineTo(px + 6 * s, -hh * 0.7);
        c.lineTo(px + 10 * s, 0);
      } else if (kind === "arcade") {
        for (let q = 0; q < 4; q++) c.rect(px - 30 * s + q * 18 * s, -40 * s, 5 * s, 40 * s);
        c.rect(px - 32 * s, -48 * s, 64 * s, 9 * s);
      } else if (kind === "gear") {
        const R = r.range(18, 30) * s;
        for (let q = 0; q < 12; q++) {
          const an = (q / 12) * TAU;
          c.rect(px + Math.cos(an) * R - 3 * s, -R * 1.4 + Math.sin(an) * R - 3 * s, 6 * s, 6 * s);
        }
        c.moveTo(px + R, -R * 1.4);
        c.arc(px, -R * 1.4, R, 0, TAU);
        c.rect(px - 3 * s, -R * 0.4, 6 * s, R * 0.4);
      } else if (kind === "chimney") {
        c.rect(px - 6 * s, -70 * s, 12 * s, 70 * s);
        c.rect(px - 20 * s, -30 * s, 40 * s, 30 * s);
      } else {
        c.rect(px - 3 * s, -36 * s, 6 * s, 36 * s);
        c.save();
        c.translate(px, -36 * s);
        c.rotate(-0.7);
        c.rect(-6 * s, -5 * s, 46 * s, 10 * s);
        c.restore();
      }
      c.fill();
    }
    // Rim light along the top and the sunward flank.
    c.beginPath();
    c.moveTo(-W, 2 * s);
    c.quadraticCurveTo(-W * 0.6, -9 * s, 0, -9 * s);
    c.quadraticCurveTo(W * 0.6, -9 * s, W, 2 * s);
    c.strokeStyle = rim;
    c.lineWidth = 1.4;
    c.stroke();
    c.restore();
  }

  /** Cloud banks: puffs with an inked silhouette, lit from the sun. */
  private paintClouds(tileW: number, H: number, scale: number, r: Rng, layer: number): Strip {
    const a = this.art,
      p = a.p;
    const { canvas, ctx: c } = makeCanvas(tileW * scale, H * scale);
    c.scale(scale, scale);
    const lit = a.night ? mix(p.cloud, "#c8d6f0", 0.4) : mix(p.cloud, "#ffffff", 0.25);
    const shade = mix(p.cloud, mix(p.fog, p.skyTop, 0.35), a.night ? 0.5 : 0.45);
    const n = layer === 0 ? 4 : 3;
    const banks: number[][][] = [];
    for (let k = 0; k < n; k++) {
      const cx = ((k + r.range(0.15, 0.85)) / n) * tileW;
      const bw = r.range(160, 320) * (layer ? 1.2 : 0.9);
      const cy = H * r.range(0.5, 0.75);
      const puffs: number[][] = [];
      const m = r.int(5, 9);
      for (let q = 0; q < m; q++) {
        const u = q / (m - 1);
        const rr = r.range(24, 48) * (1 - Math.abs(u - 0.5)) * (layer ? 1.25 : 1) + 12;
        puffs.push([cx - bw / 2 + u * bw, cy - rr * 0.55 + r.range(-6, 6), rr]);
      }
      puffs.push([cx, cy + 6, bw * 0.45]);
      for (const dx of [-tileW, 0, tileW]) banks.push(puffs.map(([x, y, rr]) => [x + dx, y, rr]));
    }
    const pass = (dx: number, dy: number, s: number, fill: string, stroke?: string) => {
      for (const puffs of banks) {
        c.beginPath();
        for (const [x, y, rr] of puffs) {
          if (rr > 100) {
            c.moveTo(x + dx + rr, y + dy);
            c.ellipse(x + dx, y + dy, rr * s, 18 * s, 0, 0, TAU);
          } else {
            c.moveTo(x + dx + rr * s, y + dy);
            c.arc(x + dx, y + dy, rr * s, 0, TAU);
          }
        }
        if (stroke) {
          c.strokeStyle = stroke;
          c.lineWidth = 2.2;
          c.stroke();
        }
        c.fillStyle = fill;
        c.fill();
      }
    };
    pass(0, 0, 1, shade, rgba(a.ink, layer ? 0.3 : 0.18));
    c.globalCompositeOperation = "source-atop";
    const lx = -a.light * 7;
    pass(lx, -8, 0.9, lit);
    c.globalCompositeOperation = "source-over";
    // Hatching on the shaded bellies.
    c.save();
    c.globalCompositeOperation = "source-atop";
    c.beginPath();
    for (let x = 0; x < tileW; x += 5) {
      c.moveTo(x, H * 0.7);
      c.lineTo(x + 10, H * 0.6);
    }
    c.strokeStyle = rgba(a.ink, 0.06);
    c.lineWidth = 0.8;
    c.stroke();
    c.restore();
    return { canvas, w: tileW, h: H, scale };
  }

  /** Colours of one cloud sea row: 0 is the farthest. */
  private seaTones(row: number) {
    const a = this.art,
      p = a.p;
    const t = row / 2;
    if (a.night) {
      const lit = mix("#d6e2fb", p.cloud, 0.3 - t * 0.2);
      const mid = mix(p.cloud, p.skyHorizon, 0.45 - t * 0.2);
      const base = mix(mix(p.skyTop, p.cloud, 0.35 - t * 0.12), p.ink, 0.1 + t * 0.15);
      return { lit, mid, base };
    }
    const lit = mix(mix(p.cloud, "#ffffff", 0.55), p.sun, 0.12 + t * 0.08);
    const mid = mix(mix(p.cloud, p.fog, 0.35), p.skyHorizon, 0.25 - t * 0.1);
    const base = mix(mix(p.fog, p.skyTop, 0.28 - t * 0.04), p.ink, 0.04 + t * 0.12);
    return { lit, mid, base };
  }

  /** One row of the cloud sea: billows lit on top, shading into the row below. */
  private paintSea(tileW: number, H: number, scale: number, r: Rng, row: number): Strip {
    const a = this.art;
    const { canvas, ctx: c } = makeCanvas(tileW * scale, H * scale);
    c.scale(scale, scale);
    const { lit, mid, base } = this.seaTones(row);
    const y0 = H * 0.5;
    const radius = 22 + row * 14;
    const puffs: number[][] = [];
    let x = 0;
    while (x < tileW) {
      const tower = r.chance(0.18);
      const rr = Math.min(y0 * 0.9, radius * r.range(0.7, 1.2) * (tower ? 1.45 : 1));
      puffs.push([x, y0 + rr * r.range(0.25, 0.45) - (tower ? rr * 0.25 : 0), rr]);
      x += rr * r.range(0.9, 1.3);
    }
    const shape = (dx0: number, dy: number, s: number) => {
      c.beginPath();
      for (const [px, py, rr] of puffs)
        for (const dx of [-tileW, 0, tileW]) {
          c.moveTo(px + dx + dx0 + rr * s, py + dy);
          c.arc(px + dx + dx0, py + dy, rr * s, 0, TAU);
        }
      c.rect(-1, y0 + radius * 0.5, tileW + 2, H);
    };
    const g = c.createLinearGradient(0, y0 - radius * 1.3, 0, H);
    g.addColorStop(0, lit);
    g.addColorStop(0.35, mid);
    g.addColorStop(0.75, base);
    g.addColorStop(1, base);
    shape(0, 0, 1);
    c.strokeStyle = rgba(a.ink, 0.16 + row * 0.07);
    c.lineWidth = 2.2;
    c.stroke();
    c.fillStyle = g;
    c.fill();
    // Sunlit crowns.
    c.globalCompositeOperation = "source-atop";
    shape(-a.light * 5, -7, 0.84);
    const crown = c.createLinearGradient(0, y0 - radius * 1.4, 0, y0 + radius * 0.6);
    crown.addColorStop(0, rgba(lit, 0.95));
    crown.addColorStop(1, rgba(lit, 0));
    c.fillStyle = crown;
    c.fill();
    // Engraved swirls and fine hatching in the shade.
    c.beginPath();
    for (const [px, py, rr] of puffs) {
      if (r.chance(0.55)) continue;
      c.moveTo(px + rr * 0.45, py + 3);
      c.arc(px, py + 3, rr * 0.45, 0, Math.PI * 1.25, false);
    }
    c.strokeStyle = rgba(a.ink, 0.08 + row * 0.03);
    c.lineWidth = 1.1;
    c.stroke();
    c.beginPath();
    for (let hx = 0; hx < tileW; hx += 6) {
      c.moveTo(hx, y0 + radius * 0.9);
      c.lineTo(hx + 9, y0 + radius * 0.3);
    }
    c.strokeStyle = rgba(a.ink, 0.04 + row * 0.02);
    c.lineWidth = 0.8;
    c.stroke();
    c.globalCompositeOperation = "source-over";
    // Solid base so the fill below joins seamlessly.
    c.fillStyle = base;
    c.fillRect(0, H * 0.82, tileW, H * 0.18 + 1);
    return { canvas, w: tileW, h: H, scale };
  }

  private paintWisp(size: number, scale: number) {
    const a = this.art;
    const w = size * 2.4,
      h = size * 0.5;
    const { canvas, ctx: c } = makeCanvas(w * scale, h * scale);
    c.scale(scale, scale);
    const r = new Rng(a.seed + 5);
    const col = a.night ? "#9fb2d6" : mix(a.p.cloud, "#ffffff", 0.3);
    for (let k = 0; k < 14; k++) {
      const x = r.range(w * 0.15, w * 0.85),
        y = h * 0.5 + r.range(-h * 0.12, h * 0.12);
      const g = c.createRadialGradient(x, y, 0, x, y, h * 0.45);
      g.addColorStop(0, rgba(col, 0.35));
      g.addColorStop(1, rgba(col, 0));
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, y, h * r.range(0.6, 1.1), h * 0.32, 0, 0, TAU);
      c.fill();
    }
    return canvas;
  }

  private paintRay(scale: number) {
    const w = 120,
      h = 900;
    const { canvas, ctx: c } = makeCanvas(w * scale, h * scale);
    c.scale(scale, scale);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(w * 0.42, 0);
    c.lineTo(w * 0.58, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    c.fill();
    return canvas;
  }

  // -------------------------------------------------------------- drawing

  /** Vertical anchor: 0 when the camera is at the level's resting height. */
  private lift(d: Draw, pv: number) {
    return (d.fy - d.refY) * d.k * pv;
  }

  private strip(d: Draw, s: Strip, p: number, yTop: number, drift = 0) {
    const c = d.c;
    const dpr = d.dpr;
    const off = -(d.fx * d.k * p) + drift;
    const w = s.w;
    let x = ((off % w) + w) % w;
    if (x > 0) x -= w;
    const y = Math.round(yTop * dpr);
    const dw = Math.round(w * dpr),
      dh = Math.round(s.h * dpr);
    if (y > d.h * dpr || y + dh < 0) return;
    for (let px = x; px < d.w; px += w) c.drawImage(s.canvas, Math.round(px * dpr), y, dw, dh);
  }

  drawBack(d: Draw) {
    const c = d.c,
      a = this.art;
    const W = d.w,
      H = d.h,
      dpr = d.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.sky) c.drawImage(this.sky, 0, 0, W * dpr, H * dpr);
    // Twinkling stars.
    if (this.twinkles.length) {
      c.globalCompositeOperation = "lighter";
      c.fillStyle = "#fff6dc";
      for (const s of this.twinkles) {
        const v = 0.5 + 0.5 * Math.sin(d.clock * 1.7 + s.ph);
        c.globalAlpha = v * (a.night ? 0.9 : 0.5);
        c.beginPath();
        sparkle(c, s.x * W * dpr, s.y * H * dpr, s.r * dpr * (0.6 + v * 0.5));
        c.fill();
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
    }
    // Sun or moon, rays slowly turning.
    const bx = (a.body.x * W - d.fx * d.k * 0.015) * dpr,
      by = (a.body.y * H + this.lift(d, 0.04)) * dpr;
    const R = a.body.r * Math.min(H, W * 1.25) * dpr;
    if (a.body.kind === "sun") {
      const spin = d.clock * 0.02;
      c.save();
      c.translate(bx, by);
      c.rotate(spin);
      c.globalCompositeOperation = "lighter";
      c.beginPath();
      const n = a.time === "dawn" ? 28 : 20;
      for (let k = 0; k < n; k++) {
        const an = (k / n) * TAU;
        const len = R * (a.time === "dawn" ? (k % 2 ? 5.5 : 8) : k % 2 ? 2.2 : 3.1);
        const wd = (TAU / n) * (a.time === "dawn" ? 0.28 : 0.16);
        c.moveTo(Math.cos(an - wd) * R * 1.1, Math.sin(an - wd) * R * 1.1);
        c.lineTo(Math.cos(an) * len, Math.sin(an) * len);
        c.lineTo(Math.cos(an + wd) * R * 1.1, Math.sin(an + wd) * R * 1.1);
      }
      if (!this.rayGrad || this.rayGradR !== R) {
        const rg = c.createRadialGradient(0, 0, R, 0, 0, R * (a.time === "dawn" ? 8 : 3.1));
        rg.addColorStop(0, rgba(a.p.sun, a.time === "dawn" ? 0.3 : 0.26));
        rg.addColorStop(1, rgba(a.p.sun, 0));
        this.rayGrad = rg;
        this.rayGradR = R;
      }
      c.fillStyle = this.rayGrad;
      c.fill();
      c.restore();
    }
    if (this.body) c.drawImage(this.body, bx - this.body.width / 2, by - this.body.height / 2);

    // God rays from the sun on bright chapters.
    if (this.ray && a.body.kind === "sun" && !d.low && a.time !== "dusk") {
      c.save();
      c.globalCompositeOperation = "lighter";
      for (let k = 0; k < 4; k++) {
        const ang = -0.9 + k * 0.5 + Math.sin(d.clock * 0.07 + k) * 0.06 + (a.body.x - 0.5) * -1.2;
        c.setTransform(Math.cos(ang) * dpr, Math.sin(ang) * dpr, -Math.sin(ang) * dpr, Math.cos(ang) * dpr, bx, by);
        c.globalAlpha = 0.035 + 0.02 * Math.sin(d.clock * 0.3 + k * 2);
        c.drawImage(this.ray, -40 * (k % 2 ? 1.5 : 1), 0, 80 * (k % 2 ? 1.5 : 1), H * 1.2);
      }
      c.restore();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);

    // Distant islands, cloud banks, cloud sea.
    if (this.far) this.strip(d, this.far, 0.035, H * 0.36 + this.lift(d, 0.06));
    if (this.clouds[0]) this.strip(d, this.clouds[0], 0.07, H * 0.42 + this.lift(d, 0.1), d.clock * 2.5);
    if (this.mid) this.strip(d, this.mid, 0.11, H * 0.38 + this.lift(d, 0.14));
    if (this.clouds[1]) this.strip(d, this.clouds[1], 0.18, H * 0.5 + this.lift(d, 0.22), d.clock * 4);
    this.ambientLayer(d, false);
    this.seaLayer(d, 0, 2);
  }

  /** The cloud sea, lower rows nearer. Drawn in two passes around the islands. */
  seaLayer(d: Draw, from: number, to: number) {
    const c = d.c;
    const H = d.h;
    for (let k = from; k < to; k++) {
      const s = this.sea[k];
      if (!s) continue;
      const pv = 0.3 + k * 0.12;
      const y = H * (0.68 + k * 0.085) + this.lift(d, pv) + Math.sin(d.clock * 0.35 + k * 1.7) * (3 + k * 2);
      this.strip(d, s, 0.25 + k * 0.15, y, d.clock * (6 + k * 5) * (k % 2 ? -1 : 1));
      const bottom = y + s.h - 2;
      if (bottom < H) {
        const top = Math.round(bottom * d.dpr);
        const depth = this.depthSprite(k);
        c.drawImage(depth, 0, top, Math.ceil(d.w * d.dpr), Math.max(Math.ceil((H - bottom) * d.dpr) + 2, Math.round(H * 0.6 * d.dpr)));
      }
    }
  }

  private depths: HTMLCanvasElement[] = [];
  /** The sea below a row deepens into a shaded haze rather than a flat fill. */
  private depthSprite(k: number) {
    let c = this.depths[k];
    if (c) return c;
    const base = this.seaBase(k);
    const deep = this.art.night ? mix(base, this.art.p.ink, 0.45) : mix(mix(base, this.art.p.skyTop, 0.25), this.art.p.ink, 0.18);
    const m = makeCanvas(4, 256);
    const g = m.ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, base);
    g.addColorStop(0.35, mix(base, deep, 0.45));
    g.addColorStop(1, deep);
    m.ctx.fillStyle = g;
    m.ctx.fillRect(0, 0, 4, 256);
    // Faint drifting cloud bands.
    for (let y = 30; y < 256; y += 38) {
      m.ctx.fillStyle = rgba("#ffffff", 0.04);
      m.ctx.fillRect(0, y, 4, 6);
    }
    this.depths[k] = m.canvas;
    return m.canvas;
  }

  private seaColors: string[] = [];
  private seaBase(k: number) {
    if (!this.seaColors.length) for (let q = 0; q < 3; q++) this.seaColors.push(this.seaTones(q).base);
    return this.seaColors[k];
  }

  /** Pollen, dust, fireflies or stars drifting through the air. */
  ambientLayer(d: Draw, front: boolean) {
    const c = d.c,
      a = this.art;
    const W = d.w,
      H = d.h,
      dpr = d.dpr;
    const t = d.clock;
    const dot = glow(a.night || a.time === "dusk" ? "#ffe9a8" : "#fff4cf");
    c.globalCompositeOperation = "lighter";
    for (let k = 0; k < this.ambient.length; k++) {
      const p = this.ambient[k];
      if (front !== p.z > 1) continue;
      const par = p.z * 0.6;
      let vx = 6,
        vy = -4;
      if (a.time === "morning") (vx = 9), (vy = -5);
      else if (a.time === "noon") (vx = 3), (vy = -2);
      else if (a.time === "afternoon") (vx = 14), (vy = 2);
      else if (a.time === "dusk") (vx = 4), (vy = -3);
      else if (a.time === "night") (vx = 2), (vy = -1);
      else (vx = 3), (vy = -9);
      const span = W + 80,
        spanY = H + 80;
      let x = p.x * span + t * vx * p.sp * p.z - d.fx * d.k * par + Math.sin(t * 0.6 + p.ph) * 14;
      let y = p.y * spanY + t * vy * p.sp * p.z + (d.fy - d.refY) * d.k * par * 0.6 + Math.cos(t * 0.5 + p.ph) * 10;
      x = (((x % span) + span) % span) - 40;
      y = (((y % spanY) + spanY) % spanY) - 40;
      const firefly = a.time === "dusk" || a.time === "night";
      const blink = firefly ? Math.max(0, Math.sin(t * 1.3 * p.sp + p.ph)) ** 2 : 0.6 + 0.4 * Math.sin(t * 2 + p.ph);
      const size = (firefly ? 7 : 4) * p.z * (front ? 1.6 : 1);
      c.globalAlpha = clamp(blink * (front ? 0.35 : 0.75));
      c.drawImage(dot, (x - size) * dpr, (y - size) * dpr, size * 2 * dpr, size * 2 * dpr);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    if (!front && !a.night && a.time !== "dusk") this.birds(d);
  }

  private birds(d: Draw) {
    const c = d.c;
    const W = d.w,
      H = d.h,
      dpr = d.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.strokeStyle = rgba(this.art.ink, 0.5);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let f = 0; f < 2; f++) {
      const period = 38 + f * 17;
      const u = ((d.clock + f * 21) % period) / period;
      const fx = -100 + u * (W + 200) - d.fx * d.k * 0.05;
      const fy = H * (0.18 + f * 0.1) + Math.sin(u * 9 + f) * 12;
      for (let b = 0; b < 4 + f; b++) {
        const bx = fx - b * 16 + Math.sin(b * 7.1) * 6,
          by = fy + b * 7 + Math.cos(b * 3.3) * 4;
        const flap = Math.sin(d.clock * 9 + b * 1.3) * 3;
        c.moveTo(bx - 5, by - flap);
        c.quadraticCurveTo(bx - 2, by - 3, bx, by);
        c.quadraticCurveTo(bx + 2, by - 3, bx + 5, by - flap);
      }
    }
    c.stroke();
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Foreground: the nearest sea row, occasional wisps, near particles. */
  drawFront(d: Draw) {
    const c = d.c;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.wisp && !d.low) {
      const W = d.w,
        dpr = d.dpr;
      const ww = d.h * 1.2;
      const spacing = 34;
      // Wisps drift slowly; express the drift in world units so the visible window follows it.
      const drift = (d.clock * 8) / (d.k * 1.35);
      const base = Math.floor((d.fx - drift) / spacing);
      for (let k = base - 1; k <= base + 2; k++) {
        const wx = k * spacing + noise1(k) * 12 + drift;
        const sx = W / 2 + (wx - d.fx) * d.k * 1.35;
        const sy = d.h * (0.82 + noise1(k + 9) * 0.12) + (d.fy - d.refY) * d.k * 0.5;
        if (sx + ww < 0 || sx - ww > W) continue;
        c.globalAlpha = 0.55;
        c.drawImage(this.wisp, (sx - ww / 2) * dpr, (sy - d.h * 0.125) * dpr, ww * dpr, d.h * 0.25 * dpr);
      }
      c.globalAlpha = 1;
    }
    this.ambientLayer(d, true);
  }

  /** Static artwork for tests. */
  get ready() {
    return !!this.sky;
  }
}
