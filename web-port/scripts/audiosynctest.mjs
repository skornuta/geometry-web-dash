// Real-browser regressions for delayed music loading, seeks, and pause ownership.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__musicStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer?.duration > 30) window.__musicStarts.push(args[1] ?? 0);
      return start.apply(this, args);
    };
  });
  await page.goto("http://localhost:3222/?level=1&manual=1", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) window.__play.stepTick(false);
  });
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__musicStarts.length > 0);
  const offset = await page.evaluate(() => window.__musicStarts[0]);
  assert.ok(Math.abs(offset - 0.5) < 0.001, `first-input music should seek to 0.5s, got ${offset}`);

  const result = await page.evaluate(async () => {
    const { AudioEngine } = await import("/src/engine/audio.ts");
    const audio = new AudioEngine();
    audio.ensure();
    // Defer only loading; the engine and WebAudio sources remain real.
    let finish;
    const buffer = audio.ctx.createBuffer(1, 44100, 44100);
    audio.load = () => new Promise(resolve => { finish = () => resolve(buffer); });
    const starts = [];
    const create = audio.ctx.createBufferSource.bind(audio.ctx);
    audio.ctx.createBufferSource = () => {
      const source = create();
      const start = source.start.bind(source);
      source.start = (...args) => { starts.push(args[1] ?? 0); start(...args); };
      return source;
    };
    const pending = audio.playMusic("delayed");
    audio.stopMusic();
    finish();
    await pending;
    const staleStarts = starts.length;
    let seek = 0;
    const seeking = audio.playMusic("delayed", () => seek);
    seek = 0.25;
    finish();
    await seeking;
    await audio.setSuspended(true);
    audio.ensure();
    await new Promise(resolve => setTimeout(resolve, 100));
    const state = audio.state;
    await audio.ctx.close();
    return { staleStarts, seek: starts.at(-1), state };
  });
  assert.equal(result.staleStarts, 0, "stopMusic must cancel a pending load");
  assert.equal(result.seek, 0.25, "seek must be sampled after loading");
  assert.equal(result.state, "suspended", "ensure must respect an explicit pause");
  console.log("PASS — music seeks to simulation time; stale loads cancel; pause stays frozen");
} finally {
  await browser.close();
}
