// The play loop's own JS time per frame at chosen points of a level — the
// part of the frame budget the port itself spends (sim, scene, draw calls).
//   node scripts/loopprobe.mjs <level> <x,...> [seconds]
import { chromium } from "playwright";
const [lvl, xsArg, secsArg] = process.argv.slice(2);
const secs = parseFloat(secsArg ?? "3");
const browser = await chromium.launch({ headless: process.env.HEADED !== "1", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const x of xsArg.split(",")) {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:3222/?level=${lvl}&x=${x}&manual=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__play !== undefined);
  const r = await page.evaluate(async (secs) => {
    const end = performance.now() + secs * 1000;
    while (performance.now() < end) {
      window.__play.stepTick(false);
      await new Promise((res) => requestAnimationFrame(res));
    }
    return window.__play.info.loopMs;
  }, secs);
  console.log(`L${lvl} x=${x}: loop p50 ${r.p50.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, max ${r.max.toFixed(2)} ms`);
  await page.close();
}
await browser.close();
