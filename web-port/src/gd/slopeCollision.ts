// `PlayerObject::collidedWithSlopeInternal` and `preSlopeCollision`,
// transcribed from the GD 2.2081 arm64 binary (m1 0x37e3e4 / 0x3819b0).
//
// This is a transcription, not a model: every branch below is a branch in the
// machine code, in the same order, and float32 arithmetic is kept wherever the
// game uses single precision (`f` = Math.fround). Field names are the Geode
// bindings' (`PlayerObject`, 2.2081), with the byte offset alongside so each
// one can be checked against the disassembly. Checked against the routine
// itself run under an emulator (scratchpad `emu_slope.py`) — see
// tests/slopeCollision.test.ts.
//
// Coordinates are GD's, but the routine only ever uses differences in y, so
// the port's (GD y - 90) works unchanged.

const f = Math.fround;
const bitsView = new DataView(new ArrayBuffer(4));
/** a float32 constant given by its bit pattern, as the machine code has it */
function bits(u: number): number { bitsView.setUint32(0, u); return bitsView.getFloat32(0); }

export interface Rect { x: number; y: number; w: number; h: number }

/** the slope object's side of the routine */
export interface SlopeObject {
  /** `m_uniqueID`-like key the player remembers the slope by (+0x394) */
  id: number;
  x: number; y: number;
  /** position on the previous step (`m_lastPosition`, +0x4c8) */
  lastX: number; lastY: number;
  /** object rect (`getObjectRect`) — min corner, width, height */
  rect: Rect;
  /** `determineSlopeDirection` results: +0x43c type, +0x438 "top" */
  slopeType: number;
  slopeTop: boolean;
  /** +0x440: the ±4 ramps (ids 366/367 in the classic set) */
  slopeOffset4: boolean;
}

/** the player fields the routine reads or writes */
export interface SlopePlayer {
  x: number; y: number;
  /** player rect size (`getObjectRect` is centred on x, y) */
  w: number; h: number;
  speedMultiplier: number;        // +0x780  m_speedMultiplier
  gameModeChangedTime: number;    // +0x7a0
  canRunIntoBlocks: boolean;      // +0x7ad  m_maybeCanRunIntoBlocks (= !playEffects)
  lastFlipTime: number;           // +0x7c8
  slopeRotation: number;          // +0x8e0  (double)
  currentSlopeYVelocity: number;  // +0x8e8  (double)
  slopeStoredY: number;           // +0x8f0  m_unk3d0
  slopeStoredY2: number;          // +0x8f8  m_blackOrbRelated
  slopeDifferent: boolean;        // +0x900  m_unk3e0
  slopeLedge: boolean;            // +0x901  m_unk3e1
  isCurrentSlopeTop: boolean;     // +0x903  (stores "is ceiling slope")
  collidedTopMinY: number;        // +0x908
  collidedBottomMaxY: number;     // +0x910
  isColliding: boolean;           // +0x934  m_maybeIsColliding
  jumpBuffered: boolean;          // +0x935  (m_isJumping in older bindings)
  yVelocity: number;              // +0x950  (raw, double)
  isOnSlope: boolean;             // +0x960
  wasOnSlope: boolean;            // +0x961
  slopeVelocity: number;          // +0x964  (float)
  upsideDownSlope: boolean;       // +0x968  m_maybeUpsideDownSlope
  isShip: boolean; isBird: boolean; isBall: boolean; isDart: boolean;  // +0x969..
  isUpsideDown: boolean;          // +0x96f
  isOnGround: boolean;            // +0x971
  isGoingLeft: boolean;           // +0x972
  isSideways: boolean;            // +0x973
  isSwing: boolean;               // +0x974
  isDashing: boolean;             // +0x994
  vehicleSize: number;            // +0x9a0
  playerSpeed: number;            // +0x9a4  (float)
  isOnGround2: boolean;           // +0x9bc
  isBoosted: boolean;             // +0x9cc  m_maybeIsBoosted
  totalTime: number;              // +0xa38
  platformerXVelocity: number;    // +0xa90
  slidingTime: number;            // +0xad4  m_maybeSlidingTime
  isPlatformer: boolean;          // +0xb08
  stateDartSlide: number;         // +0xb10
  stateHitHead: number;           // +0xb14
  ignoreDamage: boolean;          // +0xbe4
  // slope bookkeeping
  currentSlope: SlopeObject | null;         // +0x670
  currentPotentialSlope: SlopeObject | null; // +0x668
  collidingWithSlopeId: number;   // +0x680
  slopeFlipGravityRelated: boolean; // +0x684
  slopeAngleRadians: number;      // +0x690 (float)
  slopeYOffset: number;           // +0x678 (double)
  potentialSlopes: Map<number, SlopeObject>; // +0x6c0
  slopeCollidedWith: boolean;     // +0x661 m_unk669
  // ball rotation on a ramp (+0x660, +0x6e8, +0x6ec, +0x6f0)
  isBallRotating: boolean; rotationSpeed: number; rotateSpeed: number; isRotating: boolean;
  // +0x5c8 / +0x5cc last bottom / top collision ids, +0x5e0.. last ground slope
  lastCollisionBottom: number; lastCollisionTop: number;
  lastGroundObject: SlopeObject | null; lastGroundSlopeAngle: number; lastGroundSlopeTop: boolean;
  groundYVelocity: number;        // +0x628
  yVelocityBeforeSlope: number;   // +0x560
  slopeStartTime: number;         // +0x590
}

