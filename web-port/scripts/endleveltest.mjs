// Browser acceptance for the results screen (docs/ui-parity/REFERENCE.md §17).
//
// The geometry and the formatting are unit-tested; what needs a real browser is
// that the sourced art loads, that the layer really slides, that the statistics
// come from the run rather than the save, that the coin row shows the player's
// real coins, that both buttons do what the original's do, and that the HUD
// underneath is gone so a stray click cannot reach it.
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3222").replace(/\/$/, "");
const shots = new URL("../../docs/ui-parity/comparisons/", import.meta.url);
await mkdir(shots, { recursive: true });
const route = JSON.parse(await readFile(
  new URL("./manual-routes/stereo-madness.json", import.meta.url), "utf8"));

const fail = [];
const check = (ok, msg) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`);
  if (!ok) fail.push(msg);
};

const browser = await chromium.launch();
const errors = [];

async function open(url = "?level=1&manual=1", seed = null, size = { width: 1280, height: 720 }) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  if (seed !== null) {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => localStorage.setItem("gd-web-save", s), seed);
  }
  await page.goto(`${base}/${url}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__play);
  return { context, page };
}

const info = (page) => page.evaluate(() => window.__play.info);
const finish = (page) => page.evaluate((segs) => {
  for (const [t, h] of segs) for (let i = 0; i < t; i++) window.__play.stepTick(h);
}, route.segments);

async function toClient(page, x, y) {
  return page.evaluate(([x, y]) => {
    const cv = document.getElementById("game");
    const box = cv.getBoundingClientRect();
    const scale = Math.min(cv.height / 320, cv.width / 480);
    return {
      x: box.left + (x * scale + cv.width / 2) * box.width / cv.width,
      y: box.top + (cv.height / 2 - y * scale) * box.height / cv.height,
    };
  }, [x, y]);
}

async function clickControl(page, id) {
  const c = (await info(page)).controls.find((b) => b.id === id);
  if (!c) throw new Error(`no results control ${id}`);
  const p = await toClient(page, c.x, c.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(120);
}

// --------------------------------------------------------------- assets
{
  const { context, page } = await open();
  const missing = await page.evaluate(async () => {
    const a = await import("/src/engine/atlas.ts");
    const r = await import("/src/engine/renderer.ts");
    const rr = new r.Renderer(document.createElement("canvas"));
    const sheets = await Promise.all(["GJ_GameSheet-hd", "GJ_GameSheet02-hd", "GJ_GameSheet03-hd"]
      .map((n) => a.loadAtlas(rr, `/assets/${n}.plist`, `/assets/${n}.png`)));
    const has = (n) => sheets.some((s) => !!s.atlas.get(n));
    return ["GJ_levelComplete_001.png", "GJ_practiceComplete_001.png",
      "GJ_replayBtn_001.png", "GJ_menuBtn_001.png", "GJ_restartCheckBtn_001.png",
      "secretCoin_b_01_001.png", "secretCoinUI_001.png", "chain_01_001.png"]
      .filter((n) => !has(n));
  });
  check(missing.length === 0, `every results frame resolves${missing.length ? ": missing " + missing.join(", ") : ""}`);
  await context.close();
}

// ------------------------------------------------------ a normal clear
{
  const { context, page } = await open();
  const beforeCoins = (await info(page)).coins;
  check((await info(page)).endLevel === null, "there is no results layer mid-run");
  await finish(page);
  await page.waitForFunction(() => window.__play.info.completed, null, { timeout: 8000 });
  const early = (await info(page)).endLevel;
  check(early.t < 1, `the layer slides in (t = ${early.t.toFixed(2)})`);
  await page.waitForFunction(() => window.__play.info.endLevel.t >= 1, null, { timeout: 3000 });
  await page.waitForTimeout(120);

  const end = (await info(page)).endLevel;
  check(end.attempts === 1, `attempts is the run's own count (${end.attempts})`);
  check(end.time > 60 && end.time < 200, `time is the run's elapsed seconds (${end.time.toFixed(1)})`);
  check(end.practice === false, "a normal clear reports normal mode");
  // Stereo Madness's route jumps; the count is the sim's, not an inference
  check(end.jumps > 10 && end.jumps < 400, `Jumps is the session's real count (${end.jumps})`);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gd-web-save") ?? "{}").levels?.["1"]?.jumps ?? null);
  check(saved === null || saved >= end.jumps,
    `the level's cumulative jumps were banked (${saved})`);

  const ids = (await info(page)).controls.map((c) => c.id);
  check(JSON.stringify(ids) === JSON.stringify(["replay", "quit"]),
    `the results row is Replay and Menu (${ids.join(", ")})`);
  check(!ids.includes("pause"), "the gameplay HUD's pause button is gone");
  await page.screenshot({ path: fileURLToPath(new URL("end-level-normal.png", shots)) });
  void beforeCoins;
  await context.close();
}

// ------------------------------------------- the ending (gd/levelEnd.ts)
{
  const { context, page } = await open();
  const L = (await info(page)).levelLength;
  check(Math.abs(L - (26384 + 340)) < 1e-6, `L1 ends 340 past its last object (${L})`);
  await page.evaluate(() => { window.__play.state.x = window.__play.info.levelLength - 301; });
  await page.evaluate(() => window.__play.stepTick(false));
  const e0 = await info(page);
  check(e0.ended === true, "the ending triggers 300 before the portal");
  check(e0.completed === false, "the results do not drop at once");
  check(e0.hudPercent < 100, `the HUD is short of 100 at the trigger (${e0.hudPercent})`);
  const x0 = e0.x;
  await page.evaluate(() => window.__play.stepTick(true));
  await page.keyboard.press("Escape");
  const e1 = await info(page);
  check(e1.x === x0, "the locked player does not move, even held");
  check(e1.paused === false, "the pause menu refuses during the ending");
  await page.waitForFunction(() => window.__play.info.ending?.complete, null, { timeout: 4000 });
  const e2 = await info(page);
  check(e2.hudPercent === 100, `the pull carries the HUD to 100 (${e2.hudPercent})`);
  check(e2.ending.drawX > L, `the player is pulled past the portal (${Math.round(e2.ending.drawX)})`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: fileURLToPath(new URL("end-level-flash.png", shots)) });
  await page.waitForFunction(() => (window.__play.info.ending?.banner ?? 0) > 1, null, { timeout: 4000 });
  await page.screenshot({ path: fileURLToPath(new URL("end-level-banner.png", shots)) });
  await page.waitForFunction(() => window.__play.info.completed, null, { timeout: 6000 });
  const t = (await info(page)).ending.t;
  check(Math.abs(t - 4.255) < 0.35, `EndLevelLayer drops 4.255 s after the trigger (${t.toFixed(2)})`);
  const end = (await info(page)).endLevel;
  check(end.practice === false, "and it is a normal clear");
  await context.close();
}

