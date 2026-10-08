// Frame time of the illustrated renderer in the harness while the keeper runs.
// Usage: node scripts/r2d-perf.mjs "<query>" [width height dpr seconds]
import { chromium } from "/Users/randroid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const [, , query = "level=gallery&time=morning&mode=2d", w = "1280", h = "720", dpr = "2", secs = "3", throttle = "1"] = process.argv;
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const page = await (await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr })).newPage();
const errors = [];
if (+throttle > 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: +throttle });
}
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5186/harness.html?info=0&only=2d&" + query);
await page.waitForTimeout(1500);
await page.keyboard.down("KeyD");
const result = await page.evaluate(async (secs) => {
  // Wrap the renderer's frame to time it.
  const r2 = window.harness.r2;
  const orig = r2.frame.bind(r2);
  const cpu = [];
  r2.frame = (i) => {
    const t0 = performance.now();
    orig(i);
    cpu.push(performance.now() - t0);
  };
  const deltas = [];
  let last = performance.now();
  const end = last + secs * 1000;
  let jumps = 0;
  await new Promise((resolve) => {
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now < end) {
        if (++jumps % 50 === 0) window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
        if (jumps % 50 === 10) window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
        requestAnimationFrame(tick);
      } else resolve();
    };
    requestAnimationFrame(tick);
  });
  r2.frame = orig;
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sorted = [...deltas].sort((a, b) => a - b);
  const cs = [...cpu].sort((a, b) => a - b);
  return {
    frames: deltas.length,
    avgFrameMs: +avg(deltas).toFixed(2),
    p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
    avgRenderCpuMs: +avg(cpu).toFixed(2),
    p95RenderCpuMs: +cs[Math.floor(cs.length * 0.95)].toFixed(2),
    maxRenderCpuMs: +cs[cs.length - 1].toFixed(2),
    over8ms: cpu.filter((v) => v > 8).length,
    x: window.harness.game.player.x,
    snap: window.harness.r2.snapshot(),
  };
}, +secs);
console.log(JSON.stringify(result), errors);
await browser.close();
