// Outcome regression tests for PlayLayer input ownership, not loading smoke tests.
// Uses isolated saves and the existing localhost server; manual mode only supplies
// deterministic simulation/completion fixtures. All controls use real pointer input.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3222").replace(/\/$/, "");
const browser = await chromium.launch();
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 },
      deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile,
    });
    try {
      await context.addInitScript(() => {
        if (!localStorage.getItem("gd-web-save")) localStorage.setItem("gd-web-save",
          JSON.stringify({ v: 1, settings: { autoCheckpoints: false, disableCheckpoints: false,
            showPauseButton: true } }));
        addEventListener("pointerdown", e => {
          window.__lastPointer = { id: e.pointerId, type: e.pointerType };
        }, { capture: true });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      const info = () => page.evaluate(() => window.__play.info);
      const settled = () => page.evaluate(() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const load = async () => {
        await page.goto(`${base}/?level=1&manual=1`, { waitUntil: "networkidle" });
        await page.waitForFunction(() => !!window.__play);
        await settled();
      };
      const client = (x, y) => page.evaluate(([x, y]) => {
        const canvas = document.getElementById("game"), box = canvas.getBoundingClientRect();
        const scale = Math.min(canvas.width / 480, canvas.height / 320);
        return { x: box.left + (canvas.width / 2 + x * scale) * box.width / canvas.width,
          y: box.top + (canvas.height / 2 - y * scale) * box.height / canvas.height };
      }, [x, y]);
      const control = async (id, layer = "controls") => {
        await page.waitForFunction(([id, layer]) => {
          const i = window.__play.info;
          return (layer === "controls" ? i.controls : i[layer]?.controls)?.some(c => c.id === id);
        }, [id, layer]);
        const i = await info();
        return (layer === "controls" ? i.controls : i[layer].controls).find(c => c.id === id);
      };
      const at = async (id, layer) => { const c = await control(id, layer); return client(c.x, c.y); };
      const tapPoint = async p => {
        if (mobile) await page.touchscreen.tap(p.x, p.y);
        else await page.mouse.click(p.x, p.y);
        await settled();
      };
      const tap = async (id, layer) => tapPoint(await at(id, layer));
      const noJump = async () => assert.equal(await page.evaluate(() => window.__play.state.queuedHold),
        false, "UI gestures never queue a gameplay jump");
      const cdp = mobile ? await context.newCDPSession(page) : null;
      const down = async p => {
        if (mobile) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p, id: 0 }] });
        else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
        await settled();
      };
      const move = async p => {
        if (mobile) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...p, id: 0 }] });
        else await page.mouse.move(p.x, p.y, { steps: 4 });
        await settled();
      };
      const up = async () => {
        if (mobile) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        else await page.mouse.up();
        await settled();
      };
      const captured = () => page.evaluate(() => document.getElementById("game")
        .hasPointerCapture(window.__lastPointer.id));
      const pause = async () => { await tap("pause"); assert.equal((await info()).paused, true); await noJump(); };
      await load();

      // Native pause content size is the untrimmed HD sprite x sizeMult4. A
      // point outside the visible sprite must still pause, including at DPR2.
      const pauseRect = await control("pause");
      const source = await page.evaluate(async () => {
        const { parsePlist } = await import("/src/engine/plist.ts");
        const text = await fetch("/assets/GJ_GameSheet03-hd.plist").then(r => r.text());
        return parsePlist(text).frames["GJ_pauseBtn_clean_001.png"].spriteSourceSize;
      });
      const dimensions = String(source).match(/[\d.]+/g).map(Number);
      assert.equal(pauseRect.w, dimensions[0] * 0.5 * 4, "native pause width x4");
      assert.equal(pauseRect.h, dimensions[1] * 0.5 * 4, "native pause height x4");
      await down(await client(pauseRect.x, pauseRect.y));
      assert.equal((await info()).paused, false, "HUD pause waits for release");
      assert.equal(await captured(), true, "primary pointer is captured");
      await up();
      assert.equal((await info()).paused, true, "HUD pause activates on matching release");
      await noJump();
      await tap("resume");
      assert.equal((await info()).paused, false);
      await noJump();
      await tapPoint(await client(pauseRect.x - pauseRect.w * 0.35, pauseRect.y - pauseRect.h * 0.35));
      assert.equal((await info()).paused, true, "enlarged pause target works beyond visible art");
      await noJump();

      const attempts = (await info()).attempts;
      const restart = await at("restart"), resume = await at("resume"), off = await client(0, 100);
      const unchanged = async label => {
        assert.equal((await info()).attempts, attempts, label);
        assert.equal((await info()).paused, true, label);
        await noJump();
      };
      await down(restart);
      assert.equal(await captured(), true);
      await unchanged("restart does not activate on pointerdown");
      await move(off); await move(restart); await up();
      await unchanged("dragging off permanently cancels even after returning");
      await down(restart); await move(resume); await up();
      await unchanged("release over a different button activates neither");
      await down(restart);
      await page.evaluate(() => {
        const { id, type } = window.__lastPointer;
        document.getElementById("game").dispatchEvent(new PointerEvent("pointercancel", {
          bubbles: true, pointerId: id, pointerType: type, isPrimary: true,
        }));
      });
      await up();
      await unchanged("pointercancel never activates restart");
      await down(restart);
      await page.evaluate(() => document.getElementById("game").releasePointerCapture(window.__lastPointer.id));
      await move(restart); await up();
      await unchanged("lost pointer capture cancels restart");
      await down(restart);
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await up();
      await unchanged("blur cancels an outstanding button press");
      await down(restart);
      await page.evaluate(({ x, y }) => {
        const { id, type } = window.__lastPointer;
        const canvas = document.getElementById("game");
        for (const [pointerId, isPrimary] of [[id + 50, true], [id, false]]) {
          canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId,
            pointerType: type, isPrimary, button: 0, clientX: x, clientY: y }));
        }
      }, restart);
      await unchanged("mismatched and non-primary releases are ignored");
      await up();
      assert.equal((await info()).attempts, attempts + 1, "matching primary release restarts exactly once");
      assert.equal((await info()).paused, false);
      assert.equal(await captured(), false);
      await noJump();

      // Both UI ownership and gameplay release semantics survive a real tap.
      await tapPoint(await client(0, 0));
      assert.equal(await page.evaluate(() => window.__play.state.queuedHold), true,
        "background gameplay tap still reaches the simulation");
      await load();
      await pause();
      await tap("practice");
      assert.equal((await info()).practice, true, "practice toggle remains functional");
      assert.equal((await info()).paused, false);
      await tap("placeCheckpoint");
      const checkpoint = (await info()).checkpoints;
      assert.equal(checkpoint.length, 1, "on-screen checkpoint placement works");
      await pause();
      await tap("settings");
      assert.ok((await info()).gameOptions, "settings gear still opens popup");
      await tap("disableCheckpoints", "gameOptions");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("gd-web-save"))
        .settings.disableCheckpoints), true);
      await page.keyboard.press("Escape"); await settled();
      assert.equal((await info()).gameOptions, null);
      assert.equal((await info()).paused, true, "popup Escape does not resume behind it");

      const thumb = await control("slider-music", "volume");
      const volumeBefore = (await info()).volume.music;
      await down(await client(thumb.x, thumb.y));
      await move(await client(thumb.x - 20, thumb.y)); await up();
      assert.ok((await info()).volume.music < volumeBefore, "pause slider retains pointer ownership");
      assert.equal((await info()).paused, true);
      await noJump();
      await tap("resume");
      await page.keyboard.press("KeyZ");
      assert.deepEqual((await info()).checkpoints, checkpoint, "disabled Z retains every checkpoint");
      await tap("placeCheckpoint");
      assert.deepEqual((await info()).checkpoints, checkpoint, "disabled on-screen placement is also a no-op");
      await page.keyboard.press("KeyX");
      assert.equal((await info()).checkpoints.length, 0, "X still removes while placement is disabled");
      await pause(); await tap("settings");
      await tap("disableCheckpoints", "gameOptions");
      await tap("close", "gameOptions");
      assert.equal((await info()).gameOptions, null, "popup close control still works");
      await tap("resume");
      await page.keyboard.press("KeyZ");
      assert.equal((await info()).checkpoints.length, 1, "enabled Z places a checkpoint");
      await tap("removeCheckpoint");
      assert.equal((await info()).checkpoints.length, 0, "on-screen checkpoint removal works");
      await noJump();
      console.log(`PASS — ${mobile ? "touch portrait @2x" : "desktop mouse"}: pause, native target, release/cancel/capture, checkpoints, popup, slider`);

      await load();
      await page.evaluate(() => {
        window.__play.state.x = window.__play.info.levelLength - 300;
        window.__play.stepTick(false);
      });
      await page.waitForFunction(() => window.__play.info.completed);
      await page.waitForFunction(() => window.__play.info.endLevel.t >= 1);
      assert.equal((await info()).controls.some(c => c.id === "pause"), false,
        "HUD pause target is absent under results");
      const beforeReplay = (await info()).attempts;
      await down(await at("replay"));
      assert.equal((await info()).completed, true, "results replay also waits for release");
      await up();
      assert.equal((await info()).completed, false);
      assert.equal((await info()).attempts, beforeReplay + 1);
      await noJump();
      await pause(); await tap("quit");
      await page.waitForURL("**/*levels=1*");
      await page.waitForFunction(() => !!window.__menu);
      assert.deepEqual(errors, [], "no browser runtime errors");
      console.log(`PASS — ${mobile ? "touch" : "desktop"}: results replay and pause quit routes`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
