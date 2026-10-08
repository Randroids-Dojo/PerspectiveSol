// Real-game captures along a chapter's scripted route.
// node scripts/r3d-play.mjs <chapter 0..5> <outPrefix> [shots=10] [speed=3] [quality=high]
import { chromium } from "/Users/randroid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const [chapter = "0", prefix = "/tmp/sol-r3d/pass2/play", shots = "10", speed = "3", quality = "high"] = process.argv.slice(2);
const index = Number(chapter);
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(
  ([i, q]) => {
    localStorage.setItem(
      "perspective-sol:progress",
      JSON.stringify({
        version: 2,
        unlocked: 5,
        records: [null, null, null, null, null, null],
        motes: [[], [], [], [], [], []],
        finished: false,
        current: { level: i, checkpoint: null, collected: [], lit: [], elapsed: 1, deaths: 0, folds: 0, mode: "3d" },
      }),
    );
    const s = JSON.parse(localStorage.getItem("perspective-sol:settings:v2") ?? "{}");
    localStorage.setItem("perspective-sol:settings:v2", JSON.stringify({ ...s, quality: q, hints: false }));
  },
  [index, quality],
);
await page.goto("http://localhost:5186/");
await page.waitForTimeout(2500);
await page.keyboard.press("Enter");
await page.waitForTimeout(3500);
const start = await page.evaluate(() => window.sol.snapshot().level);
await page.evaluate(([i, sp]) => {
  window.sol.dev.speed(sp);
  window.sol.dev.autoplay(i);
}, [index, Number(speed)]);
const n = Number(shots);
// Spread captures over the route; routes take roughly par seconds at speed 1.
const total = await page.evaluate(() => window.sol.dev.game.level.par);
const gap = process.argv[7] ? Number(process.argv[7]) : Math.max(1200, ((total * 1000) / Number(speed)) / (n + 1));
for (let k = 0; k < n; k++) {
  await page.waitForTimeout(gap);
  const snap = await page.evaluate(() => {
    const s = window.sol.snapshot();
    return { x: s.player.x.toFixed(1), z: s.player.z.toFixed(1), mode: s.mode, status: s.status, phase: s.phase, fold: s.fold.toFixed(2), calls: s.render.sculpted?.drawCalls };
  });
  await page.screenshot({ path: `${prefix}-${k}.png` });
  console.log(k, JSON.stringify(snap));
}
console.log("start level", start, "errors", errors.slice(0, 5));
await browser.close();
