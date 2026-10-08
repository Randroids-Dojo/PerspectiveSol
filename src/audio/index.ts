import type { AudioDirector, Cue, Stinger } from "../contract";
import type { Game } from "../sim/game";
import type { GameEvent } from "../sim/types";

/** Placeholder audio. To be replaced. */
export class Sound implements AudioDirector {
  unlock() {}
  cue(_c: Cue) {}
  setFold(_f: number) {}
  event(_e: GameEvent, _g: Game, _pan: number) {}
  update(_g: Game | null, _dt: number) {}
  stinger(_s: Stinger) {}
  setVolumes(_m: number, _e: number) {}
  setMuted(_m: boolean) {}
  setPaused(_p: boolean) {}
  suspend(_s: boolean) {}
  snapshot() {
    return {};
  }
}
