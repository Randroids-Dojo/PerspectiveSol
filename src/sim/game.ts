import {
  AIR_ACCEL,
  AIR_DECEL,
  APEX_BAND,
  APEX_GRAVITY,
  BUFFER,
  CLEAR_TIME,
  CORNER_NUDGE,
  COYOTE,
  DEATH_TIME,
  GRAVITY_DOWN,
  GRAVITY_UP,
  GROUND_ACCEL,
  GROUND_DECEL,
  HEIGHT,
  JUMP_CUT,
  JUMP_SPEED,
  LOCKED_COOLDOWN,
  MAX_FALL,
  MECHANISM_TIME,
  RADIUS,
  RESPAWN_GRACE,
  RUN_SPEED,
  STEP,
  STEP_UP,
  STRIDE,
} from "./constants";
import type {
  EventType,
  GameEvent,
  Input,
  Island,
  Level,
  Mode,
  Pickup,
  Sentinel,
  Vec3,
  Wall,
} from "./types";

export type Status = "playing" | "dying" | "clearing" | "clear";

export type Player = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  /** 1 facing right, -1 facing left. */
  facing: 1 | -1;
  /** Ground heading in radians (0 = +x, π/2 = +z), updated while moving. */
  heading: number;
  /** Distance walked on the ground; drives stride animation and footsteps. */
  stride: number;
  /** Seconds since leaving the ground (0 while grounded). */
  airTime: number;
  /** Seconds since the last landing. */
  sinceLand: number;
  /** Island or wall id underfoot. */
  support: string | null;
};

/** A solid box in world space at the current instant. */
export type Box = {
  id: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
};

