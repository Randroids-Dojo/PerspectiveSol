import type { Art } from "./art";
import { Rng, makeCanvas, mix, rgba, rgbOf } from "./util";

/**
 * Paper grain, watercolour mottling, fibres and a printed vignette, baked into
 * one screen-sized bitmap and laid over the finished frame in a single blit.
 */
export class Paper {
  private canvas: HTMLCanvasElement | null = null;
  private key = "";
  bytes = 0;

  constructor(private art: Art) {}

  ensure(w: number, h: number, dpr: number, low: boolean) {
    const scale = low ? Math.min(dpr, 1) : dpr;
    const key = `${w}x${h}@${scale}`;
    if (key === this.key) return;
    this.key = key;
    const a = this.art;
    const W = Math.ceil(w * scale),
      H = Math.ceil(h * scale);
    const { canvas, ctx: c } = makeCanvas(W, H);
    const r = new Rng(a.seed * 31 + 7);

    // Fine grain tile with both dark and light specks.
    const tile = makeCanvas(256, 256);
    const img = tile.ctx.createImageData(256, 256);
    const ink = rgbOf(a.ink),
      paper = rgbOf("#fff8e8");
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r.next();
      const dark = v < 0.5;
      const col = dark ? ink : paper;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = Math.round((dark ? 0.5 - v : v - 0.5) * 2 * (a.night ? 13 : 16));
    }
    tile.ctx.putImageData(img, 0, 0);
    const pat = c.createPattern(tile.canvas, "repeat");
    if (pat) {
      c.fillStyle = pat;
      c.fillRect(0, 0, W, H);
    }

    // Watercolour mottling: low frequency blotches.
    const blot = makeCanvas(48, 28);
    for (let k = 0; k < 160; k++) {
      blot.ctx.beginPath();
      blot.ctx.arc(r.next() * 48, r.next() * 28, r.range(1, 4), 0, Math.PI * 2);
      blot.ctx.fillStyle = r.chance(0.4) ? rgba(mix(a.ink, "#8a6a3a", 0.5), 0.06) : rgba("#fff6e0", 0.12);
      blot.ctx.fill();
    }
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.globalAlpha = a.night ? 0.3 : 0.35;
    c.drawImage(blot.canvas, 0, 0, W, H);
    c.globalAlpha = 1;

    // Fibres.
    c.lineCap = "round";
    for (let k = 0; k < (low ? 120 : 320); k++) {
      const x = r.next() * W,
        y = r.next() * H;
      const len = r.range(6, 22) * scale;
      const an = r.range(0, Math.PI * 2);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(an + 0.6) * len * 0.5, y + Math.sin(an + 0.6) * len * 0.5, x + Math.cos(an) * len, y + Math.sin(an) * len);
      c.strokeStyle = r.chance(0.5) ? rgba(a.ink, 0.05) : rgba("#fffaf0", 0.08);
      c.lineWidth = 0.7 * scale;
      c.stroke();
    }

    // Printed vignette and warm corners.
    const vg = c.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
    const edge = a.night ? "#02060f" : mix(a.ink, "#5a3a18", 0.55);
    vg.addColorStop(0, rgba(edge, 0));
    vg.addColorStop(0.75, rgba(edge, a.night ? 0.18 : 0.07));
    vg.addColorStop(1, rgba(edge, a.night ? 0.42 : 0.22));
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);
    // A fine printed border line, like a plate in a book.
    const inset = 10 * scale;
    c.strokeStyle = rgba(a.night ? "#e8d9a8" : a.goldDark, 0.22);
    c.lineWidth = 1 * scale;
    c.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    c.strokeStyle = rgba(a.night ? "#e8d9a8" : a.goldDark, 0.12);
    c.strokeRect(inset + 4 * scale, inset + 4 * scale, W - (inset + 4 * scale) * 2, H - (inset + 4 * scale) * 2);

    this.canvas = canvas;
    this.bytes = W * H * 4;
  }

  draw(c: CanvasRenderingContext2D, w: number, h: number, dpr: number) {
    if (!this.canvas) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.canvas, 0, 0, Math.round(w * dpr), Math.round(h * dpr));
  }
}
