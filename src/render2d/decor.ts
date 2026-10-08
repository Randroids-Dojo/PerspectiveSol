import type { Art } from "./art";
import { mix, rgba, Rng, TAU, leafPath, taper, type Ctx } from "./util";

/**
 * Scenery that stands on island tops, behind the walkway. All painters draw in
 * world units with the origin at the base centre and up being negative y.
 * They never touch collision: they are set dressing only.
 */
export type DecoKind =
  | "cypress"
  | "olive"
  | "shrub"
  | "pergola"
  | "column"
  | "brokenColumn"
  | "arcade"
  | "urn"
  | "citrus"
  | "fountain"
  | "obelisk"
  | "shelf"
  | "books"
  | "banner"
  | "crystals"
  | "telescope"
  | "kiosk"
  | "armillary"
  | "gearTower"
  | "willow";

/** Approximate height (units, at scale 1) and half width, for cache bounds and spacing. */
export const DECO_SIZE: Record<DecoKind, [number, number]> = {
  cypress: [3.5, 0.45],
  olive: [2.7, 1.25],
  shrub: [0.9, 0.7],
  pergola: [2.3, 1.2],
  column: [2.5, 0.3],
  brokenColumn: [1.6, 0.6],
  arcade: [2.8, 1.0],
  urn: [1.3, 0.4],
  citrus: [1.8, 0.65],
  fountain: [1.5, 0.8],
  obelisk: [2.9, 0.3],
  shelf: [1.9, 0.6],
  books: [0.6, 0.45],
  banner: [2.5, 0.5],
  crystals: [1.3, 0.55],
  telescope: [1.7, 0.7],
  kiosk: [2.6, 0.85],
  armillary: [1.6, 0.5],
  gearTower: [2.4, 0.8],
  willow: [2.7, 1.3],
};

export type GearSpec = { x: number; y: number; r: number; teeth: number; speed: number; tone: number };

type Kit = Partial<Record<"garden" | "stone" | "ruin" | "bridge" | "plinth", [DecoKind, number][]>>;

export const KITS: Record<Art["time"], Kit> = {
  morning: {
    garden: [["cypress", 3], ["olive", 3], ["shrub", 3], ["pergola", 1.2]],
    stone: [["column", 2], ["urn", 2], ["cypress", 1.5], ["arcade", 1]],
    ruin: [["brokenColumn", 3], ["shrub", 2], ["pergola", 1.5], ["olive", 1]],
    plinth: [["shrub", 1]],
  },
  noon: {
    garden: [["citrus", 3], ["cypress", 2.5], ["shrub", 1.5], ["fountain", 1.2]],
    stone: [["arcade", 2], ["column", 1.5], ["urn", 2], ["obelisk", 1], ["fountain", 1.5], ["citrus", 1]],
    ruin: [["brokenColumn", 3], ["arcade", 1.2], ["urn", 1]],
    plinth: [["urn", 1]],
  },
  afternoon: {
    garden: [["olive", 2], ["shrub", 2], ["gearTower", 1.5], ["cypress", 1]],
    stone: [["gearTower", 3], ["obelisk", 1], ["column", 1], ["telescope", 0.6]],
    ruin: [["brokenColumn", 2], ["gearTower", 1.5], ["shrub", 1]],
    plinth: [["gearTower", 1]],
  },
  dusk: {
    garden: [["willow", 3], ["shrub", 2], ["books", 0.6]],
    stone: [["shelf", 3], ["banner", 2], ["column", 1], ["books", 1]],
    ruin: [["shelf", 1.2], ["books", 2], ["brokenColumn", 2], ["banner", 1]],
    plinth: [["books", 1]],
  },
  night: {
    garden: [["cypress", 3], ["shrub", 2], ["crystals", 1]],
    stone: [["crystals", 2], ["obelisk", 2], ["column", 1], ["telescope", 0.8]],
    ruin: [["brokenColumn", 2], ["crystals", 2], ["shrub", 1]],
    plinth: [["crystals", 1]],
  },
  dawn: {
    garden: [["olive", 2], ["cypress", 2], ["shrub", 1.5], ["armillary", 0.8]],
    stone: [["telescope", 2], ["kiosk", 2], ["armillary", 2], ["column", 1]],
    ruin: [["brokenColumn", 2], ["telescope", 1], ["shrub", 1]],
    plinth: [["armillary", 1]],
  },
};

export function pickKind(r: Rng, list: [DecoKind, number][]): DecoKind {
  let total = 0;
  for (const [, w] of list) total += w;
  let v = r.next() * total;
  for (const [k, w] of list) {
    v -= w;
    if (v <= 0) return k;
  }
  return list[0][0];
}

/** Paint a decoration. Returns gears that should turn at runtime (local units). */
export function paintDeco(c: Ctx, kind: DecoKind, art: Art, r: Rng, s: number, flip: number): GearSpec[] {
  c.save();
  c.scale(s * flip, s);
  c.lineJoin = "round";
  c.lineCap = "round";
  let gears: GearSpec[] = [];
  switch (kind) {
    case "cypress":
      cypress(c, art, r);
      break;
    case "olive":
      olive(c, art, r);
      break;
    case "shrub":
      shrub(c, art, r, 0, 0, r.range(0.75, 1.1));
      break;
    case "pergola":
      pergola(c, art, r);
      break;
    case "column":
      column(c, art, r, r.range(1.9, 2.5), false);
      break;
    case "brokenColumn":
      column(c, art, r, r.range(0.7, 1.5), true);
      break;
    case "arcade":
      arcade(c, art, r);
      break;
    case "urn":
      urn(c, art, r);
      break;
    case "citrus":
      citrus(c, art, r);
      break;
    case "fountain":
      fountain(c, art, r);
      break;
    case "obelisk":
      obelisk(c, art, r);
      break;
    case "shelf":
      shelf(c, art, r);
      break;
    case "books":
      books(c, art, r, 0, 0);
      break;
    case "banner":
      banner(c, art, r);
      break;
    case "crystals":
      crystals(c, art, r);
      break;
    case "telescope":
      telescope(c, art, r);
      break;
    case "kiosk":
      kiosk(c, art, r);
      break;
    case "armillary":
      armillary(c, art, r);
      break;
    case "gearTower":
      gears = gearTower(c, art, r);
      break;
    case "willow":
      willow(c, art, r);
      break;
  }
  c.restore();
  return gears.map((g) => ({ ...g, x: g.x * s * flip, y: g.y * s, r: g.r * s }));
}

