import { test } from "node:test";
import assert from "node:assert/strict";

// A missing audio file must warn once and leave silence — not throw out of
// `playMusic` / `playSfx` (callers `void` them, so a throw is an unhandled rejection).
class FakeNode { connect() { return this; } gain = { value: 1 }; }
class FakeCtx {
  state = "running"; currentTime = 0; destination = new FakeNode();
  createGain() { return new FakeNode(); }
  createAnalyser() { return Object.assign(new FakeNode(), { fftSize: 0, getFloatTimeDomainData() {} }); }
  createBufferSource() { return Object.assign(new FakeNode(), { start() {}, stop() {}, buffer: null }); }
  async decodeAudioData(d: ArrayBuffer) { if (d.byteLength === 0) throw new Error("decode"); return { duration: 1 } as AudioBuffer; }
  async resume() {} async suspend() {}
}

test("a 404 warns once and neither playMusic nor playSfx throws", async () => {
  (globalThis as Record<string, unknown>).AudioContext = FakeCtx;
  let calls = 0;
  (globalThis as Record<string, unknown>).fetch = async () => { calls++; return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }; };
  const warns: unknown[][] = [];
  const realWarn = console.warn; console.warn = (...a: unknown[]) => { warns.push(a); };
  try {
    const { AudioEngine } = await import("../src/engine/audio.ts") as unknown as { AudioEngine: new () => { playMusic(u: string): Promise<void>; playSfx(u: string): Promise<void> } };
    const a = new AudioEngine();
    await a.playMusic("/assets/nope.mp3");
    await a.playMusic("/assets/nope.mp3");
    await a.playSfx("/assets/nope.ogg");
    assert.equal(warns.length, 2, "one warning per missing URL, not per call");
    assert.ok(calls >= 2);
  } finally { console.warn = realWarn; }
});
