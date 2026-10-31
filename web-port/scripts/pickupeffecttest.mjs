// Real collision-driven coin/dash presentation regression harness.
// Run against an existing Vite server: node scripts/pickupeffecttest.mjs [baseURL]
// Fixtures intercept level1's encoded asset in isolated contexts; no public files
// or real saves are changed. Manual stepping tests bulk and frame-paced replay.
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3222").replace(/\/$/, "");
const browser = await chromium.launch();
const errors = [];
const contexts = [];
const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const far = "1,1,2,6000,3,-1000;";
async function open(body, { saved = [], practice = false, manual = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  contexts.push(context);
  await context.addInitScript(coins => localStorage.setItem("gd-web-save", JSON.stringify({ v: 1,
    levels: { 1: { coins } }, settings: { autoCheckpoints: false, autoRetry: false } })), saved);
  const data = gzipSync(`kS38,|;${body}${far}`).toString("base64url");
  await context.route("**/assets/levels/1.txt", route => route.fulfill({ contentType: "text/plain", body: data }));
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${base}/?level=1${manual ? "&manual=1" : ""}${practice ? "&practice=1" : ""}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__play);
  // Observe actual renderer input, not just the pure model's expected pose.
  await page.evaluate(async () => {
    const { UiSprites } = await import("/src/ui/sprites.ts");
    const { Renderer } = await import("/src/engine/renderer.ts");
    const require = UiSprites.prototype.require, draw = Renderer.prototype.draw, begin = Renderer.prototype.begin;
    UiSprites.prototype.require = function(name) {
      const result = require.call(this, name); result.frame.__testName = name; return result;
    };
    Renderer.prototype.begin = function(...args) { window.__draws = []; return begin.apply(this, args); };
    Renderer.prototype.draw = function(...args) {
      const f = args[3];
      if (f.__testName) window.__draws.push({ name: f.__testName, x: args[4], y: args[5],
        w: args[6], h: args[7], rot: args[8], alpha: args[12], blend: args[13],
        frame: { w: f.w, h: f.h, offsetX: f.offsetX, offsetY: f.offsetY } });
      return draw.apply(this, args);
    };
    window.__play.scene.captureDraws = [];
  });
  const settled = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await settled();
  return {
    page, settled,
    info: () => page.evaluate(() => window.__play.info),
    ticks: (n, held = false) => page.evaluate(([n, held]) => {
      for (let i = 0; i < n; i++) window.__play.stepTick(held);
      return window.__play.info;
    }, [n, held]),
    close: () => context.close(),
  };
}

