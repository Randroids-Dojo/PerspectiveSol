import {
  LEVELS,
  platformAt,
  hazardAt,
  type Vec,
  type Platform,
} from "./levels";
export type Input = {
  x: number;
  z: number;
  jump: boolean;
  shift: boolean;
  interact: boolean;
};
export const EMPTY: Input = {
  x: 0,
  z: 0,
  jump: false,
  shift: false,
  interact: false,
};
export type Event = {
  type:
    | "jump"
    | "land"
    | "shift"
    | "shard"
    | "mote"
    | "fall"
    | "checkpoint"
    | "clear"
    | "locked";
  position: Vec;
  value?: number;
};
export type Save = {
  version: 1;
  unlocked: number;
  level: number;
  collected: string[];
  motes: number;
  records: (number | null)[];
  finished: boolean;
  checkpointIndex?: number;
  elapsed?: number;
  deaths?: number;
  shifts?: number;
  mode?: "2d" | "3d";
};
const radius = 0.32,
  height = 1.18;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export class Game {
  levelIndex = 0;
  mode: "2d" | "3d" = "3d";
  status: "playing" | "clear" | "complete" = "playing";
  player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, facing: 1 };
  collected = new Set<string>();
  motes = 0;
  deaths = 0;
  shifts = 0;
  elapsed = 0;
  time = 0;
  checkpoint: Vec = { x: 0, y: 0, z: 0 };
  checkpointIndex = -1;
  events: Event[] = [];
  coyote = 0.12;
  buffer = 0;
  invincible = 0;
  noticeCooldown = 0;
  lastJump = false;
  lastShift = false;
  lastInteract = false;
  support: string | null = null;
  unlocked = 0;
  records: (number | null)[] = Array(6).fill(null);
  finished = false;
  constructor() {
    this.loadLevel(0);
  }
  get level() {
    return LEVELS[this.levelIndex];
  }
  emit(type: Event["type"], value?: number) {
    this.events.push({
      type,
      position: { x: this.player.x, y: this.player.y + 0.6, z: this.player.z },
      value,
    });
  }
  loadLevel(index: number, collected: string[] = []) {
    this.levelIndex = clamp(index, 0, LEVELS.length - 1);
    this.status = "playing";
    this.time = 0;
    this.elapsed = 0;
    this.deaths = 0;
    this.shifts = 0;
    this.collected = new Set(
      collected.filter((id) =>
        this.level.collectibles.some((c) => c.id === id),
      ),
    );
    this.checkpoint = { ...this.level.start };
    this.checkpointIndex = -1;
    this.support = this.level.platforms[0].id;
    this.player = {
      ...this.level.start,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      facing: 1,
    };
    this.coyote = 0.12;
    this.buffer = 0;
    this.invincible = 0;
    this.events = [];
    this.lastJump = false;
    this.lastShift = false;
    this.lastInteract = false;
  }
  restore(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") return false;
    const s = raw as Save;
    if (
      s.version !== 1 ||
      !Number.isInteger(s.unlocked) ||
      s.unlocked < 0 ||
      s.unlocked >= 6 ||
      !Number.isInteger(s.level) ||
      s.level < 0 ||
      s.level > s.unlocked ||
      !Array.isArray(s.collected) ||
      s.collected.some((v) => typeof v !== "string") ||
      !Array.isArray(s.records) ||
      s.records.length !== 6 ||
      s.records.some(
        (v) =>
          v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0),
      ) ||
      !Number.isInteger(s.motes) ||
      s.motes < 0 ||
      typeof s.finished !== "boolean"
    )
      return false;
    for (const key of ["elapsed", "deaths", "shifts"] as const)
      if (
        s[key] !== undefined &&
        (typeof s[key] !== "number" || !Number.isFinite(s[key]) || s[key]! < 0)
      )
        return false;
    if (
      s.checkpointIndex !== undefined &&
      (!Number.isInteger(s.checkpointIndex) ||
        s.checkpointIndex < -1 ||
        s.checkpointIndex >= LEVELS[s.level].checkpoints.length)
    )
      return false;
    if (s.mode !== undefined && s.mode !== "2d" && s.mode !== "3d")
      return false;
    this.unlocked = s.unlocked;
    this.records = [...s.records];
    this.motes = s.motes;
    this.finished = s.finished;
    this.loadLevel(s.level, s.collected);
    this.mode = s.mode ?? "3d";
    this.elapsed = s.elapsed ?? 0;
    this.deaths = s.deaths ?? 0;
    this.shifts = s.shifts ?? 0;
    this.checkpointIndex = s.checkpointIndex ?? -1;
    if (this.checkpointIndex >= 0) {
      this.checkpoint = { ...this.level.checkpoints[this.checkpointIndex] };
      Object.assign(this.player, this.checkpoint);
      this.support =
        this.level.platforms.find(
          (p) =>
            Math.abs(p.x - this.checkpoint.x) < p.w / 2 &&
            p.y === this.checkpoint.y,
        )?.id ?? null;
    }
    return true;
  }
  save(): Save {
    return {
      version: 1,
      unlocked: this.unlocked,
      level: this.levelIndex,
      collected: [...this.collected],
      motes: this.motes,
      records: [...this.records],
      finished: this.finished,
      checkpointIndex: this.checkpointIndex,
      elapsed: this.elapsed,
      deaths: this.deaths,
      shifts: this.shifts,
      mode: this.mode,
    };
  }
  shift() {
    if (this.status !== "playing") return;
    this.mode = this.mode === "3d" ? "2d" : "3d";
    this.shifts++;
    this.player.vz = 0;
    // A collapsed landing belongs to a real island. Unfold at that island's depth.
    if (this.mode === "3d" && this.player.grounded && this.support) {
      const p = this.level.platforms.find((p) => p.id === this.support);
      if (p) this.player.z = platformAt(p, this.time).z;
    }
    this.emit("shift");
  }
  respawn() {
    this.emit("fall");
    this.deaths++;
    Object.assign(this.player, this.checkpoint, {
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: false,
    });
    this.invincible = 1.2;
    this.coyote = 0;
    this.support = null;
    this.buffer = 0;
  }
  step(input: Input, dt: number) {
    dt = clamp(dt, 0, 1 / 30);
    this.events = [];
    if (this.status !== "playing") return;
    this.time += dt;
    this.elapsed += dt;
    this.invincible = Math.max(0, this.invincible - dt);
    this.noticeCooldown = Math.max(0, this.noticeCooldown - dt);
    if (input.shift && !this.lastShift) this.shift();
    this.lastShift = input.shift;
    if (input.jump && !this.lastJump) this.buffer = 0.14;
    else this.buffer = Math.max(0, this.buffer - dt);
    this.lastJump = input.jump;
    const b = this.player,
      previousY = b.y;
    const surfaces = this.level.platforms.map((p) => platformAt(p, this.time));
    if (b.grounded && this.support) {
      const original = this.level.platforms.find((p) => p.id === this.support)!;
      const old = platformAt(original, this.time - dt),
        now = platformAt(original, this.time);
      b.x += now.x - old.x;
      b.y += now.y - old.y;
      b.z += now.z - old.z;
    }
    const speed = 5.9;
    let x = clamp(input.x, -1, 1),
      z = this.mode === "3d" ? clamp(input.z, -1, 1) : 0;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    const accel = b.grounded ? 18 : 9;
    b.vx += (x * speed - b.vx) * Math.min(1, accel * dt);
    b.vz += (z * speed - b.vz) * Math.min(1, accel * dt);
    if (Math.abs(x) > 0.05) b.facing = Math.sign(x);
    this.coyote = b.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0) {
      b.vy = 10.6;
      b.grounded = false;
      this.support = null;
      this.coyote = 0;
      this.buffer = 0;
      this.emit("jump");
    }
    if (!input.jump && b.vy > 4.2) b.vy -= 28 * dt;
    const oldX = b.x,
      oldZ = b.z;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    const solids = [
      ...surfaces.map((p) => ({
        x: p.x,
        z: p.z,
        y: p.y - p.h,
        w: p.w,
        d: p.d,
        h: p.h,
      })),
      ...this.level.walls,
    ];
    for (const w of solids) {
      if (b.y >= w.y + w.h - 0.035 || b.y + height <= w.y + 0.02) continue;
      if (
        Math.abs(b.x - w.x) >= w.w / 2 + radius ||
        (this.mode === "3d" && Math.abs(b.z - w.z) >= w.d / 2 + radius)
      )
        continue;
      const oldOutsideX = Math.abs(oldX - w.x) >= w.w / 2 + radius - 0.03;
      if (this.mode === "2d" || oldOutsideX) {
        b.x =
          w.x + Math.sign(oldX - w.x || -b.facing) * (w.w / 2 + radius + 0.002);
        b.vx = 0;
      } else {
        b.z = w.z + Math.sign(oldZ - w.z || 1) * (w.d / 2 + radius + 0.002);
        b.vz = 0;
      }
    }
    if (!b.grounded) b.vy -= 25 * dt;
    const wasGrounded = b.grounded;
    const before = b.y;
    b.y += b.vy * dt;
    b.grounded = false;
    this.support = null;
    let landing: Platform | undefined;
    for (const p of surfaces) {
      const overlaps =
        Math.abs(b.x - p.x) < p.w / 2 + radius * 0.7 &&
        (this.mode === "2d" || Math.abs(b.z - p.z) < p.d / 2 + radius * 0.7);
      if (
        overlaps &&
        b.vy <= 0 &&
        Math.max(before, previousY) >= p.y - 0.1 &&
        b.y <= p.y + 0.055 &&
        (!landing || p.y > landing.y)
      )
        landing = p;
      // A jump cannot pass through the underside of an island.
      if (
        overlaps &&
        b.vy > 0 &&
        before + height <= p.y - p.h + 0.05 &&
        b.y + height >= p.y - p.h
      ) {
        b.y = p.y - p.h - height;
        b.vy = 0;
      }
    }
    if (landing) {
      b.y = landing.y;
      b.vy = 0;
      b.grounded = true;
      this.support = landing.id;
      if (this.mode === "2d") b.z = landing.z;
      if (!wasGrounded) this.emit("land");
    }
    // Walls are full solids, including ceilings and walkable tops.
    for (const w of this.level.walls) {
      if (
        Math.abs(b.x - w.x) > w.w / 2 + radius * 0.7 ||
        (this.mode === "3d" && Math.abs(b.z - w.z) > w.d / 2 + radius * 0.7)
      )
        continue;
      if (b.vy > 0 && before + height <= w.y + 0.05 && b.y + height >= w.y) {
        b.y = w.y - height;
        b.vy = 0;
      }
      if (b.vy <= 0 && before >= w.y + w.h - 0.04 && b.y <= w.y + w.h) {
        b.y = w.y + w.h;
        b.vy = 0;
        b.grounded = true;
      }
    }
    for (const collect of this.level.collectibles) {
      if (this.collected.has(collect.id)) continue;
      const original = this.level.platforms.find(
        (p) => p.id === collect.platform,
      )!;
      const p = platformAt(original, this.time);
      const cx = collect.x + p.x - original.x,
        cy = collect.y + p.y - original.y,
        cz = collect.z + p.z - original.z;
      if (
        Math.abs(b.x - cx) < 0.9 &&
        Math.abs(b.y + 0.65 - cy) < 1.0 &&
        (this.mode === "2d" || Math.abs(b.z - cz) < 0.95)
      ) {
        this.collected.add(collect.id);
        if (collect.kind === "mote") this.motes++;
        this.emit(collect.kind, this.collected.size);
      }
    }
    this.level.checkpoints.forEach((c, i) => {
      if (i <= this.checkpointIndex) return;
      if (
        b.grounded &&
        Math.abs(b.x - c.x) < 1.3 &&
        (this.mode === "2d" || Math.abs(b.z - c.z) < 1.3)
      ) {
        this.checkpoint = { ...c };
        this.checkpointIndex = i;
        this.emit("checkpoint");
      }
    });
    if (this.invincible === 0) {
      for (const original of this.level.hazards) {
        const h = hazardAt(original, this.time);
        if (
          Math.abs(b.x - h.x) < h.r + radius &&
          Math.abs(b.y + 0.6 - h.y) < h.r + 0.5 &&
          (this.mode === "2d" || Math.abs(b.z - h.z) < h.r + radius)
        ) {
          this.respawn();
          return;
        }
      }
    }
    if (b.y < -13) {
      this.respawn();
      return;
    }
    const e = this.level.exit,
      near =
        Math.abs(b.x - e.x) < 1.7 &&
        Math.abs(b.y - e.y) < 1.5 &&
        (this.mode === "2d" || Math.abs(b.z - e.z) < 1.7);
    const shards = this.level.collectibles.filter(
      (c) => c.kind === "shard" && this.collected.has(c.id),
    ).length;
    if (near && input.interact && !this.lastInteract) {
      if (shards === 3) {
        this.records[this.levelIndex] = Math.min(
          this.records[this.levelIndex] ?? Infinity,
          this.elapsed,
        );
        this.unlocked = Math.max(
          this.unlocked,
          Math.min(5, this.levelIndex + 1),
        );
        this.status = this.levelIndex === 5 ? "complete" : "clear";
        if (this.status === "complete") this.finished = true;
        this.emit("clear");
      } else if (this.noticeCooldown <= 0) {
        this.emit("locked", 3 - shards);
        this.noticeCooldown = 2;
      }
    }
    this.lastInteract = input.interact;
  }
  snapshot() {
    return {
      level: this.levelIndex,
      chapter: this.level.name,
      mode: this.mode,
      status: this.status,
      player: { ...this.player },
      support: this.support,
      shards: this.level.collectibles.filter(
        (c) => c.kind === "shard" && this.collected.has(c.id),
      ).length,
      collected: [...this.collected],
      motes: this.motes,
      deaths: this.deaths,
      shifts: this.shifts,
      elapsed: this.elapsed,
      checkpoint: { ...this.checkpoint },
      unlocked: this.unlocked,
      finished: this.finished,
    };
  }
}
