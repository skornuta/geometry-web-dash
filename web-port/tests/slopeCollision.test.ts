// `collidedWithSlopeInternal` against the game's own routine.
//
// The fixture holds 250 random cases run through the real arm64 routine
// (m1 0x37e3e4, with `preSlopeCollision`, `determineSlopeDirection`,
// `slopeYPos` and `getSlopeAngle` executed natively) under an emulator: the
// player and slope state going in, and every player field the routine changed,
// where it placed the player, and which functions it called on the way out.
// The transcription must reproduce all of it. (It was checked against 30,000
// such cases when written; this is the regression net.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collidedWithSlopeInternal, determineSlopeDirection, slopeCoveredFaces, type SlopeHost, type SlopeObject, type SlopePlayer,
} from "../src/gd/slopeCollision.ts";

const f = Math.fround;
const fx = JSON.parse(readFileSync(new URL("./fixtures-slope-native.json", import.meta.url), "utf8"));

test("slope collision matches the native routine on every fixture case", () => {
  let claims = 0;
  for (const [i, c] of (fx.cases as any[]).entries()) {
    const s = c.s;
    const dir = determineSlopeDirection(!!s.flipX, !!s.flipY, s.rot);
    assert.equal(dir.type, c.n.type, `#${i} slope type`);
    assert.equal(dir.top ? 1 : 0, c.n.top, `#${i} slope top`);
    const o: SlopeObject = {
      id: 7, x: s.x, y: s.y, lastX: s.lastX, lastY: s.lastY,
      rect: { x: f(s.x - s.w / 2), y: f(s.y - s.h / 2), w: f(s.w), h: f(s.h) },
      slopeType: dir.type, slopeTop: dir.top, slopeOffset4: !!s.o4,
    };
    const init = { ...fx.base, ...c.p.init };
    const p: any = {
      x: f(c.p.x), y: f(c.p.y), w: c.p.w, h: c.p.w,
      currentSlope: null, currentPotentialSlope: null, potentialSlopes: new Map(), lastGroundObject: null,
    };
    for (const [k, kind] of Object.entries(fx.kinds) as [string, string][]) {
      p[k] = kind === "b" ? !!init[k] : kind === "f" ? f(init[k]) : init[k];
    }
    const before = { ...p };
    const calls: unknown[] = [];
    const host: SlopeHost = {
      collideSolid: (_p, _o, r) => { calls.push(["solid", [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 1e4) / 1e4)]); },
      destroyPlayer: () => { calls.push("destroy"); throw "stop"; },
      hitGround: () => { calls.push("hitGround"); },
      updateSlopeRotation: () => { calls.push("updateSlopeRotation"); },
    };
    try { collidedWithSlopeInternal(host, p as SlopePlayer, o, c.dt, !!c.forced); } catch (e) { if (e !== "stop") throw e; }
    assert.deepEqual(calls, c.n.calls, `#${i} calls`);
    const y = p.y !== before.y ? f(p.y) : null;
    if (c.n.y === null) assert.equal(y, null, `#${i} placed`);
    else { claims++; assert.ok(y !== null && Math.abs(y - c.n.y) < 1e-4, `#${i} y ${y} vs ${c.n.y}`); }
    for (const [k, kind] of Object.entries(fx.kinds) as [string, string][]) {
      let mine = p[k];
      if (kind === "b") mine = mine ? 1 : 0;
      if (kind === "f") mine = f(mine);
      const want = k in c.n.changed ? c.n.changed[k] : (kind === "b" ? (init[k] ? 1 : 0) : kind === "f" ? f(init[k]) : init[k]);
      assert.ok(mine === want || Math.abs(mine - want) <= 1e-9 * Math.max(1, Math.abs(want)), `#${i} ${k}: ${mine} vs ${want}`);
    }
  }
  assert.ok(claims > 40, "the fixture exercises the claim path");
});

test("determineSlopeDirection: the four unrotated orientations", () => {
  assert.deepEqual(determineSlopeDirection(false, false, 0), { type: 0, top: true });
  assert.deepEqual(determineSlopeDirection(false, true, 0), { type: 1, top: false });
  assert.deepEqual(determineSlopeDirection(true, false, 0), { type: 2, top: false });
  assert.deepEqual(determineSlopeDirection(true, true, 0), { type: 3, top: true });
});

test("a slope's tall end hides the top of the block tucked under it", () => {
  // Theory of Everything 2 x=28587 (port y): a 30x30 ramp descending to the
  // right sits on a plain block; the falling cube passes the block's top
  // (the native run lands on the next ramp a frame later)
  const ramp: SlopeObject = {
    id: 1, x: 28587, y: 133, lastX: 28587, lastY: 133,
    rect: { x: 28572, y: 118, w: 30, h: 30 }, slopeType: 2, slopeTop: false, slopeOffset4: false,
  };
  const block = { x: 28572, y: 88, w: 30, h: 30 };
  const p: any = {
    x: f(28610.84), y: f(131.99884), w: 30, h: 30,
    isOnSlope: false, wasOnSlope: false, currentSlope: null, potentialSlopes: new Map([[1, ramp]]),
  };
  assert.deepEqual(slopeCoveredFaces(p, block, 28587), { top: true, bottom: false });
  // no potential slope: the block is an ordinary block
  p.potentialSlopes = new Map();
  assert.deepEqual(slopeCoveredFaces(p, block, 28587), { top: false, bottom: false });
});
