// Task 5 evidence: photograph one spot in a level at two animation times, so a
// still can show that the saws, gears and animated decoration actually move.
//
// `shot-at.mjs` answers "does this spot look right"; this answers "does it
// live". Both frames come from the same trigger state — only `TriggerRuntime`'s
// clock differs — so anything that changes between them changed because of
// `gd/objectAnim.ts` and nothing else.
//
// Usage: node scripts/animcapture.mjs <level> <x> <outPrefix> [--dt=0.25] [--y=N]
import { chromium } from "playwright";

const [lvl, x, out] = process.argv.slice(2);
if (!lvl || !x || !out) {
  console.error("usage: node scripts/animcapture.mjs <level> <x> <outPrefix> [--dt=0.25] [--y=N]");
  process.exit(2);
}
const dtArg = process.argv.find((a) => a.startsWith("--dt="));
const dt = dtArg ? Number(dtArg.slice(5)) : 0.25;
const yArg = process.argv.find((a) => a.startsWith("--y="));
const camY = yArg ? Number(yArg.slice(4)) : null;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`http://localhost:3222/?level=${lvl}&x=${x}&manual=1`);
  await page.waitForFunction(() => window.__play);
  if (camY !== null) {
    await page.evaluate((y) => { window.__play.state.y = y; window.__play.state.yVel = 0; }, camY);
  }
  await page.evaluate(async (X) => {
    const { updateTriggers } = await import("/src/gd/triggers.ts");
    const t = window.__play.triggers;
    for (let cx = 0; cx <= X; cx += 30) updateTriggers(t.rt, t.list, cx, 30 / 311.58);
  }, Number(x));

  const shot = async (t, suffix) => {
    await page.evaluate((tt) => {
      const p = window.__play;
      p.triggers.rt.time = tt;
      p.scene.animTime = tt;
    }, t);
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    }
    await page.screenshot({ path: `${out}-${suffix}.png` });
  };
  // let the camera lerp settle before the pair is taken
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
  const t0 = await page.evaluate(() => window.__play.triggers.rt.time);
  await shot(t0, "a");
  await shot(t0 + dt, "b");
  console.log(`${out}-a.png (t=${t0.toFixed(3)}) and ${out}-b.png (t=${(t0 + dt).toFixed(3)})`,
    errors.length ? `ERRORS: ${errors.slice(0, 3).join(" | ")}` : "no console errors");
} finally {
  await browser.close();
}
