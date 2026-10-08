// Startup hitch check: node scripts/r3d-startup.mjs "<query>"
import { chromium } from "/Users/randroid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const [query] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  window.__ft = [];
  let last = 0;
  const tick = (t) => {
    if (window.harness?.r3?.snapshot().frames > 0) window.__ft.push(t - last);
    last = t;
    if (window.__ft.length < 90) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.goto("http://localhost:5186/harness.html?info=0&" + query);
await page.waitForTimeout(4000);
const r = await page.evaluate(async () => {
  const first = window.__ft.slice(1);
  const snap = window.harness.r3.snapshot();
  // A fold and back, then a restart (reload) of the chapter.
  const t = [];
  let last = performance.now();
  const sample = (n) => new Promise((res) => { const f = (now) => { t.push(now - last); last = now; if (--n > 0) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  window.harness.setMode("2d");
  await sample(40);
  window.harness.setMode("3d");
  await sample(40);
  const foldMax = Math.max(...t);
  const r0 = performance.now();
  window.harness.restart();
  const reloadMs = performance.now() - r0;
  return { warmMs: snap.warmMs, firstFramesMaxMs: Math.max(...first).toFixed(1), firstFramesMeanMs: (first.reduce((a, b) => a + b, 0) / first.length).toFixed(1), foldMaxMs: foldMax.toFixed(1), reloadMs: reloadMs.toFixed(0), programs: snap.programs };
});
console.log(JSON.stringify(r));
await browser.close();
