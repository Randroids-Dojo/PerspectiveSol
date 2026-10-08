import {
  checkpoint,
  hint,
  island,
  lantern,
  level,
  mote,
  move,
  seed,
  sentinel,
  wall,
} from "./build";
import type { TimeOfDay } from "./types";

/**
 * A showcase containing every element type, for renderer and audio work.
 * Not part of the campaign. Open with ?level=gallery (and &time=night etc.).
 */
export function gallery(time: TimeOfDay = "morning") {
  const a = island("a", 0, 0, 0, 10, 7);
  const b = island("b", 8.5, 0.5, 0, 5, 5, { style: "stone" });
  const c = island("c", 14.5, 0.5, 0, 5, 2, { style: "bridge" });
  const d = island("d", 21, 1, 0, 4, 4, { style: "plinth", motion: move("x", 1.5, 0.8) });
  const e = island("e", 28.5, 1.5, 0, 9, 8);
  const f = island("f", 36, 1.5, -6, 5, 5, { style: "ruin" });
  const g = island("g", 44, 1.5, 0, 8, 6, { style: "stone" });
  const s = island("s", 51.5, 1.5, 0, 6, 1.6, { only: "2d" });
  const h = island("h", 57.5, 1.5, 0, 6, 6);
  const i = island("i", 61.8, 3, 2, 2, 2, { only: "3d" });
  const j = island("j", 64.6, 4.4, 2, 2, 2, { only: "3d" });
  const k = island("k", 69.5, 5, 0, 6, 6, { style: "ruin" });
  const l = island("l", 75.5, 5, 0, 5.2, 2, { style: "bridge", lantern: "L1" });
  const m = island("m", 81, 5, 0, 3, 3, { style: "plinth", motion: move("y", 1.2, 1) });
  const n = island("n", 86, 5.5, -3, 3, 3, { style: "plinth", motion: move("z", 3, 0.6) });
  const p = island("p", 95, 5.5, 0, 10, 8);
  return level({
    id: "gallery",
    index: 0,
    name: "The gallery",
    subtitle: "Every piece of the world, side by side.",
    epigraph: "A test of the light.",
    time,
    seed: 7,
    start: { x: -3, y: 0, z: 0 },
    islands: [a, b, c, d, e, f, g, s, h, i, j, k, l, m, n, p],
    walls: [
      wall("sunwall", "sunwall", 28.5, 1.5, 0, 1.4, 3, 5),
      wall("gate", "gate", 44, 1.5, 0, 1, 6, 4, "L0"),
      wall("rock", "rock", 90.5, -3, -9, 3, 3, 12),
    ],
    lanterns: [lantern("L0", e, 3, 3), lantern("L1", k, 2, -2)],
    sentinels: [
      sentinel("n0", 31, 2.1, -2.5, move("z", 1.2, 1.1)),
      sentinel("n1", 58, 2.2, 0, move("x", 1.5, 0.9)),
    ],
    pickups: [
      mote("m0", b),
      mote("m1", c),
      seed("s0", d),
      mote("m2", f),
      seed("s1", h, 1.5),
      seed("s2", k, -1),
      mote("m3", n),
    ],
    checkpoints: [checkpoint("c0", e, -3, 2), checkpoint("c1", h, -2)],
    exit: { x: 97, y: 5.5, z: 0, island: "p" },
    hints: [hint("h0", 4, 7, "Press {jump} to jump. Press {fold} to fold the world.")],
    par: 120,
  });
}
