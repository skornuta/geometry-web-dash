/**
 * M6 practice mode — the green-diamond checkpoint stack.
 *
 * **Sourcing note, in this file's own terms.** Unlike the physics, this is *not*
 * read out of the binary: the two Ghidra decompiles carry only `PlayerObject`'s
 * physics functions, and neither `createCheckpoint` nor the practice-mode
 * placement logic is in them. What is implemented here is the behaviour the
 * game documents and exhibits:
 *
 * - A checkpoint is a **green gem**; dying respawns at the **last** one placed.
 * - **Manual**: `Z` places a checkpoint, `X` removes the most recent one — the
 *   original's Steam keybinds.
 * - **Auto-checkpoints are on by default** and can be turned off from the pause
 *   menu.
 * - Placement differs by gamemode. For **cube, ball, robot and spider** a
 *   checkpoint drops when the player *lands on a safe surface* after some travel.
 *   For **ship, UFO and wave** — modes with no landing to key off — one drops a
 *   set distance *behind* the icon.
 *
 * The two distances (`GROUND_SPACING`, `AIR_SPACING`/`AIR_TRAIL`) are **tuned,
 * not sourced.** They are the one part of this file that is a judgement call,
 * and they are isolated here so they are cheap to correct later.
 *
 * A checkpoint stores a **whole `SimState` snapshot**, not a position: restoring
 * only x/y would resume into a world whose colour triggers had already fired and
 * whose breakable blocks were already smashed, which plays differently from the
 * first run through the section.
 */

import { cloneSim, restoreSim, type SimState } from "../game/sim.ts";
import type { Gamemode } from "./gamemodes.ts";

/** TUNED: minimum travel between two automatic ground checkpoints, in units */
const GROUND_SPACING = 420;
/** TUNED: how often an automatic checkpoint drops in a flying mode */
const AIR_SPACING = 360;
/** TUNED: how far behind the icon a flying-mode checkpoint is placed */
const AIR_TRAIL = 150;

/** modes that land on surfaces, and so key their checkpoints off a landing */
const GROUND_MODES: ReadonlySet<Gamemode> = new Set<Gamemode>([
  "cube", "ball", "robot", "spider",
]);

export interface Checkpoint {
  /** full world snapshot to restore on death */
  snap: SimState;
  /** where the green diamond is drawn */
  x: number;
  y: number;
  /** camera bottom edge at capture, so the view does not jump on respawn */
  camY: number;
  /** true if the player placed this one by hand (Z) */
  manual: boolean;
}

export class CheckpointStack {
  readonly list: Checkpoint[] = [];
  /** auto-placement, matching the original's default-on pause-menu toggle */
  auto = true;
  /** x of the last automatic placement, so spacing is measured from it */
  private lastAutoX = -Infinity;
  /** was the player on the ground at the end of last step? */
  private wasGround = false;
  /**
   * Has `update` seen a frame yet? The first one only seeds `wasGround`.
   * Without this a cube standing on the ground at the level start reads as a
   * *landing* on frame one and drops a checkpoint at x=0 — which is exactly
   * where a full restart already puts you, so it is pure noise.
   */
  private primed = false;

  get last(): Checkpoint | undefined {
    return this.list[this.list.length - 1];
  }

  get length(): number {
    return this.list.length;
  }

  clear() {
    this.list.length = 0;
    this.lastAutoX = -Infinity;
    this.wasGround = false;
    this.primed = false;
  }

  /** place one at the player's current position (the `Z` key, and auto-placement) */
  place(sim: SimState, camY: number, manual = false, x?: number, y?: number): Checkpoint {
    const cp: Checkpoint = {
      snap: cloneSim(sim),
      x: x ?? sim.player.x,
      y: y ?? sim.player.y,
      camY,
      manual,
    };
    this.list.push(cp);
    return cp;
  }

  /** remove the most recent checkpoint (the `X` key) */
  remove(): boolean {
    if (!this.list.length) return false;
    this.list.pop();
    // so auto-placement does not immediately re-drop one where it was deleted
    this.lastAutoX = this.list.length ? this.list[this.list.length - 1].x : -Infinity;
    return true;
  }

  /**
   * Called once per rendered frame while alive in practice mode. Drops an
   * automatic checkpoint when the current gamemode's rule is met.
   *
   * Deliberately driven per *frame* rather than per physics step: placement is a
   * cosmetic convenience, and snapshotting at 240 Hz would clone the world
   * hundreds of times a second for no benefit.
   */
  update(sim: SimState, camY: number) {
    const p = sim.player;
    if (!this.auto || sim.dead) {
      this.wasGround = p.onGround;
      return;
    }
    if (GROUND_MODES.has(p.mode)) {
      // "connects to a safe surface after a series of movements": the landing
      // edge is the signal, the spacing is the "series of movements" part.
      // A player who was already standing there on the first frame has not
      // landed — see `primed`.
      const landed = p.onGround && !this.wasGround && this.primed;
      if (landed && p.x - this.lastAutoX >= GROUND_SPACING) {
        this.lastAutoX = p.x;
        this.place(sim, camY);
      }
    } else {
      // flying modes never land, so they get one a fixed distance back — far
      // enough that the respawn is not already inside whatever killed you
      if (p.x - this.lastAutoX >= AIR_SPACING) {
        this.lastAutoX = p.x;
        this.place(sim, camY, false, Math.max(0, p.x - AIR_TRAIL), p.y);
      }
    }
    this.wasGround = p.onGround;
    this.primed = true;
  }

  /**
   * Restore the last checkpoint into `sim`. Returns the checkpoint used, or
   * undefined when there is none and the caller should do a full restart.
   *
   * The checkpoint is **kept** — dying repeatedly at one checkpoint must return
   * to it every time, so the snapshot is re-copied rather than consumed.
   */
  restore(sim: SimState): Checkpoint | undefined {
    const cp = this.last;
    if (!cp) return undefined;
    restoreSim(sim, cp.snap);
    // measure spacing from here again, so the next auto-placement is not
    // suppressed by how far the *pre-death* run had got
    this.lastAutoX = cp.x;
    this.wasGround = sim.player.onGround;
    return cp;
  }
}