/** what the routine calls out to */
export interface SlopeHost {
  /** `collidedWithObjectInternal(dt, object, rect, false)` */
  collideSolid(p: SlopePlayer, o: SlopeObject, r: Rect, dt: number): void;
  /** `PlayLayer::destroyPlayer(player, nullptr)` */
  destroyPlayer(p: SlopePlayer): void;
  /** `hitGround(object, notFlipped = false)` */
  hitGround(p: SlopePlayer, o: SlopeObject): void;
  /** `updateSlopeRotation(dt)` */
  updateSlopeRotation(p: SlopePlayer, dt: number): void;
  /** the collision-group event (`m1 0x29e3d4`); optional */
  collisionEvent?(p: SlopePlayer, id: number, top: boolean): void;
}

// ---- cocos helpers --------------------------------------------------------

/** `CCRect(x, y, w, h)`: a negative size is stored as 0 */
function rect(x: number, y: number, w: number, h: number): Rect {
  return { x: f(x), y: f(y), w: w < 0 ? 0 : f(w), h: h < 0 ? 0 : f(h) };
}
/** `CCRect::intersectsRect` — inclusive on every edge */
export function intersects(a: Rect, b: Rect): boolean {
  return f(a.x + a.w) >= b.x && f(b.x + b.w) >= a.x && f(a.y + a.h) >= b.y && f(b.y + b.h) >= a.y;
}
export function playerRect(p: SlopePlayer): Rect {
  return rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
}


// ---- GameObject slope helpers ---------------------------------------------

/** `determineSlopeDirection` (m1 0x4ef52c): type (+0x43c) and "top" (+0x438) */
export function determineSlopeDirection(
  flipX: boolean, flipY: boolean, rotation: number, prevType = 0,
): { type: number; top: boolean } {
  const r = Math.trunc(rotation) % 360;   // fcvtzs, then a signed % 360
  const fx = flipX, fy = flipY;
  const a = Math.abs(r);
  const w10a = r === 0 ? fy : true;
  const w14 = !fx, w12a = !fy;
  const w11 = w14 || w12a;
  if (!fx && !w10a) return { type: 0, top: true };
  if (!w11 && a === 180) return { type: 0, top: true };
  const w13 = r !== 0 ? false : fy;
  const w9a = w14 && w13;
  const w9 = w14 || fy;
  if (w9a || (!w9 && a === 180)) return { type: 1, top: false };
  if (!(w14 || w10a)) return { type: 2, top: false };
  const w12 = fx || w12a;
  if (!w12 && a === 180) return { type: 2, top: false };
  const w13b = fx || fy;
  if ((fx && w13) || (!w13b && a === 180)) return { type: 3, top: true };
  if (!w13b && (r === -270 || r === 90)) return { type: 4, top: false };
  if (!w11 && (r === -90 || r === 270)) return { type: 4, top: false };
  if (!w13b && (r === -90 || r === 270)) return { type: 5, top: false };
  if (!w11 && (r === -270 || r === 90)) return { type: 5, top: false };
  if (!w9 && (r === -270 || r === 90)) return { type: 6, top: true };
  if (!w12) {
    if (r > 89) {
      if (r === 90) return { type: 7, top: true };
      if (r === 270) return { type: 6, top: true };
    } else {
      if (r === -270) return { type: 7, top: true };
      if (r === -90) return { type: 6, top: true };
    }
  }
  if (!w9 && (r === 270 || r === -90)) return { type: 7, top: true };
  // no case matched: "top" is cleared and the type left as it was
  return { type: prevType, top: false };
}

