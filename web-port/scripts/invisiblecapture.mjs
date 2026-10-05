// A/B for the invisible-object fade: the same spot with the fade on, then with
// every item's `invisibleHW` stripped (which is what the port drew before).
import { chromium } from "playwright";
const [lvl, x, out] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://localhost:3222/?level=${lvl}&x=${x}&manual=1`);
await p.waitForFunction(() => window.__play);
for (let i = 0; i < 40; i++) await p.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
await p.screenshot({ path: `${out}-after.png` });
const n = await p.evaluate(() => {
  let n = 0;
  for (const it of window.__play.scene.items) if (it.invisibleHW !== undefined) { it.invisibleHW = undefined; n++; }
  return n;
});
for (let i = 0; i < 6; i++) await p.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
await p.screenshot({ path: `${out}-before.png` });
console.log(`${n} invisible sprites; ${out}-after.png / ${out}-before.png`);
await b.close();
