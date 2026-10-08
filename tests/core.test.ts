import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, EMPTY } from "../src/core";
import { LEVELS, platformAt } from "../src/levels";
import { runChapter } from "./controller";
const tick = (g: Game, n: number, input = { ...EMPTY }) => {
  for (let i = 0; i < n; i++) g.step(input, 1 / 120);
};
const close = (a: number, b: number, tol = 0.001) =>
  assert.ok(Math.abs(a - b) < tol, `${a} differs from ${b}`);
test("movement, release, depth controls and a real landing in both modes", () => {
  for (const mode of ["2d", "3d"] as const) {
    const g = new Game();
    g.mode = mode;
    tick(g, 30, { ...EMPTY, x: 1, z: 0.25 });
    assert.ok(g.player.x > -0.5);
    if (mode === "3d") assert.ok(g.player.z > 0.1);
    else close(g.player.z, 0);
    tick(g, 40);
    assert.ok(Math.abs(g.player.vx) < 0.05);
    g.step({ ...EMPTY, jump: true }, 1 / 120);
    assert.equal(g.player.grounded, false);
    assert.ok(g.player.vy > 9);
    tick(g, 160, { ...EMPTY, jump: true });
    assert.equal(g.player.grounded, true);
    close(g.player.y, 0);
  }
});
test("holding jump gives more height than tapping", () => {
  const high = new Game(),
    low = new Game();
  high.step({ ...EMPTY, jump: true }, 1 / 120);
  low.step({ ...EMPTY, jump: true }, 1 / 120);
  tick(high, 28, { ...EMPTY, jump: true });
  tick(low, 28);
  assert.ok(high.player.y > low.player.y + 0.5);
});
test("coyote time accepts a jump shortly after stepping off an edge", () => {
  const g = new Game();
  g.player.x = 4.2;
  g.player.vx = 5.9;
  tick(g, 4, { ...EMPTY, x: 1 });
  assert.equal(g.player.grounded, false);
  g.step({ ...EMPTY, jump: true }, 1 / 120);
  assert.ok(g.player.vy > 9);
  assert.ok(g.events.some((e) => e.type === "jump"));
});
test("a jump pressed just before landing is buffered into the next takeoff", () => {
  const g = new Game();
  g.player.y = 0.25;
  g.player.vy = -4;
  g.player.grounded = false;
  g.support = null;
  let jumps = 0;
  for (let i = 0; i < 20; i++) {
    g.step({ ...EMPTY, jump: true }, 1 / 120);
    jumps += g.events.filter((e) => e.type === "jump").length;
  }
  assert.equal(jumps, 1);
  assert.equal(g.player.grounded, false);
  assert.ok(g.player.y > 0.8);
  assert.ok(g.player.vy > 4);
});
test("a held fold button toggles once; rapid releases preserve physics and progress", () => {
  const g = new Game();
  g.collected.add("s0");
  tick(g, 30, { ...EMPTY, shift: true });
  assert.equal(g.mode, "2d");
  assert.equal(g.shifts, 1);
  const before = g.elapsed;
  tick(g, 2);
  g.step({ ...EMPTY, jump: true }, 1 / 120);
  const vy = g.player.vy,
    x = g.player.x;
  g.step({ ...EMPTY, jump: true, shift: true }, 1 / 120);
  assert.equal(g.mode, "3d");
  close(g.player.x, x);
  assert.ok(g.player.vy > vy - 0.3);
  assert.ok(g.collected.has("s0"));
  assert.ok(g.elapsed > before);
  assert.equal(g.status, "playing");
});
test("each fresh fold press works immediately, including rapid reversals", () => {
  const g = new Game();
  for (let i = 0; i < 10; i++) {
    g.step({ ...EMPTY, shift: true }, 1 / 120);
    assert.equal(g.mode, i % 2 === 0 ? "2d" : "3d");
    g.step(EMPTY, 1 / 120);
  }
  assert.equal(g.shifts, 10);
  assert.equal(g.deaths, 0);
  assert.equal(g.player.grounded, true);
});
test("projected landing links a distant island and unfolding retains its actual support", () => {
  const g = new Game();
  const r = runChapter(g);
  assert.equal(r.state.status, "clear");
  assert.equal(r.state.shards, 3);
  assert.equal(r.state.deaths, 0);
  const h = new Game();
  h.mode = "2d";
  h.player.x = 7;
  h.player.y = 0.2;
  h.player.vy = -2;
  h.player.grounded = false;
  h.support = null;
  tick(h, 20);
  assert.equal(h.support, "b");
  close(h.player.z, -5);
  h.shift();
  assert.equal(h.mode, "3d");
  close(h.player.z, -5);
  assert.equal(h.player.grounded, true);
});
test("a projected sunwall blocks the path, and 3D depth bypasses it", () => {
  const g = new Game();
  g.loadLevel(1);
  Object.assign(g.player, { x: 11, y: 0, z: 0 });
  g.support = "c";
  g.mode = "2d";
  tick(g, 120, { ...EMPTY, x: 1 });
  assert.ok(g.player.x < 12);
  g.shift();
  tick(g, 65, { ...EMPTY, z: -1 });
  assert.ok(g.player.z < -2);
  tick(g, 90, { ...EMPTY, x: 1 });
  assert.ok(g.player.x > 14);
  assert.equal(g.deaths, 0);
});
test("moving islands carry the keeper and their clock survives a fold", () => {
  const g = new Game();
  g.loadLevel(2);
  const p = g.level.platforms[1];
  g.support = p.id;
  Object.assign(g.player, { x: p.x, y: p.y, z: p.z });
  tick(g, 60);
  const pose = platformAt(p, g.time);
  close(g.player.y, pose.y);
  close(g.player.x, pose.x);
  const t = g.time;
  g.shift();
  tick(g, 30);
  assert.ok(g.time > t);
  close(g.player.y, platformAt(p, g.time).y);
  assert.equal(g.support, p.id);
});
test("a fall returns to a safe checkpoint, preserving collected light", () => {
  const g = new Game();
  g.loadLevel(1);
  g.checkpointIndex = 0;
  g.checkpoint = { ...g.level.checkpoints[0] };
  g.collected.add("s0");
  g.player.y = -14;
  g.player.grounded = false;
  g.support = null;
  g.step(EMPTY, 1 / 120);
  assert.equal(g.deaths, 1);
  close(g.player.x, g.checkpoint.x);
  assert.ok(g.collected.has("s0"));
  assert.ok(g.invincible > 1);
  tick(g, 12);
  assert.equal(g.player.grounded, true);
});
test("sentinel contact is dangerous in 2D, depth gives a safe route in 3D", () => {
  for (const mode of ["2d", "3d"] as const) {
    const g = new Game();
    g.loadLevel(2);
    g.mode = mode;
    const h = g.level.hazards[0];
    Object.assign(g.player, { x: h.x, y: 1.4, z: h.z - 2 });
    g.support = "c";
    g.step(EMPTY, 1 / 120);
    assert.equal(g.deaths, mode === "2d" ? 1 : 0);
  }
});
test("observatories require three seeds and a fresh kindle press", () => {
  const g = new Game();
  Object.assign(g.player, g.level.exit);
  g.support = "f";
  g.step({ ...EMPTY, interact: true }, 1 / 120);
  assert.equal(g.status, "playing");
  assert.ok(g.events.some((e) => e.type === "locked"));
  g.collected = new Set(["s0", "s1", "s2"]);
  g.step({ ...EMPTY, interact: true }, 1 / 120);
  assert.equal(g.status, "playing");
  g.step(EMPTY, 1 / 120);
  g.step({ ...EMPTY, interact: true }, 1 / 120);
  assert.equal(g.status, "clear");
  assert.equal(g.unlocked, 1);
  assert.ok(g.records[0] !== null);
});
test("all six chapters reach the ending using normal inputs, including midair folds", () => {
  const g = new Game();
  let folds = 0;
  for (let i = 0; i < 6; i++) {
    g.loadLevel(i);
    const r = runChapter(g);
    assert.equal(
      r.state.status,
      i === 5 ? "complete" : "clear",
      JSON.stringify(r.state),
    );
    assert.equal(r.state.shards, 3);
    assert.equal(r.state.deaths, 0);
    assert.ok(r.state.elapsed < 30);
    folds += r.state.shifts;
    assert.ok(r.trace.some((e) => e.type === "jump"));
    assert.ok(r.trace.some((e) => e.type === "clear"));
  }
  assert.ok(folds >= 15);
  assert.equal(g.finished, true);
  assert.equal(g.unlocked, 5);
  assert.ok(g.records.every((t) => t !== null));
});
test("save roundtrip restores checkpoint, seeds, perspective, records and elapsed time", () => {
  const g = new Game();
  g.loadLevel(3);
  g.unlocked = 3;
  g.collected.add("s0");
  g.checkpointIndex = 0;
  g.checkpoint = { ...g.level.checkpoints[0] };
  g.mode = "2d";
  g.elapsed = 24;
  g.shifts = 5;
  g.records[0] = 12.5;
  const restored = new Game();
  assert.equal(restored.restore(JSON.parse(JSON.stringify(g.save()))), true);
  assert.equal(restored.levelIndex, 3);
  assert.equal(restored.mode, "2d");
  assert.equal(restored.elapsed, 24);
  assert.equal(restored.shifts, 5);
  assert.ok(restored.collected.has("s0"));
  assert.equal(restored.records[0], 12.5);
  close(restored.player.x, restored.checkpoint.x);
  assert.equal(restored.player.grounded, true);
});
test("corrupt and future-version saves are rejected without modifying the game", () => {
  const g = new Game();
  const baseline = g.snapshot();
  for (const bad of [
    null,
    {},
    { ...g.save(), version: 2 },
    { ...g.save(), unlocked: 99 },
    { ...g.save(), level: -1 },
    { ...g.save(), records: [0] },
    { ...g.save(), records: [NaN, null, null, null, null, null] },
    { ...g.save(), checkpointIndex: 50 },
    { ...g.save(), mode: "4d" },
    { ...g.save(), elapsed: -1 },
  ]) {
    assert.equal(g.restore(bad), false);
    assert.deepEqual(g.snapshot(), baseline);
  }
});
test("chapter replay resets local actions while keeping campaign completion and records", () => {
  const g = new Game();
  g.unlocked = 5;
  g.finished = true;
  g.records[2] = 15;
  g.collected.add("s0");
  g.loadLevel(2);
  assert.equal(g.collected.size, 0);
  assert.equal(g.unlocked, 5);
  assert.equal(g.finished, true);
  assert.equal(g.records[2], 15);
  assert.equal(g.checkpointIndex, -1);
  assert.equal(g.status, "playing");
});
test("all checkpoint and collectible positions are outside wall solids", () => {
  for (const l of LEVELS)
    for (const v of [...l.checkpoints, ...l.collectibles])
      for (const w of l.walls) {
        const inside =
          Math.abs(v.x - w.x) < w.w / 2 + 0.32 &&
          Math.abs(v.z - w.z) < w.d / 2 + 0.32 &&
          v.y < w.y + w.h;
        assert.equal(inside, false, `${l.name}: ${JSON.stringify(v)}`);
      }
});