// ---------------------------------------------------------------- helpers

const outlineW = 0.028;

/** Fill a set of blobs with an ink outline around their union. */
function blobs(c: Ctx, list: number[][], fill: string | CanvasGradient, ink: string, w = outlineW) {
  c.beginPath();
  for (const [x, y, rx, ry] of list) {
    c.moveTo(x + rx, y);
    c.ellipse(x, y, rx, ry, 0, 0, TAU);
  }
  c.lineWidth = w * 2;
  c.strokeStyle = ink;
  c.stroke();
  c.fillStyle = fill;
  c.fill();
}

function leafTicks(c: Ctx, r: Rng, cx: number, cy: number, rx: number, ry: number, n: number, color: string, len = 0.09, dir = -0.6) {
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = r.next() * TAU,
      d = Math.sqrt(r.next());
    const x = cx + Math.cos(a) * rx * d,
      y = cy + Math.sin(a) * ry * d;
    const ang = dir + r.range(-0.5, 0.5);
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
  }
  c.strokeStyle = color;
  c.lineWidth = 0.028;
  c.stroke();
}

function stoneGrad(c: Ctx, art: Art, x0: number, x1: number) {
  const g = c.createLinearGradient(x0, 0, x1, 0);
  const lit = art.light <= 0;
  g.addColorStop(0, lit ? art.stoneLit : art.stoneMid);
  g.addColorStop(0.5, art.stone);
  g.addColorStop(1, lit ? art.stoneMid : art.stoneLit);
  return g;
}

function goldGrad(c: Ctx, art: Art, x0: number, y0: number, x1: number, y1: number) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, art.goldLight);
  g.addColorStop(0.45, art.gold);
  g.addColorStop(1, art.goldDark);
  return g;
}

function bronzeGrad(c: Ctx, art: Art, x0: number, x1: number) {
  const g = c.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, art.bronzeLit);
  g.addColorStop(0.5, art.bronze);
  g.addColorStop(1, art.bronzeDark);
  return g;
}

function ink(c: Ctx, art: Art, w = outlineW) {
  c.strokeStyle = art.inkSoft;
  c.lineWidth = w;
  c.stroke();
}

function sunGlyph(c: Ctx, art: Art, x: number, y: number, r: number) {
  c.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    c.moveTo(x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2);
    c.lineTo(x + Math.cos(a) * r * (i % 2 ? 1.55 : 1.8), y + Math.sin(a) * r * (i % 2 ? 1.55 : 1.8));
  }
  c.strokeStyle = art.gold;
  c.lineWidth = r * 0.22;
  c.stroke();
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = goldGrad(c, art, x - r, y - r, x + r, y + r);
  c.fill();
  c.strokeStyle = art.goldDark;
  c.lineWidth = r * 0.15;
  c.stroke();
}

// --------------------------------------------------------------- painters

function cypress(c: Ctx, art: Art, r: Rng) {
  const H = r.range(2.4, 3.4),
    W = r.range(0.42, 0.58);
  c.fillStyle = art.bark;
  c.fillRect(-0.05, -0.32, 0.1, 0.32);
  const tip = r.range(-0.06, 0.06);
  const outline = () => {
    c.beginPath();
    c.moveTo(-W * 0.55, -0.25);
    c.bezierCurveTo(-W * 1.05, -H * 0.35, -W * 0.7, -H * 0.75, tip, -H);
    c.bezierCurveTo(W * 0.7, -H * 0.75, W * 1.05, -H * 0.35, W * 0.55, -0.25);
    c.quadraticCurveTo(0, -0.12, -W * 0.55, -0.25);
    c.closePath();
  };
  outline();
  c.lineWidth = outlineW * 2;
  c.strokeStyle = art.inkSoft;
  c.stroke();
  c.fillStyle = art.foliageDark;
  c.fill();
  c.save();
  outline();
  c.clip();
  // Layered flame tufts, lit on the sun side.
  const lit = art.light <= 0 ? -1 : 1;
  for (let i = 0; i < 16; i++) {
    const y = -0.35 - (i / 16) * (H - 0.4);
    const width = W * Math.sin(Math.PI * (0.1 + 0.9 * (1 - i / 16))) * 0.95;
    for (let j = -1; j <= 1; j++) {
      const x = j * width * 0.55 + r.range(-0.04, 0.04);
      c.beginPath();
      c.ellipse(x, y, width * 0.42, 0.16, j * 0.35, 0, TAU);
      c.fillStyle = j === lit ? art.foliageLit : j === 0 ? art.foliage : mix(art.foliage, art.foliageDark, 0.5);
      c.globalAlpha = 0.85;
      c.fill();
    }
  }
  c.globalAlpha = 1;
  leafTicks(c, r, lit * W * 0.3, -H * 0.5, W * 0.5, H * 0.45, 40, rgba(art.foliageLit, 0.7), 0.07, -1.9);
  c.restore();
}

