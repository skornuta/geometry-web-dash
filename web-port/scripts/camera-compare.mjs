// Port vs native camera height along a real run. Walks the level's macro path
// (scripts/native-trace.mjs) through `__play.followTrace` and, at every frame a
// native camera log sampled (gd-ui-capture `seek`, `m_cameraPosition.y`),
// prints the native and port view bottoms in game units.
//
//   node scripts/camera-compare.mjs <level> <native-camera-log> [xFrom] [xTo]
//   node scripts/camera-compare.mjs 22 ../docs/fidelity/traces/native-camera-l22.txt
//
// Needs the dev server on :3222. Note: in turned (Rotate Gameplay) sections
// the render loop's own camera also runs between steps, so those samples are
// not a clean comparison.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
const [lvl, samplesFile, x0 = "0", x1 = "1e9"] = process.argv.slice(2);
execFileSync("node", ["scripts/native-trace.mjs", lvl], { stdio: "ignore" });
const tr = readFileSync(`/tmp/gd-ui-capture/trace-${lvl}.txt`, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
const S = readFileSync(samplesFile, "utf8").trim().split("\n").map((l) => {
  const m = l.match(/frame (\d+) at x=(\S+) y=(\S+) cam=(\S+),(\S+)/); return { f: +m[1], x: +m[2], y: +m[3], cy: +m[5] };
}).sort((a, b) => a.f - b.f);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:3222/?level=${lvl}&manual=1`);
await page.waitForFunction(() => window.__play);
let f = 0; const errs = [];
for (const s of S) {
  const flat = [];
  for (; f < s.f; f++) { const [x, y, , h] = tr[f]; flat.push(x, y - 90, h); }
  const i = await page.evaluate((fl) => { const r = window.__play.followTrace(fl); return r; }, flat);
  if (s.x >= +x0 && s.x <= +x1) { const d = i.camY - s.cy; errs.push(Math.abs(d)); console.log(s.x.toFixed(0), s.y.toFixed(0), "nat", s.cy.toFixed(1), "port", i.camY.toFixed(1), "d", d.toFixed(1), i.mode); }
}
errs.sort((a, b) => a - b);
console.log("n", errs.length, "median", errs[errs.length >> 1]?.toFixed(2), "max", errs.at(-1)?.toFixed(2));
await b.close();
