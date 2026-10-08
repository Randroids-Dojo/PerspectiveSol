import type {
  Checkpoint,
  Hint,
  Island,
  IslandStyle,
  Lantern,
  Level,
  Mode,
  Motion,
  Palette,
  Pickup,
  Sentinel,
  TimeOfDay,
  Vec3,
  Wall,
  WallKind,
} from "./types";

/** Small authoring helpers so chapter files read like layouts. */

type IslandOptions = {
  h?: number;
  style?: IslandStyle;
  only?: Mode;
  motion?: Motion;
  lantern?: string;
};

export const island = (
  id: string,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  o: IslandOptions = {},
): Island => ({
  id,
  x,
  y,
  z,
  w,
  d,
  h: o.h ?? (o.only || o.style === "bridge" ? 0.5 : 1.4),
  style: o.style ?? (o.only ? "bridge" : "garden"),
  only: o.only,
  motion: o.motion,
  lantern: o.lantern,
});

export const move = (
  axis: Motion["axis"],
  range: number,
  speed: number,
  phase = 0,
): Motion => ({ axis, range, speed, phase });

export const wall = (
  id: string,
  kind: WallKind,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  lantern?: string,
): Wall => ({ id, kind, x, y, z, w, d, h, lantern });

/** A pickup floating above an island; offsets are relative to its top centre. */
export const pickup = (
  id: string,
  kind: Pickup["kind"],
  on: Island,
  dx = 0,
  dz = 0,
  lift = 1.0,
): Pickup => ({
  id,
  kind,
  x: on.x + dx,
  y: on.y + lift,
  z: on.z + dz,
  island: on.motion ? on.id : undefined,
});

export const seed = (id: string, on: Island, dx = 0, dz = 0, lift = 1.0) =>
  pickup(id, "seed", on, dx, dz, lift);
export const mote = (id: string, on: Island, dx = 0, dz = 0, lift = 0.9) =>
  pickup(id, "mote", on, dx, dz, lift);

/** A pickup at an absolute position, for arcs through the air. */
export const floating = (
  id: string,
  kind: Pickup["kind"],
  x: number,
  y: number,
  z: number,
): Pickup => ({ id, kind, x, y, z });

export const lantern = (id: string, on: Island, dx = 0, dz = 0): Lantern => ({
  id,
  x: on.x + dx,
  y: on.y,
  z: on.z + dz,
});

export const sentinel = (
  id: string,
  x: number,
  y: number,
  z: number,
  motion?: Motion,
  r = 0.55,
): Sentinel => ({ id, x, y, z, r, motion });

export const checkpoint = (
  id: string,
  on: Island,
  dx = 0,
  dz = 0,
): Checkpoint => ({ id, x: on.x + dx, y: on.y, z: on.z + dz });

export const hint = (
  id: string,
  x0: number,
  x1: number,
  text: string,
  mode?: Mode,
): Hint => ({ id, x0, x1, text, mode });

export const PALETTES: Record<string, Palette> = {
  morning: {
    skyTop: "#5f9cc4",
    skyHorizon: "#f6e2bd",
    sun: "#ffe0a0",
    cloud: "#fbf3e4",
    fog: "#cfe0e1",
    stone: "#e8dcc7",
    stoneShade: "#9b8b74",
    grass: "#93b665",
    foliage: "#4d8758",
    bronze: "#b88a4a",
    accent: "#f2b544",
    ink: "#1b3546",
  },
  noon: {
    skyTop: "#3f86c4",
    skyHorizon: "#d6ecf3",
    sun: "#fff3c8",
    cloud: "#ffffff",
    fog: "#d3e6ee",
    stone: "#efe5d3",
    stoneShade: "#a3927b",
    grass: "#82b25a",
    foliage: "#3c7b53",
    bronze: "#ba8c50",
    accent: "#e9835a",
    ink: "#163246",
  },
  afternoon: {
    skyTop: "#357f93",
    skyHorizon: "#f3d199",
    sun: "#ffd185",
    cloud: "#fbe6c3",
    fog: "#d2d6c0",
    stone: "#e4d2b4",
    stoneShade: "#917b5c",
    grass: "#a0a957",
    foliage: "#4a7858",
    bronze: "#c3893f",
    accent: "#f2a246",
    ink: "#1a333d",
  },
  dusk: {
    skyTop: "#38356b",
    skyHorizon: "#eba39c",
    sun: "#ffb187",
    cloud: "#f1c0c3",
    fog: "#a596b6",
    stone: "#dccfdf",
    stoneShade: "#7a6c8a",
    grass: "#83917a",
    foliage: "#585887",
    bronze: "#bb8657",
    accent: "#f4778a",
    ink: "#221d3b",
  },
  night: {
    skyTop: "#0b1730",
    skyHorizon: "#2c4870",
    sun: "#e4ecff",
    cloud: "#4c6488",
    fog: "#20324d",
    stone: "#aab7c8",
    stoneShade: "#4a586e",
    grass: "#4d7a73",
    foliage: "#2d535e",
    bronze: "#c99d5c",
    accent: "#ffd277",
    ink: "#07111e",
  },
  dawn: {
    skyTop: "#5a6ca6",
    skyHorizon: "#ffc595",
    sun: "#fff0b5",
    cloud: "#ffdfc2",
    fog: "#f2c6ae",
    stone: "#f3e2cd",
    stoneShade: "#ae8b75",
    grass: "#a7b468",
    foliage: "#6a8e5a",
    bronze: "#cb934d",
    accent: "#ffcc55",
    ink: "#28223f",
  },
};

type LevelSpec = {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  epigraph: string;
  time: TimeOfDay;
  seed: number;
  start: Vec3;
  startMode?: Mode;
  islands: Island[];
  walls?: Wall[];
  lanterns?: Lantern[];
  sentinels?: Sentinel[];
  pickups: Pickup[];
  checkpoints?: Checkpoint[];
  exit: Vec3 & { island: string };
  hints?: Hint[];
  par: number;
};

export function level(s: LevelSpec): Level {
  const xs = s.islands.flatMap((i) => [i.x - i.w / 2, i.x + i.w / 2]);
  const ys = s.islands.map((i) => i.y - i.h);
  return {
    id: s.id,
    index: s.index,
    name: s.name,
    subtitle: s.subtitle,
    epigraph: s.epigraph,
    theme: { time: s.time, palette: PALETTES[s.time], seed: s.seed },
    start: s.start,
    startMode: s.startMode ?? "3d",
    islands: s.islands,
    walls: s.walls ?? [],
    lanterns: s.lanterns ?? [],
    sentinels: s.sentinels ?? [],
    pickups: s.pickups,
    checkpoints: s.checkpoints ?? [],
    exit: s.exit,
    hints: s.hints ?? [],
    par: s.par,
    bounds: {
      x0: Math.min(...xs) - 2,
      x1: Math.max(...xs) + 2,
      floor: Math.min(...ys) - 9,
    },
  };
}