function olive(c: Ctx, art: Art, r: Rng) {
  const H = r.range(2.0, 2.6);
  const silver = mix(art.foliage, "#c9cfae", art.night ? 0.12 : 0.32);
  // Gnarled trunk splitting into limbs.
  c.fillStyle = art.bark;
  c.beginPath();
  taper(c, [[0, 0], [0.08, -0.4], [-0.05, -0.8], [0.04, -1.15]], 0.26, 0.12);
  c.fill();
  c.beginPath();
  taper(c, [[0.02, -1.0], [-0.35, -1.35], [-0.55, -1.6]], 0.11, 0.04);
  taper(c, [[0.04, -1.05], [0.38, -1.4], [0.6, -1.55]], 0.1, 0.04);
  taper(c, [[0.03, -1.1], [0.05, -1.5], [-0.05, -1.8]], 0.08, 0.03);
  c.fill();
  c.strokeStyle = art.inkSoft;
  c.lineWidth = 0.02;
  c.beginPath();
  c.moveTo(0.04, -0.05);
  c.bezierCurveTo(0.1, -0.45, -0.02, -0.75, 0.02, -1.1);
  c.stroke();
  const list: number[][] = [];
  const n = r.int(5, 7);
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI;
    list.push([
      -Math.cos(a) * r.range(0.55, 0.85),
      -H + 0.5 - Math.sin(a) * r.range(0.25, 0.45) + r.range(-0.1, 0.1),
      r.range(0.38, 0.55),
      r.range(0.24, 0.34),
    ]);
  }
  list.push([0, -H + 0.45, 0.6, 0.36]);
  blobs(c, list, silver, art.inkSoft);
  // Lit crowns.
  const lx = art.light <= 0 ? -0.08 : 0.08;
  c.beginPath();
  for (const [x, y, rx, ry] of list) {
    c.moveTo(x + lx + rx * 0.7, y - ry * 0.25);
    c.ellipse(x + lx, y - ry * 0.25, rx * 0.7, ry * 0.6, 0, 0, TAU);
  }
  c.fillStyle = mix(silver, art.foliageLit, 0.5);
  c.fill();
  leafTicks(c, r, 0, -H + 0.45, 1.1, 0.45, 70, rgba(mix(silver, "#ffffff", 0.35), 0.75), 0.08, -0.4);
  leafTicks(c, r, 0, -H + 0.6, 1.0, 0.35, 30, rgba(art.foliageDark, 0.6), 0.07, 0.4);
}

export function shrub(c: Ctx, art: Art, r: Rng, x: number, y: number, s: number) {
  const list: number[][] = [];
  const n = r.int(3, 5);
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1) - 0.5;
    list.push([x + u * 0.8 * s, y - (0.26 + (0.5 - Math.abs(u)) * 0.3) * s, r.range(0.22, 0.32) * s, r.range(0.2, 0.28) * s]);
  }
  blobs(c, list, art.foliage, art.inkSoft);
  c.beginPath();
  const lx = art.light <= 0 ? -0.05 : 0.05;
  for (const [bx, by, rx, ry] of list) {
    c.moveTo(bx + lx + rx * 0.65, by - ry * 0.3);
    c.ellipse(bx + lx, by - ry * 0.3, rx * 0.65, ry * 0.55, 0, 0, TAU);
  }
  c.fillStyle = art.foliageLit;
  c.globalAlpha = 0.75;
  c.fill();
  c.globalAlpha = 1;
  leafTicks(c, r, x, y - 0.35 * s, 0.45 * s, 0.22 * s, 18, rgba(art.foliageDark, 0.55), 0.06);
  if (r.chance(0.6)) {
    const col = r.pick(art.flowers);
    for (let i = 0; i < 6; i++) {
      const fx = x + r.range(-0.4, 0.4) * s,
        fy = y - r.range(0.2, 0.6) * s;
      c.beginPath();
      c.arc(fx, fy, 0.045 * s, 0, TAU);
      c.fillStyle = col;
      c.fill();
    }
  }
}

function pergola(c: Ctx, art: Art, r: Rng) {
  const broken = r.chance(0.55);
  const H = 2.0;
  const posts = [-0.95, 0.95];
  posts.forEach((px, i) => {
    const h = broken && i === 1 ? 1.25 : H;
    c.beginPath();
    c.rect(px - 0.1, -h, 0.2, h);
    c.fillStyle = stoneGrad(c, art, px - 0.1, px + 0.1);
    c.fill();
    ink(c, art);
    c.fillStyle = art.stoneLit;
    c.fillRect(px - 0.15, -h - 0.08, 0.3, 0.1);
    c.strokeRect(px - 0.15, -h - 0.08, 0.3, 0.1);
    if (broken && i === 1) {
      c.beginPath();
      c.moveTo(px - 0.1, -h);
      c.lineTo(px - 0.03, -h - 0.12);
      c.lineTo(px + 0.04, -h - 0.04);
      c.lineTo(px + 0.1, -h - 0.15);
      c.stroke();
    }
  });
  // Beam (tilted when broken).
  c.save();
  if (broken) {
    c.translate(-0.95, -H);
    c.rotate(0.38);
    c.translate(0.95, H);
  }
  c.beginPath();
  c.rect(-1.25, -H - 0.2, 2.4, 0.13);
  c.fillStyle = art.bark;
  c.fill();
  ink(c, art);
  for (let x = -1.1; x < 1.1; x += 0.36) {
    c.beginPath();
    c.rect(x, -H - 0.26, 0.07, 0.24);
    c.fillStyle = mix(art.bark, art.stoneMid, 0.3);
    c.fill();
    ink(c, art, 0.015);
  }
  c.restore();
  // Vines climbing and draping, with blossoms.
  const vine = (pts: number[][]) => {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.strokeStyle = art.foliageDark;
    c.lineWidth = 0.03;
    c.stroke();
    for (let i = 0; i < pts.length - 1; i++)
      for (let j = 0; j < 3; j++) {
        const t = j / 3;
        const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
          y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
        c.beginPath();
        leafPath(c, x, y, 0.14, r.range(0, TAU));
        c.fillStyle = r.chance(0.5) ? art.foliage : art.foliageLit;
        c.fill();
      }
  };
  vine([[-0.95, 0], [-0.88, -0.6], [-1.0, -1.2], [-0.9, -1.9], [-0.4, -2.05], [0.1, -1.95]]);
  if (!broken) vine([[0.95, 0], [1.0, -0.7], [0.88, -1.4], [0.95, -2.0], [0.5, -2.1]]);
  const col = r.pick(art.flowers);
  for (let i = 0; i < 9; i++) {
    c.beginPath();
    c.arc(r.range(-1.0, broken ? 0.2 : 1.0), -r.range(1.7, 2.15), 0.05, 0, TAU);
    c.fillStyle = col;
    c.fill();
  }
}

