/** Plays every chapter's route and prints where each one ends.  npx tsx scripts/routes.ts [chapter] */
import { LEVELS } from "../src/sim/levels";
import { ROUTES } from "../src/sim/routes";
import { runRoute } from "../src/sim/route";

const only = process.argv[2] !== undefined ? Number(process.argv[2]) : null;
for (const [i, level] of LEVELS.entries()) {
  if (only !== null && only !== i) continue;
  const r = runRoute(level, ROUTES[i]);
  const g = r.game;
  const p = g.player;
  console.log(
    `${i} ${level.name}: ${r.ok ? "CLEAR" : "FAIL"} t=${r.time.toFixed(1)}s seeds ${g.seeds}/3 motes ${g.motes}/${g.moteTotal} folds ${g.folds} deaths ${g.deaths}` +
      (r.ok ? "" : `\n   at action ${r.action}: ${r.reason}\n   keeper x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} z ${p.z.toFixed(2)} ${g.mode} support ${p.support} ${p.grounded ? "ground" : "air"}`),
  );
}
