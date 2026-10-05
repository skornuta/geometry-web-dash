// Replay a recorded run and screenshot at chosen x positions.
//
//   node scripts/replay-at.mjs <run.json> <outDir> <x1,x2,...>
//
// Same idea as replay.mjs (drive `?manual=1` with __play.stepTick so the browser
// runs the recorded run exactly), but shoots where you ask rather than at fixed
// fractions — which is what you want when a specific section looks wrong.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [runFile, outDir = ".", xsArg = ""] = process.argv.slice(2);
if (!runFile || !xsArg) {
  console.error("usage: node scripts/replay-at.mjs <run.json> <outDir> <x1,x2,...>");
  process.exit(2);
}
const xs = xsArg.split(",").map(Number).sort((a, b) => a - b);
const run = JSON.parse(readFileSync(runFile, "utf8"));
mkdirSync(outDir, { recursive: true });

const held = new Array(run.ticks).fill(false);
let cur = false, ei = 0;
for (let t = 0; t < run.ticks; t++) {
  while (ei < run.edges.length && run.edges[ei].tick === t) cur = run.edges[ei++].holding;
  held[t] = cur;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const debug = process.env.DEBUG_OVERLAY === "1" ? "&debug=1" : "";
await page.goto(`http://localhost:3222/?level=${run.level}&manual=1${debug}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__play !== undefined, null, { timeout: 15000 });

let i = 0;
for (let t = 0; t < held.length && i < xs.length; t++) {
  const alive = await page.evaluate((h) => window.__play.stepTick(h), held[t]);
  if (!alive) {
    const info = await page.evaluate(() => window.__play.info);
    console.log(`DIVERGED: died at tick ${t}, x=${Math.round(info.x)} (${info.mode})`);
    break;
  }
  const info = await page.evaluate(() => window.__play.info);
  while (i < xs.length && info.x >= xs[i]) {
    const file = `${outDir}/l${run.level}-x${xs[i]}-${info.mode}.png`;
    await page.screenshot({ path: file });
    console.log(`  x=${Math.round(info.x)} (${info.percent.toFixed(1)}%) mode=${info.mode} -> ${file}`);
    i++;
  }
}
console.log(`console errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
