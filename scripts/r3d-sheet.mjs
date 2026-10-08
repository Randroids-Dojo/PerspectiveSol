// Contact sheet: node scripts/r3d-sheet.mjs out.png cols img1.png img2.png ...
import { chromium } from "/Users/randroid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const [out, cols, ...files] = process.argv.slice(2);
const imgs = files.map((f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`);
const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px">${imgs
  .map((s, i) => `<div style="position:relative"><img src="${s}" style="width:100%;display:block"><span style="position:absolute;left:4px;top:2px;color:#fff;font:12px monospace;text-shadow:0 0 3px #000">${i}</span></div>`)
  .join("")}</body></html>`;
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.setContent(html);
await page.waitForTimeout(200);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
