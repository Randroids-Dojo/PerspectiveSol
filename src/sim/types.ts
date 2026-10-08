/**
 * Shared world model. One deterministic simulation reads these definitions in
 * both perspectives; the 3D and 2D renderers draw them independently.
 *
 * Coordinates: x runs left to right, y is up, z is depth (positive toward the
 * camera). Folded (2D) play ignores z: anything that overlaps in x and y
 * touches. Unfolded (3D) play needs overlap on all three axes.
 */
export type Mode = "2d" | "3d";
export type Vec3 = { x: number; y: number; z: number };

/** A sine oscillation: base + sin(t * speed + phase) * range along one axis. */
export type Motion = {
  axis: "x" | "y" | "z";
  range: number;
  speed: number;
  phase: number;
};

/** Art hint for an island; the collision box is the same for every style. */
export type IslandStyle = "garden" | "stone" | "ruin" | "bridge" | "plinth";

/**
 * A floating island. (x, y, z) is the centre of its walkable top face; the solid
 * box extends w along x, d along z and h downward from y.
 */
export type Island = {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  style: IslandStyle;
  /**
   * Solid in one perspective only. "2d" islands are star bridges, drawn in the
   * folded world and only hinted at in 3D. "3d" islands are sunglass prisms,
   * real in the sculpted world and only outlined in 2D.
   */
  only?: Mode;
  motion?: Motion;
  /**
   * Bound to a lantern. A moving island waits at its base until the lantern is
   * lit; a still island does not exist (not solid, drawn as a faint promise)
   * until the lantern is lit.
   */
  lantern?: string;
};

export type WallKind = "sunwall" | "gate" | "rock";
/** A full solid. (x, z) is the centre of its footprint and y its base. */
export type Wall = {
  id: string;
  kind: WallKind;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Gates sink into their island once this lantern is lit. */
  lantern?: string;
};

/** Touching a lantern lights it, in any depth while folded. y is its base. */
export type Lantern = { id: string; x: number; y: number; z: number };

/** A patrolling hazard. y is the centre of its body, r its radius. */
export type Sentinel = {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
  motion?: Motion;
};

export type PickupKind = "seed" | "mote";
/** y is the centre. Pickups on a moving island travel with it. */
export type Pickup = {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  island?: string;
};

/** A recovery point, standing on an island. */
export type Checkpoint = { id: string; x: number; y: number; z: number };

/**
 * A teaching prompt shown when the keeper enters [x0, x1]. Tokens in braces
 * ({fold}, {jump}, {move}, {depth}) are replaced with the active control
 * scheme's labels by the UI.
 */
export type Hint = {
  id: string;
  x0: number;
  x1: number;
  text: string;
  /** Only show while in this perspective. */
  mode?: Mode;
};

export type TimeOfDay = "morning" | "noon" | "afternoon" | "dusk" | "night" | "dawn";

/** One palette shared by both art treatments so the chapters match. */
export type Palette = {
  skyTop: string;
  skyHorizon: string;
  sun: string;
  cloud: string;
  fog: string;
  stone: string;
  stoneShade: string;
  grass: string;
  foliage: string;
  bronze: string;
  accent: string;
  ink: string;
};

export type Theme = {
  time: TimeOfDay;
  palette: Palette;
  /** Seeds per-chapter procedural decoration in both renderers. */
  seed: number;
};

export type Level = {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  /** Line shown when the chapter is restored. */
  epigraph: string;
  theme: Theme;
  start: Vec3;
  startMode: Mode;
  islands: Island[];
  walls: Wall[];
  lanterns: Lantern[];
  sentinels: Sentinel[];
  pickups: Pickup[];
  checkpoints: Checkpoint[];
  /** The observatory. (x, y, z) stands on its island's top face. */
  exit: Vec3 & { island: string };
  hints: Hint[];
  /** Target time in seconds, shown after the chapter. */
  par: number;
  /** Horizontal camera limits and the height below which the keeper is lost. */
  bounds: { x0: number; x1: number; floor: number };
};

export type EventType =
  | "jump"
  | "land"
  | "step"
  | "bump"
  | "fold"
  | "seed"
  | "mote"
  | "checkpoint"
  | "lantern"
  | "gate"
  | "bridge"
  | "die"
  | "respawn"
  | "locked"
  | "exit"
  | "hint";

export type GameEvent = {
  type: EventType;
  /** Where it happened, in world units. */
  position: Vec3;
  /** The element involved: pickup, lantern, gate, island, checkpoint or hint id. */
  id?: string;
  /**
   * land: impact speed. seed: seeds now held. mote: motes found this chapter.
   * locked: seeds still missing. fold: 1 when folding to 2D, 0 when unfolding.
   * step: 0 or 1 for the foot.
   */
  value?: number;
  /** die: "void" | "sentinel" | "crush". */
  cause?: "void" | "sentinel" | "crush";
};

export type Input = {
  /** -1 left .. 1 right. */
  x: number;
  /** -1 away from the camera .. 1 toward it. Ignored while folded. */
  z: number;
  /** Held state of jump. */
  jump: boolean;
  /** Fresh fold presses since the previous step. */
  fold: number;
};

export const IDLE: Input = { x: 0, z: 0, jump: false, fold: 0 };
