import { test } from "node:test";
import assert from "node:assert/strict";

// The menu song loops and carries on across the menu screens (each one is its own page
// load): leaving writes the song's place, the next screen resumes at that place plus
// the wall-clock time since.
class FakeNode { connect() { return this; } gain = { value: 1 }; }
let sources: { loop: boolean; offset: number | null; stopped: boolean }[] = [];
let now = 0;
class FakeCtx {
  state = "running"; destination = new FakeNode();
  get currentTime() { return now; }
  createGain() { return new FakeNode(); }
  createAnalyser() { return Object.assign(new FakeNode(), { fftSize: 0, getFloatTimeDomainData() {} }); }
  createBufferSource() {
    const s = { loop: false, offset: null as number | null, stopped: false, buffer: null, connect() { return this; },
      start(_w: number, off: number) { s.offset = off; sources.push(s); }, stop() { s.stopped = true; } };
    return s;
  }
  async decodeAudioData() { return { duration: 100 } as AudioBuffer; }
  async resume() {} async suspend() {}
}
const store = new Map<string, string>();
Object.assign(globalThis, {
  AudioContext: FakeCtx,
  fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
  sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});
const realNow = Date.now; let wall = 1_000_000;
Date.now = () => wall;

test("the menu song loops and is stored when leaving, then resumed where it would be", async () => {
  try {
    const { AudioEngine } = await import("../src/engine/audio.ts");
    const a = new AudioEngine();
    now = 0; await a.playMenuMusic();
    assert.equal(sources.at(-1)!.loop, true, "the menu song loops");
    assert.equal(sources.at(-1)!.offset, 0, "first visit starts at the top");
    // 130 s in (the 100 s song has wrapped once): leave for another screen
    now = 130; wall += 130_000;
    a.leaveMenuMusic();
    assert.equal(sources.at(-1)!.stopped, true);
    const saved = JSON.parse(store.get("gd-menu-music")!);
    assert.ok(Math.abs(saved.pos - 30) < 1e-6, `place kept modulo the length (${saved.pos})`);
    // the next screen loads 1.5 s later
    wall += 1500; now = 0;
    const b = new AudioEngine();
    await b.playMenuMusic();
    assert.ok(Math.abs(sources.at(-1)!.offset! - 31.5) < 1e-6, `resumes at ${sources.at(-1)!.offset}`);
    // a screen reached long after (a level in between) starts again from the top
    b.leaveMenuMusic(); wall += 60_000;
    await new AudioEngine().playMenuMusic();
    assert.equal(sources.at(-1)!.offset, 0);
    // going into a level forgets the place
    wall += 100; b.leaveMenuMusic(false);
    assert.equal(store.has("gd-menu-music"), false);
  } finally { Date.now = realNow; }
});
