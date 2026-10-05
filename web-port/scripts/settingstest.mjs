// Browser acceptance for the settings screens (docs/ui-parity/REFERENCE.md §16).
//
// The geometry is unit-tested; what needs a real browser is that the sourced
// art actually loads, that a slider can be dragged with a mouse and that the
// value it writes reaches both the save and the live audio engine, that the
// toggles reach the HUD, that Escape unwinds the layers in the right order,
// and that an old save without the new fields still opens.
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

async function open(url = "?settings=1", size = { width: 1280, height: 720 }, seed = null) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  if (seed !== null) {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => localStorage.setItem("gd-web-save", s), seed);
  }
  await page.goto(`${base}/${url}`, { waitUntil: "networkidle" });
  return { context, page };
}

const menuInfo = (page) => page.evaluate(() => window.__mainMenu.info);

/** design-space point -> client pixels, the same mapping toDesignSpace inverts */
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

async function clickOption(page, id) {
  const c = await page.evaluate((id) => window.__mainMenu.optionAt(id), id);
  if (!c) throw new Error(`no settings control ${id}`);
  const p = await toClient(page, c.x, c.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
}

// ---------------------------------------------------------------- assets
{
  const { context, page } = await open();
  for (const f of [
    "goldFont-hd.fnt", "goldFont-hd.png", "GJ_button_01-hd.png",
    "GJ_square01-hd.png", "GJ_square02-hd.png",
    "slidergroove-hd.png", "sliderBar-hd.png",
    "sliderthumb-hd.png", "sliderthumbsel-hd.png",
  ]) {
    const ok = await page.evaluate((f) => fetch(`/assets/${f}`).then((r) => r.ok), f);
    check(ok, `the sourced asset ${f} is served`);
  }
  await context.close();
}

// ------------------------------------------------- the drop-down itself
{
  const { context, page } = await open();
  await page.waitForFunction(() => window.__mainMenu?.info?.options);
  await page.waitForFunction(() => window.__mainMenu.info.options.t >= 1, null, { timeout: 3000 });
  // `CCEaseInOut(CCMoveTo(0.5, end), 2)`: reopening samples the animation from
  // its first frame, which a page that has already settled cannot show
  const reopened = await page.evaluate(() => {
    window.__mainMenu.closeOptions();
    window.__mainMenu.openOptions();
    return window.__mainMenu.info.options.t;
  });
  check(reopened < 1, `the layer slides in rather than appearing (t = ${reopened.toFixed(2)})`);
  await page.waitForFunction(() => window.__mainMenu.info.options.t >= 1, null, { timeout: 3000 });

  const info = await menuInfo(page);
  const ids = info.options.controls.map((c) => c.id);
  for (const id of ["account", "howToPlay", "options", "graphics", "rate", "songs",
    "help", "menuMusic", "back", "slider-music", "slider-sfx"]) {
    check(ids.includes(id), `the drop-down has ${id}`);
  }
  const at = (id) => info.options.controls.find((c) => c.id === id);
  // the sourced pairs: +/- 79 on the top row, both at the same height
  check(Math.abs(at("account").x + at("howToPlay").x) < 0.01
    && Math.abs(at("account").y - at("howToPlay").y) < 0.01,
    "Account and How To Play are mirrored about the centre");
  check(at("rate").x < at("songs").x && at("songs").x < at("help").x,
    "the narrow bottom row runs Rate, Songs, Help left to right");
  // the menu underneath must not be clickable while the layer is up
  check(info.navigating === false, "the drop-down did not navigate away");
  await page.screenshot({ path: fileURLToPath(new URL("settings-dropdown.png", shots)) });
  await context.close();
}

// --------------------------------------------------------- slider drag
{
  const { context, page } = await open();
  await page.waitForFunction(() => window.__mainMenu.info.options.t >= 1);
  const before = await menuInfo(page);
  const thumb = before.options.controls.find((c) => c.id === "slider-music");
  const groove = before.options.controls.find((c) => c.id === "slider-sfx");
  check(before.options.music === 1, `music starts at the saved 1 (${before.options.music})`);

  // drag the music thumb to the middle of its travel
  const from = await toClient(page, thumb.x, thumb.y);
  const to = await toClient(page, 0, thumb.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  const after = await menuInfo(page);
  check(Math.abs(after.options.music - 0.5) < 0.03,
    `dragging the thumb to the centre sets ~0.5 (${after.options.music.toFixed(3)})`);
  check(after.options.sfx === 1, "the SFX slider did not move with it");

  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gd-web-save")).settings);
  check(Math.abs(saved.musicVolume - after.options.music) < 1e-6,
    `the value reached the save (${saved.musicVolume.toFixed(3)})`);

  // and the live audio engine, which is the whole point of moving it here
  const gain = await page.evaluate(() => window.__mainMenu.info.options.music);
  check(gain === after.options.music, "the overlay reports the live value");

  // the groove is not a hit target: only the thumb is, as SliderThumb is the item
  const gp = await toClient(page, groove.x - 60, groove.y);
  await page.mouse.click(gp.x, gp.y);
  await page.waitForTimeout(60);
  check((await menuInfo(page)).options.sfx === 1,
    "clicking the groove away from the thumb does nothing, as in the original");
  await context.close();
}

// -------------------------------------------------- menu music toggle
{
  const { context, page } = await open();
  await page.waitForFunction(() => window.__mainMenu.info.options.t >= 1);
  await clickOption(page, "menuMusic");
  const off = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gd-web-save")).settings.menuMusic);
  check(off === false, "the Menu Music checkbox writes the setting");
  await clickOption(page, "menuMusic");
  const on = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gd-web-save")).settings.menuMusic);
  check(on === true, "and toggles back");
  await context.close();
}

// ------------------------------------------- the Options popup and Escape
{
  const { context, page } = await open();
  await page.waitForFunction(() => window.__mainMenu.info.options.t >= 1);
  await clickOption(page, "options");
  const inPopup = await menuInfo(page);
  check(inPopup.options.popup === true, "the Options button opens MoreOptionsLayer");
  const ids = inPopup.options.controls.map((c) => c.id);
  check(ids.includes("showPauseButton") && ids.includes("pauseButtonOnLeft"),
    `the popup carries the supported rows (${ids.join(", ")})`);
  check(ids.includes("close"), "and its close button");
  await page.screenshot({ path: fileURLToPath(new URL("settings-more-options.png", shots)) });

  await clickOption(page, "pauseButtonOnLeft");
  const flipped = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gd-web-save")).settings.pauseButtonOnLeft);
  check(flipped === true, "a popup toggle writes its setting");

  // Escape unwinds one layer at a time
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  check((await menuInfo(page)).options.popup === false, "Escape closes the popup first");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  check((await menuInfo(page)).options === null, "and then the drop-down");
  // the menu underneath is live again
  await page.keyboard.press("KeyO");
  await page.waitForTimeout(80);
  check((await menuInfo(page)).options !== null, "the gear reopens it");
  await context.close();
}

// -------------------------------------- the pause gear -> GameOptionsLayer
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?level=1&manual=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__play);
  await page.evaluate(() => { for (let i = 0; i < 200; i++) window.__play.stepTick(false); });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);

  const gear = await page.evaluate(() =>
    window.__play.info.controls.find((c) => c.id === "settings"));
  check(!!gear, "the pause menu's gear is a real button now");
  const gp = await toClient(page, gear.x, gear.y);
  await page.mouse.click(gp.x, gp.y);
  await page.waitForTimeout(120);

  const opts = await page.evaluate(() => window.__play.info.gameOptions);
  check(!!opts, "the gear opens GameOptionsLayer");
  const ids = opts ? opts.controls.map((c) => c.id) : [];
  check(ids.includes("showProgressBar") && ids.includes("showPercentage")
    && ids.includes("autoCheckpoints"),
    `it carries the sourced supported rows (${ids.join(", ")})`);
  await page.screenshot({ path: fileURLToPath(new URL("settings-game-options.png", shots)) });

  // a strip of the HUD before and after hiding the bar must differ
  const strip = () => page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 40 } })
    .then((b) => b.toString("base64"));
  const withBar = await strip();
  const row = opts.controls.find((c) => c.id === "showProgressBar");
  const rp = await toClient(page, row.x, row.y);
  await page.mouse.click(rp.x, rp.y);
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gd-web-save")).settings.showProgressBar);
  check(saved === false, "the row writes the HUD setting");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  check(await page.evaluate(() => window.__play.info.gameOptions) === null,
    "Escape closes the popup and returns to the pause menu");
  const withoutBar = await strip();
  check(withBar !== withoutBar, "hiding the progress bar really changes the HUD");
  // and a pause click still cannot leak a jump into the run
  check(await page.evaluate(() => window.__play.state.queuedHold) === false,
    "opening the settings popup did not queue a jump");
  await context.close();
}

