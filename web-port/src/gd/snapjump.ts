// `PlayerObject::checkSnapJumpToObject` — the cube's landing snap.
//
// Read out of the shipping 2.2081 arm64 slice at `m1 0x382fbc`, called from
// `collidedWithObjectInternal` (`+0x2a8` and `+0x4ac`) immediately after the
// landing `setPosition`, and **only for the cube**: the call is guarded by a
// flag that is `!m_isShip && !m_isBall && !m_isBird && !m_isDart && !m_isSwing
// && !m_isRobot && !m_isSpider` (the reads at `+0x969`..`+0x96e`).
//
// What it does: when you land on a block that sits one "rhythm unit" away from
// the block you landed on last — a fixed dx paired with a fixed dy, both per
// speed — the game slides you **up to one unit** (two at 2x and 3x) toward the
// x you had on the previous block. That is what keeps a chain of identical
// jumps from creeping: without it every landing in a chain drifts, and by the
// sixth one we were a full 6 units behind the real run in `macros-main`, which
// then moved every trigger, portal and ledge exit after it.
//
// ```
// target = object.x + m_snapDifference          // +0x800, a double
// if (|target - player.x| > max) target = player.x +/- max
// player.setPosition(target, player.y)
// m_lastGroundObject = object                   // +0x838
// m_snapDifference   = player.x - object.x
// ```
/** what the snap needs to know about the object landed on */
export interface SnapObject {
  /** stable identity; the original compares the objects' `+0x394` */
  index: number;
  x: number;
  /** our y — the original's minus GD_Y_OFFSET */
  y: number;
}

export interface SnapState {
  /**
   * `m_lastGroundObject`: the index of the object last landed on, -1 for none.
   * The original keeps the pointer; we keep the identity and the position it
   * had, because the previous object is usually already out of the collision
   * neighbourhood by the time the next landing happens.
   */
  snapObject: number;
  snapObjectX: number;
  snapObjectY: number;
  /** `m_snapDifference`: the x the player held on that object */
  snapOffset: number;
  x: number;
  gravityFlipped: boolean;
  mini: boolean;
}

/**
 * The per-speed rhythm the snap recognises. `dx1` pairs with +30 of dy, `dx2`
 * with -30 and `dx0` with +60 (dy measured along the player's own up), and
 * `max` is the furthest the snap will move you.
 *
 * `dx1` is the only one mini changes, and only at 0.9x, 1.1x and 1.3x — the
 * 0.7x and 1.6x branches never read `m_vehicleSize` at all.
 */
interface SnapRhythm { dx1: number; miniDx1: number; dx2: number; dx0: number; max: number }

/** indexed by the speed setting, 0 = 0.5x .. 4 = 4x */
const RHYTHM: readonly SnapRhythm[] = [
  { dx1: 90, miniDx1: 90, dx2: 120, dx0: 60, max: 1 },     // 0.7
  { dx1: 120, miniDx1: 90, dx2: 150, dx0: 90, max: 1 },    // 0.9
  { dx1: 150, miniDx1: 90, dx2: 195, dx0: 120, max: 2 },   // 1.1
  { dx1: 180, miniDx1: 90, dx2: 225, dx0: 135, max: 2 },   // 1.3
  { dx1: 120, miniDx1: 120, dx2: 150, dx0: 90, max: 1 },   // the 1.6 fallback
];

/**
 * Apply the landing snap. `speedIndex` is the run's current speed setting.
 *
 * Returns true when the player was actually moved.
 */
export function checkSnapJump(
  p: SnapState, object: SnapObject, speedIndex: number,
): boolean {
  const prev = p.snapObject >= 0
    ? { x: p.snapObjectX, y: p.snapObjectY, index: p.snapObject }
    : undefined;
  let moved = false;
  if (prev && prev.index !== object.index) {
    const r = RHYTHM[speedIndex] ?? RHYTHM[1];
    const dx1 = p.mini ? r.miniDx1 : r.dx1;
    const max = r.max;
    const up = p.gravityFlipped ? -1 : 1;
    const near = (a: number, b: number) => Math.abs(a - b) <= max;
    const match =
      (near(object.x, prev.x + dx1) && near(object.y, prev.y + 30 * up)) ||
      (near(object.x, prev.x + r.dx2) && near(object.y, prev.y - 30 * up)) ||
      (near(object.x, prev.x + r.dx0) && near(object.y, prev.y + 60 * up));
    if (match) {
      let target = object.x + p.snapOffset;
      if (Math.abs(target - p.x) > max) target = p.x + (target > p.x ? max : -max);
      // `setPosition` stores a float, like every other position write
      p.x = Math.fround(target);
      moved = true;
    }
  }
  p.snapObject = object.index;
  p.snapObjectX = object.x;
  p.snapObjectY = object.y;
  // the original subtracts in float and widens, so do the same
  p.snapOffset = Math.fround(p.x - object.x);
  return moved;
}
