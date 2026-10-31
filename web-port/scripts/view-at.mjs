// The port's *rendered* camera at an x of a real run, beside the game's own camera
// at the same x from a continuous native log (`dash-full.txt`-style rows:
// `frame x y ... cam camX camY ... zoom z`).
//
//   node scripts/view-at.mjs 22 1300 2200 3300     (dev server on :3222)
//
// `__play.followTrace()` returns the plain follow camera, not what the renderer
// draws — so this reads `__play.info.view` after replaying the run the way
// `port-at.mjs` does (the last 3 s in 4-step rendered frames). In the view,
// the world is drawn about the view centre at scale*zoom, so the DRAWN bottom (GD) is
// view.y + 90 - 160/z and the drawn left is view.x - 285.5/z; the game's `cam.x/cam.y`
// are exactly those visible edges (centre = the guide object, minus half a zoomed view).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const lvl = process.argv[2]; const xs = process.argv.slice(3).map(Number);
const log = process.env.NATIVE_LOG ?? "../docs/fidelity/captures-2026-10-03/dash-full.txt";
execFileSync("node", ["scripts/native-trace.mjs", lvl], { stdio: "ignore" });
const rows = readFileSync(`/tmp/gd-ui-capture/trace-${lvl}.txt`, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
const full = readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" "));
const nat = (x) => { const r = full.find((q) => +q[1] >= x); const i = r.indexOf("cam"); return { camX: +r[i + 1], camY: +r[i + 2], zoom: +r[r.indexOf("zoom") + 1] }; };
const b = await chromium.launch();
for (const target of xs) {
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://localhost:${process.env.GD_PORT ?? 3222}/?level=${lvl}&manual=1`);
  await page.waitForFunction(() => window.__play);
  const flat = [];
  for (const [x, y, , h] of rows) { if (x >= target) break; flat.push(x, y - 90, h); }
  const TAIL = 480 * 3, head = flat.slice(0, Math.max(0, flat.length - TAIL)), tail = flat.slice(head.length);
  await page.evaluate((f) => window.__play.followTrace(f), head);
  for (let i = 0; i < tail.length; i += 12) await page.evaluate(async (f) => { window.__play.followTrace(f); await new Promise((r) => requestAnimationFrame(r)); }, tail.slice(i, i + 12));
  for (let i = 0; i < 3; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  const v = await page.evaluate(() => JSON.parse(JSON.stringify(window.__play.info.view)));
  const n = nat(target), bottom = v.y + 90 - 160 / n.zoom, left = v.x - 285.5 / n.zoom, zoomOff = 0;
  console.log(`x ${target}: bottom port ${bottom.toFixed(1)} native ${n.camY.toFixed(1)} (d ${(bottom - n.camY).toFixed(1)}) | left port ${left.toFixed(1)} native ${n.camX.toFixed(1)} (d ${(left - n.camX).toFixed(1)}, zoom ${n.zoom} offset ${zoomOff.toFixed(1)})`);
  await page.close();
}
await b.close();
