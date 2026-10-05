// Port vs native rendered view centre along a native run, from a `vseek` log
// with camera fields (docs/fidelity/captures-*/dash-full.txt). Native centre
// = m_cameraPosition + win / 2 / zoom (the glitter's own placement, m1 0xa810c).
//   node scripts/view-compare.mjs <level> <vseek-log> [every=100]
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [lvl, log, everyArg = "100"] = process.argv.slice(2);
const every = Number(everyArg);
execFileSync("node", ["scripts/native-trace.mjs", lvl], { stdio: "ignore" });
const tr = readFileSync(`/tmp/gd-ui-capture/trace-${lvl}.txt`, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
const nat = new Map(readFileSync(log, "utf8").trim().split("\n").map((l) => {
  const p = l.split(" "); const i = p.indexOf("cam"); const z = +p[i + 6];
  return [+p[0], { cx: +p[i + 1] + 571 / 2 / z, cy: +p[i + 2] + 320 / 2 / z, ang: +p[i + 4] }];
}));
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:3222/?level=${lvl}&manual=1`);
await page.waitForFunction(() => window.__play);
const errs = [];
for (let f = 0; f + 4 <= tr.length; f += 4) {
  const ch = []; for (let k = f; k < f + 4; k++) { const [x, y, , h] = tr[k]; ch.push(x, y - 90, h); }
  await page.evaluate(async (fl) => { window.__play.followTrace(fl); await new Promise((r) => requestAnimationFrame(r)); }, ch);
  const s = f + 4;
  if (s % every === 0 && nat.has(s)) {
    const v = await page.evaluate(() => window.__play.info.view);
    const n = nat.get(s);
    const dx = v.x - n.cx, dy = v.y + 90 - n.cy;
    errs.push(Math.hypot(dx, dy));
    console.log(s, "ang", n.ang.toFixed(0), "d", dx.toFixed(0), dy.toFixed(0));
  }
}
await b.close();
errs.sort((a, c) => a - c);
console.log("n", errs.length, "median", errs[errs.length >> 1].toFixed(1), "p90", errs[Math.floor(errs.length * 0.9)].toFixed(1), "max", errs.at(-1).toFixed(1));
