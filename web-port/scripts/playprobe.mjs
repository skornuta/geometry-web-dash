// Frame intervals and the loop's own time during real play (no manual clock):
// the level runs in real time from x, physics, effects and all.
//   HEADED=1 node scripts/playprobe.mjs <level> <x> [seconds]
import { chromium } from "playwright";
const [lvl, x, secsArg] = process.argv.slice(2);
const secs = parseFloat(secsArg ?? "4");
const browser = await chromium.launch({ headless: process.env.HEADED !== "1", args: ["--use-angle=metal", "--disable-gpu-vsync", "--disable-frame-rate-limit"] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:3222/?level=${lvl}&x=${x}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__play !== undefined);
await page.keyboard.press("Space");
const r = await page.evaluate(async (secs) => {
  const d = []; let last = performance.now(); const end = last + secs * 1000;
  while (performance.now() < end) { await new Promise((res) => requestAnimationFrame(res)); const n = performance.now(); d.push(n - last); last = n; }
  d.sort((a, b) => a - b); const q = (f) => d[Math.min(d.length - 1, Math.floor(f * d.length))];
  return { frames: d.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: d[d.length - 1], loop: window.__play.info.loopMs };
}, secs);
console.log(`L${lvl} x=${x} play: ${r.frames} frames, interval p50 ${r.p50.toFixed(1)} p95 ${r.p95.toFixed(1)} p99 ${r.p99.toFixed(1)} max ${r.max.toFixed(1)} ms; loop p50 ${r.loop.p50.toFixed(2)} p95 ${r.loop.p95.toFixed(2)} max ${r.loop.max.toFixed(2)}`);
await browser.close();