function capital(c: Ctx, art: Art, x: number, y: number, w: number) {
  c.beginPath();
  c.rect(x - w / 2, y - 0.1, w, 0.1);
  c.fillStyle = art.stoneLit;
  c.fill();
  ink(c, art, 0.02);
  for (const s of [-1, 1]) {
    c.beginPath();
    c.arc(x + (s * w) / 2 - s * 0.05, y - 0.02, 0.055, 0, TAU);
    c.fillStyle = art.stone;
    c.fill();
    ink(c, art, 0.018);
  }
  c.beginPath();
  c.moveTo(x - w / 2 + 0.06, y - 0.05);
  c.lineTo(x + w / 2 - 0.06, y - 0.05);
  c.strokeStyle = art.gold;
  c.lineWidth = 0.022;
  c.stroke();
}

function column(c: Ctx, art: Art, r: Rng, H: number, broken: boolean) {
  const w = 0.28;
  c.beginPath();
  c.rect(-0.2, -0.12, 0.4, 0.12);
  c.fillStyle = art.stoneMid;
  c.fill();
  ink(c, art, 0.02);
  c.beginPath();
  if (broken) {
    c.moveTo(-w / 2, -0.12);
    c.lineTo(-w / 2, -H);
    const steps = 5;
    for (let i = 1; i <= steps; i++) c.lineTo(-w / 2 + (w * i) / steps, -H + (i % 2 ? 0.12 : -0.05) + r.range(-0.05, 0.08) + (i / steps) * 0.18);
    c.lineTo(w / 2, -0.12);
  } else c.rect(-w / 2, -H, w, H - 0.12);
  c.closePath();
  c.fillStyle = stoneGrad(c, art, -w / 2, w / 2);
  c.fill();
  ink(c, art);
  // Flutes.
  c.save();
  c.clip();
  c.beginPath();
  for (let x = -w / 2 + 0.06; x < w / 2; x += 0.06) {
    c.moveTo(x, -0.14);
    c.lineTo(x, -H - 0.2);
  }
  c.strokeStyle = rgba(art.stoneDark, 0.45);
  c.lineWidth = 0.012;
  c.stroke();
  c.restore();
  if (!broken) capital(c, art, 0, -H, 0.46);
  else {
    // Ivy and a fallen drum.
    c.beginPath();
    c.moveTo(-0.14, -0.1);
    c.bezierCurveTo(0.1, -0.4, -0.18, -0.6, 0.06, -H * 0.85);
    c.strokeStyle = art.foliageDark;
    c.lineWidth = 0.025;
    c.stroke();
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      leafPath(c, r.range(-0.16, 0.12), -0.15 - (i / 7) * H * 0.75, 0.12, r.range(0, TAU));
      c.fillStyle = i % 2 ? art.foliage : art.foliageLit;
      c.fill();
    }
    if (r.chance(0.7)) {
      const dx = r.sign() * r.range(0.45, 0.6);
      c.beginPath();
      c.ellipse(dx, -0.13, 0.25, 0.13, 0, 0, TAU);
      c.fillStyle = art.stone;
      c.fill();
      ink(c, art, 0.02);
      c.beginPath();
      c.ellipse(dx + 0.17, -0.13, 0.07, 0.12, 0, 0, TAU);
      c.fillStyle = art.stoneLit;
      c.fill();
      ink(c, art, 0.015);
    }
  }
}

