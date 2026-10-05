// Browser acceptance for keyboard pause and pointer/touch menu actions.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile
      ? { width: 390, height: 844 } : { width: 1280, height: 720 },
      deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const load = async (level = 1) => {
      await page.goto(`http://localhost:3222/?level=${level}&manual=1`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__play !== undefined);
    };
    const info = () => page.evaluate(() => window.__play.info);
    // UI positions are in the existing 480x320 design space, y up.
    const click = async (x, y) => {
      const p = await page.evaluate(([x, y]) => {
        const w = innerWidth, h = innerHeight, scale = Math.min(w / 480, h / 320);
        return { x: w / 2 + x * scale, y: h / 2 - y * scale };
      }, [x, y]);
      if (mobile) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    };
    await load();
    const pause = async () => {
      await page.keyboard.press("Escape");
      assert.equal((await info()).paused, true, "Escape opens pause menu");
    };
    // The pause menu is now the sourced PauseLayer row, so its controls are
    // located from the scene rather than guessed at fixed offsets.
    const clickControl = async (id) => {
      const c = (await info()).controls.find(b => b.id === id);
      assert.ok(c, `pause control ${id} is present`);
      await click(c.x, c.y);
    };
    await pause();
    await clickControl("resume");
    assert.equal((await info()).paused, false);
    assert.equal(await page.evaluate(() => window.__play.state.queuedHold), false,
      "Resume must not also queue a jump");
    await pause();
    const attempts = (await info()).attempts;
    await clickControl("restart");
    assert.equal((await info()).attempts, attempts + 1);
    await pause();
    await clickControl("practice");
    assert.equal((await info()).practice, true);
    await pause();
    // Auto-Checkpoints lives on the gear's `GameOptionsLayer` now, which is a
    // second layer of real controls to reach by pointer on this device
    await clickControl("settings");
    const optionAt = await page.evaluate(() =>
      window.__play.info.gameOptions.controls.find((c) => c.id === "autoCheckpoints"));
    assert.ok(optionAt, "the options popup carries Auto-Checkpoints");
    await click(optionAt.x, optionAt.y);
    assert.equal((await info()).autoCheckpoints, false);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
    assert.equal((await info()).paused, true);
    await clickControl("quit");
    // Leaving a level returns to the carousel with that level still selected,
    // not to the main menu — the main menu is one step further back.
    await page.waitForURL("**/*levels=1*");
    await page.waitForFunction(() => window.__menu !== undefined);
    assert.equal(await page.evaluate(() => window.__menu.info.level), 1,
      "returning from a level restores its carousel selection");
    // The carousel now has the original's real controls, not clickable screen
    // thirds: page with the nav arrow, then play by pressing the level panel.
    // Both are located from the scene, so this still proves the CSS-coordinate
    // conversion works on a high-DPI touch screen.
    const tapControl = async (id) => {
      const p = await page.evaluate(([id]) => {
        const c = document.getElementById("game");
        const box = c.getBoundingClientRect();
        const at = window.__menu.at(id);
        const scale = c.height / 320 <= c.width / 480 ? c.height / 320 : c.width / 480;
        return {
          x: box.left + (at.x * scale + c.width / 2) * box.width / c.width,
          y: box.top + (c.height / 2 - at.y * scale) * box.height / c.height,
        };
      }, [id]);
      if (mobile) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    };
    await tapControl("next");
    await page.waitForFunction(() => window.__menu.info.scroll === 1, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__menu.info.level), 2,
      "the nav arrow pages using CSS coordinates, including on high-DPI screens");
    await tapControl("levelPanel");
    await page.waitForURL("**/?level=2");

    await load();
    // Exercise the real completion UI without claiming this is a valid replay.
    // The results screen is the sourced `EndLevelLayer` now, so its buttons are
    // located from the scene and reached by pointer on both device shapes.
    const complete = async () => {
      // one tick past the end trigger (`levelLength - 300`), then the ending
      // plays out: EndLevelLayer drops ~4.3 s later
      await page.evaluate(() => {
        window.__play.state.x = window.__play.info.levelLength - 300;
        window.__play.stepTick(false);
      });
      await page.waitForFunction(() => window.__play.info.completed, null, { timeout: 8000 });
      await page.waitForFunction(() => window.__play.info.endLevel.t >= 1, null, { timeout: 3000 });
      await page.waitForTimeout(50);
    };
    await complete();
    await clickControl("replay");
    assert.equal((await info()).completed, false);
    assert.equal((await info()).x, 0);

    await load(22);
    await complete();
    await page.screenshot({ path: `/tmp/gd-completion-${mobile ? "mobile" : "desktop"}.png` });
    // The original's results screen has no "next level"; the last level's row
    // is the same Replay/Menu pair as every other level's.
    const endIds = (await info()).controls.map((c) => c.id);
    assert.equal(JSON.stringify(endIds), JSON.stringify(["replay", "quit"]),
      `the last level's results row is Replay and Menu (${endIds.join(", ")})`);
    await clickControl("quit");
    await page.waitForURL("**/*levels=1*");
    await page.waitForFunction(() => window.__menu !== undefined);
    // and from the carousel, back once more lands on the reproduced main menu
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__mainMenu !== undefined);
    assert.deepEqual(errors, []);
    console.log(`PASS — ${mobile ? "touch portrait @2x" : "mouse landscape"} navigation`);
    await page.close();
  }
} finally {
  await browser.close();
}
