import test from "node:test";
import assert from "node:assert/strict";
import { MenuMusic } from "../src/engine/menuMusic.ts";

function fixture(enabled = true) {
  const calls = { ensure: 0, play: 0, stop: [] as (boolean | undefined)[] };
  const state = { enabled };
  const music = new MenuMusic({
    ensure: () => { calls.ensure++; },
    playMenuMusic: async () => { calls.play++; },
    leaveMenuMusic: (keep) => { calls.stop.push(keep); },
  }, () => state.enabled);
  return { calls, state, music };
}

test("opening a menu/settings deep link does not request audio without a gesture", () => {
  const { music, calls } = fixture();
  music.sync();
  assert.deepEqual(calls, { ensure: 0, play: 0, stop: [] });
  music.gesture();
  assert.deepEqual(calls, { ensure: 1, play: 1, stop: [] });
});

test("each gesture retries the browser unlock without creating duplicate loops", () => {
  const { music, calls } = fixture();
  music.gesture();
  music.gesture();
  music.gesture();
  assert.equal(calls.ensure, 3);
  assert.equal(calls.play, 1);
});

test("a saved-off switch prevents playback on every menu scene", () => {
  for (let scene = 0; scene < 3; scene++) {
    const { music, calls } = fixture(false);
    music.gesture();
    music.sync();
    assert.deepEqual(calls, { ensure: 0, play: 0, stop: [] });
  }
});

test("off stops/invalidates the requested track, on starts exactly one new loop", () => {
  const { music, calls, state } = fixture();
  music.gesture();
  state.enabled = false;
  music.sync();
  music.gesture();
  assert.deepEqual(calls.stop, [false], "clear the menu bookmark and cancel pending decode");
  assert.equal(calls.play, 1);
  state.enabled = true;
  music.sync();
  music.gesture();
  assert.equal(calls.play, 2);
});

test("enabling the setting without an earlier gesture still cannot autoplay", () => {
  const { music, calls, state } = fixture(false);
  state.enabled = true;
  music.sync();
  assert.equal(calls.play, 0);
  music.gesture();
  assert.equal(calls.play, 1);
});
