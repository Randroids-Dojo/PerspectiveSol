// Measure frame rate and draw stats: node scripts/r3d-perf.mjs "<query>" [w h dpr]
import { chromium } from "/Users/randroid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const [query, w = "1280", h = "720", dpr = "1"] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5186/harness.html?info=0&" + query);
await page.waitForTimeout(3000);
const r = await page.evaluate(async () => {
  // Hold right so the keeper runs and the camera moves.
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
  const times = [];
  let last = performance.now();
  await new Promise((res) => {
    const tick = (t) => {
      times.push(t - last);
      last = t;
      if (times.length < 240) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { fps: +(1000 / mean).toFixed(1), p95ms: +times[Math.floor(times.length * 0.95)].toFixed(2), snap: window.harness.r3.snapshot() };
});
console.log(JSON.stringify(r), errors);
await browser.close();
