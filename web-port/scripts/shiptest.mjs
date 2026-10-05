// Verifies the ship section of Stereo Madness: start just before the ship
// portal at x=7995 and fly by alternating hold/release. Reports mode, y
// oscillation, deaths and progress.
import { chromium } from "playwright";

const startX = parseFloat(process.argv[2] ?? "7950");
const seconds = parseFloat(process.argv[3] ?? "15");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:3222/?level=1&x=${startX}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__play !== undefined, null, { timeout: 15000 });

const result = await page.evaluate(async ({ seconds, startX }) => {
  const play = window.__play;
  // start at portal height so the run crosses the ship portal's trigger box —
  // verifies the portal -> gamemode path end to end
  play.state.y = 165;
  const samples = [];
  const deaths = [];
  const t0 = performance.now();
  let holdingNow = false;
  let lastAttempt = 1;
  while ((performance.now() - t0) / 1000 < seconds) {
    const t = (performance.now() - t0) / 1000;
    const info = play.info;
    if (info.attempts !== lastAttempt) {
      deaths.push({ x: samples.length ? samples[samples.length - 1].x : 0 });
      lastAttempt = info.attempts;
      holdingNow = false;
      play.endJump();
    }
    if (info.attempts > 1 && play.state.y < 60) play.state.y = 165; // re-arm after a death
    if (!info.dead && info.mode === "ship") {
      // bang-bang altitude hold around the corridor middle
      const want = play.state.y < 165;
      if (want !== holdingNow) {
        holdingNow = want;
        if (want) play.jump(); else play.endJump();
      }
    }
    samples.push({
      t: +t.toFixed(2), x: Math.round(info.x), y: Math.round(info.y),
      mode: info.mode, dead: info.dead, attempts: info.attempts,
    });
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { samples, deaths };
}, { seconds, startX });

// compress: report mode changes, deaths, and a few y samples
const { samples, deaths } = result;
const modes = [];
let minY = 1e9, maxY = -1e9, lastX = 0;
for (const s of samples) {
  if (!modes.length || modes[modes.length - 1].mode !== s.mode) modes.push({ mode: s.mode, x: s.x });
  if (!s.dead) { minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); lastX = Math.max(lastX, s.x); }
}
console.log("mode transitions:", modes);
console.log("deaths:", deaths);
console.log("furthest x:", lastX, "| y range while alive:", minY, "-", maxY);
console.log("attempts:", samples[samples.length - 1].attempts, "| dead at end:", samples[samples.length - 1].dead);
console.log("last samples:", samples.slice(-5));
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
