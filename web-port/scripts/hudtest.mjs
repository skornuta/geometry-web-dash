// Browser acceptance for the gameplay HUD (docs/ui-parity/REFERENCE.md §14).
//
// The geometry and rounding are unit-tested; what needs a real browser is that
// the loose bar textures load, that the printed percentage tracks the *live*
// position rather than the best, that it reads 99 at the near-finish case the
// plan flagged and 100 only on completion, that both visibility settings
// actually hide their element, and that the HUD does not follow world shake or
// mirroring.
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

async function open(settings, url = "?level=1&manual=1", size = { width: 1280, height: 720 }) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  if (settings) {
    await page.evaluate((s) => localStorage.setItem("gd-web-save",
      JSON.stringify({ v: 1, settings: s })), settings);
  }
  await page.goto(`${base}/${url}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__play);
  return { context, page };
}

const info = (page) => page.evaluate(() => window.__play.info);
const step = (page, n, held = false) =>
  page.evaluate(([n, held]) => { for (let i = 0; i < n; i++) window.__play.stepTick(held); }, [n, held]);

// --------------------------------------------------------------- assets
{
  const { context, page } = await open();
  for (const f of ["slidergroove2-hd.png", "sliderBar2-hd.png"]) {
    const ok = await page.evaluate((f) => fetch(`/assets/${f}`).then((r) => r.ok), f);
    check(ok, `the sourced bar texture ${f} is served`);
  }
  const hasPause = await page.evaluate(async () => {
    const a = await import("/src/engine/atlas.ts");
    const r = await import("/src/engine/renderer.ts");
    const rr = new r.Renderer(document.createElement("canvas"));
    const s = await a.loadAtlas(rr, "/assets/GJ_GameSheet03-hd.plist", "/assets/GJ_GameSheet03-hd.png");
    return !!s.atlas.get("GJ_pauseBtn_clean_001.png");
  });
  check(hasPause, "GJ_pauseBtn_clean_001.png resolves");
  await context.close();
}

// ------------------------------------------------- the value and its floor
{
  const { context, page } = await open();
  const start = await info(page);
  check(start.hudPercent === 0, `a fresh attempt reads 0% (${start.hudPercent})`);

  await step(page, 300);
  const mid = await info(page);
  check(mid.hudPercent === Math.floor(mid.livePercent),
    `the HUD floors the live percent (${mid.livePercent.toFixed(3)} -> ${mid.hudPercent})`);
  check(mid.hudPercent > 0, "it moved off zero");

  // the plan's near-finish case: x just short of the level's length must not
  // read 100 (the length is `m_levelLength`, 340 past the last object)
  const near = await page.evaluate(() => {
    window.__play.state.x = window.__play.info.levelLength - 2;
    return window.__play.info;
  });
  check(near.hudPercent === 99, `just short of the end reads 99, not 100 (${near.hudPercent})`);
  const exact = await page.evaluate(() => {
    window.__play.state.x = window.__play.info.levelLength;
    return window.__play.info;
  });
  check(exact.hudPercent === 100, `exactly at the end reads 100 (${exact.hudPercent})`);
  await context.close();
}

// ---------------------------------------- live position, not best progress
{
  const { context, page } = await open();
  await step(page, 400);
  const before = await info(page);
  // rewind the player: the HUD must follow it back down, which a best-progress
  // reading would not
  await page.evaluate(() => { window.__play.state.x = 0; });
  const after = await info(page);
  check(before.hudPercent > 0 && after.hudPercent === 0,
    `the HUD follows the player back to 0 (${before.hudPercent} -> ${after.hudPercent})`);
  check(after.percent >= before.hudPercent,
    "the separate best-progress stat did not move backwards");
  await context.close();
}

// -------------------------------------------------- visibility settings
//
// A WebGL canvas without `preserveDrawingBuffer` reads back empty, so the only
// honest way to prove a setting hides its element is to compare the rendered
// pixels. Each variant screenshots the same 40px strip at the top of the view,
// at the same deterministic tick, and the strips must differ from "all on".
const DEFAULTS = {
  musicVolume: 1, sfxVolume: 1, seenGarage: true,
  showProgressBar: true, showPercentage: true,
  showPauseButton: true, pauseButtonOnLeft: false,
};
const strips = {};
for (const [name, patch] of [
  ["all on", {}],
  ["no bar", { showProgressBar: false }],
  ["no percentage", { showPercentage: false }],
  ["no pause button", { showPauseButton: false }],
  ["pause on the left", { pauseButtonOnLeft: true }],
]) {
  const { context, page } = await open({ ...DEFAULTS, ...patch });
  await step(page, 300);
  await page.waitForTimeout(150);
  const slug = name.replace(/ /g, "-");
  await page.screenshot({ path: fileURLToPath(new URL(`hud-${slug}.png`, shots)) });
  strips[name] = (await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 40 } }))
    .toString("base64");
  await context.close();
}
for (const name of ["no bar", "no percentage", "no pause button", "pause on the left"]) {
  check(strips[name] !== strips["all on"], `${name}: the HUD strip really changes`);
}
check(strips["no bar"] !== strips["no percentage"],
  "hiding the bar and hiding the percentage are different pictures");

// ------------------------------------------- HUD is independent of the world
//
// The renderer flushes and swaps to an unmirrored, unshaken camera before the
// HUD, so entering a mirror portal must not move a single HUD element. Level 11
// has mirror portals; `?x=` fast-forwards every portal behind it, so loading
// past one gives a genuinely mirrored world.
{
  const plain = await open(null, "?level=11&manual=1");
  await step(plain.page, 200);
  const a = await info(plain.page);
  await plain.context.close();

  // Clutterfunk's orange mirror portal is at x=1223 and the blue one at x=2121
  // (scripts/mirrorplaytest.mjs pins both), so x=1500 is inside the mirrored run
  const mirrored = await open(null, "?level=11&x=1500&manual=1");
  await step(mirrored.page, 30);
  const b = await info(mirrored.page);
  await mirrored.context.close();

  check(a.hud !== null && b.hud !== null, "the HUD reports its layout");
  check(JSON.stringify(a.hud) === JSON.stringify(b.hud),
    `the HUD layout is identical mirrored (${b.mirrored}) and not (${a.mirrored})`);
  check(b.mirrored === true && a.mirrored === false,
    `the two runs really differ: plain=${a.mirrored}, mirrored=${b.mirrored}`);
}

// ------------------------------------------------------ viewport shapes
for (const [name, size] of [
  ["1280x720", { width: 1280, height: 720 }],
  ["1920x1080", { width: 1920, height: 1080 }],
  ["1024x768", { width: 1024, height: 768 }],
  ["narrow-420x900", { width: 420, height: 900 }],
]) {
  const { context, page } = await open(null, "?level=1&manual=1", size);
  await step(page, 300);
  await page.waitForTimeout(150);
  await page.screenshot({ path: fileURLToPath(new URL(`hud-port-${name}.png`, shots)) });
  const i = await info(page);
  check(i.hudPercent >= 0 && i.hudPercent <= 100, `${name}: the HUD percent is in range`);
  await context.close();
}

check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");

await browser.close();
console.log(fail.length ? `\nFAIL — ${fail.length} check(s) failed` : "\nPASS — gameplay HUD");
process.exit(fail.length ? 1 : 0);
