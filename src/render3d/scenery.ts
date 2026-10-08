import type { IslandStyle, Level } from "../sim/types";
import { Buckets } from "./geo";
import { type Ctx, buildIsland } from "./islands";
import { cypress, dome, landmark } from "./props";
import { Rng } from "./util";

/**
 * Background islands that give the chapter scale: a middle distance of lit,
 * dressed islands behind the play lane and a far ring of silhouettes that
 * melt into the atmosphere. They live in the backdrop and never flatten.
 */
export function buildScenery(level: Level, ctx: Ctx, far: boolean, quality: number) {
  const b = new Buckets();
  const r = new Rng(level.theme.seed * 31337 + 7);
  const ys = level.islands.map((i) => i.y);
  const midY = ys.reduce((a, v) => a + v, 0) / Math.max(1, ys.length);
  const x0 = level.bounds.x0 - 30,
    x1 = level.bounds.x1 + 30;
  const styles: IslandStyle[] =
    ctx.time === "morning" ? ["garden", "garden", "ruin"] : ctx.time === "noon" ? ["stone", "garden", "stone"] : ctx.time === "afternoon" ? ["stone", "garden", "ruin"] : ctx.time === "dusk" ? ["ruin", "stone", "garden"] : ctx.time === "night" ? ["stone", "ruin", "garden"] : ["stone", "garden", "stone"];
  const sub: Ctx = { ...ctx, scatter: null, detail: ctx.detail * 0.6 };
  if (!far) {
    // Middle distance.
    let x = x0 + r.range(0, 10);
    while (x < x1) {
      const w = r.range(5, 12),
        d = r.range(4, 8);
      const z = r.range(-36, -18);
      const y = midY + r.range(-10, -1) + (z < -28 ? r.range(0, 3) : 0);
      const s = { id: "bg", x, y, z, w, d, h: r.range(1, 2), style: r.pick(styles) };
      buildIsland(b, s, r, sub, { depth: r.range(4, 9) });
      landmark(b, s, r, sub);
      x += w + r.range(8, 22) / Math.max(0.5, quality);
    }
  } else {
    // Far silhouettes.
    let x = x0 - 60;
    while (x < x1 + 60) {
      const w = r.range(14, 34),
        d = r.range(10, 20);
      const z = r.range(-150, -70);
      const y = midY + r.range(-14, 14);
      const s = { id: "far", x, y, z, w, d, h: 3, style: r.pick(styles) };
      buildIsland(b, s, r, sub, { far: true, depth: r.range(10, 24) });
      if (r.chance(0.55)) dome(b, x + r.range(-0.2, 0.2) * w, y, z, r.range(2.5, 5), sub, ctx.time === "dusk" || ctx.time === "night");
      else for (let i = 0; i < 4; i++) cypress(b, r, x + r.range(-0.4, 0.4) * w, y, z + r.range(-0.3, 0.3) * d, r.range(4, 8), sub);
      x += w + r.range(20, 50);
    }
    // The grand observatory looms in the last chapter.
    if (ctx.time === "dawn") {
      const gx = (level.bounds.x0 + level.bounds.x1) / 2 + 40;
      const s = { id: "grand", x: gx, y: midY + 6, z: -95, w: 40, d: 24, h: 3, style: "stone" as IslandStyle };
      buildIsland(b, s, r, sub, { far: true, depth: 26 });
      dome(b, gx, midY + 6, -98, 9, sub, true);
      dome(b, gx - 14, midY + 6, -92, 4, sub, true);
      dome(b, gx + 13, midY + 6, -93, 3.5, sub, true);
    }
  }
  return b;
}