/** types 1, 3, 5, 6: the solid side is up (`0x6a >> type & 1`, m1 0x4f8b8c) */
export function isCeilingSlope(o: SlopeObject): boolean {
  return o.slopeType < 7 && ((0x6a >> o.slopeType) & 1) === 1;
}
/** types 2, 3, 4, 6: the tall end is on the left (`0x5c >> type & 1`, m1 0x4f8b70) */
function isLeftTallSlope(o: SlopeObject): boolean {
  return o.slopeType < 7 && ((0x5c >> o.slopeType) & 1) === 1;
}
/** `getSlopeAngle` (m1 0x4ef748): atanf(h / w) */
export function getSlopeAngle(o: SlopeObject): number {
  return f(Math.atan(f(o.rect.h / o.rect.w)));
}
/** `slopeYPos(x)` (m1 0x4f8cb8): the surface line, extended past the tile (double) */
export function slopeYPos(o: SlopeObject, x: number): number {
  const r = o.rect;
  const minX = r.x, maxX = f(r.x + r.w), minY = r.y, maxY = f(r.y + r.h);
  const k = f(r.h / r.w);
  let d = x - maxX;
  const fromMax = o.slopeTop ? d * k + maxY : minY - d * k;
  d = minX - x;
  const fromMin = o.slopeTop ? minY - d * k : d * k + maxY;
  let y = minX < x ? fromMax : fromMin;
  if (o.slopeOffset4) y += o.slopeType <= 6 && ((1 << o.slopeType) & 0x6a) !== 0 ? -4 : 4;
  return y;
}

/** `slopeYPos(rect)` (m1 0x4f8c48): the line at the rect's corner that faces the slope's rising side */
export function slopeYPosRect(o: SlopeObject, r: Rect): number {
  const x = isCeilingSlope(o) === o.slopeTop ? f(r.x + r.w) : r.x;
  return slopeYPos(o, x);
}

/**
 * The potential-slope scan in `collidedWithObjectInternal` (m1 0x37fd98-
 * 0x37ff88): a slope the player may be riding onto hides the faces of a
 * block tucked under it. `top` — some slope's line (±2) reaches the block's
 * top, so the top face is not landed on (0x3801f8); `bottom` — likewise
 * for the underside (0x380400).
 */
export function slopeCoveredFaces(p: SlopePlayer, block: Rect, blockX: number): { top: boolean; bottom: boolean } {
  let top = false, bottom = false, any = false;
  if (!p.isOnSlope && !p.wasOnSlope && p.potentialSlopes.size === 0) return { top, bottom };
  const anyX = p.isOnSlope || p.wasOnSlope;
  const pr = playerRect(p);
  const maxY = f(block.y + block.h), minY = block.y;
  for (const o of p.potentialSlopes.values()) {
    if (!anyX && o !== p.currentSlope) {
      if (!(o.rect.x < blockX) || !(f(o.rect.x + o.rect.w) > blockX)) continue;
    }
    // getObjectRect(1.2, 1.1): the slope's rect grown about its centre
    const w = f(o.rect.w * f(1.2)), h = f(o.rect.h * f(1.1));
    const grown = rect(f(o.x - w / 2), f(o.y - h / 2), w, h);
    if (!intersects(grown, block) || !intersects(grown, pr)) continue;
    any = true;
    const y = slopeYPosRect(o, block);
    const mine = isCeilingSlope(o) || o === p.currentSlope;
    if (y + 2 >= maxY && (!isCeilingSlope(o) || o === p.currentSlope)) top = true;
    if (!(y - 2 > minY) && mine) bottom = true;
    if (top && bottom) break;
  }
  return { top: any && top, bottom: any && bottom };
}

/** the game's velocity rounding: whole part kept, fraction rounded to 1/1000 */
export function round3(d: number): number {
  const i = Math.trunc(d);
  if (d === i) return d;
  const fr = (d - i) * 1000;
  // frinta: to nearest, ties away from zero
  const r = fr < 0 ? -Math.round(-fr) : Math.round(fr);
  return r / 1000 + i;
}

// ---- preSlopeCollision ----------------------------------------------------

/**
 * `PlayerObject::preSlopeCollision(dt, object)` (m1 0x3819b0). A slope's flat
 * sides are 1-unit solid strips — its tall end, and its base (the top, for a
 * ceiling slope) — resolved as ordinary solids. Returns true when the slope
 * itself is to be skipped this step.
 */
