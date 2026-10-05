// Capture the port at an x of a real run, reached the way the game reaches it.
//
//   node scripts/port-at.mjs <level> <x> <out.png> [--draws=out.json]
//
// `shot-at.mjs` jumps there with `?x=` and fast-forwards the trigger clock at a
// fixed 1x speed, so colour and pulse state drift from the game's wherever the
// level changes speed. This instead loads the level from the start and walks
// the macro's recorded path at 240 Hz (`__play.followTrace`), placing the
// player on it every step — what the gd-ui-capture mod's `seek` does inside the
// game — so the two captures show the same moment. The last two seconds go one
// rendered frame per 4 steps, so the camera follows as it does in play.
//
// `--draws` also writes every sprite drawn that frame (object index, id,
// position, size, final colour and opacity) for diffing against the mod's
// `objects` dump (`scripts/draw-diff.mjs`).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [lvl, xArg, out] = process.argv.slice(2);
if (!lvl || !xArg || !out) {
  console.error("usage: node scripts/port-at.mjs <level> <x> <out.png> [--draws=out.json]");
  process.exit(2);
}
const drawsOut = process.argv.find((a) => a.startsWith("--draws="))?.slice(8);
const target = Number(xArg);

execFileSync("node", [join(here, "native-trace.mjs"), lvl], { stdio: "ignore" });
const flat = [];
for (const line of readFileSync(`/tmp/gd-ui-capture/trace-${lvl}.txt`, "utf8").split("\n")) {
  const [x, y, , held] = line.split(" ").map(Number);
  if (!Number.isFinite(x) || x >= target) break;
  flat.push(x, y - 90, held); // the port's y is the game's minus 90
}
const TAIL = 480 * 3; // the last two seconds, stepped with the renderer

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:3222/?level=${lvl}&manual=1`);
  await page.waitForFunction(() => window.__play);
  const head = flat.slice(0, Math.max(0, flat.length - TAIL));
  const tail = flat.slice(head.length);
  await page.evaluate((f) => window.__play.followTrace(f), head);
  for (let i = 0; i < tail.length; i += 12) {
    await page.evaluate(async (f) => {
      window.__play.followTrace(f);
      await new Promise((r) => requestAnimationFrame(r));
    }, tail.slice(i, i + 12));
  }
  for (let i = 0; i < 3; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  if (drawsOut) {
    const draws = await page.evaluate(async () => {
      const s = window.__play.scene;
      s.captureDraws = [];
      await new Promise((r) => requestAnimationFrame(r));
      const d = s.captureDraws;
      s.captureDraws = undefined;
      return d;
    });
    writeFileSync(drawsOut, JSON.stringify(draws));
  }
  await page.screenshot({ path: out });
  const info = await page.evaluate(() => window.__play.info);
  console.log(`${out} x=${info.x.toFixed(1)} y=${info.y.toFixed(1)} mode=${info.mode}`);
  if (errors.length) { console.error("page errors:", errors.slice(0, 3)); process.exit(1); }
} finally {
  await browser.close();
}
