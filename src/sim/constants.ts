/** Movement tuning. Level layouts are designed against these numbers. */
export const STEP = 1 / 120;
export const RADIUS = 0.3;
export const HEIGHT = 1.2;

export const RUN_SPEED = 6.2;
export const GROUND_ACCEL = 62;
export const GROUND_DECEL = 52;
export const AIR_ACCEL = 34;
export const AIR_DECEL = 14;

export const JUMP_SPEED = 11.2;
export const GRAVITY_UP = 30;
export const GRAVITY_DOWN = 42;
/** Near the apex of a held jump gravity softens for a short float. */
export const APEX_BAND = 2;
export const APEX_GRAVITY = 0.55;
/** Releasing jump while rising cuts the rise. */
export const JUMP_CUT = 0.45;
export const MAX_FALL = 24;

export const COYOTE = 0.1;
export const BUFFER = 0.13;
/** Ledges this far above the feet are climbed while walking. */
export const STEP_UP = 0.32;
/** Head bumps this close to a corner slide around it. */
export const CORNER_NUDGE = 0.22;
export const STRIDE = 1.05;

export const DEATH_TIME = 0.85;
export const RESPAWN_GRACE = 0.7;
export const CLEAR_TIME = 1.8;
export const LOCKED_COOLDOWN = 2.6;
/** Gates and lantern bridges finish changing over this many seconds. */
export const MECHANISM_TIME = 1.1;

/** Comfortable design limits derived from the tuning above. */
export const DESIGN = {
  /** Highest reliable climb from standing. */
  climb: 1.8,
  /** Widest reliable flat gap edge to edge. */
  gap: 3.8,
  /** Edge to edge gap that needs a running start and full jump. */
  hardGap: 4.4,
} as const;
