import type { AudioDirector, Cue, Stinger } from "../contract";
import type { Game } from "../sim/game";
import type { GameEvent } from "../sim/types";
import { bank } from "./bank";
import { Engine } from "./engine";

/**
 * Perspective Sol's audio director: an adaptive score with two arrangements
 * on one transport, designed effects and per-chapter ambience.
 *
 * Construction is free: sample synthesis starts in a background worker and
 * the AudioContext is created on the first unlock() (a user gesture).
 */
export class Sound implements AudioDirector {
  private ctx: AudioContext | null = null;
  private engine: Engine | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingCue: Cue | null = null;
  private fold = 0;
  private music = 0.6;
  private effects = 0.8;
  private muted = false;
  private paused = false;
  private suspended = false;
  private unlockedAt = 0;
  private errors: string[] = [];

  /** Audio must never break the game loop: failures are recorded, not thrown. */
  private safe(where: string, f: () => void) {
    try {
      f();
    } catch (err) {
      if (this.errors.length < 20) this.errors.push(`${where}: ${(err as Error)?.message ?? err}`);
    }
  }

  constructor() {
    if (typeof window === "undefined" || typeof AudioBuffer === "undefined") return;
    // Begin rendering samples off the main thread once the page has settled.
    const begin = () => bank.start("sculpted");
    if ("requestIdleCallback" in window) (window as Window).requestIdleCallback(begin, { timeout: 600 });
    else setTimeout(begin, 200);
  }

  unlock() {
    this.safe("unlock", () => this.unlockNow());
  }

  private unlockNow() {
    if (typeof window === "undefined") return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!this.ctx) {
      bank.start(this.fold > 0.5 ? "illustrated" : "sculpted");
      const ctx = new Ctor({ latencyHint: "interactive" });
      this.ctx = ctx;
      this.unlockedAt = performance.now();
      const engine = new Engine(ctx, bank);
      this.engine = engine;
      engine.setFold(this.fold);
      engine.setVolumes(this.music, this.effects);
      engine.setMuted(this.muted);
      engine.setPaused(this.paused);
      // A silent buffer inside the gesture wakes stricter mobile browsers.
      const blip = ctx.createBufferSource();
      blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      blip.connect(ctx.destination);
      blip.start();
      // Give the first cue a moment for its core instruments if synthesis is
      // still running, but never more than a fraction of a second.
      const started = performance.now();
      const ready = () =>
        bank.complete ||
        ["inst:pad:60", "inst:bass:42", "inst:piano:72", "inst:harmonium:60", "inst:harp:60", "inst:flute:74"].every((k) => bank.has(k));
      const begin = () => {
        if (!ready() && performance.now() - started < 900) {
          setTimeout(begin, 50);
          return;
        }
        if (this.pendingCue !== null) this.safe("cue", () => engine.cue(this.pendingCue as Cue));
      };
      begin();
      // Lookahead scheduler. Hidden tabs throttle timers to about once a
      // second, so schedule further ahead there.
      this.timer = setInterval(() => {
        if (this.ctx?.state !== "running") return;
        const hidden = typeof document !== "undefined" && document.hidden;
        this.safe("pump", () => engine.pump(hidden ? 1.6 : undefined));
      }, 30);
    }
    if (!this.suspended && this.ctx.state !== "running") void this.ctx.resume().catch(() => undefined);
  }

  cue(c: Cue) {
    this.pendingCue = c;
    this.safe("cue", () => this.engine?.cue(c));
  }

  setFold(fold: number) {
    this.fold = fold;
    this.safe("setFold", () => this.engine?.setFold(fold));
  }

  event(e: GameEvent, game: Game, pan: number) {
    if (!this.engine || this.ctx?.state !== "running") return;
    this.safe("event", () => this.engine?.event(e, game, pan));
  }

  update(game: Game | null, dt: number) {
    if (!this.engine || this.ctx?.state !== "running") return;
    this.safe("update", () => this.engine?.update(game, dt));
  }

  stinger(s: Stinger) {
    if (!this.engine || this.ctx?.state !== "running") return;
    this.safe("stinger", () => this.engine?.stinger(s));
  }

  setVolumes(music: number, effects: number) {
    this.music = music;
    this.effects = effects;
    this.safe("setVolumes", () => this.engine?.setVolumes(music, effects));
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.safe("setMuted", () => this.engine?.setMuted(muted));
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.safe("setPaused", () => this.engine?.setPaused(paused));
  }

  suspend(suspended: boolean) {
    this.suspended = suspended;
    if (!this.ctx) return;
    if (suspended) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
  }

  /** Internals for diagnostics and tests. */
  get internals() {
    return { ctx: this.ctx, engine: this.engine, bank };
  }

  snapshot() {
    const e = this.engine;
    const ctx = this.ctx;
    const pos = e?.music.position();
    return {
      state: ctx?.state ?? "locked",
      cue: e?.music.cueName ?? (this.pendingCue === null ? null : String(this.pendingCue)),
      fold: this.fold,
      transport: e && e.music.firstStart >= 0 && ctx ? Math.max(0, ctx.currentTime - e.music.firstStart) : 0,
      contextTime: ctx?.currentTime ?? 0,
      bar: pos?.bar ?? 0,
      beat: pos?.beat ?? 0,
      section: pos?.section ?? null,
      pass: pos?.pass ?? 0,
      bpm: pos?.bpm ?? 0,
      key: pos ? `${["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][pos.key.tonic]} ${pos.key.mode}` : null,
      musicVolume: this.music,
      effectsVolume: this.effects,
      muted: this.muted,
      paused: this.paused,
      suspended: this.suspended,
      voices: e?.music.stats.voices ?? 0,
      peakVoices: e?.music.stats.peakVoices ?? 0,
      noteOns: e?.music.stats.noteOns ?? 0,
      skippedNotes: e?.music.stats.skipped ?? 0,
      effectVoices: e?.fx.live ?? 0,
      effectsPlayed: e?.fx.played ?? 0,
      ambience: e?.ambience.active ? e.ambience.profile : null,
      ambienceLoops: e?.ambience.loopCount ?? 0,
      tension: e?.tension.level ?? 0,
      radiant: e?.radiant ?? 0,
      dying: e?.dying ?? false,
      samples: `${bank.loaded}/${bank.total}`,
      samplesReady: bank.complete,
      sampleMB: Math.round(bank.megabytes * 10) / 10,
      renderMs: bank.finishedAt ? Math.round(bank.finishedAt - bank.startedAt) : null,
      schedulerMsPerCall: e && e.schedulerCalls ? e.schedulerMs / e.schedulerCalls : 0,
      sampleRate: ctx?.sampleRate ?? 0,
      baseLatency: ctx?.baseLatency ?? 0,
      unlockedMs: this.unlockedAt ? Math.round(performance.now() - this.unlockedAt) : 0,
      errors: [...this.errors, ...bank.errors],
    };
  }
}
