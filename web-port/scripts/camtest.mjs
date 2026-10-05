// Is the dual camera STATIC within a section, and centred on the pair?
//   node scripts/camtest.mjs <run.json> <xFrom> <xTo>
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const [runFile, xFrom, xTo] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runFile, "utf8"));
const held = new Array(run.ticks).fill(false);
let cur = false, ei = 0;
for (let t = 0; t < run.ticks; t++) {
  while (ei < run.edges.length && run.edges[ei].tick === t) cur = run.edges[ei++].holding;
  held[t] = cur;
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:3222/?level=${run.level}&manual=1`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__play !== undefined, null, { timeout: 15000 });
const rows = [];
for (let t = 0; t < held.length; t++) {
  if (!await page.evaluate((h) => window.__play.stepTick(h), held[t])) break;
  const i = await page.evaluate(() => window.__play.info);
  if (i.x >= +xFrom && i.x <= +xTo && t % 20 === 0) rows.push(i);
  if (i.x > +xTo) break;
}
await browser.close();
if (!rows.length) { console.log("no samples in range"); process.exit(1); }
console.log("   x      P1 y   P2 y    mid     camY   mid-relative-to-view-centre");
for (const r of rows) {
  const mid = r.dualY === null ? r.y : (r.y + r.dualY) / 2;
  console.log(`${String(Math.round(r.x)).padStart(6)}  ${String(Math.round(r.y)).padStart(6)}` +
    `  ${String(r.dualY === null ? "-" : Math.round(r.dualY)).padStart(6)}` +
    `  ${String(Math.round(mid)).padStart(6)}  ${String(Math.round(r.camY)).padStart(6)}` +
    `   ${(mid - (r.camY + 160)).toFixed(0)}`);
}
const cams = rows.map((r) => r.camY);
console.log(`camY range across the section: ${Math.min(...cams).toFixed(1)} .. ${Math.max(...cams).toFixed(1)}`);
