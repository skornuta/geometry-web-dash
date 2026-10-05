// The back half of every portal.
//
// `PlayLayer::addObject` (m1 0xa02e0, the block at 0xa07f8–0xa0de4) gives each
// portal a second `GameObject` built from a `portal_NN_back_001.png` frame:
// same position, rotation and flips, default z layer 4 (just behind the
// player, between B1 3 and T1 5 where the front sits), z order the front's
// minus 100 (minus 99 in one layer case), skipped for a hidden (key 135)
// portal. The port drew only the fronts, so its portals read as half rings —
// a 2.2 playthrough (YouTube g3_XUbK-PP0, Deadlocked 57–59%) shows whole
// ellipses.
import { OBJECT_DEFS, type ObjectDef } from "./objects.ts";

/** portal id -> its back frame number (the id switch at m1 0xa0810…) */
export const PORTAL_BACK: ReadonlyMap<number, number> = new Map([
  [10, 1], [11, 2], [12, 3], [13, 4], [45, 5], [46, 6], [47, 7], [99, 8], [101, 9], [111, 10],
  [286, 11], [287, 12], [660, 13], [745, 14], [747, 15], [2902, 15],
  // 749 is the orange end the game builds for a 747 (`TeleportPortalObject`)
  [749, 16], [2064, 16],
  [1331, 17], [1933, 18], [2926, 19],
]);

/** the back sprites' own z layer (`[0x45c]` = 4) */
export const PORTAL_BACK_Z_LAYER = 4;

/** synthetic ids the scene draws the backs under */
export const PORTAL_BACK_ID_BASE = 900000;

export function portalBackId(portalId: number): number | null {
  const n = PORTAL_BACK.get(portalId);
  return n === undefined ? null : PORTAL_BACK_ID_BASE + n;
}

for (const n of new Set(PORTAL_BACK.values())) {
  const def: ObjectDef = {
    frame: `portal_${String(n).padStart(2, "0")}_back_001.png`, sheet: "game02",
    type: 0, kind: "deco", color: "none", primaryCh: 0, secondaryCh: -1,
    zLayer: PORTAL_BACK_Z_LAYER, zOrder: 0,
  };
  OBJECT_DEFS.set(PORTAL_BACK_ID_BASE + n, def);
}