export function preSlopeCollision(h: SlopeHost, p: SlopePlayer, o: SlopeObject, dt: number): boolean {
  if (o.id === p.collidingWithSlopeId) return false;
  const sr = rect(o.rect.x, o.rect.y, o.rect.w, o.rect.h);
  const pr = playerRect(p);
  const leftTall = isLeftTallSlope(o);
  const ceil = isCeilingSlope(o);
  let s10 = 0;
  if (p.isPlatformer) s10 = p.isOnSlope ? 5 : (p.wasOnSlope ? 5 : 0);
  const moveAlong = p.isSideways ? f(o.y - o.lastY) : f(o.x - o.lastX);
  const step = f(p.speedMultiplier * f(p.playerSpeed) * dt);
  const left = p.isGoingLeft;
  let wall: Rect | null = null;
  let s9 = 0;
  if (leftTall) {
    // 1adc: moving left faster than the slope in classic mode skips the wall
    const skip = left && !p.isPlatformer && moveAlong >= step;
    if (!skip && !(p.x >= sr.x)) {
      s9 = left ? (p.isPlatformer ? 0 : 1) : 0;
      const s2 = f(s10 + s9);
      wall = rect(sr.x, f(s2 + sr.y), 1, f(s2 * -2 + sr.h));
    }
  } else {
    const test = left || p.isPlatformer || moveAlong > step;
    if (test && !(p.x <= f(sr.x + sr.w))) {
      s9 = left ? 0 : (p.isPlatformer ? 0 : 1);
      const s2 = f(s10 + s9);
      wall = rect(f(f(sr.x + sr.w) - 1), f(s2 + sr.y), 1, f(s2 * -2 + sr.h));
    }
  }
  let w22: boolean;
  if (wall) {
    if (intersects(pr, wall)) h.collideSolid(p, o, wall, dt);
    w22 = true;
  } else {
    w22 = false; s9 = 0;
  }
  let w21: boolean;
  const strip = ceil
    ? rect(f(s9 + sr.x), f(f(sr.y + sr.h) - 1), f(s9 * -2 + sr.w), 1)
    : rect(f(s9 + sr.x), sr.y, f(s9 * -2 + sr.w), 1);
  const stripTop = f(strip.y + strip.h);
  const outside = ceil ? !(p.y < stripTop) : p.y <= stripTop;
  if (outside) {
    if (intersects(pr, strip)) h.collideSolid(p, o, strip, dt);
    w21 = true;
  } else if (w22) {
    w21 = true;
  } else {
    p.slopeCollidedWith = false;
    if (!p.isOnSlope) {
      p.potentialSlopes.set(o.id, o);
      const last = p.currentPotentialSlope;
      const plain = (s: SlopeObject) => s.slopeTop && !isCeilingSlope(s);
      let replace = false;
      if (!last) replace = true;
      else {
        let tail = plain(last) || plain(o);
        if (!tail) { if (last.x > o.x) replace = true; else tail = true; }
        if (tail && !replace) replace = plain(last) && last.x < o.x;
      }
      if (replace) p.currentPotentialSlope = o;
    }
    w21 = false;
  }
  return w21 || !intersects(sr, pr);
}

// ---- collidedWithSlopeInternal --------------------------------------------

/**
 * `PlayerObject::collidedWithSlopeInternal(dt, object, forced)` (m1 0x37e3e4).
 * The decision half is a literal block-by-block transcription (labels are the
 * low address bits of each block).
 */
