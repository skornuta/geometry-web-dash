// Does the pause menu actually freeze the music, not just the simulation?
// Drives the real browser build: start audio with a keypress, pause, resume.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3222/?level=1";
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console error:", m.text()); });
await page.goto(url, { waitUntil: "networkidle" });

const info = () => page.evaluate(() => window.__play.info);

// audio only starts on a real user gesture
await page.keyboard.press("Space");
await page.waitForTimeout(1200);
const playing = await info();
console.log(`after first input : audioState=${playing.audioState}  paused=${playing.paused}`);

await page.keyboard.press("Escape");
await page.waitForTimeout(600);
const pausedInfo = await info();
console.log(`after Escape      : audioState=${pausedInfo.audioState}  paused=${pausedInfo.paused}`);

// Pointer input must not unlock audio or buffer a jump behind the pause menu.
const queuedBefore = await page.evaluate(() => window.__play.state.queuedHold);
await page.mouse.click(10, 10);
await page.evaluate(() => window.dispatchEvent(new Event("touchstart", { cancelable: true })));
await page.waitForTimeout(150);
const afterPointer = await info();
const queuedAfter = await page.evaluate(() => window.__play.state.queuedHold);
console.log(`after paused click/touch: audioState=${afterPointer.audioState}  paused=${afterPointer.paused}`);

await page.keyboard.press("Escape");
await page.waitForTimeout(600);
const resumed = await info();
console.log(`after Escape again: audioState=${resumed.audioState}  paused=${resumed.paused}`);

await page.keyboard.down("Space");
await page.evaluate(() => window.dispatchEvent(new Event("blur")));
await page.waitForTimeout(100);
const blurred = await info();
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", {
  code: "Escape", repeat: true,
})));
await page.waitForTimeout(100);
const repeated = await info();
console.log(`after blur/repeated Escape: audioState=${repeated.audioState}  paused=${repeated.paused}`);

await browser.close();

const ok = playing.audioState === "running"
  && pausedInfo.audioState === "suspended" && pausedInfo.paused === true
  && afterPointer.audioState === "suspended" && afterPointer.paused === true
  && afterPointer.x === pausedInfo.x && queuedAfter === queuedBefore
  && resumed.audioState === "running" && resumed.paused === false
  && blurred.paused && blurred.audioState === "suspended"
  && repeated.paused && repeated.x === blurred.x;
console.log(ok ? "PASS — music freezes with the pause menu" : "FAIL — music did not follow the pause state");
process.exit(ok ? 0 : 1);
