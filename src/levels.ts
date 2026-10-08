export type Vec = { x: number; y: number; z: number };
export type Platform = Vec & {
  id: string;
  w: number;
  d: number;
  h: number;
  kind?: "bridge" | "garden" | "lift";
  motion?: {
    axis: "x" | "y" | "z";
    range: number;
    speed: number;
    phase: number;
  };
};
export type Wall = Vec & { w: number; d: number; h: number };
export type Hazard = Vec & {
  r: number;
  range: number;
  axis: "x" | "z";
  speed: number;
  phase: number;
};
export type Collectible = Vec & {
  id: string;
  kind: "shard" | "mote";
  platform: string;
};
export type Level = {
  name: string;
  subtitle: string;
  hint: string;
  sky: string;
  mist: string;
  stone: string;
  leaf: string;
  accent: string;
  start: Vec;
  platforms: Platform[];
  walls: Wall[];
  hazards: Hazard[];
  collectibles: Collectible[];
  checkpoints: Vec[];
  exit: Vec;
  par: number;
};
const p = (
  id: string,
  x: number,
  y: number,
  z: number,
  w: number,
  d = 4,
  kind: Platform["kind"] = "garden",
  motion?: Platform["motion"],
): Platform => ({ id, x, y, z, w, d, h: 1.2, kind, motion });
const c = (
  id: string,
  platform: Platform,
  kind: Collectible["kind"] = "shard",
  offset = 0,
): Collectible => ({
  id,
  platform: platform.id,
  kind,
  x: platform.x + offset,
  y: platform.y + 1.1,
  z: platform.z,
});
function make(
  index: number,
  name: string,
  subtitle: string,
  hint: string,
  platforms: Platform[],
  shards: number[],
  walls: Wall[] = [],
  hazards: Hazard[] = [],
): Level {
  const palettes = [
    ["#9bc9d1", "#bfd9dc", "#dde1d4", "#648b80", "#f4c774"],
    ["#92b9cb", "#bfd6db", "#cfdfd9", "#568677", "#eed38a"],
    ["#899cbb", "#b7bfd2", "#d4d7e4", "#657b9e", "#f8bc77"],
    ["#867ca5", "#b0a3c2", "#d9cde2", "#796d98", "#f5a8a0"],
    ["#3a647f", "#688e9e", "#b8ced0", "#4d8990", "#f4ce8a"],
    ["#e8ba95", "#f0d5b9", "#efe2c9", "#9ba87b", "#ffe5a8"],
  ];
  const colors = palettes[index];
  const last = platforms.at(-1)!;
  const first = platforms[0];
  return {
    name,
    subtitle,
    hint,
    sky: colors[0],
    mist: colors[1],
    stone: colors[2],
    leaf: colors[3],
    accent: colors[4],
    start: { x: first.x - 1.5, y: first.y, z: first.z },
    platforms,
    walls,
    hazards,
    collectibles: [
      ...shards.map((n, i) => c(`s${i}`, platforms[n])),
      ...platforms
        .slice(1, -1)
        .filter((_, i) => !shards.includes(i + 1))
        .map((v, i) =>
          c(`m${i}`, v, "mote", walls.some((w) => w.x === v.x) ? -2 : 0.5),
        ),
    ],
    checkpoints: platforms
      .filter((_, i) => i > 0 && i % 3 === 0 && !platforms[i].motion)
      .map((v) => ({
        x: v.x - (walls.some((w) => w.x === v.x) ? 2 : 0),
        y: v.y,
        z: v.z,
      })),
    exit: { x: last.x + 1, y: last.y, z: last.z },
    par: [75, 100, 120, 140, 160, 180][index],
  };
}
export const LEVELS: Level[] = [
  make(
    0,
    "The waking garden",
    "A little light goes a long way.",
    "Press Shift to fold the distant islands into one path.",
    [
      p("a", 0, 0, 0, 8, 5),
      p("b", 7, 0, -5, 5),
      p("c", 13, 1, 4, 5),
      p("d", 19, 0, -3, 5),
      p("e", 25, 1.5, 3, 5),
      p("f", 32, 0, 0, 9, 6),
    ],
    [1, 3, 4],
  ),
  make(
    1,
    "The hidden courtyard",
    "There is always another way around.",
    "Unfold into 3D. Use W / S to walk around the tall sunwalls.",
    [
      p("a", 0, 0, 0, 8, 6),
      p("b", 7, 0, -4, 5, 5),
      p("c", 13, 0, 0, 8, 9),
      p("d", 21, 1, -5, 5),
      p("e", 27, 1, 3, 5),
      p("f", 34, 0, 0, 10, 7),
    ],
    [1, 3, 4],
    [{ x: 13, y: 0, z: 0, w: 1.4, d: 3, h: 5.5 }],
  ),
  make(
    2,
    "The tide engine",
    "Even stone remembers how to drift.",
    "The gold-edged islands move. Jump with them, then fold the distance.",
    [
      p("a", 0, 0, 0, 8, 6),
      p("b", 7, 0, -3, 4, 4, "lift", {
        axis: "y",
        range: 1.1,
        speed: 0.7,
        phase: 0,
      }),
      p("c", 13, 1.4, 4, 8, 7),
      p("d", 20, 0.6, -4, 4, 4, "lift", {
        axis: "x",
        range: 1.1,
        speed: 0.65,
        phase: 0,
      }),
      p("e", 26, 2, 3, 5),
      p("f", 34, 1, 0, 10, 7),
    ],
    [1, 3, 4],
    [],
    [
      {
        x: 15.2,
        y: 2.1,
        z: 4,
        r: 0.6,
        axis: "x",
        range: 0.4,
        speed: 1.1,
        phase: 1,
      },
    ],
  ),
  make(
    3,
    "The violet archive",
    "A shadow is only one side of a thing.",
    "Rose sentinels patrol the ruins. Jump over them or pass behind them in 3D.",
    [
      p("a", 0, 0, 0, 8, 6),
      p("b", 7, 1, -5, 5),
      p("c", 13, 2, 3, 8, 7),
      p("d", 20, 0, 0, 9, 10),
      p("e", 28, 1, -5, 8, 7),
      p("f", 34, 2, 4, 5),
      p("g", 42, 0, 0, 11, 7),
    ],
    [1, 4, 5],
    [{ x: 20, y: 0, z: 0, w: 1.3, d: 3, h: 6 }],
    [
      {
        x: 15.2,
        y: 2.7,
        z: 3,
        r: 0.6,
        axis: "x",
        range: 0.4,
        speed: 1.1,
        phase: 0,
      },
      {
        x: 30.2,
        y: 1.7,
        z: -5,
        r: 0.6,
        axis: "x",
        range: 0.4,
        speed: 1.3,
        phase: 2,
      },
    ],
  ),
  make(
    4,
    "The night crossing",
    "Carry the dawn through the dark.",
    "Shift in midair to find your landing. Your light follows you in either world.",
    [
      p("a", 0, 0, 0, 8, 6),
      p("b", 7, 1, -4, 4),
      p("c", 13, 2, 4, 4, 4, "lift", {
        axis: "y",
        range: 0.8,
        speed: 0.75,
        phase: 0,
      }),
      p("d", 19, 1, -4, 8, 7),
      p("e", 26, 2, 0, 8, 10),
      p("f", 34, 3, -4, 4, 4, "lift", {
        axis: "x",
        range: 1,
        speed: 0.7,
        phase: 1,
      }),
      p("g", 40, 2, 4, 5),
      p("h", 48, 1, 0, 11, 7),
    ],
    [1, 5, 6],
    [{ x: 26, y: 2, z: 0, w: 1.4, d: 3, h: 5.5 }],
    [
      {
        x: 21.2,
        y: 1.7,
        z: -4,
        r: 0.6,
        axis: "x",
        range: 0.4,
        speed: 1.15,
        phase: 1,
      },
    ],
  ),
  make(
    5,
    "The last observatory",
    "Give the sky its sun back.",
    "One final passage. Gather the three sun seeds and wake the observatory.",
    [
      p("a", 0, 0, 0, 8, 6),
      p("b", 7, 1, -5, 5),
      p("c", 13, 2, 4, 4, 4, "lift", {
        axis: "y",
        range: 0.7,
        speed: 0.7,
        phase: 1,
      }),
      p("d", 20, 1, 0, 9, 10),
      p("e", 28, 2, -4, 4, 4, "lift", {
        axis: "x",
        range: 1,
        speed: 0.75,
        phase: 0,
      }),
      p("f", 34, 3, 4, 8, 7),
      p("g", 41, 2, -4, 5),
      p("h", 49, 1, 0, 14, 9),
    ],
    [1, 4, 6],
    [{ x: 20, y: 1, z: 0, w: 1.5, d: 3.2, h: 6 }],
    [
      {
        x: 36.2,
        y: 3.8,
        z: 4,
        r: 0.6,
        axis: "x",
        range: 0.4,
        speed: 1.1,
        phase: 1,
      },
    ],
  ),
];
export function platformAt(p: Platform, t: number): Platform {
  if (!p.motion) return p;
  return {
    ...p,
    [p.motion.axis]:
      p[p.motion.axis] +
      Math.sin(t * p.motion.speed + p.motion.phase) * p.motion.range,
  };
}
export function hazardAt(h: Hazard, t: number): Hazard {
  return {
    ...h,
    [h.axis]: h[h.axis] + Math.sin(t * h.speed + h.phase) * h.range,
  };
}