function arcade(c: Ctx, art: Art, r: Rng) {
  const H = 1.8,
    span = 0.8;
  for (const s of [-1, 1]) {
    c.save();
    c.translate(s * span, 0);
    column(c, art, r, H, false);
    c.restore();
  }
  // Arch with voussoirs and a gold keystone.
  const top = -H - 0.1;
  c.beginPath();
  c.moveTo(-span - 0.24, top);
  c.lineTo(-span - 0.24, top - 0.95);
  c.lineTo(span + 0.24, top - 0.95);
  c.lineTo(span + 0.24, top);
  c.lineTo(span - 0.16, top);
  c.arc(0, top, span - 0.16, 0, Math.PI, true);
  c.closePath();
  c.fillStyle = stoneGrad(c, art, -span, span);
  c.fill();
  ink(c, art);
  c.beginPath();
  for (let i = 1; i < 9; i++) {
    const a = Math.PI + (i / 9) * Math.PI;
    c.moveTo(Math.cos(a) * (span - 0.16), top + Math.sin(a) * (span - 0.16));
    c.lineTo(Math.cos(a) * (span + 0.08), top + Math.sin(a) * (span + 0.08));
  }
  c.strokeStyle = rgba(art.stoneDark, 0.6);
  c.lineWidth = 0.014;
  c.stroke();
  c.beginPath();
  c.moveTo(-0.08, top - span + 0.12);
  c.lineTo(0.08, top - span + 0.12);
  c.lineTo(0.1, top - span - 0.12);
  c.lineTo(-0.1, top - span - 0.12);
  c.closePath();
  c.fillStyle = goldGrad(c, art, -0.1, top - span, 0.1, top - span + 0.1);
  c.fill();
  ink(c, art, 0.015);
  c.beginPath();
  c.moveTo(-span - 0.28, top - 0.95);
  c.lineTo(span + 0.28, top - 0.95);
  c.lineWidth = 0.06;
  c.strokeStyle = art.stoneLit;
  c.stroke();
  c.beginPath();
  c.moveTo(-span - 0.24, top - 0.88);
  c.lineTo(span + 0.24, top - 0.88);
  c.strokeStyle = art.gold;
  c.lineWidth = 0.02;
  c.stroke();
}

function urn(c: Ctx, art: Art, r: Rng) {
  const tone = r.chance(0.5) ? mix(art.stone, art.stoneLit, 0.5) : mix(mix("#c97b4a", art.p.accent, 0.3), art.stoneMid, 0.25);
  c.beginPath();
  c.moveTo(-0.12, 0);
  c.lineTo(0.12, 0);
  c.lineTo(0.09, -0.08);
  c.bezierCurveTo(0.34, -0.2, 0.32, -0.5, 0.16, -0.62);
  c.lineTo(0.2, -0.68);
  c.lineTo(-0.2, -0.68);
  c.lineTo(-0.16, -0.62);
  c.bezierCurveTo(-0.32, -0.5, -0.34, -0.2, -0.09, -0.08);
  c.closePath();
  const g = c.createLinearGradient(-0.3, 0, 0.3, 0);
  g.addColorStop(0, art.light <= 0 ? mix(tone, "#ffffff", 0.3) : mix(tone, art.ink, 0.25));
  g.addColorStop(0.5, tone);
  g.addColorStop(1, art.light <= 0 ? mix(tone, art.ink, 0.25) : mix(tone, "#ffffff", 0.3));
  c.fillStyle = g;
  c.fill();
  ink(c, art);
  c.beginPath();
  c.moveTo(-0.27, -0.36);
  c.lineTo(0.27, -0.36);
  c.strokeStyle = art.gold;
  c.lineWidth = 0.025;
  c.stroke();
  shrub(c, art, r, 0, -0.62, 0.7);
}

function citrus(c: Ctx, art: Art, r: Rng) {
  const pot = mix("#c56f45", art.p.accent, 0.35);
  c.beginPath();
  c.moveTo(-0.26, -0.5);
  c.lineTo(0.26, -0.5);
  c.lineTo(0.2, 0);
  c.lineTo(-0.2, 0);
  c.closePath();
  c.fillStyle = pot;
  c.fill();
  ink(c, art);
  c.fillStyle = mix(pot, "#ffffff", 0.25);
  c.fillRect(-0.3, -0.56, 0.6, 0.09);
  c.strokeRect(-0.3, -0.56, 0.6, 0.09);
  c.beginPath();
  c.moveTo(-0.2, -0.28);
  c.lineTo(0.2, -0.28);
  c.strokeStyle = art.gold;
  c.lineWidth = 0.02;
  c.stroke();
  c.fillStyle = art.bark;
  c.fillRect(-0.035, -1.05, 0.07, 0.5);
  const list: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    list.push([Math.cos(a) * 0.32, -1.3 + Math.sin(a) * 0.22, 0.26, 0.22]);
  }
  list.push([0, -1.3, 0.34, 0.3]);
  blobs(c, list, art.foliage, art.inkSoft);
  leafTicks(c, r, 0, -1.3, 0.5, 0.35, 34, rgba(art.foliageLit, 0.8), 0.07);
  for (let i = 0; i < 9; i++) {
    const a = r.next() * TAU,
      d = Math.sqrt(r.next()) * 0.45;
    c.beginPath();
    c.arc(Math.cos(a) * d, -1.3 + Math.sin(a) * d * 0.7, 0.055, 0, TAU);
    c.fillStyle = r.chance(0.6) ? "#f2a33a" : "#f6d24a";
    c.fill();
    c.strokeStyle = art.inkSoft;
    c.lineWidth = 0.012;
    c.stroke();
  }
}

