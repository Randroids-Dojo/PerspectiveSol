// Screenshots of the illustrated renderer through the harness.
// Usage: node scripts/r2d-shot.mjs <jobs.json | inline JSON>
// Job: { query, out?, wait?, width?, height?, dpr?, eval?, after?, clip?, shots?: [{ eval?, out, clip?, after? }] }
import { chromium } from "/Users/randroid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const arg = process.argv[2] ?? "[]";
const jobs = JSON.parse(arg.trim().startsWith("[") ? arg : readFileSync(arg, "utf8"));
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"],
});
for (const job of jobs) {
  const ctx = await browser.newContext({
    viewport: { width: job.width ?? 1280, height: job.height ?? 720 },
    deviceScaleFactor: job.dpr ?? 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });
  await page.goto("http://localhost:5186/harness.html?info=0&only=2d&" + job.query);
  await page.waitForTimeout(job.wait ?? 1200);
  const shots = job.shots ?? [{ eval: job.eval, out: job.out, clip: job.clip, after: job.after }];
  for (const s of shots) {
    let result = null;
    if (s.eval) {
      result = await page.evaluate(s.eval);
      await page.waitForTimeout(s.after ?? 200);
    }
    let clip = s.clip;
    if (s.around) {
      const at = await page.evaluate(() => {
        const p = window.harness.game.player;
        return window.harness.r2.project({ x: p.x, y: p.y + 0.6, z: p.z });
      });
      clip = { x: Math.max(0, at.x - s.around[0] / 2), y: Math.max(0, at.y - s.around[1] / 2), width: s.around[0], height: s.around[1] };
    }
    await page.screenshot({ path: s.out, clip });
    console.log(s.out, result !== null && result !== undefined ? JSON.stringify(result) : "");
  }
  const snap = await page.evaluate(() => window.harness?.r2?.snapshot());
  const herr = await page.evaluate(() => window.harness?.errors);
  console.log(JSON.stringify({ snap, herr }), errors.length ? errors : "");
  await ctx.close();
}
await browser.close();