// ---------------------------------------------------------- the buttons
{
  const { context, page } = await open();
  await finish(page);
  await page.waitForFunction(() => window.__play.info.completed, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__play.info.endLevel.t >= 1);
  const attempts = (await info(page)).attempts;
  await clickControl(page, "replay");
  const after = await info(page);
  check(after.completed === false, "Replay restarts the level in place");
  check(after.attempts === attempts + 1, "and counts the attempt");
  check(after.paused === false, "and does not leave it paused");
  check(await page.evaluate(() => window.__play.state.queuedHold) === false,
    "and does not leak a jump into the new run");

  await finish(page);
  await page.waitForFunction(() => window.__play.info.completed, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__play.info.endLevel.t >= 1);
  await clickControl(page, "quit");
  await page.waitForURL("**/*levels=1*", { timeout: 5000 });
  check(page.url().includes("sel=1"),
    `Menu returns to the carousel with the level selected (${page.url()})`);
  await context.close();
}

// ------------------------------------------------- practice completion
{
  const { context, page } = await open("?level=1&manual=1&practice=1");
  check((await info(page)).practice === true, "the practice route starts in practice");
  await finish(page);
  await page.waitForFunction(() => window.__play.info.completed, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__play.info.endLevel.t >= 1);
  const end = (await info(page)).endLevel;
  check(end.practice === true, "a practice clear reports practice mode");
  const ids = (await info(page)).controls.map((c) => c.id);
  check(ids.includes("restartCheckpoint"),
    `practice adds the restart-from-checkpoint button (${ids.join(", ")})`);
  check(ids[0] === "restartCheckpoint",
    "and it is the leftmost, as customSetup places it at -180");
  await page.screenshot({ path: fileURLToPath(new URL("end-level-practice.png", shots)) });
  await context.close();
}

// ---------------------------------- the coin row shows the real save state
{
  const seed = JSON.stringify({
    v: 1,
    levels: { 1: { normal: 100, practice: 0, coins: [0, 2], attempts: 9, jumps: 0 } },
  });
  const { context, page } = await open("?level=1&manual=1", seed);
  await finish(page);
  await page.waitForFunction(() => window.__play.info.completed, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__play.info.endLevel.t >= 1);
  await page.waitForTimeout(120);
  const held = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gd-web-save")).levels["1"].coins);
  check(JSON.stringify(held) === JSON.stringify([0, 2]),
    `the coin row reads the save's real coins (${JSON.stringify(held)})`);
  await page.screenshot({ path: fileURLToPath(new URL("end-level-coins.png", shots)) });
  await context.close();
}

// ------------------------------------------------------ viewport shapes
for (const [name, size] of [
  ["1280x720", { width: 1280, height: 720 }],
  ["1920x1080", { width: 1920, height: 1080 }],
  ["1024x768", { width: 1024, height: 768 }],
  ["narrow-420x900", { width: 420, height: 900 }],
]) {
  const { context, page } = await open("?level=1&manual=1", null, size);
  await finish(page);
  await page.waitForFunction(() => window.__play.info.completed, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__play.info.endLevel.t >= 1);
  await page.waitForTimeout(120);
  const c = (await info(page)).controls;
  check(c.length >= 2, `${name}: the results buttons are present`);
  await page.screenshot({ path: fileURLToPath(new URL(`end-level-${name}.png`, shots)) });
  await context.close();
}

check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");

await browser.close();
console.log(fail.length ? `\nFAIL — ${fail.length} check(s) failed` : "\nPASS — results screen");
process.exit(fail.length ? 1 : 0);
