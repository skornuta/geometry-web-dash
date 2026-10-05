// Replays a recorded run one 60 Hz tick per rendered frame — the pace a human
// plays at — and screenshots chosen moments, so particles, streaks and trails
// are captured as they really look (replay.mjs steps faster than the frame
// rate, which leaves presentation effects starved of frames).
//
//   node scripts/fxcapture.mjs <run.json | route.json> <outDir> <tick,tick,...> [--debug]
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [file, outDir, ticksArg] = process.argv.slice(2);
if (!file || !outDir || !ticksArg) {
  console.error("usage: node scripts/fxcapture.mjs <run.json> <outDir> <tick,...>");
  process.exit(2);
}
const run = JSON.parse(readFileSync(file, "utf8"));
mkdirSync(outDir, { recursive: true });
const shots = new Set(ticksArg.split(",").map((n) => parseInt(n, 10)));
// run.json (autoplay) carries edges; manual routes carry [ticks, held] segments
const held = [];
if (run.segments) for (const [t, h] of run.segments) for (let i = 0; i < t; i++) held.push(h);
else {
  let cur = false, ei = 0;
  for (let t = 0; t < run.ticks; t++) {
    while (ei < run.edges.length && run.edges[ei].tick === t) cur = run.edges[ei++].holding;
    held.push(cur);
  }
}
const last = Math.max(...shots);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const debug = process.argv.includes("--debug") ? "&debug=1" : "";
await page.goto(`http://localhost:3222/?level=${run.level}&manual=1${debug}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__play !== undefined);
for (let t = 0; t <= last && t < held.length; t++) {
  const alive = await page.evaluate(async (h) => {
    const ok = window.__play.stepTick(h);
    await new Promise((r) => requestAnimationFrame(r));
    return ok;
  }, held[t]);
  if (shots.has(t)) {
    const info = await page.evaluate(() => window.__play.info);
    const path = `${outDir}/fx-l${run.level}-t${t}-${info.mode}.png`;
    await page.screenshot({ path });
    console.log(`tick ${t} x=${Math.round(info.x)} ${info.mode} particles=${info.particles} -> ${path}`);
  }
  if (!alive) { console.log(`died at tick ${t}`); break; }
}
console.log(`errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
