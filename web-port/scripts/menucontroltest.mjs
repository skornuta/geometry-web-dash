// Outcome regressions for the menu audit fixes. Uses the existing Vite server;
// isolated contexts only, no source edits, fixture files, or screenshot overwrites.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3222").replace(/\/$/, "");
const browser = await chromium.launch();
const errors = [];

async function open(query, mobile = false, seed = null) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1,
  });
  await context.addInitScript((seed) => {
    if (seed) localStorage.setItem("gd-web-save", JSON.stringify(seed));
    window.__menuControlSources = [];
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__menuControlSources.push({ node: this, stopped: false });
      return start.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      for (const s of window.__menuControlSources) if (s.node === this) s.stopped = true;
      return stop.apply(this, args);
    };
  }, seed);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (e) => errors.push(e.message));
  const load = async (q, hook) => {
    await page.goto(`${base}/${q}`, { waitUntil: "networkidle" });
    await page.waitForFunction((h) => !!window[h], hook);
  };
  await load(query, query.includes("icons") ? "__kit"
    : query.includes("levels") ? "__menu" : query.includes("level=") ? "__play" : "__mainMenu");
  const point = (c) => page.evaluate((c) => {
    const cv = document.getElementById("game"), box = cv.getBoundingClientRect();
    const scale = Math.min(cv.width / 480, cv.height / 320);
    return {
      x: box.left + (cv.width / 2 + c.x * scale) * box.width / cv.width,
      y: box.top + (cv.height / 2 - c.y * scale) * box.height / cv.height,
    };
  }, c);
  const tap = async (c) => {
    assert.ok(c, "the target is a live control");
    const at = await point(c);
    if (mobile) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(80);
  };
  const option = (id) => page.evaluate((id) => window.__mainMenu.optionAt(id), id);
  const kit = () => page.evaluate(() => window.__kit.info);
  const kitTap = async (id) => tap((await kit()).controls.find((c) => c.id === id));
  return { context, page, load, point, tap, option, kit, kitTap };
}

const activeLoops = (page) => page.evaluate(() => window.__menuControlSources
  .filter((s) => s.node.loop && !s.stopped).length);
const waitForMusic = (page) => page.waitForFunction(() => window.__menuControlSources
  .some((s) => s.node.loop && !s.stopped && s.node.context.state === "running"));

