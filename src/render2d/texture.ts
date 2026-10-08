import { Rng, makeCanvas, type Ctx } from "./util";

/**
 * A watercolour texture tile: soft pigment blooms, granulation and a few dry
 * brush streaks, as semi-transparent darks and lights. Laid over painted
 * bitmaps with source-atop so it only touches existing paint.
 */
let tile: HTMLCanvasElement | null = null;

function makeTile() {
  const size = 256;
  const { canvas, ctx: c } = makeCanvas(size, size);
  const r = new Rng(4242);
  // Blooms: painted small, scaled up for softness.
  const low = makeCanvas(32, 32);
  for (let k = 0; k < 70; k++) {
    low.ctx.beginPath();
    low.ctx.arc(r.next() * 32, r.next() * 32, r.range(1.5, 5), 0, Math.PI * 2);
    low.ctx.fillStyle = r.chance(0.45) ? `rgba(40,30,50,${r.range(0.03, 0.07)})` : `rgba(255,250,235,${r.range(0.05, 0.11)})`;
    low.ctx.fill();
  }
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  // Draw tiled 3x3 so the bloom layer wraps seamlessly.
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) c.drawImage(low.canvas, dx * size, dy * size, size, size);
  // Granulation.
  const img = c.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r.next();
    if (v < 0.035) {
      img.data[i] = img.data[i + 1] = 40;
      img.data[i + 2] = 50;
      img.data[i + 3] = Math.max(img.data[i + 3], 10 + Math.round(v * 200));
    } else if (v > 0.94) {
      img.data[i] = img.data[i + 1] = 255;
      img.data[i + 2] = 245;
      img.data[i + 3] = Math.max(img.data[i + 3], 12);
    }
  }
  c.putImageData(img, 0, 0);
  // Dry brush streaks.
  c.lineCap = "round";
  for (let k = 0; k < 18; k++) {
    const y = r.next() * size,
      x = r.next() * size;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + 30, y + r.range(-4, 4), x + r.range(40, 90), y + r.range(-6, 6));
    c.strokeStyle = r.chance(0.5) ? "rgba(255,250,235,0.08)" : "rgba(20,20,40,0.05)";
    c.lineWidth = r.range(1, 3);
    c.stroke();
  }
  return canvas;
}

/** Texture everything already painted on a canvas. scale ~ device pixels per unit / 60. */
export function texturize(c: Ctx, canvas: HTMLCanvasElement, scale: number, strength = 1) {
  if (!tile) tile = makeTile();
  const pat = c.createPattern(tile, "repeat");
  if (!pat) return;
  pat.setTransform(new DOMMatrix().scale(Math.max(0.5, scale)));
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-atop";
  c.globalAlpha = strength;
  c.fillStyle = pat;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.restore();
}
