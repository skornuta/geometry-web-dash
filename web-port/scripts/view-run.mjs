// The port's rendered camera along a whole real run, against the game's own camera
// frame by frame from a continuous native log (`dash-full.txt`).
//
//   node scripts/view-run.mjs 22 [every=10] > /tmp/view-run.csv   (dev server on :3222)
//
// One replay of the level through `__play.followTrace` in 4-step (60 fps) rendered
// frames, reading `__play.info.view` every `every` frames. Columns:
// frame,x,zoom,portBottom,nativeBottom,dBottom,portLeft,nativeLeft,dLeftAfterZoomOffset
// (the world is drawn about the view centre at scale*zoom: drawn bottom GD =
// view.y + 90 - 160/zoom, drawn left = view.x - 285.5/zoom; the game's cam.x/cam.y
// are those visible edges).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const lvl = process.argv[2]; const every = Number(process.argv[3] ?? 10);
const log = process.env.NATIVE_LOG ?? "../docs/fidelity/captures-2026-10-03/dash-full.txt";
execFileSync("node", ["scripts/native-trace.mjs", lvl], { stdio: "ignore" });
const rows = readFileSync(`/tmp/gd-ui-capture/trace-${lvl}.txt`, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
const full = readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" "));
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${process.env.GD_PORT ?? 3222}/?level=${lvl}&manual=1${process.env.FPS ? "&fps=" + process.env.FPS : ""}`);
await page.waitForFunction(() => window.__play);
console.log("frame,x,zoom,portBottom,nativeBottom,dBottom,portLeft,nativeLeft,dLeft,portZoom,portAng,nativeAng,portMode,portFlip,nativeModeFlags,nativeFlip");
let frames = 0;
for (let s = 0; s < rows.length; s += 4) {
  const flat = [];
  for (let k = s; k < Math.min(rows.length, s + 4); k++) { const [x, y, , h] = rows[k]; flat.push(x, y - 90, h); }
  const v = await page.evaluate(async (f) => { window.__play.followTrace(f); await new Promise((r) => requestAnimationFrame(r)); const rt = window.__play.triggers.rt; return { x: window.__play.info.view.x, y: window.__play.info.view.y, zoom: rt.zoom, ang: rt.camAngle, mode: window.__play.state.mode, flip: window.__play.state.gravityFlipped ? 1 : 0 }; }, flat);
  frames++;
  if (frames % every) continue;
  const n = full[Math.min(full.length - 1, s + 3)]; const i = n.indexOf("cam"); const z = +n[n.indexOf("zoom") + 1];
  const nb = +n[i + 2], nl = +n[i + 1], pb = v.y + 90 - 160 / z, pl = v.x - 285.5 / z;
  console.log([s + 4, (+n[1]).toFixed(1), z.toFixed(4), pb.toFixed(1), nb.toFixed(1), (pb - nb).toFixed(1), pl.toFixed(1), nl.toFixed(1), (pl - nl).toFixed(1), v.zoom.toFixed(4), v.ang.toFixed(2), (+n[n.indexOf("ang") + 1]).toFixed(2), v.mode, v.flip, n[5], n[6]].join(","));
}
await b.close();
