import {
  checkpoint,
  floating,
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

/*
 * The six chapters. x runs along the journey, y is height and z is depth
 * (negative is farther from the camera). The main lane is z = 0; islands at
 * |z| >= 9 are out of reach in 3D and only join the path when folded.
 * Comfortable limits: gaps up to 3.8, climbs up to 1.8 (see DESIGN in
 * constants.ts). Each chapter's intended solution is its route in routes.ts.
 */

// 0. Teaches walking, jumping, folding across depth and unfolding past a far obstacle.
function wakingGarden() {
  const a1 = island("a1", 0, 0, 0, 10, 7);
  const a2 = island("a2", 9, 0.5, 0, 5, 6);
  const a3 = island("a3", 16, 1.5, 0, 5, 5, { style: "stone" });
  const b1 = island("b1", 22.5, 1.5, -12, 6, 6);
  const b2 = island("b2", 30, 1.5, 0, 7, 7);
  const c1 = island("c1", 40, 1.5, 0, 11, 8, { style: "stone" });
  const d1 = island("d1", 49, 2.5, 0, 5, 5);
  const d2 = island("d2", 56, 3.5, -12, 5, 5);
  const e1 = island("e1", 66, 3.5, 0, 11, 8);
  return level({
    id: "waking-garden",
    index: 0,
    name: "The waking garden",
    subtitle: "A little light goes a long way.",
    epigraph: "The garden wakes.",
    time: "morning",
    seed: 11,
    start: { x: -3, y: 0, z: 0 },
    islands: [a1, a2, a3, b1, b2, c1, d1, d2, e1],
    walls: [wall("r1", "rock", 40, -6, -12, 2.6, 3, 14)],
    pickups: [
      seed("s0", b1),
      seed("s1", c1, 3.5),
      seed("s2", d2),
      mote("m0", a2),
      mote("m1", a3, 1),
      mote("m2", b2),
      floating("m3", "mote", 30, 4.7, 0),
      mote("m4", c1, 0, -3),
      mote("m5", d1),
    ],
    checkpoints: [checkpoint("cp0", b2, -1), checkpoint("cp1", d1, -1)],
    exit: { x: 68, y: 3.5, z: 0, island: "e1" },
    hints: [
      hint("h0", -6, 3, "{move} to walk. {jump} to jump."),
      hint("h1", 13.5, 18.5, "That island is far behind. Press {fold} to fold the world flat.", "3d"),
      hint("h2", 34.5, 38.6, "Folded, far things block the path. Press {fold} to unfold and walk past.", "2d"),
      hint("h3", 60, 64, "The observatory wakes when it holds three sun seeds."),
    ],
    par: 75,
  });
}

// 1. Sunwalls block the folded path; walk around them in depth.
function hiddenCourtyard() {
  const a1 = island("a1", 0, 0, 0, 10, 8, { style: "stone" });
  const a2 = island("a2", 12, 0, 0, 10, 9, { style: "stone" });
  const b1 = island("b1", 22, 1, -13, 6, 6, { style: "stone" });
  const b2 = island("b2", 32, 1, -13, 10, 9, { style: "stone" });
  const c0 = island("c0", 40.5, 2, -6, 3, 3, { style: "plinth" });
  const c1 = island("c1", 47, 2, 0, 8, 8, { style: "stone" });
  const d1 = island("d1", 56, 3, 11, 5, 5);
  const d2 = island("d2", 62.5, 3, 11, 5, 5, { style: "stone" });
  const e1 = island("e1", 73, 3, 0, 12, 7, { style: "stone" });
  const f1 = island("f1", 81.5, 4.5, -11, 3, 3, { style: "ruin", h: 0.8 });
  const f2 = island("f2", 85.5, 6, 10, 3, 3, { style: "ruin", h: 0.8 });
  return level({
    id: "hidden-courtyard",
    index: 1,
    name: "The hidden courtyard",
    subtitle: "There is always another way around.",
    epigraph: "The courtyard shines.",
    time: "noon",
    seed: 23,
    start: { x: -3, y: 0, z: 0 },
    islands: [a1, a2, b1, b2, c0, c1, d1, d2, e1, f1, f2],
    walls: [
      wall("w1", "sunwall", 12, 0, 0, 1.2, 3.5, 6),
      wall("w2", "sunwall", 32, 1, -13, 1.2, 4, 6),
      wall("w3", "sunwall", 47.5, 2, -1, 1.2, 6, 6),
      wall("w4", "sunwall", 71, 3, -1, 1.2, 5, 6),
    ],
    pickups: [
      seed("s0", b1),
      seed("s1", d1),
      seed("s2", f2),
      mote("m0", a2, 0, -3.6),
      mote("m1", b2, 4, -16 + 13),
      mote("m2", c0),
      mote("m3", d2),
      mote("m4", e1, 0, 2.5),
      floating("m5", "mote", 81.5, 6.6, -11),
    ],
    checkpoints: [checkpoint("cp0", c1, -2.5, 2.5), checkpoint("cp1", e1, -4.5)],
    exit: { x: 76, y: 3, z: 0, island: "e1" },
    hints: [
      hint("h0", 6.5, 10, "Sunwalls are tall, but only so wide. Walk around with {depth}.", "3d"),
      hint("h1", 14, 17, "The next courtyard is far behind. Fold with {fold}.", "3d"),
      hint("h2", 27, 30.5, "Folded, the sunwall seals the way. Unfold and walk around it.", "2d"),
    ],
    par: 110,
  });
}

// 2. Moving islands, depth ferries that only matter in 3D, and star bridges that only exist folded.
function tideEngine() {
  const a1 = island("a1", 0, 0, 0, 10, 7, { style: "stone" });
  const a2 = island("a2", 10, 0, 0, 3, 3, { style: "plinth", motion: move("x", 2.5, 0.9) });
  const a3 = island("a3", 19, 0, 0, 8, 7, { style: "stone" });
  const b1 = island("b1", 27, 0.5, -5.5, 3, 3, { style: "plinth", motion: move("z", 5.5, 0.6, -Math.PI / 2) });
  const b2 = island("b2", 33, 1, -11, 6, 6, { style: "stone" });
  const c1 = island("c1", 41, 1, 0, 6, 6, { style: "plinth" });
  const c2 = island("c2", 51, 1, 0, 14, 1.6, { only: "2d" });
  const c3 = island("c3", 62, 1, 0, 8, 7);
  const d1 = island("d1", 69.5, 1, 0, 3, 3, { style: "plinth", motion: move("y", 3, 0.8) });
  const d2 = island("d2", 75, 5, 0, 6, 6, { style: "stone" });
  const e1 = island("e1", 85, 5, -12, 10, 8);
  return level({
    id: "tide-engine",
    index: 2,
    name: "The tide engine",
    subtitle: "Even stone remembers how to drift.",
    epigraph: "The tide turns.",
    time: "afternoon",
    seed: 37,
    start: { x: -3, y: 0, z: 0 },
    islands: [a1, a2, a3, b1, b2, c1, c2, c3, d1, d2, e1],
    walls: [wall("r1", "rock", 28.8, -5, -16, 1.6, 2.5, 16)],
    pickups: [
      seed("s0", b2),
      floating("s1", "seed", 51, 2.1, 0),
      floating("s2", "seed", 70.8, 6.5, 0),
      mote("m0", a2),
      mote("m1", a3, 2),
      mote("m2", b1),
      mote("m3", c3),
      mote("m4", d2),
      floating("m5", "mote", 56, 2.0, 0),
    ],
    checkpoints: [checkpoint("cp0", c1, -1.5), checkpoint("cp1", d2, -1)],
    exit: { x: 87, y: 5, z: -12, island: "e1" },
    hints: [
      hint("h0", 3, 5.5, "Bronze islands drift. Ride them across."),
      hint("h1", 21, 23.5, "This ferry sails in depth. Unfolded, it carries you behind the rock.", "3d"),
      hint("h2", 21, 23.5, "Folded, depth has no distance, and the rock bars the way. Unfold.", "2d"),
      hint("h3", 38, 44, "Starlight only holds you while the world is folded."),
    ],
    par: 120,
  });
}

// 3. Sentinels guard one depth; far lanterns open gates and raise bridges.
function violetArchive() {
  const a1 = island("a1", 0, 0, 0, 10, 7, { style: "ruin" });
  const a2 = island("a2", 13, 0, 0, 12, 8, { style: "stone" });
  const b1 = island("b1", 26, 1, 0, 10, 8, { style: "ruin" });
  const b2 = island("b2", 25, 1, -12, 6, 5, { style: "ruin" });
  const c1 = island("c1", 36, 1, 0, 8, 8, { style: "stone" });
  const c2 = island("c2", 37.5, 1, -11, 7, 5, { style: "ruin" });
  const d1 = island("d1", 46, 2, 0, 6, 7, { style: "ruin" });
  const d2 = island("d2", 55, 2, 0, 12, 2, { style: "bridge", lantern: "L2" });
  const d3 = island("d3", 65, 2, 0, 6, 6, { style: "ruin" });
  const e1 = island("e1", 76, 3, -11, 10, 8, { style: "stone" });
  return level({
    id: "violet-archive",
    index: 3,
    name: "The violet archive",
    subtitle: "A shadow is only one side of a thing.",
    epigraph: "The archive remembers.",
    time: "dusk",
    seed: 41,
    start: { x: -3, y: 0, z: 0 },
    islands: [a1, a2, b1, b2, c1, c2, d1, d2, d3, e1],
    walls: [
      wall("g1", "gate", 29.5, 1, 0, 1, 8, 5, "L1"),
      wall("w1", "sunwall", 46.5, 2, -0.5, 1.2, 4, 6),
    ],
    lanterns: [lantern("L1", b2, 1), lantern("L2", d1, 0.5, 2.6)],
    sentinels: [
      sentinel("n0", 13, 0.8, -1.5, move("x", 4, 0.9)),
      sentinel("n1", 37.5, 1.8, -11, move("x", 3, 1.0)),
      sentinel("n2", 69.5, 2.6, 0, move("y", 1.2, 1.3)),
    ],
    pickups: [
      seed("s0", a2, 4.5, -2.5),
      seed("s1", d3),
      seed("s2", c2, 1.5),
      mote("m0", a1, 2, -2.5),
      mote("m1", b2, -1.5),
      mote("m2", c1, 2, 2.5),
      mote("m3", d2, 0, 0, 0.9),
      mote("m4", e1, -2),
      mote("m5", d3, 2),
    ],
    checkpoints: [checkpoint("cp0", c1, -3), checkpoint("cp1", d3, -2)],
    exit: { x: 78, y: 3, z: -11, island: "e1" },
    hints: [
      hint("h0", 7, 10, "Sentinels guard a single depth. Unfolded, walk past them. Folded, leap clear.", "3d"),
      hint("h0b", 7, 10, "Sentinels guard a single depth. Leap clear, or unfold and walk past.", "2d"),
      hint("h1", 21, 25, "The lantern for this gate is far away. Folded, far things are within reach.", "3d"),
      hint("h2", 32, 34.5, "Folded, every sentinel stands in your way.", "2d"),
      hint("h3", 43, 45.5, "Some lanterns can only be reached with depth."),
    ],
    par: 140,
  });
}

// 4. Sunglass is only solid with depth; switch on the seam and in midair.
function nightCrossing() {
  const a1 = island("a1", 0, 0, 0, 10, 7);
  const a2 = island("a2", 11, 0, 0, 8, 7, { style: "stone" });
  const g1 = island("g1", 17, 1.5, 0, 2.2, 2.2, { only: "3d" });
  const g2 = island("g2", 20, 3, 0, 2.2, 2.2, { only: "3d" });
  const h1 = island("h1", 25, 4.5, 0, 6, 6, { style: "stone" });
  const gb = island("gb", 31.75, 4.5, 0, 7.5, 1.6, { only: "3d" });
  const sb = island("sb", 39, 4.5, 0, 8, 1.6, { only: "2d" });
  const b2 = island("b2", 46, 4.5, 0, 6, 6, { style: "stone" });
  const gp = island("gp", 51, 4.5, 0, 4, 2, { only: "3d" });
  const c1 = island("c1", 60, 3, -12, 7, 6);
  const d1 = island("d1", 69, 4, -12, 6, 6, { style: "stone" });
  const gz = island("gz", 75, 4, -6, 2, 12, { only: "3d" });
  const e1 = island("e1", 82.5, 4, 0, 10, 8, { style: "stone" });
  return level({
    id: "night-crossing",
    index: 4,
    name: "The night crossing",
    subtitle: "Carry the dawn through the dark.",
    epigraph: "The night gives way.",
    time: "night",
    seed: 53,
    start: { x: -3, y: 0, z: 0 },
    islands: [a1, a2, g1, g2, h1, gb, sb, b2, gp, c1, d1, gz, e1],
    sentinels: [sentinel("n0", 69, 4.8, -14, move("x", 2.5, 1.1))],
    pickups: [
      seed("s0", h1),
      seed("s1", c1),
      seed("s2", gz),
      mote("m0", g1),
      floating("m1", "mote", 11, 3.0, 0),
      mote("m2", gb),
      mote("m3", sb, 1.5),
      mote("m4", d1, 1.5, 2),
      mote("m5", e1, 2.5),
    ],
    checkpoints: [checkpoint("cp0", b2, -1.5), checkpoint("cp1", d1, -1.5, 1.5)],
    exit: { x: 84.5, y: 4, z: 0, island: "e1" },
    hints: [
      hint("h0", 9, 14.5, "Sunglass is only solid while the world has depth.", "3d"),
      hint("h0b", 9, 14.5, "The sunglass steps are gone while folded. Unfold to climb them.", "2d"),
      hint("h1", 28, 31, "Walk the glass, then fold where it meets the starlight.", "3d"),
      hint("h2", 49.5, 52.5, "Jump first, then fold in midair.", "3d"),
    ],
    par: 150,
  });
}

// 5. Everything together, up to the grand observatory.
function lastObservatory() {
  const a1 = island("a1", 0, 0, 0, 10, 7);
  const a2 = island("a2", 10.5, 0, 0, 3, 3, { style: "plinth", motion: move("x", 2.5, 0.9) });
  const a3 = island("a3", 20, 0.5, -11, 7, 6, { style: "stone" });
  const b1 = island("b1", 31, 0.5, -11, 10, 9, { style: "stone" });
  const c1 = island("c1", 42, 1.5, -11, 6, 6, { style: "stone" });
  const c2 = island("c2", 40, 1.5, 9, 5, 4);
  const d1 = island("d1", 52, 1.5, -11, 10, 8, { style: "stone" });
  const e1 = island("e1", 59, 3, -11, 2.2, 2.2, { only: "3d" });
  const e2 = island("e2", 62, 4.5, -11, 2.2, 2.2, { only: "3d" });
  const e3 = island("e3", 67, 6, -11, 6, 6, { style: "ruin" });
  const f1 = island("f1", 73.75, 6, -11, 7.5, 1.6, { only: "3d" });
  const f2 = island("f2", 81, 6, -11, 8, 1.6, { only: "2d" });
  const f3 = island("f3", 88, 6, -11, 6, 6, { style: "stone" });
  const g1 = island("g1", 93, 6, -11, 4, 2, { only: "3d" });
  const g2 = island("g2", 100.5, 4.5, 8, 7, 6);
  const h1 = island("h1", 106, 5, 0, 3, 3, { style: "plinth", motion: move("z", 7, 0.55) });
  const h2 = island("h2", 112, 5.5, -9, 6, 6, { style: "stone" });
  const i1 = island("i1", 120.5, 5.5, -9, 11, 2, { style: "bridge", lantern: "L2" });
  const j1 = island("j1", 135, 5.5, -2, 14, 12, { style: "stone" });
  return level({
    id: "last-observatory",
    index: 5,
    name: "The last observatory",
    subtitle: "Give the sky its sun back.",
    epigraph: "And so, the morning returns.",
    time: "dawn",
    seed: 67,
    start: { x: -3, y: 0, z: 0 },
    islands: [a1, a2, a3, b1, c1, c2, d1, e1, e2, e3, f1, f2, f3, g1, g2, h1, h2, i1, j1],
    walls: [
      wall("w1", "sunwall", 31, 0.5, -11, 1.2, 5, 6),
      wall("g1", "gate", 44, 1.5, -11, 1, 6, 5, "L1"),
      wall("r1", "rock", 108.2, -5, -16, 1.6, 2, 18),
    ],
    lanterns: [lantern("L1", c2, 0.5), lantern("L2", h2, 1.5)],
    sentinels: [
      sentinel("n0", 52, 2.3, -12.5, move("x", 3.5, 1.0)),
      sentinel("n1", 121, 6.3, -13, move("x", 4, 1.2)),
    ],
    pickups: [
      seed("s0", e3),
      seed("s1", g2),
      seed("s2", i1),
      mote("m0", a2),
      mote("m1", b1, 0, -3.5),
      mote("m2", c2, -1.5),
      mote("m3", d1, 2.5, 2.5),
      mote("m4", f2, 1),
      mote("m5", h1),
      mote("m6", j1, -3, 3),
    ],
    checkpoints: [
      checkpoint("cp0", d1, -3.5, 2.5),
      checkpoint("cp1", f3, -1.5),
      checkpoint("cp2", h2, -1.5),
    ],
    exit: { x: 137, y: 5.5, z: -2, island: "j1" },
    hints: [hint("h0", -6, 3, "Everything you have learned. Carry the sun home.")],
    par: 240,
  });
}

export const CHAPTERS = [
  wakingGarden(),
  hiddenCourtyard(),
  tideEngine(),
  violetArchive(),
  nightCrossing(),
  lastObservatory(),
];
