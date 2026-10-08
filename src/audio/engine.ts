import type { Cue, Stinger } from "../contract";
import type { Game } from "../sim/game";
import type { GameEvent, TimeOfDay } from "../sim/types";
import { Ambience, Tension } from "./ambience";
import type { Bank } from "./bank";
import type { Surface } from "./catalog";
import { Mixer } from "./mixer";
import { Music } from "./music";
import { Effects } from "./sfx";

/**
 * Everything that makes sound, bound to one (live or offline) AudioContext.
 * The Sound director owns the context; this class owns the graph.
 */
export class Engine {
  readonly ctx: BaseAudioContext;
  readonly mixer: Mixer;
  readonly music: Music;
  readonly fx: Effects;
  readonly ambience: Ambience;
  readonly tension: Tension;
  fold = 0;
  paused = false;
  dying = false;
  radiant = 0;
  private radiantOn = false;
  private radiantOffAt = 0;
  musicVolume = 0.6;
  effectsVolume = 0.8;
  muted = false;
  schedulerMs = 0;
  schedulerCalls = 0;
  private lastStatus = "";

  constructor(ctx: BaseAudioContext, bank: Bank) {
    this.ctx = ctx;
    this.mixer = new Mixer(ctx);
    this.music = new Music(ctx, this.mixer, bank);
    this.fx = new Effects(ctx, this.mixer, bank, () => this.music.position()?.key ?? this.music.targetKey());
    this.ambience = new Ambience(ctx, this.mixer, bank);
    this.tension = new Tension(ctx, this.mixer, bank);
    for (const side of [0, 1] as const) {
      this.mixer.role(side, "shimmer").gain.value = 0;
      this.mixer.role(side, "halo").gain.value = 0;
    }
    this.setVolumes(this.musicVolume, this.effectsVolume);
  }

  /** Lookahead scheduling; cheap enough to call every frame and from a timer. */
  pump(lookahead?: number) {
    const t0 = performance.now();
    const now = this.ctx.currentTime;
    this.music.pump(now, lookahead === undefined ? undefined : now + lookahead);
    this.schedulerMs += performance.now() - t0;
    this.schedulerCalls++;
  }

  cue(c: Cue) {
    const before = this.music.targetKey().tonic;
    this.music.cue(String(c));
    this.pump();
    if (this.music.targetKey().tonic !== before) this.ambience.retune(this.music.targetKey());
  }

  setFold(f: number) {
    const v = Math.max(0, Math.min(1, f));
    if (Math.abs(v - this.fold) < 1e-4 && this.schedulerCalls > 0) return;
    this.fold = v;
    this.mixer.setFold(v);
    this.music.setFold(v);
  }

  setVolumes(music: number, effects: number) {
    this.musicVolume = music;
    this.effectsVolume = effects;
    this.mixer.setVolumes(music, effects, this.muted);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.mixer.setVolumes(this.musicVolume, this.effectsVolume, m);
  }

  setPaused(p: boolean) {
    if (p === this.paused) return;
    this.paused = p;
    this.mixer.setWorldHeld(p);
    this.shape();
  }

  private shape() {
    if (this.paused) this.mixer.shapeMusic(this.dying ? 420 : 900, 0.42, 0.15);
    else if (this.dying) this.mixer.shapeMusic(420, 0.7, 0.05);
    else this.mixer.shapeMusic(20000, 1, 0.35);
  }

  stinger(s: Stinger) {
    this.fx.stinger(s);
  }

