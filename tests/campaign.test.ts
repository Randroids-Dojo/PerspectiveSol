import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/sim/levels";
import { ROUTES } from "../src/sim/routes";
import { runRoute } from "../src/sim/route";

test("the campaign has six chapters with three seeds and a reachable observatory each", () => {
  assert.equal(LEVELS.length, 6);
  for (const l of LEVELS) {
    assert.equal(l.pickups.filter((p) => p.kind === "seed").length, 3, l.name);
    assert.ok(l.islands.some((i) => i.id === l.exit.island), l.name);
    const ids = new Set<string>();
    for (const thing of [...l.islands, ...l.walls, ...l.pickups, ...l.lanterns, ...l.sentinels, ...l.checkpoints])
      assert.ok(!ids.has(thing.id) || l.walls.some((w) => w.id === thing.id), `${l.name}: duplicate ${thing.id}`), ids.add(thing.id);
    for (const w of l.walls) if (w.lantern) assert.ok(l.lanterns.some((v) => v.id === w.lantern), `${l.name}: ${w.id}`);
    for (const i of l.islands) if (i.lantern) assert.ok(l.lanterns.some((v) => v.id === i.lantern), `${l.name}: ${i.id}`);
  }
});

for (const [i, level] of LEVELS.entries())
  test(`chapter ${i + 1}, ${level.name}, can be finished with every seed through ordinary inputs`, () => {
    const r = runRoute(level, ROUTES[i]);
    assert.ok(r.ok, `${r.reason} (action ${r.action})`);
    assert.equal(r.game.seeds, 3);
    assert.equal(r.game.deaths, 0);
    assert.ok(r.game.folds >= 1, "the chapter needs the fold");
  });
