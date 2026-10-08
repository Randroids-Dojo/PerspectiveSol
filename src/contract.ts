import type { Game } from "./sim/game";
import type { GameEvent, Level, Vec3 } from "./sim/types";
import type { ViewFrame } from "./view";

/**
 * Contracts between the director (src/main.ts) and the independent renderers
 * and audio. Renderers read the simulation; they never change it.
 */

export type Quality = "high" | "low";

export type FrameInput = {
  /** Read only. */
  game: Game;
  view: ViewFrame;
  /** Real seconds since the previous frame, at most 0.1. */
  dt: number;
  /** Real seconds since start; keeps running in menus for ambient motion. */
  clock: number;
  /** A menu or pause screen covers play. Gameplay-driven animation should hold still. */
  paused: boolean;
};

export interface WorldRenderer {
  /** Build everything for a chapter. Called on chapter start and restart. */
  load(level: Level): void;
  /** Draw one frame. A renderer whose layer is invisible must not draw. */
  frame(input: FrameInput): void;
  /** React to a simulation event (bursts, flashes, dust). */
  event(e: GameEvent, game: Game): void;
  resize(width: number, height: number, dpr: number): void;
  setQuality(q: Quality): void;
  /** CSS pixel position of a world point as currently drawn, for HUD anchoring. */
  project(p: Vec3): { x: number; y: number } | null;
  /** Diagnostics for tests: frame counts, draw calls, etc. */
  snapshot(): Record<string, unknown>;
}

export type Cue = "title" | "ending" | number;
export type Stinger =
  | "ui-move"
  | "ui-select"
  | "ui-back"
  | "chapter-start"
  | "clear"
  | "ending"
  | "pause"
  | "resume";

export interface AudioDirector {
  /** Must be called from a user gesture (pointerup, touchend, click or keydown). */
  unlock(): void;
  /** Music for a chapter, the title, or the ending. Crossfades if already playing. */
  cue(c: Cue): void;
  /** 0 = sculpted arrangement, 1 = illustrated arrangement. Called every frame. */
  setFold(fold: number): void;
  /** Simulation events. pan is -1 (left of screen) .. 1 (right). */
  event(e: GameEvent, game: Game, pan: number): void;
  /** Per-frame: proximity sounds and adaptive layers. game is null in menus. */
  update(game: Game | null, dt: number): void;
  stinger(s: Stinger): void;
  setVolumes(music: number, effects: number): void;
  setMuted(muted: boolean): void;
  /** Pause screen: music ducks behind a soft filter, world sounds hold. */
  setPaused(paused: boolean): void;
  /** Hidden tab or lost focus: suspend all output without losing the transport. */
  suspend(suspended: boolean): void;
  snapshot(): Record<string, unknown>;
}
