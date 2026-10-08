/**
 * End-to-end check of the real game in Chrome: title, every chapter played
 * through the actual loop by its route, the fold contract (zero WebGL frames
 * while folded, continuous audio transport), pause, saves, the ending, touch
 * controls and mobile layouts. Screenshots go to the output directory.
 *
 *   node scripts/e2e.mjs [url] [outDir]
 *   PLAYWRIGHT=/path/to/playwright/index.mjs CHROME=/path/to/chrome node scripts/e2e.mjs
 *
 * Route autoplay needs the development build (npm run dev). Against a
 * production URL only the title, a manual fold and the layouts are checked.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const { chromium } = await import(
  process.env.PLAYWRIGHT ?? "/Users/randroid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs"
);
const url = process.argv[2] ?? "http://localhost:5186/";
const out = process.argv[3] ?? "/tmp/sol-e2e";
mkdirSync(out, { recursive: true });
const production = !url.includes("localhost");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const results = { url, production, checks: [], errors: [] };
const check = (name, data = {}) => {
  results.checks.push({ name, ...data });
  console.log(`✓ ${name}`, Object.keys(data).length ? JSON.stringify(data) : "");
};

// The development server's hot reload would restart the page whenever a file
// changes during a long run; a stub client keeps the run stable.
const HMR_STUB = `
export function createHotContext() { return { accept() {}, acceptExports() {}, dispose() {}, prune() {}, invalidate() {}, on() {}, off() {}, send() {}, decline() {}, data: {} }; }
export function updateStyle(id, css) { let s = document.querySelector('style[data-vite-dev-id="' + id + '"]'); if (!s) { s = document.createElement('style'); s.setAttribute('data-vite-dev-id', id); document.head.appendChild(s); } s.textContent = css; }
export function removeStyle() {}
export function injectQuery(u) { return u; }
export class ErrorOverlay {}
`;

async function open(viewport, touch = false) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await context.newPage();
  if (!production)
    await page.route("**/@vite/client", (r) => r.fulfill({ contentType: "application/javascript", body: HMR_STUB }));
  page.on("pageerror", (e) => results.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && results.errors.push(m.text()));
  page.on("requestfailed", (r) => results.errors.push(`${r.url()} ${r.failure()?.errorText}`));
  await page.goto(url);
  await page.waitForFunction(() => !!window.sol);
  await page.waitForTimeout(1500);
  return page;
}
const snap = (page) => page.evaluate(() => window.sol.snapshot());