try {
  const c = await open("1,901,2,0,3,0,51,7,28,-120,10,0;1,142,2,120,3,15,57,7;1,3600,2,350,3,15;");
  let i = await c.ticks(1);
  assert.equal(i.effects.events.coin, 1, "first of four steps is drained before later steps clear its event");
  assert.deepEqual(i.effects.destroyed, [1]);
  assert.equal(i.effects.coinPickups.length, 1);
  near(i.effects.coinPickups[0].age, 3 / 240);
  assert.ok(i.effects.coinPickups[0].y > 15, "native flight has started");
  const circles = i.effects.waves.filter(w => w.kind === "coin");
  assert.deepEqual(circles.map(w => [w.x, w.y, w.from, w.to, w.duration]), [[0, 15, 25, 5, 0.3], [0, 15, 5, 60, 0.3]],
    "moving pickup uses resolved collision position, not source x120");
  assert.ok(i.emitters.oneShots > 0);
  assert.deepEqual(i.saved.coins, [], "pickup is not saved before normal completion");
  assert.deepEqual(i.effects.pendingCoins, [], "manual debugging never touches progress saves");
  await c.page.evaluate(() => { window.__play.scene.captureDraws = []; });
  await c.settled();
  assert.equal(await c.page.evaluate(() => window.__play.scene.captureDraws.some(d => d.obj === 1)), false,
    "removed source coin is not still drawn");
  const frozen = i.effects.coinPickups[0].age;
  await c.page.waitForTimeout(100);
  near((await c.info()).effects.coinPickups[0].age, frozen);
  await c.page.keyboard.press("Escape"); await c.settled();
  assert.equal((await c.info()).paused, true);
  await c.ticks(4);
  near((await c.info()).effects.coinPickups[0].age, frozen);
  await c.page.keyboard.press("Escape"); await c.settled();
  i = await c.ticks(36);
  assert.equal(i.effects.coinPickups.length, 1);
  assert.ok(i.effects.coinPickups[0].alpha > 0.4 && i.effects.coinPickups[0].alpha < 0.6);
  assert.equal(i.effects.waves.filter(w => w.kind === "coin").length, 0);
  i = await c.ticks(10);
  assert.equal(i.effects.coinPickups.length, 0);
  i = await c.ticks(30);
  assert.equal(i.ended, true);
  assert.deepEqual(i.saved.coins, [], "manual completion is also unscored");
  await c.page.evaluate(() => window.__play.reset());
  i = await c.info();
  assert.equal(i.effects.coinPickups.length, 0);
  assert.equal(i.effects.events.coin, 0);
  assert.deepEqual(i.effects.destroyed, []);
  assert.deepEqual(i.effects.pendingCoins, []);
  // followTrace must drain events too, not just stepTick's four-step loop.
  await c.page.evaluate(() => window.__play.followTrace([0, 15, 0, 0, 15, 0, 0, 15, 0, 0, 15, 0]));
  i = await c.info();
  assert.equal(i.effects.events.coin, 1);
  assert.equal(i.effects.coinPickups[0].outline, false);
  near(i.effects.coinPickups[0].age, 3 / 240);
  console.log("PASS coin: collision-time moving position, four-step/trace draining, flight/fade, pause, completion-only save, reset");
  await c.close();

  const normal = await open("1,142,2,0,3,15;1,3600,2,600,3,15;", { manual: false });
  i = await normal.info();
  assert.equal(i.effects.events.coin, 1);
  assert.deepEqual(i.effects.pendingCoins, [0]);
  assert.deepEqual(i.saved.coins, [], "normal pickup remains pending until completion");
  await normal.page.waitForFunction(() => window.__play.info.saved.coins.includes(0));
  console.log("PASS normal mode: pending pickup committed only after real simulation completion");
  await normal.close();

  const outline = await open("1,142,2,90,3,120;", { saved: [0] });
  const widths = [];
  for (let n = 0; n < 4; n++) {
    await outline.page.evaluate(() => { window.__play.scene.captureDraws = []; });
    await outline.settled();
    widths.push(await outline.page.evaluate(() => window.__play.scene.captureDraws.find(d => d.obj === 0 && d.main)?.w));
    await outline.ticks(7);
  }
  assert.deepEqual(widths, [39.5, 33.5, 9.5, 33.5], "saved outline uses all four native trimmed widths");
  console.log("PASS saved outline: actual rendered idle frames and geometry");
  await outline.close();

  const practice = await open("1,142,2,0,3,15;", { practice: true });
  await practice.page.evaluate(() => window.__play.placeCheckpoint());
  await practice.ticks(1);
  await practice.page.evaluate(() => { window.__play.kill(); window.__play.respawnAtCheckpoint(); });
  i = await practice.info();
  assert.equal(i.effects.coinPickups.length, 0);
  assert.deepEqual(i.effects.destroyed, []);
  assert.equal(i.effects.events.coin, 0);
  i = await practice.ticks(1);
  assert.equal(i.effects.events.coin, 1, "checkpoint rewind rearms coin pickup");
  assert.deepEqual(i.saved.coins, []);
  console.log("PASS practice: snapshot removal restore, transient cleanup and recollection");
  await practice.close();

  const dash = await open("1,1704,2,0,3,15;1,1829,2,300,3,15;");
  await dash.ticks(1);
  await dash.page.evaluate(() => window.__play.jump());
  i = await dash.ticks(1, true);
  assert.deepEqual(i.effects.events.dash, [1, 0]);
  assert.equal(i.effects.dash[0].entries, 1);
  assert.ok(i.effects.dash[0].loop);
  assert.equal(i.effects.dash[0].emitterActive, true);
  i = await dash.ticks(12, true);
  assert.ok(i.effects.dash[0].particles > 0);
  const firstFrame = i.effects.dash[0].loop.frame;
  i = await dash.ticks(4, true);
  assert.notEqual(i.effects.dash[0].loop.frame, firstFrame);
  await dash.settled();
  const draws = await dash.page.evaluate(() => window.__draws);
  const flame = draws.find(d => /^playerDash2_\d/.test(d.name));
  assert.ok(flame, "flame really renders, not just an active model");
  const pose = i.effects.dash[0].sprites.find(s => s.kind === "flame");
  near(flame.x, pose.x + flame.frame.offsetX * 0.5 * pose.scaleX * Math.cos(pose.rotation)
    - flame.frame.offsetY * 0.5 * pose.scaleY * Math.sin(pose.rotation));
  near(flame.y, pose.y + flame.frame.offsetX * 0.5 * pose.scaleX * Math.sin(pose.rotation)
    + flame.frame.offsetY * 0.5 * pose.scaleY * Math.cos(pose.rotation));
  near(flame.w, flame.frame.w * 0.5 * pose.scaleX);
  const icon = draws.findIndex(d => /^player_\d+_001/.test(d.name));
  assert.ok(icon >= 0 && draws.indexOf(flame) < icon, "dash art draws behind player icon");
  await dash.page.evaluate(() => window.__play.endJump());
  i = await dash.ticks(1);
  assert.equal(i.effects.dash[0].loop, null);
  assert.equal(i.effects.dash[0].emitterActive, false);
  assert.equal(i.effects.dash[0].remnants, 1);
  i = await dash.ticks(13);
  assert.equal(i.effects.dash[0].remnants, 0);
  await dash.page.evaluate(() => window.__play.reset());
  await dash.ticks(1);
  await dash.page.evaluate(() => window.__play.jump());
  await dash.ticks(1, true);
  for (let n = 0; n < 100; n++) { i = await dash.ticks(1, true); if (!i.effects.dash[0].loop) break; }
  assert.equal(i.effects.dash[0].loop, null, "real S-block collision ends dash");
  assert.equal(i.effects.dash[0].remnants, 1);
  await dash.page.evaluate(() => { window.__play.reset(); window.__play.setMode("robot"); });
  await dash.ticks(1);
  await dash.page.evaluate(() => window.__play.jump());
  i = await dash.ticks(1, true);
  assert.equal(i.effects.dash[0].limb.name, "fall_loop");
  await dash.page.evaluate(() => window.__play.kill());
  await dash.page.waitForTimeout(300);
  i = await dash.info();
  assert.equal(i.effects.dash[0].loop, null);
  assert.equal(i.effects.dash[0].remnants, 0, "death remnants finish on wallclock even in manual mode");
  await dash.page.evaluate(() => window.__play.reset());
  i = await dash.info();
  assert.equal(i.effects.dash[0].particles, 0);
  assert.equal(i.effects.dash[0].entries, 0);
  console.log("PASS dash: real orb/S collisions, loop cadence, trim-correct rendering/order, release, robot pose, death and reset");
  await dash.close();

  const dual = await open("1,286,2,0,3,150;1,1751,2,80,3,160;");
  await dual.page.evaluate(() => Object.assign(window.__play.state, { y: 120, onGround: false }));
  i = await dual.ticks(1);
  assert.notEqual(i.dualY, null, "dual spawned through a real portal collision");
  await dual.page.evaluate(() => window.__play.jump());
  for (let n = 0; n < 40; n++) { i = await dual.ticks(1, true); if (i.effects.events.dash[1]) break; }
  assert.deepEqual(i.effects.events.dash, [0, 1], "only player2 overlaps its dash orb");
  assert.equal(i.effects.dash[0].loop, null);
  assert.ok(i.effects.dash[1].loop);
  assert.equal(i.effects.dash[1].entries, 1);
  assert.equal(i.effects.dash[1].emitterActive, true);
  assert.equal(i.effects.dash[0].emitterActive, false);
  await dual.ticks(2, true); await dual.settled();
  const flipped = (await dual.info()).effects.dash[1].sprites.find(s => s.kind === "flame");
  const flippedDraw = await dual.page.evaluate(() => window.__draws.find(d => /^playerDash2_\d/.test(d.name)));
  near(flippedDraw.h, flippedDraw.frame.h * 0.5 * flipped.scaleY);
  assert.ok(flipped.scaleY < 0, "dual inverted gravity reaches signed-scale rendering");
  await dual.page.evaluate(() => window.__play.endJump());
  i = await dual.ticks(1);
  assert.equal(i.effects.dash[1].loop, null);
  assert.equal(i.effects.dash[1].remnants, 1);
  console.log("PASS dual: real portal + player2-only gravity-dash activation, signed geometry and independent stop");
  await dual.close();

  const press = await open("1,3004,2,0,3,15;");
  await press.ticks(1);
  await press.page.evaluate(() => window.__play.jump());
  i = await press.info();
  assert.deepEqual(i.effects.events.orb, [1, 0], "simPress boundary drains synchronous spider-orb event immediately");
  await press.ticks(1, true);
  assert.deepEqual((await press.info()).effects.events.orb, [1, 0]);
  await press.close();
  assert.deepEqual(errors, [], "no browser exceptions");
  console.log("PASS simPress boundary; no browser exceptions");
} finally {
  await browser.close();
}