function fountain(c: Ctx, art: Art, _r: Rng) {
  // Pedestal, basin, spout, and arcs of water.
  c.beginPath();
  c.moveTo(-0.14, 0);
  c.lineTo(0.14, 0);
  c.lineTo(0.08, -0.45);
  c.lineTo(-0.08, -0.45);
  c.closePath();
  c.fillStyle = stoneGrad(c, art, -0.14, 0.14);
  c.fill();
  ink(c, art);
  c.beginPath();
  c.moveTo(-0.75, -0.62);
  c.quadraticCurveTo(0, -0.2, 0.75, -0.62);
  c.lineTo(0.7, -0.7);
  c.lineTo(-0.7, -0.7);
  c.closePath();
  c.fillStyle = art.stone;
  c.fill();
  ink(c, art);
  c.beginPath();
  c.moveTo(-0.62, -0.62);
  c.lineTo(0.62, -0.62);
  c.strokeStyle = art.gold;
  c.lineWidth = 0.02;
  c.stroke();
  c.fillStyle = art.stoneLit;
  c.fillRect(-0.05, -1.25, 0.1, 0.55);
  c.beginPath();
  c.arc(0, -1.3, 0.09, 0, TAU);
  c.fillStyle = goldGrad(c, art, -0.09, -1.39, 0.09, -1.21);
  c.fill();
  const water = mix("#bfe6f2", art.p.skyHorizon, 0.3);
  c.strokeStyle = rgba(water, 0.85);
  c.lineWidth = 0.035;
  for (const s of [-1, 1])
    for (let j = 0; j < 2; j++) {
      c.beginPath();
      c.moveTo(0, -1.36);
      c.quadraticCurveTo(s * (0.3 + j * 0.15), -1.75 + j * 0.1, s * (0.5 + j * 0.15), -0.72);
      c.stroke();
    }
  c.fillStyle = rgba(water, 0.7);
  c.fillRect(-0.6, -0.74, 1.2, 0.05);
}

function obelisk(c: Ctx, art: Art, r: Rng) {
  const H = r.range(2.2, 2.8);
  c.beginPath();
  c.rect(-0.28, -0.18, 0.56, 0.18);
  c.fillStyle = art.stoneMid;
  c.fill();
  ink(c, art, 0.02);
  c.beginPath();
  c.moveTo(-0.18, -0.18);
  c.lineTo(-0.12, -H);
  c.lineTo(0, -H - 0.25);
  c.lineTo(0.12, -H);
  c.lineTo(0.18, -0.18);
  c.closePath();
  c.fillStyle = stoneGrad(c, art, -0.18, 0.18);
  c.fill();
  ink(c, art);
  c.beginPath();
  c.moveTo(-0.12, -H);
  c.lineTo(0, -H - 0.25);
  c.lineTo(0.12, -H);
  c.closePath();
  c.fillStyle = goldGrad(c, art, -0.12, -H - 0.25, 0.12, -H);
  c.fill();
  sunGlyph(c, art, 0, -H + 0.45, 0.08);
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const y = -H + 0.85 + i * 0.22;
    c.moveTo(-0.06, y);
    c.lineTo(0.06, y);
  }
  c.strokeStyle = rgba(art.gold, 0.8);
  c.lineWidth = 0.018;
  c.stroke();
}

const BOOKS = ["#4b3f8f", "#2f5f73", "#8a6a2c", "#5a3e6b", "#3f6a52", "#b88a3a", "#6c4a3a", "#7a5fb0"];

export function books(c: Ctx, art: Art, r: Rng, x: number, y: number) {
  let yy = y;
  const n = r.int(3, 5);
  for (let i = 0; i < n; i++) {
    const w = r.range(0.45, 0.7),
      h = r.range(0.07, 0.11);
    const ox = x + r.range(-0.08, 0.08);
    c.beginPath();
    c.rect(ox - w / 2, yy - h, w, h);
    c.fillStyle = mix(r.pick(BOOKS), art.p.fog, 0.1);
    c.fill();
    ink(c, art, 0.015);
    c.fillStyle = art.ivory;
    c.fillRect(ox + w / 2 - 0.05, yy - h + 0.015, 0.04, h - 0.03);
    yy -= h;
  }
  if (r.chance(0.6)) {
    c.beginPath();
    c.ellipse(x + 0.05, yy - 0.06, 0.3, 0.06, 0, 0, TAU);
    c.fillStyle = art.ivory;
    c.fill();
    ink(c, art, 0.015);
    c.beginPath();
    c.arc(x + 0.35, yy - 0.06, 0.06, 0, TAU);
    c.fillStyle = art.paperShade;
    c.fill();
    ink(c, art, 0.015);
  }
}

function shelf(c: Ctx, art: Art, r: Rng) {
  const W = 0.55,
    H = 1.75;
  c.beginPath();
  c.rect(-W, -H, W * 2, H);
  c.fillStyle = art.stoneDeep;
  c.fill();
  c.beginPath();
  c.rect(-W - 0.08, -H - 0.12, W * 2 + 0.16, 0.14);
  c.fillStyle = art.stoneLit;
  c.fill();
  ink(c, art);
  for (const s of [-1, 1]) {
    c.beginPath();
    c.rect(s * W - (s > 0 ? 0.1 : 0), -H, 0.1, H);
    c.fillStyle = stoneGrad(c, art, -W, W);
    c.fill();
    ink(c, art, 0.02);
  }
  for (let row = 0; row < 3; row++) {
    const base = -0.08 - row * 0.56;
    c.fillStyle = art.stone;
    c.fillRect(-W, base, W * 2, 0.07);
    let x = -W + 0.12;
    while (x < W - 0.14) {
      const bw = r.range(0.05, 0.1),
        bh = r.range(0.32, 0.44);
      if (r.chance(0.12)) {
        x += 0.1;
        continue;
      }
      const lean = r.chance(0.12) ? r.range(0.1, 0.3) : 0;
      c.save();
      c.translate(x, base);
      c.rotate(lean);
      c.beginPath();
      c.rect(0, -bh, bw, bh);
      c.fillStyle = r.pick(BOOKS);
      c.fill();
      c.strokeStyle = art.inkSoft;
      c.lineWidth = 0.01;
      c.stroke();
      c.fillStyle = art.gold;
      c.fillRect(0.01, -bh + 0.06, bw - 0.02, 0.018);
      c.fillRect(0.01, -0.08, bw - 0.02, 0.014);
      c.restore();
      x += bw + 0.01 + lean * 0.2;
    }
  }
  ink(c, art);
}