/** In-progress chapter state that survives a reload. */
export type ChapterState = {
  level: number;
  checkpoint: string | null;
  collected: string[];
  lit: string[];
  elapsed: number;
  deaths: number;
  folds: number;
  mode: Mode;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const approach = (v: number, target: number, amount: number) =>
  v < target ? Math.min(target, v + amount) : Math.max(target, v - amount);
const ease = (t: number) => t * t * (3 - 2 * t);
const EPS = 0.001;

export class Game {
  readonly level: Level;
  mode: Mode;
  status: Status = "playing";
  /** Chapter clock: drives moving islands and sentinels. Never resets on fold. */
  time = 0;
  /** Chapter timer for records. */
  elapsed = 0;
  deaths = 0;
  folds = 0;
  player: Player;
  collected = new Set<string>();
  /** Lantern id to the chapter time it was lit. */
  lit = new Map<string, number>();
  checkpoint: Vec3;
  checkpointId: string | null = null;
  events: GameEvent[] = [];
  hintsSeen = new Set<string>();
  /** Solids overlapped at the instant of a fold; passable until the keeper is clear. */
  ghosts = new Set<string>();
  /** Sentinels overlapped at the instant of a fold or respawn. */
  spared = new Set<string>();
  /** Seconds left in the current death or clear sequence. */
  sequence = 0;
  /** Seconds of respawn invulnerability left. */
  grace = 0;
  /** Seconds since the last fold. */
  sinceFold = 99;
  private coyote = COYOTE;
  private buffer = 0;
  private lastJump = false;
  private canCut = false;
  private lockedCooldown = 0;
  private nextFoot = 0;
  private islandIndex = new Map<string, Island>();
  private wallIndex = new Map<string, Wall>();

  constructor(level: Level, state?: ChapterState) {
    this.level = level;
    this.mode = level.startMode;
    for (const i of level.islands) this.islandIndex.set(i.id, i);
    for (const w of level.walls) this.wallIndex.set(w.id, w);
    this.checkpoint = { ...level.start };
    this.player = this.freshPlayer(level.start);
    if (state) this.resume(state);
    this.player.support = this.groundUnder(this.player)?.id ?? null;
  }

  private freshPlayer(at: Vec3): Player {
    return {
      x: at.x,
      y: at.y,
      z: at.z,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      facing: 1,
      heading: 0,
      stride: 0,
      airTime: 0,
      sinceLand: 9,
      support: null,
    };
  }

  private resume(s: ChapterState) {
    const ids = new Set(this.level.pickups.map((p) => p.id));
    for (const id of s.collected) if (ids.has(id)) this.collected.add(id);
    for (const id of s.lit)
      if (this.level.lanterns.some((l) => l.id === id))
        this.lit.set(id, -MECHANISM_TIME * 4);
    this.elapsed = Math.max(0, s.elapsed);
    this.deaths = Math.max(0, Math.floor(s.deaths));
    this.folds = Math.max(0, Math.floor(s.folds));
    this.mode = s.mode;
    const c = this.level.checkpoints.find((c) => c.id === s.checkpoint);
    if (c) {
      this.checkpointId = c.id;
      this.checkpoint = { x: c.x, y: c.y, z: c.z };
      this.player = this.freshPlayer(this.checkpoint);
    }
  }

  chapterState(): ChapterState {
    return {
      level: this.level.index,
      checkpoint: this.checkpointId,
      collected: [...this.collected],
      lit: [...this.lit.keys()],
      elapsed: this.elapsed,
      deaths: this.deaths,
      folds: this.folds,
      mode: this.mode,
    };
  }

  // ---------------------------------------------------------------- queries
  // Renderers call these every frame so both worlds show the same instant.

  get seeds() {
    let n = 0;
    for (const p of this.level.pickups)
      if (p.kind === "seed" && this.collected.has(p.id)) n++;
    return n;
  }
  get seedTotal() {
    return this.level.pickups.filter((p) => p.kind === "seed").length;
  }
  get motes() {
    let n = 0;
    for (const p of this.level.pickups)
      if (p.kind === "mote" && this.collected.has(p.id)) n++;
    return n;
  }
  get moteTotal() {
    return this.level.pickups.filter((p) => p.kind === "mote").length;
  }

  island(id: string) {
    return this.islandIndex.get(id);
  }

  /** 0 before the lantern is lit, rising to 1 over MECHANISM_TIME. */
  lanternProgress(id: string | undefined) {
    if (!id) return 1;
    const at = this.lit.get(id);
    if (at === undefined) return 0;
    return clamp((this.time - at) / MECHANISM_TIME, 0, 1);
  }

  /** Current top-centre of an island. */
  islandPosition(i: Island, t = this.time): Vec3 {
    const pos = { x: i.x, y: i.y, z: i.z };
    if (!i.motion) return pos;
    let clock = t;
    if (i.lantern) {
      const at = this.lit.get(i.lantern);
      if (at === undefined) return pos;
      clock = t - at;
      pos[i.motion.axis] += Math.sin(clock * i.motion.speed) * i.motion.range;
      return pos;
    }
    pos[i.motion.axis] +=
      Math.sin(clock * i.motion.speed + i.motion.phase) * i.motion.range;
    return pos;
  }

  /**
   * How present a lantern-bound still island is: 0 is only a promise, 1 fully
   * formed. Other islands are always 1.
   */
  islandPresence(i: Island) {
    if (!i.lantern || i.motion) return 1;
    return ease(this.lanternProgress(i.lantern));
  }

  /** Whether an island is solid in a perspective right now. */
  islandSolid(i: Island, mode: Mode = this.mode) {
    if (i.only && i.only !== mode) return false;
    if (i.lantern && !i.motion && !this.lit.has(i.lantern)) return false;
    return true;
  }

  /** Current height of a wall; gates sink after their lantern is lit. */
  wallHeight(w: Wall) {
    if (w.kind !== "gate" || !w.lantern) return w.h;
    return w.h * (1 - ease(this.lanternProgress(w.lantern)));
  }

  pickupPosition(p: Pickup): Vec3 {
    const pos = { x: p.x, y: p.y, z: p.z };
    const i = p.island ? this.islandIndex.get(p.island) : undefined;
    if (i?.motion) {
      const now = this.islandPosition(i);
      pos.x += now.x - i.x;
      pos.y += now.y - i.y;
      pos.z += now.z - i.z;
    }
    return pos;
  }

  sentinelPosition(s: Sentinel, t = this.time): Vec3 {
    const pos = { x: s.x, y: s.y, z: s.z };
    if (s.motion)
      pos[s.motion.axis] +=
        Math.sin(t * s.motion.speed + s.motion.phase) * s.motion.range;
    return pos;
  }

  /** All solids in a perspective at time t. */
  solids(mode: Mode = this.mode, t = this.time): Box[] {
    const out: Box[] = [];
    for (const i of this.level.islands) {
      if (!this.islandSolid(i, mode)) continue;
      const p = this.islandPosition(i, t);
      out.push({
        id: i.id,
        x0: p.x - i.w / 2,
        x1: p.x + i.w / 2,
        y0: p.y - i.h,
        y1: p.y,
        z0: p.z - i.d / 2,
        z1: p.z + i.d / 2,
      });
    }
    for (const w of this.level.walls) {
      const h = this.wallHeight(w);
      if (h < 0.05) continue;
      out.push({
        id: w.id,
        x0: w.x - w.w / 2,
        x1: w.x + w.w / 2,
        y0: w.y,
        y1: w.y + h,
        z0: w.z - w.d / 2,
        z1: w.z + w.d / 2,
      });
    }
    return out;
  }

  // ------------------------------------------------------------- simulation

  private emit(type: EventType, extra: Partial<GameEvent> = {}) {
    const p = this.player;
    this.events.push({
      type,
      position: { x: p.x, y: p.y + HEIGHT / 2, z: p.z },
      ...extra,
    });
  }

  private overlaps(
    x: number,
    y: number,
    z: number,
    b: Box,
    mode: Mode,
    r = RADIUS,
  ) {
    return (
      x + r > b.x0 + EPS &&
      x - r < b.x1 - EPS &&
      y + HEIGHT > b.y0 + EPS &&
      y < b.y1 - EPS &&
      (mode === "2d" || (z + r > b.z0 + EPS && z - r < b.z1 - EPS))
    );
  }

  private footprint(x: number, z: number, b: Box, mode: Mode, r = RADIUS) {
    return (
      x + r > b.x0 + EPS &&
      x - r < b.x1 - EPS &&
      (mode === "2d" || (z + r > b.z0 + EPS && z - r < b.z1 - EPS))
    );
  }

  /** The highest solid whose top is at or just below the feet. */
  private groundUnder(
    p: { x: number; y: number; z: number },
    reach = 0.06,
    solids = this.solids(),
  ) {
    let best: Box | undefined;
    for (const b of solids) {
      if (this.ghosts.has(b.id)) continue;
      if (!this.footprint(p.x, p.z, b, this.mode)) continue;
      if (b.y1 > p.y + 0.01 || b.y1 < p.y - reach) continue;
      if (!best || b.y1 > best.y1) best = b;
    }
    return best;
  }

  private spaceFree(x: number, y: number, z: number, solids: Box[]) {
    return !solids.some(
      (b) => !this.ghosts.has(b.id) && this.overlaps(x, y, z, b, this.mode),
    );
  }

  /** Fold or unfold. Always succeeds; overlaps become passable until clear. */
  toggleMode() {
    if (this.status === "clearing" || this.status === "clear") return;
    const p = this.player;
    const next: Mode = this.mode === "3d" ? "2d" : "3d";
    if (next === "3d") {
      // Unfold onto the island the keeper stands on or is above in the flat view.
      const below = this.solids("2d")
        .filter(
          (b) =>
            this.footprint(p.x, p.z, b, "2d") &&
            b.y1 <= p.y + 0.05 &&
            this.solids("3d").some((s) => s.id === b.id),
        )
        .sort((a, b) => b.y1 - a.y1)[0];
      const base =
        (p.support && this.solids("3d").find((b) => b.id === p.support)) ||
        below;
      if (base && (p.z - RADIUS < base.z0 || p.z + RADIUS > base.z1))
        p.z = clamp((base.z0 + base.z1) / 2, base.z0 + RADIUS, base.z1 - RADIUS);
    } else p.vz = 0;
    this.mode = next;
    this.folds++;
    this.sinceFold = 0;
    this.ghosts.clear();
    const solids = this.solids();
    for (const b of solids) {
      if (!this.overlaps(p.x, p.y, p.z, b, next)) continue;
      const lift = b.y1 - p.y;
      if (lift > 0 && lift <= 0.45 && this.spaceFree(p.x, b.y1, p.z, solids)) {
        p.y = b.y1;
        p.vy = Math.max(0, p.vy);
        p.grounded = true;
        p.support = b.id;
      } else this.ghosts.add(b.id);
    }
    this.spared.clear();
    for (const s of this.level.sentinels)
      if (this.touchesSentinel(s, 0.2)) this.spared.add(s.id);
    if (p.grounded) {
      const ground = this.groundUnder(p, 0.06, solids);
      if (ground) p.support = ground.id;
      else p.grounded = false;
    }
    this.emit("fold", { value: next === "2d" ? 1 : 0 });
  }

  private touchesSentinel(s: Sentinel, slack = 0) {
    const p = this.player;
    const c = this.sentinelPosition(s);
    const r = s.r + RADIUS * 0.8 + slack;
    return (
      Math.abs(p.x - c.x) < r &&
      Math.abs(p.y + HEIGHT / 2 - c.y) < s.r + HEIGHT * 0.4 + slack &&
      (this.mode === "2d" || Math.abs(p.z - c.z) < r)
    );
  }

  private die(cause: GameEvent["cause"]) {
    if (this.status !== "playing") return;
    this.status = "dying";
    this.sequence = DEATH_TIME;
    this.deaths++;
    const p = this.player;
    p.vx = p.vz = 0;
    p.vy = Math.min(p.vy, 0);
    this.emit("die", { cause });
  }

  private respawn() {
    const c = this.checkpoint;
    const facing = this.player.facing;
    this.player = this.freshPlayer(c);
    this.player.facing = facing;
    this.status = "playing";
    this.grace = RESPAWN_GRACE;
    this.ghosts.clear();
    this.spared.clear();
    const solids = this.solids();
    for (const b of solids)
      if (this.overlaps(c.x, c.y, c.z, b, this.mode)) this.ghosts.add(b.id);
    for (const s of this.level.sentinels)
      if (this.touchesSentinel(s, 0.3)) this.spared.add(s.id);
    const ground = this.groundUnder(this.player, 0.3, solids);
    if (ground) {
      this.player.y = ground.y1;
      this.player.support = ground.id;
    } else this.player.grounded = false;
    this.coyote = COYOTE;
    this.buffer = 0;
    this.emit("respawn");
  }

  step(input: Input, dt = STEP) {
    this.events = [];
    if (this.status === "clear") return;
    for (let i = 0; i < input.fold; i++) this.toggleMode();
    this.time += dt;
    this.sinceFold += dt;
    this.grace = Math.max(0, this.grace - dt);
    this.lockedCooldown = Math.max(0, this.lockedCooldown - dt);
    const p = this.player;

    if (this.status === "dying") {
      this.sequence -= dt;
      // The lost keeper drifts down a little before the light gathers again.
      p.vy = Math.max(-6, p.vy - GRAVITY_DOWN * 0.25 * dt);
      p.y += p.vy * dt;
      if (this.sequence <= 0) this.respawn();
      return;
    }
    if (this.status === "clearing") {
      this.sequence -= dt;
      const e = this.level.exit;
      const k = Math.min(1, dt * 3);
      p.x += (e.x - p.x) * k;
      if (this.mode === "3d") p.z += (e.z - p.z) * k;
      p.vx = p.vz = p.vy = 0;
      if (this.sequence <= 0) this.status = "clear";
      return;
    }
    this.elapsed += dt;

    // Ride the island underfoot.
    if (p.grounded && p.support) {
      const i = this.islandIndex.get(p.support);
      if (i?.motion) {
        const before = this.islandPosition(i, this.time - dt);
        const now = this.islandPosition(i, this.time);
        p.x += now.x - before.x;
        p.y += now.y - before.y;
        if (this.mode === "3d") p.z += now.z - before.z;
      }
    }
    const solids = this.solids();

    // Run.
    let ix = clamp(input.x, -1, 1);
    let iz = this.mode === "3d" ? clamp(input.z, -1, 1) : 0;
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    const moving = len > 0.08;
    const rate = (v: number, target: number) => {
      if (p.grounded)
        return (Math.abs(target) > Math.abs(v) && Math.sign(target) === Math.sign(v)) ||
          v === 0
          ? GROUND_ACCEL
          : GROUND_DECEL;
      return moving ? AIR_ACCEL : AIR_DECEL;
    };
    p.vx = approach(p.vx, ix * RUN_SPEED, rate(p.vx, ix * RUN_SPEED) * dt);
    p.vz = approach(p.vz, iz * RUN_SPEED, rate(p.vz, iz * RUN_SPEED) * dt);
    if (Math.abs(ix) > 0.1) p.facing = ix > 0 ? 1 : -1;
    if (moving) p.heading = Math.atan2(iz, ix);

    // Jump with buffering, coyote time and a variable height.
    if (input.jump && !this.lastJump) this.buffer = BUFFER;
    else this.buffer = Math.max(0, this.buffer - dt);
    this.lastJump = input.jump;
    this.coyote = p.grounded ? COYOTE : Math.max(0, this.coyote - dt);
    let jumped = false;
    if (this.buffer > 0 && this.coyote > 0) {
      p.vy = JUMP_SPEED;
      p.grounded = false;
      p.support = null;
      this.coyote = 0;
      this.buffer = 0;
      this.canCut = true;
      jumped = true;
      this.emit("jump");
    }
    if (!input.jump && this.canCut && p.vy > 0) {
      p.vy *= JUMP_CUT;
      this.canCut = false;
    }
    if (p.vy <= 0) this.canCut = false;
    if (!p.grounded) {
      let g = p.vy > 0 ? GRAVITY_UP : GRAVITY_DOWN;
      if (input.jump && Math.abs(p.vy) < APEX_BAND) g *= APEX_GRAVITY;
      p.vy = Math.max(-MAX_FALL, p.vy - g * dt);
    }

    // Horizontal movement, one axis at a time.
    const wasGrounded = p.grounded;
    this.moveAcross("x", p.vx * dt, solids);
    if (this.mode === "3d") this.moveAcross("z", p.vz * dt, solids);

    // Vertical movement.
    const prevY = p.y;
    p.y += p.vy * dt;
    if (p.vy <= 0) {
      let top: Box | undefined;
      for (const b of solids) {
        if (this.ghosts.has(b.id)) continue;
        if (!this.footprint(p.x, p.z, b, this.mode)) continue;
        if (prevY < b.y1 - 0.06 || p.y > b.y1 + EPS) continue;
        if (!top || b.y1 > top.y1) top = b;
      }
      // Walking down a small step stays on the ground.
      if (!top && wasGrounded && !jumped) {
        const below = this.groundUnder(p, STEP_UP, solids);
        if (below) top = below;
      }
      if (top) {
        const impact = -p.vy;
        p.y = top.y1;
        p.vy = 0;
        p.support = top.id;
        if (!wasGrounded) {
          p.sinceLand = 0;
          this.emit("land", { value: impact });
        }
        p.grounded = true;
      } else {
        p.grounded = false;
        p.support = null;
      }
    } else {
      p.grounded = false;
      p.support = null;
      for (const b of solids) {
        if (this.ghosts.has(b.id)) continue;
        if (!this.footprint(p.x, p.z, b, this.mode)) continue;
        if (prevY + HEIGHT > b.y0 + 0.06 || p.y + HEIGHT < b.y0) continue;
        // Graze a corner instead of stopping dead.
        const left = p.x + RADIUS - b.x0,
          right = b.x1 - (p.x - RADIUS);
        if (left < CORNER_NUDGE && this.spaceFree(b.x0 - RADIUS - EPS, p.y, p.z, solids)) {
          p.x = b.x0 - RADIUS - EPS;
          continue;
        }
        if (right < CORNER_NUDGE && this.spaceFree(b.x1 + RADIUS + EPS, p.y, p.z, solids)) {
          p.x = b.x1 + RADIUS + EPS;
          continue;
        }
        p.y = b.y0 - HEIGHT;
        p.vy = 0;
        this.canCut = false;
        this.emit("bump");
        break;
      }
    }

    this.depenetrate(solids);
    if (this.status !== "playing") return;

    // Passage through anything overlapped at a fold ends once the keeper is clear.
    for (const id of [...this.ghosts]) {
      const b = solids.find((s) => s.id === id);
      if (!b || !this.overlaps(p.x, p.y, p.z, b, this.mode, RADIUS + 0.02))
        this.ghosts.delete(id);
    }

    // Animation clocks and footsteps.
    if (p.grounded) {
      p.airTime = 0;
      p.sinceLand += dt;
      const speed = Math.hypot(p.vx, this.mode === "3d" ? p.vz : 0);
      p.stride += speed * dt;
      if (speed > 1 && p.stride >= this.nextFoot) {
        this.nextFoot = p.stride + STRIDE / 2;
        this.emit("step", { value: Math.floor(p.stride / (STRIDE / 2)) % 2 });
      }
    } else {
      p.airTime += dt;
      p.sinceLand += dt;
      this.nextFoot = p.stride + STRIDE / 4;
    }

    this.interact();
    if (p.y < this.level.bounds.floor) this.die("void");
  }

  private moveAcross(axis: "x" | "z", delta: number, solids: Box[]) {
    if (delta === 0) return;
    const p = this.player;
    const before = p[axis];
    p[axis] += delta;
    for (const b of solids) {
      if (this.ghosts.has(b.id)) continue;
      if (!this.overlaps(p.x, p.y, p.z, b, this.mode)) continue;
      // Walk up a low ledge.
      const rise = b.y1 - p.y;
      if (
        p.grounded &&
        rise > 0 &&
        rise <= STEP_UP &&
        this.spaceFree(p.x, b.y1, p.z, solids)
      ) {
        p.y = b.y1;
        p.support = b.id;
        continue;
      }
      const lo = axis === "x" ? b.x0 : b.z0;
      const hi = axis === "x" ? b.x1 : b.z1;
      p[axis] = before <= (lo + hi) / 2 ? lo - RADIUS - EPS : hi + RADIUS + EPS;
      if (axis === "x") p.vx = 0;
      else p.vz = 0;
    }
  }

  /** Resolve overlaps left by moving islands. A keeper with no way out is crushed. */
  private depenetrate(solids: Box[]) {
    const p = this.player;
    for (let pass = 0; pass < 3; pass++) {
      const b = solids.find(
        (b) => !this.ghosts.has(b.id) && this.overlaps(p.x, p.y, p.z, b, this.mode),
      );
      if (!b) return;
      const up = b.y1 - p.y;
      if (up <= 0.5 && this.spaceFree(p.x, b.y1, p.z, solids)) {
        p.y = b.y1;
        p.vy = Math.max(0, p.vy);
        p.grounded = true;
        p.support = b.id;
        continue;
      }
      const options: [number, () => void][] = [
        [p.x + RADIUS - b.x0, () => (p.x = b.x0 - RADIUS - EPS)],
        [b.x1 - (p.x - RADIUS), () => (p.x = b.x1 + RADIUS + EPS)],
        [p.y + HEIGHT - b.y0, () => (p.y = b.y0 - HEIGHT - EPS)],
      ];
      if (this.mode === "3d")
        options.push(
          [p.z + RADIUS - b.z0, () => (p.z = b.z0 - RADIUS - EPS)],
          [b.z1 - (p.z - RADIUS), () => (p.z = b.z1 + RADIUS + EPS)],
        );
      options.sort((a, b) => a[0] - b[0]);
      options[0][1]();
    }
    if (solids.some((b) => !this.ghosts.has(b.id) && this.overlaps(p.x, p.y, p.z, b, this.mode)))
      this.die("crush");
  }

  private interact() {
    const p = this.player;
    const flat = this.mode === "2d";
    const near = (c: Vec3, rx: number, ry: number, rz: number, cy = p.y) =>
      Math.abs(p.x - c.x) < rx &&
      Math.abs(cy - c.y) < ry &&
      (flat || Math.abs(p.z - c.z) < rz);

    for (const pick of this.level.pickups) {
      if (this.collected.has(pick.id)) continue;
      if (!near(this.pickupPosition(pick), 0.75, 0.95, 0.8, p.y + HEIGHT / 2))
        continue;
      this.collected.add(pick.id);
      const value = pick.kind === "seed" ? this.seeds : this.motes;
      this.events.push({
        type: pick.kind,
        position: this.pickupPosition(pick),
        id: pick.id,
        value,
      });
    }

    for (const l of this.level.lanterns) {
      if (this.lit.has(l.id)) continue;
      if (!near({ x: l.x, y: l.y + 0.8, z: l.z }, 0.85, 1.4, 0.95, p.y + HEIGHT / 2))
        continue;
      this.lit.set(l.id, this.time);
      this.events.push({ type: "lantern", position: { x: l.x, y: l.y + 1, z: l.z }, id: l.id });
      for (const w of this.level.walls)
        if (w.lantern === l.id)
          this.events.push({ type: "gate", position: { x: w.x, y: w.y + w.h / 2, z: w.z }, id: w.id });
      for (const i of this.level.islands)
        if (i.lantern === l.id)
          this.events.push({ type: "bridge", position: { x: i.x, y: i.y, z: i.z }, id: i.id });
    }

    if (p.grounded)
      for (const c of this.level.checkpoints) {
        if (c.id === this.checkpointId) continue;
        if (!near(c, 1.1, 0.6, 1.3)) continue;
        const order = this.level.checkpoints.findIndex((v) => v.id === c.id);
        const current = this.level.checkpoints.findIndex((v) => v.id === this.checkpointId);
        if (order < current) continue;
        this.checkpointId = c.id;
        this.checkpoint = { x: c.x, y: c.y, z: c.z };
        this.events.push({ type: "checkpoint", position: { x: c.x, y: c.y + 0.4, z: c.z }, id: c.id });
      }

    for (const h of this.level.hints) {
      if (this.hintsSeen.has(h.id)) continue;
      if (p.x < h.x0 || p.x > h.x1) continue;
      if (h.mode && h.mode !== this.mode) continue;
      this.hintsSeen.add(h.id);
      this.emit("hint", { id: h.id });
    }

    for (const id of [...this.spared])
      if (!this.touchesSentinel(this.level.sentinels.find((s) => s.id === id)!, 0.05))
        this.spared.delete(id);
    if (this.grace === 0)
      for (const s of this.level.sentinels)
        if (!this.spared.has(s.id) && this.touchesSentinel(s)) {
          this.die("sentinel");
          return;
        }

    const e = this.level.exit;
    if (near(e, 1.3, 1.3, 1.6)) {
      if (this.seeds >= this.seedTotal) {
        this.status = "clearing";
        this.sequence = CLEAR_TIME;
        this.emit("exit");
      } else if (this.lockedCooldown === 0) {
        this.lockedCooldown = LOCKED_COOLDOWN;
        this.emit("locked", { value: this.seedTotal - this.seeds });
      }
    }
  }

  snapshot() {
    const p = this.player;
    return {
      level: this.level.index,
      chapter: this.level.name,
      mode: this.mode,
      status: this.status,
      time: this.time,
      elapsed: this.elapsed,
      player: { ...p },
      seeds: this.seeds,
      motes: this.motes,
      collected: [...this.collected],
      lit: [...this.lit.keys()],
      checkpoint: this.checkpointId,
      deaths: this.deaths,
      folds: this.folds,
      ghosts: [...this.ghosts],
    };
  }
}