try {
  // ---------------------------------------------------------- desktop
  const page = await open({ width: 1280, height: 720 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.sol);
  await page.waitForTimeout(2500);
  let s = await snap(page);
  assert.equal(s.phase, "title");
  await page.screenshot({ path: `${out}/title.png` });
  check("title screen with the live demonstration", { demoMode: s.mode, demoX: Math.round(s.player.x) });

  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.sol.snapshot().phase === "play");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/chapter-1-start.png` });

  // A real keypress fold: WebGL stops while folded and the audio transport keeps running.
  await page.keyboard.press("Shift");
  await page.waitForFunction(() => window.sol.snapshot().render.engine === "canvas2d");
  const a = await snap(page);
  await page.waitForTimeout(600);
  const b = await snap(page);
  assert.equal(a.render.sculpted.frames, b.render.sculpted.frames, "no WebGL frames while folded");
  assert.ok(b.render.flat.frames > a.render.flat.frames, "the illustrated world draws");
  assert.ok(b.elapsed > a.elapsed, "the chapter clock runs");
  if (typeof a.audio.transport === "number") assert.ok(b.audio.transport > a.audio.transport, "audio transport runs");
  await page.screenshot({ path: `${out}/chapter-1-folded.png` });
  check("folded play draws zero WebGL frames", { webgl: [a.render.sculpted.frames, b.render.sculpted.frames], flat: [a.render.flat.frames, b.render.flat.frames] });
  await page.keyboard.press("Shift");
  await page.waitForFunction(() => window.sol.snapshot().render.engine === "webgl");
  const c = await snap(page);
  await page.waitForTimeout(300);
  assert.ok((await snap(page)).render.sculpted.frames > c.render.sculpted.frames);
  check("unfolding resumes the sculpted world");

  // Keyboard movement and jumping through the ordinary input path.
  const x0 = (await snap(page)).player.x;
  await page.keyboard.down("d");
  await page.waitForTimeout(450);
  await page.keyboard.up("d");
  await page.keyboard.down("Space");
  await page.waitForFunction(() => !window.sol.snapshot().player.grounded);
  await page.keyboard.up("Space");
  const moved = await snap(page);
  assert.ok(moved.player.x > x0 + 1, "walked right");
  check("keyboard walks and jumps", { moved: +(moved.player.x - x0).toFixed(2) });

  // Pause holds the simulation.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.sol.snapshot().phase === "pause");
  const p1 = await snap(page);
  await page.waitForTimeout(500);
  const p2 = await snap(page);
  assert.equal(p1.elapsed, p2.elapsed);
  await page.screenshot({ path: `${out}/pause.png` });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.sol.snapshot().phase === "play");
  check("pause holds the chapter clock");

  if (!production) {
    // Every chapter, played by its route through the real loop.
    await page.evaluate(() => window.sol.dev.speed(3));
    for (let i = 0; i < 6; i++) {
      await page.evaluate((i) => {
        window.sol.dev.setInput(null);
      }, i);
      if (i === 0) {
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => window.sol.snapshot().phase === "pause");
        await page.getByRole("button", { name: "Restart chapter" }).click();
      }
      await page.waitForFunction((i) => window.sol.snapshot().level === i && window.sol.snapshot().phase === "play", i);
      await page.evaluate((i) => window.sol.dev.autoplay(i), i);
      const shots = [8000, 16000];
      const start = Date.now();
      let shot = 0;
      for (;;) {
        s = await snap(page);
        if (s.phase === "clear") break;
        if (s.status === "dying") throw new Error(`chapter ${i + 1}: the keeper was lost at x ${s.player.x}`);
        if (shot < shots.length && Date.now() - start > shots[shot]) {
          await page.screenshot({ path: `${out}/chapter-${i + 1}-${shot + 1}.png` });
          shot++;
        }
        if (Date.now() - start > 90000) throw new Error(`chapter ${i + 1} did not finish`);
        await page.waitForTimeout(250);
      }
      assert.equal(s.seeds, 3);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/chapter-${i + 1}-clear.png` });
      check(`chapter ${i + 1} finished in the real game`, { time: +s.elapsed.toFixed(1), folds: s.folds, motes: s.motes });
      await page.evaluate(() => window.sol.dev.setInput(null));
      await page.keyboard.press("Enter");
    }
    await page.waitForFunction(() => window.sol.snapshot().phase === "ending");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/ending.png` });
    check("the ending is reached");
    await page.reload();
    await page.waitForFunction(() => !!window.sol);
    s = await snap(page);
    assert.equal(s.progress.finished, true);
    assert.equal(s.progress.unlocked, 5);
    assert.ok(s.progress.records.every((r) => r > 0));
    check("progress survives a reload", { unlocked: s.progress.unlocked });
  }
  await page.context().close();

  // ------------------------------------------------------------- touch
  for (const [w, h] of [
    [390, 844],
    [844, 390],
  ]) {
    const phone = await open({ width: w, height: h }, true);
    await phone.screenshot({ path: `${out}/title-${w}x${h}.png` });
    const begin = phone.locator(".title-menu .primary").first();
    await begin.tap();
    await phone.waitForFunction(() => window.sol.snapshot().phase === "play");
    await phone.waitForTimeout(800);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const zone = await phone.locator("#stick-zone").boundingBox();
    const x0 = (await snap(phone)).player.x;
    const cdp = await phone.context().newCDPSession(phone);
    const sx = zone.x + 90,
      sy = zone.y + zone.height - 110;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 1 }] });
    for (let k = 1; k <= 6; k++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx + k * 9, y: sy, id: 1 }] });
      await phone.waitForTimeout(16);
    }
    await phone.waitForTimeout(500);
    await phone.screenshot({ path: `${out}/play-${w}x${h}.png` });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const moved = (await snap(phone)).player.x - x0;
    assert.ok(moved > 1, `touch stick moved the keeper (${moved})`);
    await phone.locator("#touch-fold").tap();
    await phone.waitForFunction(() => window.sol.snapshot().mode === "2d");
    await phone.waitForTimeout(800);
    await phone.screenshot({ path: `${out}/play-${w}x${h}-folded.png` });
    check(`touch controls at ${w}x${h}`, { moved: +moved.toFixed(2) });
    await phone.context().close();
  }
} catch (e) {
  results.failure = e.stack ?? String(e);
  console.error(e);
} finally {
  results.passed = !results.failure && results.errors.length === 0;
  writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 2));
  console.log(results.passed ? "PASSED" : `FAILED ${results.errors.join(" | ")}`);
  await browser.close();
  process.exit(results.passed ? 0 : 1);
}
