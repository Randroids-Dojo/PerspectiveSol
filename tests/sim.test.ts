import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/sim/game";
import { checkpoint, island, lantern, level, move, seed, sentinel, wall } from "../src/sim/build";
import { IDLE, type Input, type Level } from "../src/sim/types";
import { JUMP_SPEED, RUN_SPEED } from "../src/sim/constants";

const run = (g: Game, n: number, input: Partial<Input> = {}) => {
  const events: string[] = [];
  for (let i = 0; i < n; i++) {
    g.step({ ...IDLE, ...input });
    events.push(...g.events.map((e) => e.type));
  }
  return events;
};
const fold = (g: Game) => g.step({ ...IDLE, fold: 1 });

function stage(extra: Partial<Parameters<typeof level>[0]> = {}): Level {
  const home = island("home", 0, 0, 0, 10, 6);
  return level({
    id: "test",
    index: 0,
    name: "Test",
    subtitle: "",
    epigraph: "",
    time: "morning",
    seed: 1,
    start: { x: -3, y: 0, z: 0 },
    islands: [home, ...(extra.islands ?? [])],
    pickups: extra.pickups ?? [],
    exit: extra.exit ?? { x: 0, y: 40, z: 0, island: "home" },
    par: 60,
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => !["islands", "pickups", "exit"].includes(k))),
  });
}

test("running reaches full speed quickly and stops cleanly", () => {
  const g = new Game(stage());
  run(g, 15, { x: 1 });
  assert.ok(Math.abs(g.player.vx - RUN_SPEED) < 0.01, `vx ${g.player.vx}`);
  run(g, 20);
  assert.equal(g.player.vx, 0);
  assert.ok(g.player.grounded);
});

test("a held jump climbs about two units and a tap makes a short hop", () => {
  const high = new Game(stage());
  const low = new Game(stage());
  let peakHigh = 0,
    peakLow = 0;
  high.step({ ...IDLE, jump: true });
  low.step({ ...IDLE, jump: true });
  assert.ok(high.player.vy > JUMP_SPEED - 0.5);
  for (let i = 0; i < 150; i++) {
    high.step({ ...IDLE, jump: true });
    low.step(IDLE);
    peakHigh = Math.max(peakHigh, high.player.y);
    peakLow = Math.max(peakLow, low.player.y);
  }
  assert.ok(peakHigh > 2 && peakHigh < 2.3, `held peak ${peakHigh}`);
  assert.ok(peakLow < 0.8, `tap peak ${peakLow}`);
  assert.ok(high.player.grounded && low.player.grounded);
});

test("coyote time and jump buffering forgive early and late presses", () => {
  const g = new Game(stage());
  g.player.x = 5.1;
  g.player.vx = RUN_SPEED;
  run(g, 5, { x: 1 });
  assert.equal(g.player.grounded, false);
  assert.ok(run(g, 1, { x: 1, jump: true }).includes("jump"));

  const b = new Game(stage());
  b.player.y = 3;
  b.player.grounded = false;
  b.player.support = null;
  let n = 0;
  while (b.player.y > 0.35 && n++ < 200) b.step(IDLE);
  assert.equal(b.player.grounded, false);
  const events = run(b, 30, { jump: true });
  assert.equal(events.filter((e) => e === "jump").length, 1);
  assert.ok(events.indexOf("land") < events.indexOf("jump"));
});

test("folding joins islands across depth; unfolding returns their distance", () => {
  const far = island("far", 7.5, 0, -10, 4, 4);
  for (const mode of ["2d", "3d"] as const) {
    const g = new Game(stage({ islands: [far] }));
    if (mode === "2d") fold(g);
    g.player.x = 4.6;
    run(g, 60, { x: 1 });
    if (mode === "2d") {
      assert.equal(g.player.support, "far");
      assert.ok(g.player.grounded);
    } else assert.ok(g.player.y < -1, "falls between islands in 3D");
  }
});

test("unfolding puts the keeper at the depth of the island underfoot", () => {
  const far = island("far", 7.5, 0, -10, 4, 4);
  const g = new Game(stage({ islands: [far] }));
  fold(g);
  g.player.x = 4.6;
  run(g, 60, { x: 1 });
  fold(g);
  assert.equal(g.mode, "3d");
  assert.equal(g.player.z, -10);
  run(g, 30);
  assert.ok(g.player.grounded && g.player.support === "far");
});

test("walls seal the folded path but can be walked around with depth", () => {
  const w = wall("w", "sunwall", 2, 0, 0, 1, 2, 6);
  const flat = new Game(stage({ walls: [w] }));
  fold(flat);
  run(flat, 120, { x: 1 });
  assert.ok(flat.player.x < 1.5, `stopped at ${flat.player.x}`);
  const deep = new Game(stage({ walls: [w] }));
  run(deep, 26, { z: 1 });
  run(deep, 10);
  run(deep, 130, { x: 1 });
  assert.ok(deep.player.x > 3 && deep.player.grounded, `walked past to ${deep.player.x}`);
});

