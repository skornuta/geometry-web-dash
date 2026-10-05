// Screenshot a level at an x position with its trigger runtime fast-forwarded.
//
// `?x=` skips every portal behind the start but deliberately not the triggers,
// so a plain `?x=` screenshot shows a mid-level scene wearing the level's
// *opening* colours. This walks the runtime forward first, which is what makes
// a colour/move change visible without playing the level to that point.
//
// `--y=N` lifts the player (and so the camera) to that height before drawing.
// `?x=` always starts on the ground, which is useless for a section played in a
// tunnel or on a ceiling — the camera follows the player and you photograph the
// floor while the geometry you wanted is off the top of the frame.
//
// Usage: node scripts/shot-at.mjs <level> <x> <out.png> [--debug] [--y=N]
import { chromium } from "playwright";

const [lvl, x, out] = process.argv.slice(2);
if (!lvl || !x || !out) {
  console.error("usage: node scripts/shot-at.mjs <level> <x> <out.png> [--debug]");
  process.exit(2);
}
const debug = process.argv.includes("--debug") ? "&debug=1" : "";
const yArg = process.argv.find((a) => a.startsWith("--y="));
const camY = yArg ? Number(yArg.slice(4)) : null;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`http://localhost:3222/?level=${lvl}&x=${x}&manual=1${debug}`);
  await page.waitForFunction(() => window.__play);
  if (camY !== null) {
    await page.evaluate((y) => {
      window.__play.state.y = y;
      window.__play.state.yVel = 0;
    }, camY);
  }
  const channels = await page.evaluate(async (X) => {
    const { updateTriggers } = await import("/src/gd/triggers.ts");
    const t = window.__play.triggers;
    // Advance in one-unit-of-art steps at normal speed. Tween *timing* is
    // therefore approximate wherever the level changes speed; positions are not.
    for (let cx = 0; cx <= X; cx += 30) updateTriggers(t.rt, t.list, cx, 30 / 311.58);
    return [...t.rt.colors].sort((a, b) => a[0] - b[0]).map(([ch, c]) =>
      `${ch}:${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}${c.blending ? "+B" : ""}`);
  }, Number(x));
  // several frames so the camera lerp settles on the requested height
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
  await page.screenshot({ path: out });
  console.log(`${out}  ${channels.join(" ")}`);
  if (errors.length) { console.error("console errors:", errors); process.exit(1); }
} finally {
  await browser.close();
}