  event(e: GameEvent, game: Game, pan: number) {
    if (this.paused) return;
    const p = game.player;
    const distance = Math.hypot(e.position.x - p.x, e.position.y - p.y);
    switch (e.type) {
      case "jump":
        this.fx.jump(pan);
        break;
      case "land":
        this.fx.land(e.value ?? 8, surfaceUnder(game), pan);
        break;
      case "step":
        this.fx.step(e.value ?? 0, surfaceUnder(game), pan);
        break;
      case "bump":
        this.fx.bump(pan);
        break;
      case "fold":
        this.fx.fold(e.value === 1, pan);
        break;
      case "seed":
        this.fx.seed(e.value ?? game.seeds, game.seedTotal, pan);
        break;
      case "mote":
        this.fx.mote(e.value ?? game.motes, pan);
        break;
      case "checkpoint":
        this.fx.checkpoint(pan);
        break;
      case "lantern":
        this.fx.lantern(pan);
        break;
      case "gate":
        this.fx.gate(pan, distance);
        break;
      case "bridge":
        this.fx.bridge(pan, distance);
        break;
      case "die":
        this.fx.die(e.cause, pan);
        this.dying = true;
        this.shape();
        break;
      case "respawn":
        this.fx.respawn(pan);
        this.dying = false;
        this.shape();
        break;
      case "locked":
        this.fx.locked(e.value ?? 1, pan);
        break;
      case "exit":
        this.fx.exit(pan);
        break;
      case "hint":
        this.fx.hint(pan);
        break;
    }
  }

  update(game: Game | null, dt: number) {
    this.pump();
    const now = this.ctx.currentTime;
    const time: TimeOfDay | null = game ? game.level.theme.time : null;
    const pos = this.music.position(now);
    const beat = pos ? { period: pos.beatPeriod, anchor: pos.barStart } : null;
    this.ambience.update(this.paused ? null : time, dt, this.music.targetKey(), beat);

    // Tension: the nearest sentinel, in the current perspective's distance.
    let level = 0;
    let pan = 0;
    if (game && game.status === "playing" && !this.paused) {
      const p = game.player;
      const cy = p.y + 0.6;
      for (const s of game.level.sentinels) {
        const c = game.sentinelPosition(s);
        const dz = game.mode === "2d" ? 0 : c.z - p.z;
        const d = Math.hypot(c.x - p.x, c.y - cy, dz) - s.r;
        const k = Math.max(0, Math.min(1, 1 - (d - 0.6) / 7.5));
        if (k > level) {
          level = k;
          pan = (c.x - p.x) / 6;
        }
      }
    }
    if (game && game.status !== this.lastStatus) {
      if (this.lastStatus === "dying" && game.status === "playing" && this.dying) {
        this.dying = false;
        this.shape();
      }
      this.lastStatus = game.status;
    }
    this.tension.update(level, pan, this.music.targetKey());

    // Radiant shimmer once every seed is held.
    const radiant = !!game && game.seedTotal > 0 && game.seeds >= game.seedTotal;
    if (radiant !== this.radiantOn) {
      this.radiantOn = radiant;
      for (const side of [0, 1] as const)
        for (const role of ["shimmer", "halo"] as const) {
          const g = this.mixer.role(side, role).gain;
          g.cancelScheduledValues(now);
          g.setTargetAtTime(radiant ? this.mixer.roleLevel(side, role) : 0, now, radiant ? 1.2 : 0.8);
        }
      if (radiant) this.music.radiant = true;
      else this.radiantOffAt = now + 4;
    }
    if (!this.radiantOn && this.music.radiant && now > this.radiantOffAt) this.music.radiant = false;
    this.radiant = radiant ? 1 : 0;
  }
}

function surfaceUnder(game: Game): Surface {
  const id = game.player.support;
  if (!id) return "stone";
  const island = game.island(id);
  if (island) {
    if (island.only === "2d") return "soft";
    if (island.only === "3d") return "glass";
    switch (island.style) {
      case "garden":
        return "grass";
      case "plinth":
        return "bronze";
      case "bridge":
        return "wood";
      case "ruin":
        return "gravel";
      default:
        return "stone";
    }
  }
  const wall = game.level.walls.find((w) => w.id === id);
  if (wall?.kind === "rock") return "gravel";
  if (wall?.kind === "gate") return "bronze";
  return "stone";
}
