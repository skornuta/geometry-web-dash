// Frame-time probe: holds the camera at a chosen x of a level (`?x=`, with the
// player kept alive by the `?manual=1` clock) and records requestAnimationFrame
// intervals and the scene loop's own JS time for a few seconds.
//
//   node scripts/perfprobe.mjs <level> <x,...> [seconds]
import { chromium } from "playwright";

const [lvl, xsArg, secsArg] = process.argv.slice(2);
const secs = parseFloat(secsArg ?? "3");
const browser = await chromium.launch({ headless: process.env.HEADED !== "1", args: ["--use-angle=metal", "--disable-gpu-vsync", "--disable-frame-rate-limit"] });
for (const x of xsArg.split(",")) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://localhost:3222/?level=${lvl}&x=${x}&manual=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__play !== undefined);
  const r = await page.evaluate(async (secs) => {
    // step a little so the emitters around the player are running
    for (let i = 0; i < 30; i++) {
      window.__play.stepTick(false);
      await new Promise((res) => requestAnimationFrame(res));
    }
    const deltas = [];
    let last = performance.now();
    const end = last + secs * 1000;
    while (performance.now() < end) {
      window.__play.stepTick(false);
      await new Promise((res) => requestAnimationFrame(res));
      const now = performance.now();
      deltas.push(now - last);
      last = now;
    }
    deltas.sort((a, b) => a - b);
    const q = (f) => deltas[Math.min(deltas.length - 1, Math.floor(f * deltas.length))];
    return { frames: deltas.length, p50: q(0.5), p95: q(0.95), max: deltas[deltas.length - 1],
      particles: window.__play.info.particles, emitters: window.__play.info.emitters };
  }, secs);
  console.log(`L${lvl} x=${x}: ${r.frames} frames, p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, `
    + `max ${r.max.toFixed(1)} ms, particles ${r.particles} ${JSON.stringify(r.emitters)}`);
  await page.close();
}
await browser.close();
