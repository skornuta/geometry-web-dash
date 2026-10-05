// Which robot/spider animation is playing, and where it has got to.
//
// The frame data is GENERATED into `anim.ts` from the game's own
// `objectDefinitions.plist` / `*_AnimDesc.plist`. What is *not* in that data is
// which animation a given player state should be running, because the game
// drives that from `PlayerObject` rather than from the plist. Two rules here
// are therefore reasoned rather than sourced, and both are marked below.
//
// This is presentation only — nothing here may feed back into `sim.ts`.
import { ROBOT_ANIM, SPIDER_ANIM, type Anim, type AnimPart } from "./anim.ts";

export type LimbMode = "robot" | "spider";

export interface AnimPlayer {
  name: string;
  /** seconds into the current animation */
  t: number;
}

export function createAnimPlayer(): AnimPlayer {
  return { name: "idle", t: 0 };
}

function table(mode: LimbMode): Record<string, Anim> {
  return mode === "robot" ? ROBOT_ANIM : SPIDER_ANIM;
}

/**
 * DESIGN CHOICE, not sourced: a one-shot `*_start` runs into the matching
 * `*_loop`. The plists carry an `other` field that could name a follow-up, but
 * it is "0" on every animation, so the pairing is by name.
 */
const CONTINUES: Record<string, string> = {
  jump_start: "jump_loop",
  fall_start: "fall_loop",
};

/**
 * DESIGN CHOICE, not sourced: the robot runs while grounded, plays its jump
 * while rising and its fall otherwise; the spider, which teleports between
 * surfaces rather than jumping, only ever runs or falls.
 */
function wanted(mode: LimbMode, onGround: boolean, rising: boolean): string {
  if (onGround) return "run";
  if (mode === "spider") return "fall_loop";
  return rising ? "jump_start" : "fall_start";
}

/** total run time of a non-looping animation */
function span(a: Anim): number {
  return a.delay * a.frames.length;
}

export function stepAnim(
  a: AnimPlayer, mode: LimbMode, onGround: boolean, rising: boolean, dt: number,
) {
  const anims = table(mode);
  const want = wanted(mode, onGround, rising);
  // already past the one-shot and into its loop: that still counts as `want`
  const settled = CONTINUES[want] === a.name;
  if (!settled && a.name !== want) {
    a.name = anims[want] ? want : "idle";
    a.t = 0;
  }
  a.t += dt;

  const cur = anims[a.name];
  if (!cur || cur.looped || cur.delay <= 0) return;
  const next = CONTINUES[a.name];
  if (next && anims[next] && a.t >= span(cur)) {
    a.t -= span(cur);
    a.name = next;
  }
}

/** the parts to draw this instant, or null if the animation is unknown */
export function animFrame(mode: LimbMode, a: AnimPlayer): AnimPart[] | null {
  const anim = table(mode)[a.name];
  if (!anim || !anim.frames.length) return null;
  const n = anim.frames.length;
  if (anim.delay <= 0) return anim.frames[0];
  const i = Math.floor(a.t / anim.delay);
  // a loop wraps; a one-shot holds its last pose
  return anim.frames[anim.looped ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
}