export function collidedWithSlopeInternal(
  h: SlopeHost, p: SlopePlayer, o: SlopeObject, dtIn: number, forced: boolean,
): void {
  const dt = f(dtIn);
  if (!forced && preSlopeCollision(h, p, o, dt)) return;
  const pr = playerRect(p);
  const sr = rect(o.rect.x, o.rect.y, o.rect.w, o.rect.h);
  const flip = p.isUpsideDown, side = p.isSideways, plat = p.isPlatformer;
  const ship = p.isShip, ufo = p.isBird, wave = p.isDart, swing = p.isSwing, ball = p.isBall;
  // e474
  let w23 = !o.slopeTop;
  let w26: boolean;
  const goLeft = plat ? p.platformerXVelocity < 0 : p.isGoingLeft;
  if (goLeft) { w26 = true; w23 = o.slopeTop; } else w26 = false;
  const w21 = isCeilingSlope(o);
  const mvX = f(o.x - o.lastX), mvY = f(o.y - o.lastY);
  const d11 = side ? mvY : mvX;
  const s13perp = side ? mvX : mvY;
  const rate = p.speedMultiplier * f(p.playerSpeed);   // d0
  const d14 = rate * dt;
  let w24 = false;
  if (!(d14 >= d11)) { w24 = w23 !== flip; w23 = !w23; }
  const w25 = w23 !== (flip !== side);
  const riding = p.wasOnSlope;
  const ySpeed = () => f(sr.h / f(sr.w / rate));
  let s10: number;
  if (!riding) s10 = ySpeed();
  else {
    const sv = flip ? -f(p.slopeVelocity) : f(p.slopeVelocity);
    if (sv > 0 && w25 && p.isCurrentSlopeTop === w21 && p.isCurrentSlopeTop === flip) return;
    s10 = ySpeed();
    if (sv > 0 && p.currentSlopeYVelocity > s10) return;
  }
  // e5dc
  let s12 = w25 ? (riding ? 4 : 1) : 0;
  const back = side ? f(o.lastX - o.x) : f(o.lastY - o.y);
  let add: boolean;
  if (!flip && back > 0) { w23 = true; add = true; }
  else { w23 = back >= 0 || Number.isNaN(back) ? false : flip; add = forced || w23; }
  if (add) {
    let s0 = Math.abs(back);
    const cap = f((plat ? 10 : 5) * dt);
    if (s0 > cap) s0 = cap;
    s12 = f(s12 + s0);
  }
  // e690: the probe, one tolerance past the player's gravity-side edge
  {
    const s9 = f(f(pr.h * 0.5) / f(Math.cos(f(p.slopeRotation))));
    const y = p.y;
    const probe = flip ? f(s12 + f(s9 + y)) : f(f(y - s9) - s12);
    if (riding) {
      if (flip) { if (!(probe >= sr.y || Number.isNaN(probe))) return; }
      else if (probe > f(sr.y + sr.h)) return;
    } else if (!intersects(pr, rect(sr.x, f(sr.y + 1), sr.w, f(sr.h - 2)))) return;
  }
  // e740
  const spSlopeYSpeed = s10;            // [sp+0x1c]
  const px = p.x, py = p.y;             // [sp+0x30]
  s10 = sr.y;
  let s11 = f(sr.y + sr.h);
  const angle = getSlopeAngle(o);       // [sp+0x18]
  const s0lift = f(pr.h / f(Math.cos(angle)));
  let s15 = 0;
  let w27: boolean;
  const s13 = s13perp;
  if (riding && p.collidingWithSlopeId !== o.id && p.isCurrentSlopeTop !== w21) {
    if (!plat) s15 = f(p.vehicleSize * 20);   // e9b8
    w27 = true;
  } else w27 = false;
  // e7e0
  const s9 = f(s0lift * 0.5);
  const line = f(slopeYPos(o, px));
  const half = f(pr.h * 0.5);
  const sp8 = w26;
  let w16: boolean, w28: boolean;
  if (w21) {
    const s1 = f(s15 + f(s10 - half));
    let s0 = f(s15 + f(line - s9));
    w16 = s0 <= s1; if (w16) s0 = s1;
    w28 = s0 >= s11; s10 = w28 ? s11 : s0;
  } else {
    const s1 = f(f(s11 + half) - s15);
    let s0 = f(f(s9 + line) - s15);
    w16 = s0 >= s1; if (w16) s0 = s1;
    w28 = s0 <= s10; s10 = w28 ? s10 : s0;
  }
  let w22 = forced, w0 = false, w8 = false, w9 = false, spc = false;
  let s1 = 0;
  let L = w21 ? (flip ? "e8c0" : "e838") : (flip ? "e838" : "e8c0");
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    switch (L) {
      // ---- gravity pulls away from the surface (opposite side) ----
      case "e838":
        s1 = 0;
        if (w25) { L = "e888"; continue; }
        if (!(ship || ufo || wave || swing)) { L = "eaac"; continue; }
        s1 = s12;
        if (p.jumpBuffered) s1 = riding ? 2 : 1;
        L = "e888"; continue;
      case "e888":
        if (!w27) { L = "eab4"; continue; }
        w8 = true; L = "eae0"; continue;
      case "eaac":
        s1 = s12;
        if (w27) { w8 = true; L = "eae0"; continue; }
        L = "eab4"; continue;
      case "eab4":
        if (ship || ufo || wave) {
          if (!w25) { L = "eadc"; continue; }
          if (!plat) { w8 = true; L = "eae0"; continue; }
          L = "eadc"; continue;
        }
        if (swing && w25) { if (!plat) { w8 = true; L = "eae0"; continue; } }
        L = "eadc"; continue;
      case "eadc":
        w8 = p.isOnSlope; L = "eae0"; continue;
      case "eae0": {
        const lo = py < s10, hi = py > s10;
        const floorHit: boolean = (lo || w8) ? lo : py < f(s10 + s1);
        const ceilHit: boolean = (hi || w8) ? hi : py > f(s10 - s1);
        w8 = w21 ? ceilHit : floorHit;
        if (p.jumpBuffered) { w26 = false; spc = false; L = w8 ? "ebc0" : "eca4"; continue; }
        let w10: boolean;
        if (plat) { w26 = false; w10 = w25; L = ship ? "ebb8" : "eba4"; }
        else if (ship || ufo || wave || swing) {
          if (w25) { w26 = riding; w10 = w25; } else { w26 = false; w10 = false; }
          L = ship ? "ebb8" : "eba4";
        } else {
          // f6e0
          if (ball && w25) { w26 = riding; w10 = w25; L = ship ? "ebb8" : "eba4"; }
          else { w26 = false; w10 = false; L = ufo ? "ebb4" : "ebac"; }
        }
        // eba4 / ebac / ebb4 / ebb8 / ec94
        if (L === "eba4") L = ufo ? "ebb4" : "ebac";
        if (L === "ebac") L = wave ? "ebb4" : "ec94";
        if (L === "ebb4") { w10 = w25; L = "ebb8"; }
        if (L === "ec94") w10 = swing && w25;
        spc = w10;
        L = w8 ? "ebc0" : "eca4"; continue;
      }
      case "ebc0":
        if (ship || ufo || wave || swing || ball || plat || p.stateHitHead > 0) { L = "ebfc"; continue; }
        L = "f7b0"; continue;
      case "ebfc":
        w23 = false; w22 = true; L = "ec04"; continue;
      case "ec04":
        L = o.slopeOffset4 ? "ec0c" : "ec28"; continue;
      case "ec0c":
        if (p.ignoreDamage) { L = "ec5c"; continue; }
        L = "ec14"; continue;
      case "ec14":
        if (!p.canRunIntoBlocks) { h.destroyPlayer(p); return; }
        p.isColliding = true; return;
      case "ec28":
        if (!w27) { L = "ec44"; continue; }
        L = "ec2c"; continue;
      case "ec2c":
        if (plat || p.stateHitHead > 0) { L = "ec5c"; continue; }
        L = "ec0c"; continue;
      case "ec44":
        if (!wave) { L = "ec5c"; continue; }
        if (p.stateDartSlide <= 0) { L = "ec2c"; continue; }
        L = "ec5c"; continue;
      case "ec5c":
        w0 = true; L = "ec60"; continue;
      case "ec60":
        s11 = s10; L = "eda8"; continue;
      case "eca4":
        w0 = false; w23 = false; w22 = true; s11 = s10; L = "eda8"; continue;
      case "f7b0": {
        const recent = (t: number) => t !== 0 && p.totalTime - t < 0.1;
        if (recent(p.gameModeChangedTime) || recent(p.lastFlipTime)) {
          p.y = s10;
          const v = p.yVelocity;
          p.yVelocity = round3(flip ? (v < 2 ? 2 : v) : (v <= -2 ? v : -2));
          p.isOnGround = false; p.isOnGround2 = false;
          return;
        }
        const clear = w21 ? f(py - 2) <= s10 : f(py + 2) >= s10;
        if (clear) { p.isOnGround = false; p.isOnGround2 = false; return; }
        L = p.ignoreDamage ? "ebfc" : "ec14"; continue;
      }
      // ---- gravity holds the player against the surface (same side) ----
      case "e8c0":
        if (w27 || !w25) { w9 = false; L = "e8d8"; continue; }
        if (!p.isOnSlope) { L = "e98c"; continue; }
        w9 = false; L = "e8d8"; continue;
      case "e98c":
        if (!p.isBoosted) {
          if (!ship) { w9 = true; L = "e8d8"; continue; }
          w9 = !p.jumpBuffered; L = "e8d8"; continue;
        }
        if (ship) { w9 = !p.jumpBuffered; L = "e8d8"; continue; }
        if (ufo || wave || swing) { w9 = true; L = "e8d8"; continue; }
        w9 = false; L = "e8d8"; continue;
      case "e8d8": {
        const allow = w25 ? w9 : (w23 || w9 || (w22 && !w25));
        const nallow = !allow;
        if (!w21) {
          w8 = py < s10;
          if (w8 || nallow) { L = "e9d8"; continue; }
          if (!(py < f(s12 + s10))) { w8 = false; L = "e9d8"; continue; }
          if (!ufo) { w8 = true; L = p.jumpBuffered ? "e9e0" : "ea20"; continue; }
          w8 = p.yVelocity <= 0;
        } else {
          w8 = py > s10;
          if (w8 || nallow) { L = "e9d8"; continue; }
          if (py <= f(s10 - s12)) { w8 = false; L = "e9d8"; continue; }
          if (!ufo) { w8 = true; L = p.jumpBuffered ? "e9e0" : "ea20"; continue; }
          w8 = p.yVelocity >= 0;
        }
        L = p.jumpBuffered ? "e9e0" : "ea20"; continue;
      }
      case "e9d8":
        L = p.jumpBuffered ? "e9e0" : "ea20"; continue;
      case "e9e0":
        if (ship || ufo || wave) {
          w9 = true;
          if (!(w9 && w25)) { L = "ea60"; continue; }
          L = "ea04"; continue;
        }
        w9 = swing;
        if (swing && w25) { L = "ea04"; continue; }
        L = "ea60"; continue;
      case "ea04":
        if (!plat) { L = "ea88"; continue; }
        w9 = true; L = "ea68"; continue;
      case "ea60":
        if (!w9) { L = "ea88"; continue; }
        w9 = plat; L = "ea68"; continue;
      case "ea68":
        spc = false; w22 = false; w0 = false;
        w26 = !(w27 && w9); w23 = true;
        L = w8 ? "eaa0" : "ec60"; continue;
      case "ea88":
      case "ea20":
        w23 = false; spc = false; w26 = false; w22 = false; w0 = false;
        L = w8 ? "eaa0" : "ec60"; continue;
      case "eaa0":
        L = o.slopeOffset4 ? "ec0c" : "ec28"; continue;
      // ---- the claim ----
      case "eda8": {
        const d12 = s10;
        if (riding) {
          let toEe14 = false;
          if (p.slopeStoredY === d12 || (side && p.slopeStoredY2 === s11)) {
            // edc4
            if (plat && Math.abs(p.platformerXVelocity) < 0.1) toEe14 = true;
            else w0 = false;
          } else toEe14 = true;
          if (toEe14 && s13 !== 0) {
            let toEe38 = w16 && p.slopeDifferent;
            if (!toEe38 && w28) {
              if (p.slopeLedge) toEe38 = true;
              else w28 = true;   // ef00
            }
            if (toEe38 && !p.isDashing) {
              if (!plat || Math.abs(p.platformerXVelocity) > 0.1) w0 = false;
            }
          }
        }
        if (w0 && plat) {
          w0 = intersects(sr, rect(f(pr.x - 2), f(pr.y - 10), f(pr.w + 4), f(pr.h + 20)));
        }
        if (w25 && wave && p.jumpBuffered) {
          if (!((flip !== w21) && w0)) return;
        } else if (!w0) return;
        claimSlope(h, p, o, dt, {
          d12, s9, s10, s11, pr, w16, w21, w22, w23, w24, w25, w26, w27, w28, spc, sp8,
          d14, d11, riding, angle, spSlopeYSpeed,
        });
        return;
      }
      default:
        throw new Error("slopeCollision: no block " + L);
    }
  }
}

