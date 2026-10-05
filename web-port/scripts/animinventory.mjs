// Task 5 evidence: how many sprites in each of the 22 levels actually spin or
// run a frame animation, counted in the built scene rather than from the level
// data — so it measures what the renderer really does with `gd/objectAnim.ts`.
//
// Usage: node scripts/animinventory.mjs        (needs the dev server)
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
let tot = { spin: 0, anim: 0, items: 0 };
for (let n = 1; n <= 22; n++) {
  await page.goto(`http://localhost:3222/?level=${n}&manual=1`);
  await page.waitForFunction(() => window.__play, null, { timeout: 30000 });
  const r = await page.evaluate(() => {
    const it = window.__play.scene.items;
    let spin = 0, anim = 0;
    for (const i of it) { if (i.spin) spin++; if (i.animFrames) anim++; }
    return { items: it.length, spin, anim };
  });
  tot.spin += r.spin; tot.anim += r.anim; tot.items += r.items;
  console.log(`L${n}\t${r.items} sprites\t${r.spin} spinning\t${r.anim} animated`);
}
console.log(`TOTAL\t${tot.items}\t${tot.spin}\t${tot.anim}`);
await browser.close();