try {
  // Deep links must wait for real input, then unlock even if the base host is gone.
  for (const gesture of ["pointer", "keyboard", "slider"]) {
    const { context, page, tap, option } = await open("?settings=1");
    await page.waitForFunction(() => window.__mainMenu.info.options?.t === 1);
    assert.equal(await activeLoops(page), 0, "deep links do not autoplay before input");
    if (gesture === "pointer") await tap(await option("account"));
    else if (gesture === "slider") await tap(await option("slider-music"));
    else await page.keyboard.press("KeyQ");
    await waitForMusic(page);
    await page.keyboard.press("KeyQ");
    await tap(await option("account"));
    assert.equal(await activeLoops(page), 1, "further gestures do not duplicate the loop");
    await tap(await option("menuMusic"));
    assert.equal(await activeLoops(page), 0, "unchecking Menu Music actually stops playback");
    await tap(await option("menuMusic"));
    await waitForMusic(page);
    assert.equal(await activeLoops(page), 1, "re-enabling starts one loop");
    await context.close();
    console.log(`PASS — settings deep-link ${gesture} unlock and live music toggle`);
  }

  // Turn the switch off through the UI, then retain that save across all menu routes.
  {
    const { context, page, load, tap, option } = await open("?settings=1");
    await page.waitForFunction(() => window.__mainMenu.info.options?.t === 1);
    await tap(await option("menuMusic"));
    for (const [q, hook] of [["", "__mainMenu"], ["?icons=1", "__kit"], ["?levels=1", "__menu"]]) {
      await load(q, hook);
      await page.keyboard.press("KeyQ");
      await page.waitForTimeout(200);
      assert.equal(await activeLoops(page), 0, `saved-off music stays off at /${q}`);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("gd-web-save")).settings.menuMusic), false);
    }
    await context.close();
    console.log("PASS — saved-off Menu Music on main menu, garage and carousel");
  }

  // A stop during asynchronous decoding must not let the old request start later.
  {
    const { context, page, tap, option } = await open("?settings=1");
    await page.waitForFunction(() => window.__mainMenu.info.options?.t === 1);
    const pending = page.waitForRequest("**/menuLoop.mp3");
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route("**/menuLoop.mp3", async (route) => {
      await gate;
      await route.continue();
    });
    await tap(await option("account"));
    await pending;
    await tap(await option("menuMusic"));
    release();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(200);
    assert.equal(await activeLoops(page), 0, "late decode cannot restart disabled music");
    await tap(await option("menuMusic"));
    await waitForMusic(page);
    assert.equal(await activeLoops(page), 1);
    await context.close();
    console.log("PASS — disabling music cancels an in-flight track load");
  }

  for (const mobile of [false, true]) {
    const { context, page, kit, kitTap } = await open("?icons=1", mobile);
    const initial = await kit();
    await kitTap("next");
    assert.equal((await kit()).page, 1);
    assert.equal((await kit()).icon, initial.icon, "paging must not equip another icon");
    await kitTap("icon-37");
    assert.equal((await kit()).icon, 37);
    await kitTap("prev");
    assert.equal((await kit()).page, 0);
    await kitTap("prev");
    assert.equal((await kit()).page, initial.pages - 1);
    await kitTap("next");
    assert.equal((await kit()).page, 0);
    await kitTap("paint");
    const before = await kit();
    for (const key of ["ArrowRight", "ArrowLeft", "Tab", "KeyG"]) await page.keyboard.press(key);
    const after = await kit();
    for (const key of ["tab", "page", "icon", "glow", "col1", "col2", "popup"]) {
      assert.deepEqual(after[key], before[key], `${key} must not change behind the colour popup`);
    }
    assert.ok(!after.controls.some((c) => c.id === "next"), "covered arrows are not live");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("gd-web-save")).icons.cube);
    assert.equal(saved, 37, "modal shortcuts must not mutate the persisted kit");
    await kitTap("swatch-9");
    assert.equal((await kit()).col1, 9, "the popup itself still works");
    await page.keyboard.press("Escape");
    assert.equal((await kit()).popup, null);
    await page.keyboard.press("ArrowRight");
    assert.equal((await kit()).icon, 38, "garage shortcuts return after closing the popup");
    await kitTap("tab-trail");
    assert.ok(!(await kit()).controls.some((c) => c.id === "next" || c.id === "prev"),
      "a single-page category has no paging controls");
    await context.close();
    console.log(`PASS — garage arrows, paging and modal isolation (${mobile ? "touch @2x" : "mouse"})`);
  }

  // Exercise the rendered explanation and modal behavior, not just its control ID.
  for (const mobile of [false, true]) {
    const { context, page, tap, option } = await open("?settings=1", mobile);
    await page.waitForFunction(() => window.__mainMenu.info.options?.t === 1);
    await page.evaluate(async () => {
      const { LoadedFont } = await import("/src/engine/bmfont.ts");
      const draw = LoadedFont.prototype.draw;
      window.__menuControlText = [];
      LoadedFont.prototype.draw = function (...args) {
        window.__menuControlText.push(args[1]);
        if (window.__menuControlText.length > 5000) window.__menuControlText.splice(0, 2500);
        return draw.apply(this, args);
      };
    });
    await tap(await option("options"));
    await tap(await option("next-page"));
    for (const [id, text] of [
      ["showPauseButton", "Shows cursor and pause button during gameplay."],
      ["hideAttempts", "Hides the attempt counter when playing levels."],
      ["pauseButtonOnLeft", "Flips the location of the pause button."],
    ]) {
      const underlying = await option(id);
      const before = await page.evaluate((id) => JSON.parse(localStorage.getItem("gd-web-save") ?? "{}").settings?.[id], id);
      await tap(await option(`info-${id}`));
      await page.waitForFunction(() => window.__mainMenu.optionAt("alertButton"));
      await page.waitForTimeout(600);
      assert.deepEqual(await page.evaluate(() => window.__mainMenu.info.options.controls.map((c) => c.id)), ["alertButton"]);
      await page.waitForFunction((text) => window.__menuControlText.join(" ").includes(text), text);
      await tap(underlying);
      assert.equal(await page.evaluate((id) => JSON.parse(localStorage.getItem("gd-web-save") ?? "{}").settings?.[id], id), before);
      await page.keyboard.press("ArrowRight");
      assert.ok(await option("alertButton"));
      await page.keyboard.press("Escape");
      assert.ok(await option(id), "Escape closes only the explanation, preserving the options page");
    }
    await tap(await option("next-page"));
    for (const id of ["percentageDecimals", "fastMenu"]) {
      await tap(await option(`info-${id}`));
      await page.waitForFunction(() => window.__mainMenu.optionAt("alertButton"));
      await page.waitForTimeout(600);
      await tap(await option("alertButton"));
      assert.ok(await option(id), "OK returns to the same page");
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.__mainMenu.info.options.popup), false);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.__mainMenu.info.options), null);
    await context.close();
    console.log(`PASS — rendered option descriptions, OK, Escape and modal blocking (${mobile ? "touch @2x" : "mouse"})`);
  }

  // TogglePopup is also used by the pause gear; no gameplay source changes needed.
  {
    const { context, page, tap } = await open("?level=1&manual=1");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    await tap(await page.evaluate(() => window.__play.info.controls.find((c) => c.id === "settings")));
    for (const id of ["showHitboxes", "hitboxOnDeath"]) {
      await tap(await page.evaluate((id) => window.__play.info.gameOptions.controls.find((c) => c.id === `info-${id}`), id));
      await page.waitForFunction(() => window.__play.info.gameOptions.controls.some((c) => c.id === "alertButton"));
      await page.waitForTimeout(600);
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => window.__play.info.paused), true);
      assert.ok(await page.evaluate((id) => window.__play.info.gameOptions.controls.some((c) => c.id === id), id));
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.__play.info.gameOptions), null);
    assert.equal(await page.evaluate(() => window.__play.info.paused), true);
    await context.close();
    console.log("PASS — pause gear info alerts preserve the options/pause layers");
  }

  {
    const { context, page, tap, option } = await open("?settings=1");
    await page.waitForFunction(() => window.__mainMenu.info.options?.t === 1);
    await tap(await option("options"));
    await tap(await option("next-page"));
    let release;
    const gate = new Promise((r) => { release = r; });
    const pending = page.waitForRequest("**/chatFont-hd.png");
    await page.route("**/chatFont-hd.png", async (route) => {
      await gate;
      await route.continue();
    });
    await tap(await option("info-showPauseButton"));
    await pending;
    await page.keyboard.press("Escape");
    assert.ok(await option("showPauseButton"), "Escape cancels even while art is loading");
    release();
    await page.waitForLoadState("networkidle");
    assert.equal(await option("alertButton"), null, "late art must not resurrect a dismissed alert");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.__mainMenu.info.options.popup), false,
      "the temporary key handler was removed on cancellation");
    await context.close();
    console.log("PASS — cancelling a loading explanation cannot resurrect it or trap keys");
  }

  assert.deepEqual(errors, []);
  console.log("PASS — menu control outcome regressions; no page errors");
} finally {
  await browser.close();
}
