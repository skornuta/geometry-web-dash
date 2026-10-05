// Drives the running game in headless chromium and reports what happens:
// where the cube dies, how far it gets, and (optionally) whether scripted jumps
// clear an obstacle. Dev server must be running.
//
// Usage: node scripts/playtest.mjs [level] [seconds] [jumpAtX,jumpAtX,...]
import { chromium } from "playwright";

const level = process.argv[2] ?? "1";
const seconds = parseFloat(process.argv[3] ?? "6");
const jumpAt = (process.argv[4] ?? "").split(",").filter(Boolean).map(Number);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:3222/?level=${level}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__play !== undefined, null, { timeout: 15000 });

const result = await page.evaluate(async ({ seconds, jumpAt }) => {
  const play = window.__play;
  const log = [];
  // jumps are re-armed on every attempt, and never fired while dead — otherwise
  // a run that is already past (or dying at) the trigger swallows them all
  let pending = [...jumpAt];
  let lastAttempt = play.info.attempts;
  let maxX = 0;
  const t0 = performance.now();

  while ((performance.now() - t0) / 1000 < seconds) {
    const info = play.info;
    if (info.attempts !== lastAttempt) {
      log.push({ event: "death", x: Math.round(maxX) });
      lastAttempt = info.attempts;
      maxX = 0;
      pending = [...jumpAt];
    }
    if (!info.dead) {
      maxX = Math.max(maxX, info.x);
      while (pending.length && info.x >= pending[0]) {
        pending.shift();
        play.jump();
        setTimeout(() => play.endJump(), 40);
      }
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  const info = play.info;
  return { log, attempts: info.attempts, furthest: Math.round(maxX), maxLevelX: Math.round(info.maxX) };
}, { seconds, jumpAt });

console.log(JSON.stringify(result, null, 2));
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
