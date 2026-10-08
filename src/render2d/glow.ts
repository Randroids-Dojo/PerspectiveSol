import type { Draw } from "./draw";
import { sx, sy } from "./draw";
import { makeCanvas, rgba } from "./util";

/** Soft round glow bitmaps, cached per colour. Drawn scaled, usually additively. */
const cache = new Map<string, HTMLCanvasElement>();

export function glow(color: string): HTMLCanvasElement {
  let s = cache.get(color);
  if (s) return s;
  const size = 128;
  const { canvas, ctx: c } = makeCanvas(size, size);
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba(color, 1));
  g.addColorStop(0.12, rgba(color, 0.78));
  g.addColorStop(0.3, rgba(color, 0.4));
  g.addColorStop(0.55, rgba(color, 0.14));
  g.addColorStop(0.8, rgba(color, 0.035));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  cache.set(color, canvas);
  return canvas;
}

/** Draw a glow of radius r world units centred on world (x, y). */
export function glowAt(d: Draw, color: string, x: number, y: number, r: number, alpha: number, additive = true, sxScale = 1) {
  if (alpha <= 0.003) return;
  const c = d.c;
  const px = sx(d, x),
    py = sy(d, y);
  const rr = r * d.S;
  c.globalAlpha = Math.min(1, alpha);
  if (additive) c.globalCompositeOperation = "lighter";
  c.drawImage(glow(color), px - rr * sxScale, py - rr, rr * 2 * sxScale, rr * 2);
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
}
