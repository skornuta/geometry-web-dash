// Real canvas regression: the attempt label belongs to the starting area,
// scrolls away with the world, and returns after Restart.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export async function checkAttemptLabel(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("http://localhost:3222/?level=1&manual=1");
  await page.waitForFunction(() => window.__play && Math.abs(window.__play.info.camY + 90) < 1);
  // This opening region contains only the label and background. Exclude the
  // progress bar/percent above it and the ground/spike art below it.
  const labelPixels = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const gl = document.querySelector("canvas").getContext("webgl2");
    const pixels = new Uint8Array(1280 * 720 * 4);
    gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let count = 0, sumX = 0;
    for (let y = 370; y < 620; y++) for (let x = 0; x < 1200; x++) {
      const i = (y * 1280 + x) * 4;
      if (pixels[i] > 180 && pixels[i + 1] > 180 && pixels[i + 2] > 180) {
        count++; sumX += x;
      }
    }
    resolve({ count, x: sumX / count });
  })));
  const step = ticks => page.evaluate(ticks => {
    for (let i = 0; i < ticks; i++) window.__play.stepTick(false);
  }, ticks);
  const initial = await labelPixels();
  assert.ok(initial.count > 500, "attempt label is visible at the start");
  await step(20);
  const moved = await labelPixels();
  const displacement = await page.evaluate(() => window.__play.info.x);
  assert.ok(Math.abs(initial.x - moved.x - displacement * 720 / 320) < 2,
    `attempt label must move with the world: pixels ${initial.x - moved.x}, expected ${displacement * 720 / 320}`);
  await step(60);
  assert.equal((await labelPixels()).count, 0, "label scrolls completely offscreen");
  await page.keyboard.press("Escape");
  // The pause menu is now the sourced PauseLayer row
  // [restartFull, practice, resume, quit, restart], with the cursor starting on
  // Resume, so Restart is two steps to the right.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__play.info.attempts === 2 && Math.abs(window.__play.info.camY + 90) < 1);
  assert.ok((await labelPixels()).count > 500, "Restart shows the new attempt label");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch();
  try {
    await checkAttemptLabel(await browser.newPage());
    console.log("PASS — attempt label scrolls away and returns on restart");
  } finally { await browser.close(); }
}