interface ClaimState {
  d12: number; s9: number; s10: number; s11: number; pr: Rect;
  w21: boolean; w22: boolean; w23: boolean; w24: boolean; w25: boolean; w26: boolean;
  w16: boolean; w27: boolean; w28: boolean; spc: boolean; sp8: boolean;
  d14: number; d11: number; riding: boolean; angle: number; spSlopeYSpeed: number;
}

/** ef90 onward: the player is on the slope — store it, place, set velocities */
function claimSlope(h: SlopeHost, p: SlopePlayer, o: SlopeObject, dt: number, c: ClaimState): void {
  const flip = p.isUpsideDown;
  p.currentSlope = o;
  p.slopeAngleRadians = getSlopeAngle(o);
  p.currentPotentialSlope = o;
  p.potentialSlopes.set(o.id, o);
  p.slopeYOffset = f(c.s9 + f(c.pr.h * -0.5));
  p.isCurrentSlopeTop = c.w21;
  p.slopeStoredY = c.d12;
  p.slopeStoredY2 = c.s11;
  p.collidingWithSlopeId = o.id;
  let sign = flip ? -1 : 1;
  p.slopeFlipGravityRelated = c.w25;
  const d9 = p.slopeRotation;   // the rotation before this claim
  // (x27 holds w16 by here: `mov x27, x16` at ef98)
  p.slopeDifferent = c.w16;
  p.slopeLedge = c.w28;
  if (!c.w25) sign = -sign;
  if (c.d14 < c.d11) sign = -sign;
  if (c.sp8) sign = -sign;
  if (p.isSideways) sign = -sign;
  p.slopeRotation = f(f(f(c.angle * f(57.29578)) * sign) * f(0.017453292));
  p.y = c.s10;
  p.isOnSlope = true;
  if (!c.riding) { p.slopeStartTime = p.totalTime; p.yVelocityBeforeSlope = p.yVelocity; }
  p.upsideDownSlope = c.w22;
  const s11 = c.spSlopeYSpeed;
  let w20 = flip;
  const dt4 = dt;
  let L = c.w26 ? "f108" : "f12c";
  for (;;) {
    switch (L) {
      case "f108": {
        w20 = flip;
        if (!c.spc) { L = "f278"; continue; }
        const v = p.yVelocity;
        if (flip) { if (v < 2) p.yVelocity = round3(2); }
        else if (!(v <= -2)) p.yVelocity = round3(-2);
        L = "f278"; continue;
      }
      case "f12c": {
        if (!c.w22) { L = "f298"; continue; }
        const v = p.yVelocity;
        const d0 = flip ? (v < 0 ? 0 : v) : (v <= 0 ? v : 0);
        p.yVelocity = round3(d0);
        p.isOnGround = false; p.isOnGround2 = false;
        const hh = f(playerRect(p).h * 0.5);
        const edge = f(hh * (flip ? -1 : 1) + p.y);
        const d1 = p.collidedTopMinY;
        let d = edge;
        if (d1 !== 0) d = flip ? (d1 < edge ? edge : d1) : (d1 > edge ? edge : d1);
        p.collidedTopMinY = d;
        if (o.id !== 0 && p.lastCollisionTop !== o.id) {
          p.lastCollisionTop = o.id;
          h.collisionEvent?.(p, o.id, true);
        }
        L = "f108"; continue;
      }
      case "f298": {
        const s10 = f(p.yVelocity);
        h.hitGround(p, o);
        if (flip ? s10 < -5 : s10 > 5) p.yVelocity = round3(s10);
        if (p.isPlatformer && Math.abs(f(p.slopeAngleRadians * f(57.29578))) > 40 && s10 < -5 &&
            p.platformerXVelocity > 0) p.platformerXVelocity *= 0.5;
        const hh = f(playerRect(p).h);
        const edge = f(f(hh * -0.5) * (flip ? -1 : 1) + p.y);
        const d1 = p.collidedBottomMaxY;
        let d = edge;
        if (d1 !== 0) d = flip ? (d1 > edge ? edge : d1) : (d1 < edge ? edge : d1);
        p.collidedBottomMaxY = d;
        if (o.id !== 0 && p.lastCollisionBottom !== o.id) {
          p.lastCollisionBottom = o.id;
          h.collisionEvent?.(p, o.id, false);
        }
        p.lastGroundObject = o;
        const a = getSlopeAngle(o);
        p.lastGroundSlopeAngle = a;
        let top = o.slopeTop;
        if (p.isSideways) top = !top;
        p.lastGroundSlopeTop = top;
        if (top && a >= 1) p.slidingTime = 3;
        if (o.lastX !== o.x || o.lastY !== o.y) {
          const s1 = flip ? o.lastX : o.lastY;
          const s0 = flip ? o.x : o.y;
          if (flip ? s1 > s0 : s1 < s0) p.groundYVelocity = f(f(s0 - s1) / dt4);
        }
        L = "f108"; continue;
      }
      case "f278": {
        if (c.w23) {
          const v = p.yVelocity;
          if (!w20) { if (v >= 2) w20 = false; else p.yVelocity = round3(2); }
          else { if (v > -2) p.yVelocity = round3(-2); w20 = true; }
        }
        // f438
        p.currentSlopeYVelocity = s11;
        const m = Math.min(f(f(0.8) / c.angle), f(1.1));
        const s1 = f(s11 * f(1.4));
        const pos = f(s1 * m);
        let s0 = c.w24 || !c.w25 ? pos : -pos;
        if (w20) s0 = -s0;
        p.slopeVelocity = s0;
        if (c.w22 && p.isPlatformer && p.isBird) p.jumpBuffered = false;
        if (p.isShip || p.isBird || p.isDart || p.isSwing || p.isBall) {
          p.slopeVelocity = f(s0 * 0.75);
          if (!p.isBall) { h.updateSlopeRotation(p, dt4); return; }
          // f4f4: the ball's roll on a ramp
          if (p.slopeRotation === f(d9)) return;
          p.isRotating = false; p.isBallRotating = false; p.rotationSpeed = 0;
          if (p.isDashing || p.isPlatformer) return;
          let r = f(1 / f(Math.cos(f(p.slopeRotation))));
          if (r > 2) r = f(f(r - 1) * f(0.7) + 1);
          p.isBallRotating = r !== 1;
          p.rotateSpeed = r;
          const sp = f(p.playerSpeed);
          const factor = sp === f(0.7) ? bits(0x3f9ecacb) : sp === f(1.1) ? bits(0x3f4de2e6)
            : sp === f(1.3) ? bits(0x3f2a6fdb) : sp === f(1.6) ? bits(0x3f0a7ae1) : 1;
          let deg = w20 ? -120 : 120;
          if (p.isGoingLeft) deg = -deg;
          const k = p.vehicleSize === 1 ? bits(0x3e4ccccd) : bits(0x3e23d70b);
          p.rotationSpeed = f(deg / f(k * factor));
          if (p.isSideways) p.rotationSpeed = -p.rotationSpeed;
          p.isRotating = true;
          return;
        }
        h.updateSlopeRotation(p, dt4);
        return;
      }
      default:
        throw new Error("slopeCollision: no block " + L);
    }
  }
}