function banner(c: Ctx, art: Art, r: Rng) {
  const H = r.range(2.1, 2.4);
  c.beginPath();
  c.rect(-0.03, -H, 0.06, H);
  c.fillStyle = bronzeGrad(c, art, -0.03, 0.03);
  c.fill();
  c.beginPath();
  c.arc(0, -H - 0.06, 0.07, 0, TAU);
  c.fillStyle = art.gold;
  c.fill();
  c.fillStyle = art.bronze;
  c.fillRect(-0.03, -H + 0.05, 0.62, 0.04);
  const cloth = art.fabric;
  c.beginPath();
  c.moveTo(0.04, -H + 0.09);
  c.lineTo(0.56, -H + 0.09);
  c.bezierCurveTo(0.6, -H + 0.5, 0.52, -H + 0.9, 0.58, -H + 1.25);
  c.lineTo(0.31, -H + 1.08);
  c.lineTo(0.06, -H + 1.25);
  c.bezierCurveTo(0.1, -H + 0.85, 0.02, -H + 0.45, 0.04, -H + 0.09);
  c.closePath();
  const g = c.createLinearGradient(0, 0, 0.6, 0);
  g.addColorStop(0, mix(cloth, "#ffffff", 0.18));
  g.addColorStop(1, mix(cloth, art.ink, 0.3));
  c.fillStyle = g;
  c.fill();
  ink(c, art);
  sunGlyph(c, art, 0.31, -H + 0.5, 0.07);
  c.beginPath();
  c.moveTo(0.08, -H + 0.2);
  c.lineTo(0.53, -H + 0.2);
  c.strokeStyle = art.gold;
  c.lineWidth = 0.018;
  c.stroke();
}

function crystals(c: Ctx, art: Art, r: Rng) {
  const base = mix("#bfe2ff", art.p.skyHorizon, 0.2);
  const n = r.int(3, 5);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) - 0.5) * 0.7 + r.range(-0.05, 0.05);
    const h = r.range(0.45, 1.15) * (1 - Math.abs(x) * 0.6);
    const a = r.range(-0.35, 0.35) + x * 0.6;
    const w = r.range(0.1, 0.16);
    c.save();
    c.translate(x, 0);
    c.rotate(a);
    c.beginPath();
    c.moveTo(-w, 0);
    c.lineTo(-w, -h);
    c.lineTo(0, -h - w * 1.6);
    c.lineTo(w, -h);
    c.lineTo(w, 0);
    c.closePath();
    c.fillStyle = mix(base, art.p.skyTop, 0.35);
    c.fill();
    c.beginPath();
    c.moveTo(-w, 0);
    c.lineTo(-w, -h);
    c.lineTo(0, -h - w * 1.6);
    c.lineTo(0, 0);
    c.closePath();
    c.fillStyle = rgba(mix(base, "#ffffff", 0.4), 0.85);
    c.fill();
    c.beginPath();
    c.moveTo(-w, 0);
    c.lineTo(-w, -h);
    c.lineTo(0, -h - w * 1.6);
    c.lineTo(w, -h);
    c.lineTo(w, 0);
    c.closePath();
    ink(c, art, 0.02);
    c.restore();
  }
  c.beginPath();
  c.ellipse(0, -0.02, 0.5, 0.08, 0, 0, TAU);
  c.fillStyle = art.stoneMid;
  c.fill();
}

function telescope(c: Ctx, art: Art, r: Rng) {
  c.strokeStyle = art.bronzeDark;
  c.lineWidth = 0.04;
  c.beginPath();
  c.moveTo(-0.4, 0);
  c.lineTo(0, -0.8);
  c.lineTo(0.38, 0);
  c.moveTo(0, -0.8);
  c.lineTo(0.05, 0);
  c.stroke();
  c.save();
  c.translate(0, -0.85);
  c.rotate(-r.range(0.55, 0.85));
  c.beginPath();
  c.moveTo(-0.55, -0.07);
  c.lineTo(0.75, -0.11);
  c.lineTo(0.75, 0.11);
  c.lineTo(-0.55, 0.07);
  c.closePath();
  const g = c.createLinearGradient(0, -0.11, 0, 0.11);
  g.addColorStop(0, art.bronzeLit);
  g.addColorStop(0.5, art.bronze);
  g.addColorStop(1, art.bronzeDark);
  c.fillStyle = g;
  c.fill();
  ink(c, art);
  for (const x of [-0.4, 0.1, 0.6]) {
    c.fillStyle = art.gold;
    c.fillRect(x, -0.12, 0.06, 0.24);
  }
  c.beginPath();
  c.ellipse(0.76, 0, 0.03, 0.12, 0, 0, TAU);
  c.fillStyle = mix("#bfe6ff", art.p.skyHorizon, 0.4);
  c.fill();
  c.restore();
}

function kiosk(c: Ctx, art: Art, r: Rng) {
  const H = 1.5;
  for (const s of [-1, 1]) {
    c.save();
    c.translate(s * 0.62, 0);
    column(c, art, r, H, false);
    c.restore();
  }
  c.beginPath();
  c.rect(-0.85, -H - 0.28, 1.7, 0.18);
  c.fillStyle = art.stoneLit;
  c.fill();
  ink(c, art);
  c.beginPath();
  c.moveTo(-0.78, -H - 0.28);
  c.bezierCurveTo(-0.78, -H - 1.15, 0.78, -H - 1.15, 0.78, -H - 0.28);
  c.closePath();
  const g = c.createLinearGradient(-0.8, 0, 0.8, 0);
  g.addColorStop(0, art.goldLight);
  g.addColorStop(0.5, art.gold);
  g.addColorStop(1, art.goldDark);
  c.fillStyle = g;
  c.fill();
  ink(c, art);
  c.beginPath();
  for (const x of [-0.4, 0, 0.4]) {
    c.moveTo(x * 1.0, -H - 0.28);
    c.quadraticCurveTo(x * 0.7, -H - 0.95, 0, -H - 0.93);
  }
  c.strokeStyle = rgba(art.goldDark, 0.7);
  c.lineWidth = 0.02;
  c.stroke();
  c.beginPath();
  c.arc(0, -H - 1.0, 0.07, 0, TAU);
  c.fillStyle = art.goldLight;
  c.fill();
}