test("a fold never fails: overlapped solids are passable until the keeper is clear", () => {
  const w = wall("w", "sunwall", 2, 0, -3, 1, 1, 6);
  const g = new Game(stage({ walls: [w] }));
  g.player.x = 2;
  fold(g);
  assert.equal(g.mode, "2d");
  assert.deepEqual([...g.ghosts], ["w"]);
  run(g, 60, { x: 1 });
  assert.ok(g.player.x > 2.8);
  assert.equal(g.ghosts.size, 0);
  run(g, 120, { x: -1 });
  assert.ok(g.player.x > 2.8, "solid again once clear");
});

test("star bridges hold only while folded and sunglass only while unfolded", () => {
  const star = island("star", 8, 0, 0, 6, 1.5, { only: "2d" });
  const glass = island("glass", 8, 0, 0, 6, 1.5, { only: "3d" });
  for (const [piece, mode, holds] of [
    [star, "2d", true],
    [star, "3d", false],
    [glass, "3d", true],
    [glass, "2d", false],
  ] as const) {
    const g = new Game(stage({ islands: [piece] }));
    if (mode === "2d") fold(g);
    g.player.x = 4.5;
    run(g, 80, { x: 1 });
    assert.equal(g.player.grounded && g.player.support === piece.id, holds, `${piece.id} in ${mode}`);
  }
});

test("a far lantern can be lit while folded; it opens its gate and forms its bridge", () => {
  const far = island("far", 2, 0, -10, 4, 4);
  const bridge = island("bridge", 8, 0, 0, 6, 2, { style: "bridge", lantern: "L" });
  const gate = wall("gate", "gate", 4.5, 0, 0, 0.5, 6, 5, "L");
  const g = new Game(stage({ islands: [far, bridge], walls: [gate], lanterns: [lantern("L", far)] }));
  assert.equal(g.islandSolid(bridge), false);
  const events = run(g, 60, { x: 1 });
  assert.ok(!events.includes("lantern"), "out of reach in 3D");
  fold(g);
  g.player.x = -2;
  const lit = run(g, 90, { x: 1 });
  assert.ok(lit.includes("lantern") && lit.includes("gate") && lit.includes("bridge"));
  assert.equal(g.islandSolid(bridge), true);
  run(g, 240);
  assert.equal(g.wallHeight(gate), 0);
  run(g, 120, { x: 1 });
  assert.ok(g.player.x > 6 && g.player.grounded);
});

test("sentinels at other depths are deadly folded and harmless unfolded; respawn keeps seeds", () => {
  const s = sentinel("s", 2, 0.7, -3);
  const home = island("home", 0, 0, 0, 10, 8);
  const lvl = stage({
    islands: [],
    sentinels: [s],
    pickups: [seed("seed", home, -1.5, 0)],
    checkpoints: [checkpoint("cp", home, -1)],
  });
  const deep = new Game(lvl);
  run(deep, 130, { x: 1 });
  assert.ok(deep.player.x > 2.5 && deep.status === "playing", `${deep.player.x} ${deep.status}`);
  const flat = new Game(lvl);
  fold(flat);
  const events = [...run(flat, 110, { x: 1 }), ...run(flat, 120)];
  assert.ok(events.includes("die") && events.includes("respawn"));
  assert.equal(flat.deaths, 1);
  assert.ok(flat.collected.has("seed"));
  assert.ok(Math.abs(flat.player.x - -1) < 1e-6);
});

test("moving islands carry the keeper", () => {
  const raft = island("raft", 8, 0, 0, 3, 3, { style: "plinth", motion: move("x", 2, 1) });
  const g = new Game(stage({ islands: [raft] }));
  g.player.x = 8;
  g.player.support = "raft";
  const start = g.islandPosition(raft).x - g.player.x;
  run(g, 100);
  assert.ok(g.player.grounded);
  assert.ok(Math.abs(g.islandPosition(raft).x - g.player.x - start) < 1e-6);
});

test("the observatory waits for three seeds", () => {
  const home = island("home", 0, 0, 0, 30, 6);
  const lvl = stage({
    islands: [],
    pickups: [seed("a", home, 2), seed("b", home, 4), seed("c", home, 6)],
    exit: { x: 3, y: 0, z: 0, island: "home" },
  });
  lvl.islands[0] = home;
  const g = new Game(lvl);
  const early = run(g, 100, { x: 1 });
  assert.ok(early.includes("locked"));
  run(g, 90, { x: 1 });
  assert.equal(g.seeds, 3);
  run(g, 100, { x: -1 });
  assert.ok(g.status === "clearing" || g.status === "clear");
});

test("the simulation is deterministic and resumes from a saved chapter state", () => {
  const far = island("far", 7.5, 0, -10, 4, 4);
  const lvl = stage({ islands: [far], pickups: [seed("s", far)], checkpoints: [checkpoint("cp", far)] });
  const script = (g: Game) => {
    run(g, 30, { x: 1 });
    fold(g);
    run(g, 90, { x: 1, jump: true });
    run(g, 60, { x: 1 });
  };
  const a = new Game(lvl),
    b = new Game(lvl);
  script(a);
  script(b);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const resumed = new Game(lvl, a.chapterState());
  assert.equal(resumed.mode, a.mode);
  assert.deepEqual([...resumed.collected], [...a.collected]);
  assert.equal(resumed.checkpointId, a.checkpointId);
});
