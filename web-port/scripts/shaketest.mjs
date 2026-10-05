// Does the shake trigger (id 1520) actually move the camera in a real level?
//
// The trigger has unit tests, but those only prove `TriggerRuntime.shake` gets
// armed. This proves the last link in the chain: that `playLevel` reads it and
// that the camera offset moves as a result. Level 22 (Dash) carries 6 of them
// and the first sits at x=375, early enough for a recorded run to reach.
//
// **Two wrong ways to test this, both tried first.** `?x=` to just before the
// trigger teleports the player into whatever is at that x; they die on the first
// step and the shake you read back is DEATH_SHAKE (9), not the trigger. Adding
// `?manual=1` stops the sim advancing but a single `stepTick` still kills them,
// for the same reason. The only reading that means anything comes from a run
// that is *alive* when the trigger fires — so this replays a real recorded run,
// exactly like replay.mjs, and samples across the trigger.
//
//   node scripts/autoplay.mjs 22 --beam=256 --out=/tmp/run22.json
//   node scripts/shaketest.mjs /tmp/run22.json
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const runFile = process.argv[2] ?? "/tmp/run22.json";
const base = process.argv[3] ?? "http://localhost:3222";
const run = JSON.parse(readFileSync(runFile, "utf8"));

/** x of level 22's first shake trigger, read out of the level data (key 75 = 10) */
const TRIGGER_X = 375;

// edges -> per-tick held flags, same unpacking as replay.mjs
const held = new Array(run.ticks).fill(false);
let cur = false, ei = 0;
for (let t = 0; t < run.ticks; t++) {
  while (ei < run.edges.length && run.edges[ei].tick === t) cur = run.edges[ei++].holding;
  held[t] = cur;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`${base}/?level=${run.level}&manual=1`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

let beforeShake = 0, peakShake = 0, peakOffset = 0, armed = 0, died = false;
let sawBefore = false;
for (let t = 0; t < run.ticks; t++) {
  const alive = await page.evaluate((h) => window.__play.stepTick(h), held[t]);
  const info = await page.evaluate(() => window.__play.info);
  if (info.x < TRIGGER_X) {
    // baseline: nothing should be shaking before the trigger is reached
    beforeShake = Math.max(beforeShake, info.shake);
    sawBefore = true;
  } else {
    armed = Math.max(armed, info.triggerShake);
    peakShake = Math.max(peakShake, info.shake);
    peakOffset = Math.max(peakOffset, Math.abs(info.shakeOffset.x), Math.abs(info.shakeOffset.y));
  }
  if (!alive) { died = true; break; }
  // a couple of hundred ticks past the trigger is plenty; the whole run is 3200
  if (info.x > TRIGGER_X + 600) break;
}

const ok = !died && sawBefore && beforeShake === 0 && armed > 0
  && peakShake > 0 && peakOffset > 0.01 && errors.length === 0;

console.log(`level ${run.level}, shake trigger at x=${TRIGGER_X} (strength 10)`);
console.log(`  quiet before the trigger : ${beforeShake === 0} (peak ${beforeShake.toFixed(3)})`);
console.log(`  runtime armed for        : ${armed.toFixed(2)}s`);
console.log(`  peak camera shake        : ${peakShake.toFixed(2)}`);
console.log(`  peak camera offset       : ${peakOffset.toFixed(2)}`);
console.log(`  died before the trigger  : ${died}`);
for (const e of errors.slice(0, 3)) console.log(`  error: ${e}`);
console.log(ok
  ? "\nOK — trigger 1520 fires in a live run and moves the camera"
  : "\nFAIL");

await browser.close();
process.exit(ok ? 0 : 1);
