// The player's gameplay frame, for Rotate Gameplay (trigger 2900).
//
// The original never turns the level. `PlayerObject::rotateGameplay` (m1
// 0x387c94) only sets three flags on the player — `m_isSideways` (0x973),
// `m_isUpsideDown` via `flipGravity` (0x37b40c) and `m_isGoingLeft` via
// `doReversePlayer` (0x37a070) — and the physics keeps running on one "travel"
// axis and one "gravity" axis:
//
//   sideways = key166 in {3, 4}
//   flipped  = key166 in {1, 4}
//   reversed = key167 in {2, 3}      (keys use 1 up, 2 down, 3 left, 4 right)
//
// Sideways swaps the two axes: travel runs along world y and gravity along
// world x (Dash, native: after the trigger at (2265, 226) — key 166 = 4,
// key 167 = 2 — the player travels *down* with the right-hand wall as its
// ground, exactly what the flags give). Reversed makes travel negative.
//
// The port does the same by running the ordinary step in a **local frame**:
//
//   local.x = r * (sideways ? world.y : world.x),   r = reversed ? -1 : 1
//   local.y =      sideways ? world.x : world.y
//
// so "x" is always the direction of travel and "y" the gravity axis, and the
// collision world is handed to the step through `LocalWorld`, which maps every
// query box out to the world and every collider back in.
import type { Box, Collider, CollisionWorld, Interactive } from "./collision.ts";
import type { TriggerRuntime } from "../gd/triggers.ts";

export interface Frame {
  sideways: boolean;
  reversed: boolean;
}

export const isIdentity = (f: Frame) => !f.sideways && !f.reversed;

export function toLocal(f: Frame, x: number, y: number): { x: number; y: number } {
  const r = f.reversed ? -1 : 1;
  return f.sideways ? { x: r * y, y: x } : { x: r * x, y };
}

export function toWorld(f: Frame, x: number, y: number): { x: number; y: number } {
  const r = f.reversed ? -1 : 1;
  return f.sideways ? { x: y, y: r * x } : { x: r * x, y };
}

/** a box's centre moves with the frame; its extents swap when sideways */
export function boxToWorld(f: Frame, b: Box): Box {
  const c = toWorld(f, b.x, b.y);
  return f.sideways ? { x: c.x, y: c.y, hw: b.hh, hh: b.hw } : { x: c.x, y: c.y, hw: b.hw, hh: b.hh };
}

function boxToLocal<T extends Box>(f: Frame, b: T): T {
  const c = toLocal(f, b.x, b.y);
  const out: T = { ...b, x: c.x, y: c.y };
  if (f.sideways) { out.hw = b.hh; out.hh = b.hw; }
  return out;
}

/** a direction (unit vector) in the local frame */
function vecToLocal(f: Frame, x: number, y: number): { x: number; y: number } {
  return toLocal(f, x, y);
}

function orientToLocal(f: Frame, obb: NonNullable<Collider["obb"]>) {
  const u = vecToLocal(f, obb.cos, obb.sin);
  return { hw: obb.hw, hh: obb.hh, cos: u.x, sin: u.y };
}

export function colliderToLocal(f: Frame, c: Collider): Collider {
  const out = boxToLocal(f, c);
  if (c.obb) out.obb = orientToLocal(f, c.obb);
  if (c.ox !== undefined || c.oy !== undefined) {
    const o = vecToLocal(f, c.ox ?? 0, c.oy ?? 0);
    out.ox = o.x; out.oy = o.y;
  }
  if (c.slope) {
    // the right-angle corner is a direction from the centre, so it turns too
    const k = vecToLocal(f, c.slope.cx, c.slope.cy);
    out.slope = { cx: k.x < 0 ? -1 : 1, cy: k.y < 0 ? -1 : 1 };
  }
  return out;
}

export function interactiveToLocal(f: Frame, it: Interactive): Interactive {
  const out = boxToLocal(f, it);
  if (it.obb) out.obb = orientToLocal(f, it.obb);
  return out;
}

/**
 * The collision world as seen from the player's local frame. Only the queries
 * the step makes are provided; `CollisionWorld` itself is the identity case.
 */
export class LocalWorld {
  readonly world: CollisionWorld;
  readonly frame: Frame;
  constructor(world: CollisionWorld, frame: Frame) {
    this.world = world;
    // a snapshot: the player's flags may change while the view is in use
    this.frame = { sideways: frame.sideways, reversed: frame.reversed };
  }

  near(box: Box, rt?: TriggerRuntime): Collider[] {
    return this.world.near(boxToWorld(this.frame, box), rt).map((c) => colliderToLocal(this.frame, c));
  }

  nearInteractives(box: Box, rt?: TriggerRuntime): Interactive[] {
    return this.world.nearInteractives(boxToWorld(this.frame, box), rt)
      .map((it) => interactiveToLocal(this.frame, it));
  }

  isDynamic(index: number): boolean {
    return this.world.isDynamic(index);
  }

  placedCollider(index: number, rt: TriggerRuntime): { x: number; y: number } | null {
    const p = this.world.placedCollider(index, rt);
    return p && toLocal(this.frame, p.x, p.y);
  }
}

/** what the step needs from a collision world, in whatever frame it runs */
export type WorldView = Pick<CollisionWorld, "near" | "nearInteractives" | "isDynamic" | "placedCollider">;

/** the view of `world` for a player in `frame` */
export function viewFor(world: CollisionWorld, frame: Frame): WorldView {
  return isIdentity(frame) ? world : new LocalWorld(world, frame);
}
