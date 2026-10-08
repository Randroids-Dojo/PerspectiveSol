// Screenshot helper for the sculpted renderer.
// usage: node scripts/r3d-shot.mjs '<json array of shots>'
// shot: { q: "level=gallery&time=morning&only=3d&x=20", out: "/tmp/sol-r3d/a.png", wait: 1500, w: 1280, h: 720, js: "harness.step(10,{x:1})" }
import { chromium } from "/Users/randroid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const shots = JSON.parse(process.argv[2] ?? "[]");
mkdirSync("/tmp/sol-r3d", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"],
});
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w ?? 1280, height: s.h ?? 720 }, deviceScaleFactor: s.dpr ?? 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.text().slice(0, 400));
  });
  await page.goto("http://localhost:5186/harness.html?info=0&" + s.q);
  await page.waitForTimeout(s.wait ?? 1500);
  if (s.js) {
    await page.evaluate(s.js);
    await page.waitForTimeout(s.after ?? 300);
  }
  if (s.frames) {
    // Capture a sequence: each entry is js evaluated then a screenshot.
    let k = 0;
    for (const f of s.frames) {
      await page.evaluate(f);
      await page.waitForTimeout(s.gap ?? 120);
      let clip;
      if (s.zoom) {
        const c = await page.evaluate(() => {
          const p = window.harness.game.player;
          return window.harness.r3.project({ x: p.x, y: p.y + 0.6, z: p.z });
        });
        const W = s.zoom * 1.6, H = s.zoom;
        clip = { x: Math.max(0, c.x - W / 2), y: Math.max(0, c.y - H / 2), width: W, height: H };
      }
      await page.screenshot({ path: s.out.replace(".png", `-${k++}.png`), clip });
    }
  } else await page.screenshot({ path: s.out });
  const info = await page.evaluate(() => ({
    errors: window.harness?.errors,
    snap: window.harness?.r3?.snapshot(),
    p: window.harness?.game.player && { x: window.harness.game.player.x, y: window.harness.game.player.y, z: window.harness.game.player.z },
    extra: window.__extra,
  }));
  console.log(s.out, JSON.stringify(info), errors.slice(0, 8));
  await ctx.close();
}
await browser.close();
