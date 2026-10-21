// Every orb, pad, gamemode change and speed row against the shipping binary,
// for every gamemode, mini and gravity state — including the combinations no
// native macro ever touches (an orb in a wave, a pad in a swing ...).
// `tests/binary-jump-table.json` is written by `scripts/binary/jump_table.py`,
// which runs the real 2.2081 arm64 functions under emulation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freshPlayer, setGamemode, type Gamemode } from "../src/gd/gamemodes.ts";
import { activateOrb, activatePad } from "../src/gd/interactives.ts";
import { flipGravity, SPEEDS, SPEED_PHYSICS } from "../src/gd/physics.ts";

const table = JSON.parse(readFileSync(new URL("./binary-jump-table.json", import.meta.url), "utf8"));
const RAW = 54;

const player = (mode: string, mini: number, flipped: number, yVelRaw = 123) => ({
  ...freshPlayer(0, 100), mode: mode as Gamemode, mini: !!mini, gravityFlipped: !!flipped, yVel: yVelRaw * RAW,
});

test("orbs 36/141/84/1022/1330/1333 launch and flip as ringJump does in every gamemode", () => {
  assert.equal(table.orbs.length, 6 * 8 * 4);
  for (const c of table.orbs) {
    const p = player(c.mode, c.mini, c.flipped);
    assert.ok(activateOrb(c.id, p, SPEEDS[1], new Map()));
    const tag = `orb ${c.id} ${c.mode}${c.mini ? " mini" : ""}${c.flipped ? " flipped" : ""}`;
    assert.ok(Math.abs(p.yVel / RAW - c.raw) < 1e-6, `${tag}: ${p.yVel / RAW} vs ${c.raw}`);
    assert.equal(p.gravityFlipped, c.gravityFlipped, tag);
  }
});

test("pads 35/140/1332/67 launch and flip as bumpPlayer does in every gamemode", () => {
  assert.equal(table.pads.length, 4 * 8 * 4);
  for (const c of table.pads) {
    const p = player(c.mode, c.mini, c.flipped);
    activatePad(c.id, p);
    const tag = `pad ${c.id} ${c.mode}${c.mini ? " mini" : ""}${c.flipped ? " flipped" : ""}`;
    assert.ok(Math.abs(p.yVel / RAW - c.raw) < 1e-6, `${tag}: ${p.yVel / RAW} vs ${c.raw}`);
    assert.equal(p.gravityFlipped, c.gravityFlipped, tag);
  }
});

test("a gamemode change scales the velocity as switchedToMode and the toggle helpers do", () => {
  assert.equal(table.switches.length, 64);
  for (const c of table.switches) {
    // leaving a wave is its own rule (a wave's velocity is its path speed, not
    // the field the port keeps); entering a wave overwrites the field each step
    if (c.from_ === "wave" || c.to === "wave") continue;
    const p = player(c.from_, 0, 0, 10);
    setGamemode(p, c.to, SPEEDS[1]);
    assert.ok(Math.abs(p.yVel / RAW / 10 - c.yVelRatio) < 1e-9, `${c.from_} -> ${c.to}: ${p.yVel / RAW / 10} vs ${c.yVelRatio}`);
  }
  // the wave: its exit halves whatever it was flying at, its entry halves the stale field
  for (const c of table.switches) {
    if (c.from_ === "wave" && c.to !== "wave") assert.ok([0.5, 0.25].includes(c.yVelRatio), `wave -> ${c.to}`);
  }
});

test("flipGravity halves the velocity only when the gravity changes", () => {
  for (const c of table.flips) {
    const p = player("cube", 0, c.from_ ? 1 : 0, 10);
    flipGravity(p, c.to);
    assert.equal(p.yVel / RAW / 10, c.yVelRatio);
    assert.equal(p.gravityFlipped, c.gravityFlipped);
  }
});

test("the five speed rows are updateSpeedVariables'", () => {
  assert.equal(table.speeds.length, SPEED_PHYSICS.length);
  table.speeds.forEach((r: { mult: number; xVel: number; gravity: number; jump: number }, i: number) => {
    const s = SPEED_PHYSICS[i];
    assert.ok(Math.abs(r.mult - s.mult) < 1e-6);
    assert.ok(Math.abs(r.xVel - s.xVel) < 1e-5 && Math.abs(r.gravity - s.gravity) < 1e-5 && Math.abs(r.jump - s.jump) < 1e-5, `row ${i}`);
  });
});
