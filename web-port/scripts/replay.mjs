// Replays a recorded autopilot run inside the real browser build and checks it
// reaches the same place, then screenshots a few moments of it.
//
//   node scripts/autoplay.mjs 1 --out=/tmp/run1.json
//   node scripts/replay.mjs /tmp/run1.json [outDir]
//
// The point is to prove the browser scene and the headless search are running
// the same rules: the page is loaded with `?manual=1`, which stops wall-clock
// time from advancing the simulation, and every tick is driven by
// `__play.stepTick()`. Any divergence means playLevel.ts has grown a rule that
// sim.ts does not have.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const runFile = process.argv[2];
const outDir = process.argv[3] ?? ".";
if (!runFile) {
  console.error("usage: node scripts/replay.mjs <run.json> [outDir]");
  process.exit(2);
}
const run = JSON.parse(readFileSync(runFile, "utf8"));
mkdirSync(outDir, { recursive: true });

// edges -> per-tick held flags
const held = new Array(run.ticks).fill(false);
let cur = false;
let ei = 0;
for (let t = 0; t < run.ticks; t++) {
  while (ei < run.edges.length && run.edges[ei].tick === t) cur = run.edges[ei++].holding;
  held[t] = cur;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:3222/?level=${run.level}&manual=1`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__play !== undefined, null, { timeout: 15000 });

// screenshot at these fractions of the run, to eyeball each section
const shots = [0.12, 0.35, 0.55, 0.8, 0.97].map((f) => Math.floor(f * run.ticks));
let shotIdx = 0;

for (let t = 0; t < held.length; t++) {
  const alive = await page.evaluate((h) => window.__play.stepTick(h), held[t]);
  if (!alive) {
    const info = await page.evaluate(() => window.__play.info);
    console.log(`DIVERGED: died at tick ${t}, x=${Math.round(info.x)} (${info.mode})`);
    console.log("the browser scene and the headless sim disagree — check playLevel.ts");
    await browser.close();
    process.exit(1);
  }
  if (shotIdx < shots.length && t === shots[shotIdx]) {
    const info = await page.evaluate(() => window.__play.info);
    const file = `${outDir}/replay-l${run.level}-${String(shotIdx + 1)}-${info.mode}.png`;
    await page.screenshot({ path: file });
    console.log(`  tick ${t} x=${Math.round(info.x)} mode=${info.mode} -> ${file}`);
    shotIdx++;
  }
}

const info = await page.evaluate(() => window.__play.info);
console.log(`replay of level ${run.level}: survived all ${held.length} ticks`);
console.log(`  x=${Math.round(info.x)} percent=${info.percent.toFixed(1)}%`
  + ` coins=${info.coins} attempts=${info.attempts}`);
console.log(`  console errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
