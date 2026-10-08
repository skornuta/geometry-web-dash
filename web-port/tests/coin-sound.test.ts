// Secret-coin pickup sound (USER-14).
//
// The native pickup path (GJBaseGameLayer::pickupItem, GameObject::
// spawnDefaultPickupParticle) never calls the audio engine: no playEffect
// call site exists in it. `secretKey.ogg` belongs to EndLevelLayer::
// playEndEffect and PlayLayer::showNewBest (the reward jingle), so playing it
// on every pickup was wrong. In-level pickup is silent apart from the
// coinPickupEffect particle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SFX, gameplaySfx } from "../src/gd/audio-map.ts";

test("picking up a secret coin plays no reward jingle", () => {
  assert.equal(gameplaySfx("coin"), null);
});

test("the end-screen reward jingle is not wired into gameplay sfx", () => {
  for (const url of Object.values(SFX)) assert.ok(!url.includes("secretKey"));
});

test("death and completion keep their sounds", () => {
  assert.equal(gameplaySfx("death"), SFX.death);
  assert.equal(gameplaySfx("complete"), SFX.complete);
});