function armillary(c: Ctx, art: Art, _r: Rng) {
  c.beginPath();
  c.moveTo(-0.22, 0);
  c.lineTo(0.22, 0);
  c.lineTo(0.08, -0.15);
  c.lineTo(0.05, -0.75);
  c.lineTo(-0.05, -0.75);
  c.lineTo(-0.08, -0.15);
  c.closePath();
  c.fillStyle = stoneGrad(c, art, -0.2, 0.2);
  c.fill();
  ink(c, art);
  const cy = -1.12,
    R = 0.36;
  c.strokeStyle = art.gold;
  c.lineWidth = 0.035;
  c.beginPath();
  c.arc(0, cy, R, 0, TAU);
  c.stroke();
  c.lineWidth = 0.025;
  c.beginPath();
  c.ellipse(0, cy, R, R * 0.35, 0.4, 0, TAU);
  c.stroke();
  c.beginPath();
  c.ellipse(0, cy, R * 0.35, R, 0.2, 0, TAU);
  c.stroke();
  c.beginPath();
  c.moveTo(-R * 1.2, cy + R * 0.5);
  c.lineTo(R * 1.2, cy - R * 0.5);
  c.strokeStyle = art.bronzeDark;
  c.lineWidth = 0.02;
  c.stroke();
  c.beginPath();
  c.arc(0, cy, 0.07, 0, TAU);
  c.fillStyle = art.goldLight;
  c.fill();
}

function gearTower(c: Ctx, art: Art, r: Rng): GearSpec[] {
  const H = r.range(1.9, 2.3);
  // Bronze scaffold with pipes; the gears themselves turn at runtime.
  c.strokeStyle = art.bronzeDark;
  c.lineWidth = 0.06;
  c.beginPath();
  c.moveTo(-0.35, 0);
  c.lineTo(-0.25, -H);
  c.moveTo(0.35, 0);
  c.lineTo(0.25, -H);
  c.stroke();
  c.lineWidth = 0.025;
  c.beginPath();
  for (let i = 0; i < 4; i++) {
    const y0 = -(i / 4) * H,
      y1 = -((i + 1) / 4) * H;
    c.moveTo(-0.33 + i * 0.02, y0);
    c.lineTo(0.27 - i * 0.02, y1);
    c.moveTo(0.33 - i * 0.02, y0);
    c.lineTo(-0.27 + i * 0.02, y1);
  }
  c.stroke();
  c.strokeStyle = art.bronze;
  c.lineWidth = 0.08;
  c.beginPath();
  c.moveTo(0.45, 0);
  c.lineTo(0.45, -H * 0.6);
  c.quadraticCurveTo(0.45, -H * 0.75, 0.3, -H * 0.75);
  c.stroke();
  c.strokeStyle = art.bronzeLit;
  c.lineWidth = 0.02;
  c.stroke();
  c.beginPath();
  c.rect(-0.4, -H - 0.1, 0.8, 0.12);
  c.fillStyle = art.bronze;
  c.fill();
  ink(c, art);
  return [
    { x: 0, y: -H - 0.05, r: r.range(0.42, 0.55), teeth: 12, speed: r.sign() * 0.6, tone: 0 },
    { x: r.sign() * 0.48, y: -H * 0.45, r: 0.26, teeth: 8, speed: -1.1, tone: 1 },
  ];
}

function willow(c: Ctx, art: Art, r: Rng) {
  const lean = r.sign() * r.range(0.1, 0.25);
  c.fillStyle = art.bark;
  c.beginPath();
  taper(c, [[0, 0], [lean * 0.5, -0.7], [lean, -1.4], [lean * 0.6, -1.9]], 0.24, 0.1);
  c.fill();
  const cx = lean * 0.7,
    cy = -2.0;
  const canopy: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 5) * Math.PI;
    canopy.push([cx + Math.cos(a) * 0.75, cy + Math.sin(a) * 0.35 + 0.15, 0.42, 0.3]);
  }
  canopy.push([cx, cy, 0.7, 0.42]);
  blobs(c, canopy, art.foliage, art.inkSoft);
  // Hanging wisteria racemes.
  const flower = art.time === "dusk" ? "#b9a2ec" : r.pick(art.flowers);
  for (let i = 0; i < 9; i++) {
    const x = cx + (i / 8 - 0.5) * 1.6;
    const top = cy + 0.15 + Math.sin((i / 8) * Math.PI) * 0.2;
    const len = r.range(0.45, 0.95);
    for (let j = 0; j < 7; j++) {
      const t = j / 7;
      c.beginPath();
      c.arc(x + Math.sin(j) * 0.02, top + t * len, 0.07 * (1 - t * 0.7), 0, TAU);
      c.fillStyle = mix(flower, j % 2 ? "#ffffff" : art.ink, 0.12);
      c.fill();
    }
  }
  leafTicks(c, r, cx, cy, 0.8, 0.35, 40, rgba(art.foliageLit, 0.7), 0.08, 1.4);
}
