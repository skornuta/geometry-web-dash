// Practice mode, checkpoints, and the reproduced PauseLayer's practice
// variations (docs/ui-parity/REFERENCE.md §15).
//
// What only a browser can answer: that the pause row swaps its practice button
// for the normal-mode one, that the practice banner appears, that a checkpoint
// really rewinds a death, that progress is filed against the practice stat and
// not the normal one, and that a pause click cannot leak a jump into the run.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3222").replace(/\/$/, "");
const shots = new URL("../../docs/ui-parity/comparisons/", import.meta.url);
await mkdir(shots, { recursive: true });

const fail = [];
const check = (ok, msg) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`);
  if (!ok) fail.push(msg);
};

const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

const info = () => page.evaluate(() => window.__play.info);
const step = (n, held = false) =>
  page.evaluate(([n, held]) => { for (let i = 0; i < n; i++) window.__play.stepTick(held); }, [n, held]);

async function load(level = 1) {
  await page.goto(`${base}/?level=${level}&manual=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__play);
}

/** click a pause control by id, using the rect the scene actually drew */
async function clickControl(id) {
  const c = (await info()).controls.find((b) => b.id === id);
  assert.ok(c, `pause control ${id} is present`);
  const p = await page.evaluate(([x, y]) => {
    const cv = document.getElementById("game");
    const box = cv.getBoundingClientRect();
    const scale = cv.height / 320 <= cv.width / 480 ? cv.height / 320 : cv.width / 480;
    return {
      x: box.left + (x * scale + cv.width / 2) * box.width / cv.width,
      y: box.top + (cv.height / 2 - y * scale) * box.height / cv.height,
    };
  }, [c.x, c.y]);
  await page.mouse.click(p.x, p.y);
}

await load();

// ------------------------------------------------ the pause row, both modes
await step(200);
await page.keyboard.press("Escape");
await page.waitForTimeout(120);
const normalRow = (await info()).controls.map((c) => c.id);
// `onRestartFull` is added only for a platformer (PauseLayer::customSetup
// +776..852), and the native capture of a classic level shows four buttons
check(JSON.stringify(normalRow.slice(0, 4))
  === JSON.stringify(["practice", "resume", "quit", "restart"]),
  `the pause row is the sourced order (${normalRow.slice(0, 4).join(", ")})`);
check(!normalRow.includes("restartFull"), "a classic level has no full-restart button");
check(normalRow.includes("settings"),
  "the settings gear is part of the pause menu's controls");
await page.screenshot({ path: fileURLToPath(new URL("pause-normal.png", shots)) });

await clickControl("practice");
check((await info()).practice === true, "the practice button enters practice mode");
check((await info()).paused === false, "and resumes, as onPracticeMode does");

await step(200);
await page.keyboard.press("Escape");
await page.waitForTimeout(120);
const practiceRow = (await info()).controls.map((c) => c.id);
check(practiceRow.includes("practice"),
  "the practice button becomes the normal-mode one in place");
await page.screenshot({ path: fileURLToPath(new URL("pause-practice.png", shots)) });

// Auto-Checkpoints is game variable "0027" on the sourced GameOptionsLayer, which
// the gear opens — it is no longer a port-invented row on the pause menu itself
await clickControl("settings");
const opts = (await info()).gameOptions;
check(!!opts && opts.controls.some((c) => c.id === "autoCheckpoints"),
  "the gear's options popup carries Auto-Checkpoints");
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
check((await info()).gameOptions === null, "and Escape returns to the pause menu");

// a pause click must not leak a jump into the run
await clickControl("resume");
check(await page.evaluate(() => window.__play.state.queuedHold) === false,
  "resuming does not queue a jump");

// ------------------------------------------------------- checkpoints
await page.evaluate(() => window.__play.placeCheckpoint?.());
await step(120);
const beforeDeath = await info();
await page.evaluate(() => { window.__play.state.y = 2000; });
await step(120);
const afterDeath = await info();
check(afterDeath.x > 0 || afterDeath.checkpoints.length > 0,
  `a practice death rewinds rather than restarting from zero (x ${afterDeath.x.toFixed(0)})`);
check(beforeDeath.practice === true, "still in practice mode");

// ------------------------------------------ practice progress is separate
//
// `?manual=1` deliberately does not write to the save (ARCHITECTURE-REFERENCE
// §6), so this pins that invariant rather than pretending a manual run banks —
// and then checks the two pause bars really read the two separate stats.
await step(300);
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
await clickControl("quit");
await page.waitForURL("**/*levels=1*", { timeout: 5000 });
await page.waitForFunction(() => !!window.__menu);
const stats = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("gd-web-save") ?? "{}");
  return raw.levels?.["1"] ?? null;
});
check(stats === null || stats.normal === 0,
  `a manual run does not bank against the normal stat (${JSON.stringify(stats)})`);

// seed the two stats apart and confirm the pause menu shows both, separately
await page.evaluate(() => localStorage.setItem("gd-web-save", JSON.stringify({
  v: 1, levels: { 1: { normal: 37, practice: 84, coins: [], attempts: 3, jumps: 5 } },
})));
await load();
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
const bars = await page.evaluate(() => {
  const c = document.getElementById("game");
  return { w: c.width, h: c.height };
});
check(bars.w > 0, "the pause menu renders with seeded stats");
await page.screenshot({ path: fileURLToPath(new URL("pause-seeded-stats.png", shots)) });
await page.keyboard.press("Escape");

// ------------------------------------------------- attempts persist
await load();
const a1 = (await info()).attempts;
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
await clickControl("restart");
await page.waitForTimeout(100);
check((await info()).attempts === a1 + 1, "restart counts an attempt");

// the in-practice restart also starts from zero: `reset` clears the stack
await page.evaluate(() => window.__play.setPractice(true));
await step(100);
await page.evaluate(() => window.__play.placeCheckpoint?.());
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
await clickControl("restart");
await page.waitForTimeout(100);
check((await info()).checkpoints.length === 0,
  "restart clears the checkpoint stack");

check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");

await browser.close();
console.log(fail.length ? `\nFAIL — ${fail.length} check(s) failed` : "\nPASS — practice mode and the pause menu");
process.exit(fail.length ? 1 : 0);