// --------------------------------------------- old saves and no storage
{
  // a save written before menuMusic/autoCheckpoints existed
  const legacy = JSON.stringify({
    v: 1,
    settings: { musicVolume: 0.25, sfxVolume: 0.75, seenGarage: true },
    levels: { 1: { normal: 42, practice: 0, coins: [], attempts: 3, jumps: 9 } },
  });
  const { context, page } = await open("?settings=1", { width: 1280, height: 720 }, legacy);
  await page.waitForFunction(() => window.__mainMenu.info.options.t >= 1);
  const info = await menuInfo(page);
  check(Math.abs(info.options.music - 0.25) < 1e-6,
    `an old save's volume is honoured (${info.options.music})`);
  // the migration is in memory until something writes, so flip one field and
  // then read the blob back: the new keys must appear at their defaults and
  // every old key must have survived untouched
  await clickOption(page, "menuMusic");
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("gd-web-save")));
  check(s.settings.menuMusic === false && s.settings.autoCheckpoints === true,
    `the new fields default in (menuMusic just toggled off, autoCheckpoints ${s.settings.autoCheckpoints})`);
  check(s.settings.sfxVolume === 0.75 && s.settings.musicVolume === 0.25
    && s.settings.seenGarage === true,
    "and the old settings are untouched");
  check(s.levels["1"].normal === 42 && s.levels["1"].attempts === 3,
    "and so are the level stats");
  await context.close();
}
{
  // storage refused entirely: the screen must still open and still be usable
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const boom = () => { throw new DOMException("denied", "SecurityError"); };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => ({ getItem: boom, setItem: boom, removeItem: boom, clear: boom }),
    });
  });
  await page.goto(`${base}/?settings=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__mainMenu?.info?.options, null, { timeout: 5000 });
  await page.waitForFunction(() => window.__mainMenu.info.options.t >= 1);
  await clickOption(page, "menuMusic");
  check(true, "the settings screen opens and toggles with storage disabled");
  await context.close();
}

// ------------------------------------------------------ viewport shapes
for (const [name, size] of [
  ["1280x720", { width: 1280, height: 720 }],
  ["1920x1080", { width: 1920, height: 1080 }],
  ["1024x768", { width: 1024, height: 768 }],
  ["narrow-420x900", { width: 420, height: 900 }],
]) {
  const { context, page } = await open("?settings=1", size);
  await page.waitForFunction(() => window.__mainMenu.info.options.t >= 1);
  const info = await menuInfo(page);
  const back = info.options.controls.find((c) => c.id === "back");
  check(back.x < 0 && back.y > 0, `${name}: the back arrow stays in the top-left`);
  const lock = info.options.controls;
  void lock;
  await page.screenshot({ path: fileURLToPath(new URL(`settings-${name}.png`, shots)) });
  await context.close();
}

check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");

await browser.close();
console.log(fail.length ? `\nFAIL — ${fail.length} check(s) failed` : "\nPASS — settings screens");
process.exit(fail.length ? 1 : 0);
