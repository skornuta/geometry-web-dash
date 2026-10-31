// The ball on the tip of a rod.
//
// The game's level dumps (gdphysicsreader level-N-*.jsonl, the object list after
// load) hold 1,161 `id 37` objects the level files do not: each is a
// `rod_ball_0N_001.png` the game builds for a rod decoration (ids 15, 16, 17 —
// `rod_01/02/03_001`) and puts on its tip. Measured from the rods and balls of
// the dumps (offsets from the rod's centre, the rod unrotated): +31 for 15,
// +23.25 for 16 and, for 17 whose own rotation is 180, −16.25 — the same +16.25
// turned with it. Live (running-game) dumps of the ball (`captures-2026-09-29/
// visual/objs-*.csv`): white, normal blend, scale 0.5 at rest and 0.5378 mid-pulse,
// z 10 (the rod is −6). The ball pulses with the music like every id-37 object
// (`gd/audioPulse.ts`): the scale follows the pulse p as p + 0.4 (0.5 at the rest
// pulse of 0.1).
//
// Which of the three ball frames is used is not tied to the rod: all balls of one
// level dump share a frame, and two dumps of the same level differ — the game
// picks one at random when the level loads. The port picks one per level
// deterministically (`rodBallFrame`) so a replay draws the same every time.
import { OBJECT_DEFS, type ObjectDef } from "./objects.ts";
import type { LevelObject } from "./level.ts";
import { P } from "./props.ts";

/** rod id -> the ball's offset along the rod's own up axis */
export const ROD_BALL_DY: ReadonlyMap<number, number> = new Map([[15, 31], [16, 23.25], [17, 16.25]]);

/** synthetic ids the scene draws the balls under (frame number 1..3 added) */
export const ROD_BALL_ID_BASE = 910000;

/** the ball is 30 x 30 and rests at scale 0.25 */
export const ROD_BALL_REST_SCALE = 0.25;
/** z order of the ball (the rod's is -6) */
export const ROD_BALL_Z_ORDER = 10;

for (let n = 1; n <= 3; n++) {
  const def: ObjectDef = {
    frame: `rod_ball_0${n}_001.png`, sheet: "game", type: 7, kind: "deco", color: "none",
    primaryCh: 0, secondaryCh: -1, zLayer: 1, zOrder: ROD_BALL_Z_ORDER,
  };
  OBJECT_DEFS.set(ROD_BALL_ID_BASE + n, def);
}

/**
 * The frame the game happened to use in the capture session's dump of each main
 * level (all balls of a level share one), keyed by the level's object count in
 * the level file — the game re-rolls it every load, so any of the three is
 * right; these make the port show what the reference captures show.
 */
const CAPTURED_FRAME: ReadonlyMap<number, number> = new Map([
  [2291, 3], [1545, 2], [1531, 2], [1444, 1], [2146, 1], [1704, 1], [2813, 1], [3599, 2],
  [3921, 2], [4716, 3], [4863, 2], [4345, 2], [5643, 3], [7641, 2], [9523, 3], [10224, 2],
  [11552, 2], [14400, 2], [16131, 2], [27283, 2],
]);

/** the frame number (1..3) one level draws all its balls with */
export function rodBallFrame(levelObjectCount: number): number {
  return CAPTURED_FRAME.get(levelObjectCount) ?? 1 + (levelObjectCount % 3);
}

/**
 * The ball of one rod, as an object of its own at the rod's tip, carrying the
 * rod's groups so a trigger moves it with the rod; `null` for a non-rod.
 * `rotation` is the rod's key 6 in degrees clockwise.
 */
export function rodBallFor(o: LevelObject, frame: number): LevelObject | null {
  const dy = ROD_BALL_DY.get(o.id);
  if (dy === undefined) return null;
  const rot = parseFloat(o.props.get(P.ROTATION) ?? "0") || 0;
  const flipY = o.props.get(P.FLIP_Y) === "1" ? -1 : 1;
  const a = (rot * Math.PI) / 180;
  const along = dy * flipY;
  const props = new Map<number, string>();
  const groups = o.props.get(57);
  if (groups !== undefined) props.set(57, groups);
  props.set(P.SCALE, String(ROD_BALL_REST_SCALE));
  return { id: ROD_BALL_ID_BASE + frame, x: o.x + along * Math.sin(a), y: o.y + along * Math.cos(a), props };
}
