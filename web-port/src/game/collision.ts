// Builds the collision world for a level and answers overlap queries.
// Bounding boxes are bucketed into vertical columns; rotated hazards retain
// their oriented rectangle for the narrow-phase test.
import type { Level } from "../gd/level.ts";
import { OBJECT_DEFS, type ObjectKind } from "../gd/objects.ts";
import { HITBOXES, HITBOX_RADII } from "../gd/hitboxes.ts";
import { P, propFloat, propInt, propBool } from "../gd/props.ts";
import { parseGroups, groupState, type TriggerRuntime } from "../gd/triggers.ts";

export type ColliderKind = "solid" | "hazard";

export interface Collider {
  kind: ColliderKind;
  /** centre */
  x: number;
  y: number;
  /** half extents */
  hw: number;
  hh: number;
  id: number;
  /**
   * Index into `level.objects` — a stable identity for this collider's source
   * object. Used to remember destroyed breakables per attempt, and shared with
   * the renderer so a block that has been smashed also stops being drawn.
   */
  index: number;
  /**
   * `GameObjectType::Breakable` (21). Solid in every respect — it is bucketed
   * with the solids and you land and snap on it normally — except that **where
   * a normal solid would kill you, a breakable is destroyed instead**:
   * ```cpp
   * if (object->getType() == GameObjectType::Breakable) { destroyObject(object); return 1; }
   * else { destroyPlayer(this, nullptr); }
   * ```
   * (`PlayerObject::collidedWithObjectInternal`, the tail.) Only id 143 has it.
   * Making them non-solid instead is wrong and was measured to be worse — the
   * same blocks are load-bearing platforms elsewhere in the level.
   */
  breakable?: boolean;
  /**
   * Hitbox centre minus the source object's own position, when the two differ
   * (15 of the 435 hitbox entries sit off-centre). Absent — and zero — for
   * everything else. The cube's landing snap reads the *object* position, not
   * the hitbox's, so it has to be able to get back to it.
   */
  ox?: number;
  oy?: number;
  /** group ids this collider belongs to (M5); empty for the vast majority */
  groups: number[];
  /** set for round hazards (saws/blades) — tested as a circle, not a box */
  radius?: number;
  /** a round hazard tested circle-vs-circle — see `hitsHazard` */
  circle?: boolean;
  /** Local half-extents and CCW rotation; hw/hh remain the enclosing AABB. */
  obb?: { hw: number; hh: number; cos: number; sin: number };
  /**
   * Set for object_type 25. A slope is a right triangle filling its box; this
   * says which corner holds the right angle, so the hypotenuse (the ridable
   * surface) runs between the other two. `cy = -1` means the solid part is
   * below the surface (a ramp), `+1` means above it (a ceiling wedge).
   */
  slope?: { cx: -1 | 1; cy: -1 | 1 };
}

/** kinds that interact without blocking movement (M4) */
export type InteractiveKind = "portal" | "orb" | "pad" | "speed" | "coin" | "collect" | "special";

export interface Interactive {
  kind: InteractiveKind;
  /** index into CollisionWorld.interactives — the trigger identity */
  index: number;
  /**
   * Index into `level.objects`, matching `Collider.index` and `DrawItem.obj`.
   *
   * **Not the same number as `index` above**, and the difference bites: a
   * secret coin's *sprite* has to be found by this one, while the sim tracks
   * which coins are spent by `index`. Keying the scene off `index` silently
   * marks the wrong object (or none at all) — it looked exactly like the
   * already-collected coin art not existing.
   */
  obj: number;
  /** object id from the level data */
  id: number;
  /** GameObjectType from the object table */
  type: number;
  x: number;
  y: number;
  hw: number;
  hh: number;
  /** raw object properties (teleport offset, multi-activate, rotation, …) */
  props: Map<number, string>;
  /** groups, set only when a trigger can move or toggle this interactive */
  groups?: number[];
  /** the true rectangle when turned off the quarter-turns, as for colliders */
  obb?: Collider["obb"];
}

export interface Box {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/** column width for the spatial index */
const COL = 60;

/**
 * Fallback only — see `HITBOXES` in `src/gd/hitboxes.ts` for the real thing.
 *
 * Every id the 22 levels collide with is in the real table, so nothing below is
 * reached in practice; it stays for ids outside that scope (2.1+ objects the
 * table predates). Exported because the tests and tooling sweep it.
 */
export const HAZARD_SHRINK = { x: 0.72, y: 0.75 };

/** fallback per-family shapes, used only when the real table has no entry */
const HAZARD_SHAPES: { match: RegExp; x: number; y: number; circle?: boolean }[] = [
  { match: /^(saw|blade|darkblade|blade_b|blackCogwheel|fireball)/, x: 0.75, y: 0.75, circle: true },
  { match: /^(spike|colorSpike|iceSpike|d_spike)/, x: 0.25, y: 0.3 },
];

/** shape for an object's art family; the default suits floor pits */
export function hazardShape(frame: string): { x: number; y: number; circle: boolean } {
  for (const s of HAZARD_SHAPES) {
    if (s.match.test(frame)) return { x: s.x, y: s.y, circle: s.circle === true };
  }
  return { x: HAZARD_SHRINK.x, y: HAZARD_SHRINK.y, circle: false };
}

const INTERACTIVE_KINDS: Partial<Record<ObjectKind, InteractiveKind>> = {
  portal: "portal", orb: "orb", pad: "pad", speed: "speed", coin: "coin",
};

/**
 * The collectible (`1614`). The object table calls it decoration because it is
 * drawn like decoration, but `collisionCheckObjects` (m1 `0xff074` +1516..1628)
 * runs it through the pickup path: once per attempt per object, guarded by
 * `GJEffectManager::hasBeenTriggered` / `storeTriggeredID`. Fingerdash's 11
 * feed item 1, which its count and instant-count triggers read.
 */
export const COLLECTIBLE_IDS: ReadonlySet<number> = new Set([1614]);

/** which per-frame player state a special block raises — see `SPECIAL_BLOCKS` */
export type SpecialBlock = "D" | "J" | "S" | "H" | "F";

/**
 * GD 2.2's **special blocks** (`GameObjectType` 40, "Special"): the lettered
 * editor squares. They are invisible in play and never solid. While the
 * player's box overlaps one, it raises one of the player's per-frame state
 * flags, which the collision pass then reads:
 *
 *   * **D** (1755) — `m_stateDartSlide`: the wave ("dart") slides along solids
 *     it touches instead of dying on them;
 *   * **J** (1813) — `m_stateNoAutoJump`: a held button does not re-jump off
 *     the ground, only a fresh press does;
 *   * **S** (1829) — stops a dash-orb dash the moment it is touched;
 *   * **H** (1859) — `m_stateHitHead`: hitting a ceiling with your head is a
 *     bump, not a death.
 *
 * 1751 is **not** one of them — it is the gravity dash orb (`dashRing_02`).
 * S is confirmed frame-exactly by Fingerdash's native run: its dash ends on
 * the first frame the player's box reaches the S column at x=2741 (frame
 * 2088), where the port used to dash on for another 14 frames.
 */
export const SPECIAL_BLOCKS: ReadonlyMap<number, SpecialBlock> = new Map([
  [1755, "D"], [1813, "J"], [1829, "S"], [1859, "H"],
  // F (2866) sets `m_stateFlipGravity` (`touchedObject` m1 0x391af0 -> [0xb18]);
  // `didHitHead` (0x3834bc) then flips gravity on a head hit — see sim.ts
  [2866, "F"],
]);

/**
 * Where an object in trigger-controlled groups is now: orbited about any
 * rotating group's centre, then offset by the groups' moves. Null while any of
 * its groups is disabled. Without `rt` the object stays where it was placed.
 */
function placeInGroups(
  x0: number, y0: number, groups: number[], rt?: TriggerRuntime,
): { x: number; y: number; rot: number; lockRot: boolean; sx: number; sy: number } | null {
  let dx = 0, dy = 0, rot = 0, cx = 0, cy = 0, lockRot = false;
  let sx = 1, sy = 1, scx = 0, scy = 0, scaled = false;
  if (rt) {
    for (const g of groups) {
      const s = groupState(rt, g);
      dx += s.dx; dy += s.dy;
      if (s.rot) { rot += s.rot; cx = s.cx; cy = s.cy; lockRot = s.lockRot; }
      if (s.sx !== 1 || s.sy !== 1) {
        sx *= s.sx; sy *= s.sy;
        if (!s.scaleOwn) { scx = s.scx; scy = s.scy; scaled = true; }
      }
      if (!s.enabled) return null;
    }
  }
  let x = x0, y = y0;
  // a Scale trigger with a centre spreads the objects about it; without one
  // each object only grows in place
  if (scaled) { x = scx + (x - scx) * sx; y = scy + (y - scy) * sy; }
  if (rot) {
    // orbit the group's centre, then apply any move offset on top
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const px = x - cx, py = y - cy;
    x = cx + px * ca - py * sa;
    y = cy + px * sa + py * ca;
  }
  return { x: x + dx, y: y + dy, rot, lockRot, sx, sy };
}

export class CollisionWorld {
  private columns = new Map<number, Collider[]>();
  readonly colliders: Collider[] = [];
  private icolumns = new Map<number, Interactive[]>();
  readonly interactives: Interactive[] = [];

  /**
   * Colliders in a group that a move/alpha/toggle trigger targets cannot live
   * in the x-bucketed index — moving them would put them in the wrong column.
   * They go in a separate list that is scanned in full, with the group's current
   * offset applied at query time. Levels have only a handful of these.
   */
  private dynamic: Collider[] = [];
  /** the same, for orbs, pads and portals in a trigger-moved group */
  private idynamic: Interactive[] = [];
  private movable: Set<number> = new Set();

  constructor(
    level: Level, frameSize: (id: number) => { w: number; h: number } | null,
    movableGroups: Set<number> = new Set(),
  ) {
    this.movable = movableGroups;
    const circles = circleVsCircle(level);
    for (let objIndex = 0; objIndex < level.objects.length; objIndex++) {
      const o = level.objects[objIndex];
      const def = OBJECT_DEFS.get(o.id);
      if (!def) continue;
      const ikind: InteractiveKind | undefined =
        COLLECTIBLE_IDS.has(o.id) ? "collect"
          : SPECIAL_BLOCKS.has(o.id) ? "special"
            : INTERACTIVE_KINDS[def.kind];
      const kind: ColliderKind | null =
        def.kind === "solid" || def.kind === "slope" ? "solid"
          : def.kind === "hazard" ? "hazard"
            : null;
      if (!kind && !ikind) continue;
      // **No Touch** (`m_isNoTouch`, key 121): the object is drawn but nothing
      // collides with it. Dash stacks a no-touch yellow pad on a live one at
      // (1545, 122), plus 51 thin platforms and 7 spikes; the port fired the
      // decoy pad under a spider five frames before the real cube fired the
      // live one (native f1170).
      if (propBool(o.props, P.NO_TOUCH)) continue;
      // **Passable** (`m_isPassable`, key 134): a block the player runs
      // through. Dash (22521, 2153): the real cube passes it at f20814, where
      // the port hit its side and died.
      if (kind === "solid" && propBool(o.props, P.PASSABLE)) continue;

      const size = frameSize(o.id);
      // RobTop's own table governs both walls and trigger volumes. Every portal
      // and every orb differs from its art — the sprite is wider than the box
      // for portals (gravity 34.5 vs 25) and narrower for orbs (30 vs 36) — so
      // sizing interactives from the art both over- and under-triggers.
      const real = HITBOXES.get(o.id);
      // the sprite is only a fallback for ids outside the real table
      if (!real && !size) continue;
      const scale = propFloat(o.props, P.SCALE, 1);
      // **2.2's per-axis scale** (keys 128/129, `m_scaleX`/`m_scaleY`) stands
      // in for the uniform key 32 when present. Dash (645, -33): a block with
      // 128 = 1.98 is 59.4 wide, and the real player keeps riding it 13 units
      // past where a 30-wide box ends (f533-542).
      const sx = o.props.has(128) ? propFloat(o.props, 128, 1) : scale;
      const sy = o.props.has(129) ? propFloat(o.props, 129, 1) : scale;
      // a quarter-turn swaps the box's extents
      const rotation = propFloat(o.props, P.ROTATION, 0);
      const rot = ((rotation % 180) + 180) % 180;
      const turned = rot > 45 && rot < 135;
      const w = real ? real.w : size!.w;
      const h = real ? real.h : size!.h;
      let hw = (turned ? h * sy : w * sx) / 2;
      let hh = (turned ? w * sx : h * sy) / 2;
      let radius: number | undefined;
      if (real) {
        // `GameObject::getObjectRadius()` — a circle wins over the box, and
        // scales by the object's scale
        const r = HITBOX_RADII.get(o.id);
        if (r !== undefined) {
          // `getObjectRadius`: the radius times the smaller of the two scales
          radius = r * Math.min(sx, sy);
          // Several saws carry a radius LARGER than their stored box (id 88 is
          // r 32.3 against a 44-wide box). The circle is what kills, but the box
          // is what the column index buckets on, so it has to contain the
          // circle or the broad phase drops the saw exactly at its edges.
          hw = Math.max(hw, radius);
          hh = Math.max(hh, radius);
        }
      } else if (kind === "hazard") {
        const shape = hazardShape(def.frame);
        hw *= shape.x;
        hh *= shape.y;
        if (shape.circle) radius = Math.min(hw, hh);
      }
      let obb: Collider["obb"];
      if ((kind === "hazard" || (!kind && ikind)) && radius === undefined && rot % 90 !== 0) {
        // RectApplyTransform/OBB2D: rotate the sourced rectangle, not a
        // quarter-turn approximation. The spatial index needs its full AABB
        // or a rotated tip can reach into a column that never queries it.
        const a = -rotation * Math.PI / 180;
        const cos = Math.cos(a), sin = Math.sin(a);
        obb = { hw: turned ? hh : hw, hh: turned ? hw : hh, cos, sin };
        hw = Math.abs(cos) * obb.hw + Math.abs(sin) * obb.hh;
        hh = Math.abs(sin) * obb.hw + Math.abs(cos) * obb.hh;
      }
      // 15 of the 435 entries sit off-centre; the original rotates and flips
      // that offset with the object (`RectApplyTransform`), so we do too.
      let ox = 0, oy = 0;
      if (real && (real.dx || real.dy)) {
        const dx = (real.dx ?? 0) * sx * (propBool(o.props, P.FLIP_X) ? -1 : 1);
        const dy = (real.dy ?? 0) * sy * (propBool(o.props, P.FLIP_Y) ? -1 : 1);
        // key 6 is degrees CW
        const a = (-rotation * Math.PI) / 180;
        ox = dx * Math.cos(a) - dy * Math.sin(a);
        oy = dx * Math.sin(a) + dy * Math.cos(a);
      }
      const groups = parseGroups(o);
      if (kind) {
        const c: Collider = {
          kind, x: o.x + ox, y: o.y + oy, hw, hh, id: o.id, groups, radius, obb,
          ...(radius !== undefined && circles ? { circle: true } : {}),
          index: objIndex,
        };
        if (ox || oy) { c.ox = ox; c.oy = oy; }
        if (def.type === 21) c.breakable = true;
        if (def.kind === "slope") c.slope = slopeCorner(o.props);
        if (groups.some((g) => this.movable.has(g))) {
          this.colliders.push(c);
          this.dynamic.push(c);
        } else {
          this.add(c);
        }
      } else if (ikind) {
        // the hitbox's off-centre offset turns with the object, as for colliders
        // (Fingerdash's 90-degree teleport at x=6405: the real cube drops onto
        // it 12 units lower than the unshifted box, three frames later)
        const it: Interactive = {
          kind: ikind, index: this.interactives.length, obj: objIndex,
          id: o.id, type: def.type,
          x: o.x + ox, y: o.y + oy, hw, hh, props: o.props,
        };
        // Deadlocked's teleports at -53 and -46 degrees: the enclosing box
        // fired them at its empty corners, frames before the real runs
        if (obb) it.obb = obb;
        if (groups.some((g) => this.movable.has(g))) {
          it.groups = groups;
          this.interactives.push(it);
          this.idynamic.push(it);
        } else {
          this.addInteractive(it);
        }
      }
    }
  }

  private add(c: Collider) {
    this.colliders.push(c);
    const from = Math.floor((c.x - c.hw) / COL);
    const to = Math.floor((c.x + c.hw) / COL);
    for (let i = from; i <= to; i++) {
      let bucket = this.columns.get(i);
      if (!bucket) this.columns.set(i, (bucket = []));
      bucket.push(c);
    }
  }

  private addInteractive(it: Interactive) {
    this.interactives.push(it);
    const from = Math.floor((it.x - it.hw) / COL);
    const to = Math.floor((it.x + it.hw) / COL);
    for (let i = from; i <= to; i++) {
      let bucket = this.icolumns.get(i);
      if (!bucket) this.icolumns.set(i, (bucket = []));
      bucket.push(it);
    }
  }

  /**
   * Every collider whose column overlaps the box, plus any trigger-moved
   * collider currently near it. When `rt` is given, moved colliders are
   * returned at their *current* position and disabled groups are omitted.
   */
  near(box: Box, rt?: TriggerRuntime): Collider[] {
    const from = Math.floor((box.x - box.hw) / COL);
    const to = Math.floor((box.x + box.hw) / COL);
    const out: Collider[] = [];
    for (let i = from; i <= to; i++) {
      const bucket = this.columns.get(i);
      if (bucket) out.push(...bucket);
    }
    for (const c of this.dynamic) {
      const t = placeInGroups(c.x, c.y, c.groups, rt);
      if (!t) continue;
      if (Math.abs(t.x - box.x) > box.hw + c.hw + COL) continue;
      const cs = t.sx !== 1 || t.sy !== 1 ? { ...c, hw: c.hw * Math.abs(t.sx), hh: c.hh * Math.abs(t.sy) } : c;
      if (!t.rot) { out.push(t.x !== c.x || t.y !== c.y || cs !== c ? { ...cs, x: t.x, y: t.y } : c); continue; }
      out.push(rotated(cs, t.x, t.y, t.rot, t.lockRot));
    }
    return out;
  }

  /** is this collider (by object index) one that triggers move? */
  isDynamic(index: number): boolean {
    return this.dynamic.some((c) => c.index === index);
  }

  /** a trigger-moved collider's current position, or null while disabled */
  placedCollider(index: number, rt: TriggerRuntime): { x: number; y: number } | null {
    const c = this.dynamic.find((d) => d.index === index);
    if (!c) return null;
    const t = placeInGroups(c.x, c.y, c.groups, rt);
    return t && { x: t.x, y: t.y };
  }

  /**
   * Every interactive whose column overlaps the box, plus any trigger-moved one
   * near it, at its current position; interactives in a disabled group are
   * omitted. Geometrical Dominator x=6645 raises a group of yellow orbs 60
   * units before the ship reaches them — left in place, they fired on a ship
   * that the real run flies underneath (f5266, f5342).
   */
  nearInteractives(box: Box, rt?: TriggerRuntime): Interactive[] {
    const from = Math.floor((box.x - box.hw) / COL);
    const to = Math.floor((box.x + box.hw) / COL);
    const out: Interactive[] = [];
    for (let i = from; i <= to; i++) {
      const bucket = this.icolumns.get(i);
      if (bucket) out.push(...bucket);
    }
    for (const it of this.idynamic) {
      const t = placeInGroups(it.x, it.y, it.groups!, rt);
      if (!t) continue;
      if (Math.abs(t.x - box.x) > box.hw + it.hw + COL) continue;
      out.push(t.x !== it.x || t.y !== it.y ? { ...it, x: t.x, y: t.y } : it);
    }
    return out;
  }
}

/**
 * Which corner of the box holds the slope's right angle, after the object's
 * flips and rotation. The unflipped, unrotated slope is taken to rise
 * left-to-right with its right angle at the bottom-right, so a player runs *up*
 * it; every other orientation in the levels is that shape flipped or turned by
 * a quarter/half turn (verified: rotations present are only 0, +/-90, +/-180).
 */
export function slopeCorner(props: Map<number, string>): { cx: -1 | 1; cy: -1 | 1 } {
  let cx: -1 | 1 = 1, cy: -1 | 1 = -1;
  if (propBool(props, P.FLIP_X)) cx = (-cx) as -1 | 1;
  if (propBool(props, P.FLIP_Y)) cy = (-cy) as -1 | 1;
  // key 6 is degrees CW; each quarter turn CW maps (cx,cy) -> (cy, -cx)
  let quarters = Math.round(propInt(props, P.ROTATION, 0) / 90) % 4;
  if (quarters < 0) quarters += 4;
  for (let i = 0; i < quarters; i++) {
    const nx = cy as -1 | 1;
    const ny = (-cx) as -1 | 1;
    cx = nx; cy = ny;
  }
  return { cx, cy };
}

/**
 * Height of a slope's surface at world x, clamped to the slope's span.
 * The surface runs from the corner diagonally opposite the right angle.
 */
export function slopeSurfaceY(c: Collider, x: number): number {
  const s = c.slope!;
  const x0 = c.x - c.hw, x1 = c.x + c.hw;
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  // the surface is high on the side away from the right-angle corner in x
  const highOnLeft = s.cx > 0;
  const frac = highOnLeft ? 1 - t : t;
  // cy = -1: solid below, surface climbs from the low corner to the box top
  return s.cy < 0
    ? c.y - c.hh + (1 - frac) * 2 * c.hh
    : c.y + c.hh - (1 - frac) * 2 * c.hh;
}

/**
 * Resolve a slope. Unlike a block, a slope has no flat top: the player rides
 * the hypotenuse, so the landing height depends on where along it the player
 * is. Treating slopes as full boxes (what this did before) made every ramp a
 * wall — most visible as the wave, which died on contact instead of running up.
 */
/** does the surface rise as x increases? */
export function slopeUphill(c: Collider): boolean {
  return slopeSurfaceY(c, c.x + c.hw) > slopeSurfaceY(c, c.x - c.hw);
}

/** the span of solid a collider presents at its right edge (x = c.x + c.hw) */
function solidAtRightEdge(c: Collider): { lo: number; hi: number } {
  if (!c.slope) return { lo: c.y - c.hh, hi: c.y + c.hh };
  const s = slopeSurfaceY(c, c.x + c.hw);
  return c.slope.cy < 0 ? { lo: c.y - c.hh, hi: s } : { lo: s, hi: c.y + c.hh };
}

/**
 * Does a box run into a slope's **vertical side** from the left?
 *
 * A wedge whose tall end is on its left (a descending ramp, or a ceiling
 * wedge hanging lowest on its left) presents a full-height wall to a player
 * moving right. `resolveSlope` only knows the hypotenuse: its riding branch
 * lifts anyone less than a tile deep onto the ramp, and lets anyone moving
 * *away* from the surface through untouched — so a wave, which has no landing
 * rule and dies on every other solid it touches, flew straight through these
 * walls. This is the missing half: the box straddling the wall's x and
 * overlapping its height.
 *
 * Part of the wall that a neighbour covers is not a wall — on a staircase of
 * ramps each tile's tall end sits flush against the previous tile's low end —
 * so `neighbours` (the colliders near the player) are checked for one that
 * fills the contact span.
 *
 * Measured, not assumed: across all 17,243 wave frames of the native macros
 * the real wave's box never overlaps an uncovered wall, so this cannot end a
 * run the game lets through.
 */
export function hitsSlopeWall(box: Box, c: Collider, neighbours: readonly Collider[]): boolean {
  if (!c.slope) return false;
  const x0 = c.x - c.hw;
  const top = c.y + c.hh, bottom = c.y - c.hh;
  const left = slopeSurfaceY(c, x0);
  // the left side is a wall only when it is the tall end of the wedge
  if (Math.abs(left - (c.slope.cy < 0 ? top : bottom)) > 1e-6) return false;
  if (!(box.x - box.hw < x0 && box.x + box.hw > x0)) return false;
  const lo = Math.max(bottom, box.y - box.hh), hi = Math.min(top, box.y + box.hh);
  if (lo >= hi) return false;
  for (const n of neighbours) {
    if (n === c || n.kind !== "solid" || Math.abs(n.x + n.hw - x0) > 0.5) continue;
    const span = solidAtRightEdge(n);
    if (span.lo <= lo && span.hi >= hi) return false;
  }
  return true;
}

/** |dy/dx| of the ramp — 1 for a 45 degree tile, 0.5 for a 2:1 one */
export function slopeGradient(c: Collider): number {
  return c.hh / c.hw;
}

/**
 * `m_slopeVelocity`, the launch a ramp stores for when the rider leaves it —
 * **read out of `collidedWithSlopeInternal`** (GD 2.2081 arm64 m1 0x37f440):
 * `s11 * 1.4 * min(0.8 / angle, 1.1)`, then `* 0.75` for every mode but the
 * cube, robot and spider, where `angle` is the ramp's (radians) and `s11`
 * measures `0.9 * speed * k` against the native runs. It reproduces every
 * measured launch: 1.386x the ride speed off a 2:1 ramp, 1.2834x off a 45,
 * at 1x and 2x alike (Geometrical Dominator f254, Hexagon Force f6401…).
 * The port launched at the ride speed itself.
 */
export function slopeLaunchVelocity(c: Collider, speed: number, mode: string): number {
  const k = slopeGradient(c);
  const v = 0.9 * speed * k * 1.4 * Math.min(0.8 / Math.atan(k), 1.1);
  const small = mode === "cube" || mode === "robot" || mode === "spider";
  return small ? v : v * 0.75;
}

/**
 * Where a player of half-size `half` rides on a ramp, and over how wide a span.
 *
 * **The game keeps the player `half` from the ramp measured perpendicular to
 * it, not straight up.** Geometrical Dominator's first 2:1 ramp (id 666 from
 * x=270), native: the cube rides 16.77 above the surface under its centre —
 * `15 * sqrt(1 + 0.5^2)` — on every frame of the climb, and so starts climbing
 * 3.54 units *before* the ramp begins, where that line first rises past the
 * flat 15 (`15 * (sqrt(5) - 2)`). Holding 15 straight up rode every ramp too
 * low (1.77 on a 2:1, 6.21 on a 45) and started every climb late.
 *
 * The line is extended past the tile only as far as that early start needs,
 * and the height is clamped between the tile's low and high ends plus a flat
 * `half`, so the ground and the ledge on either side are unchanged.
 *
 * **`handoff`: a player already riding a ramp meets the next one's line
 * as soon as its box overlaps the tile**, with no flat floor under it — the
 * previous ramp is the support, not the ground. Hexagon Force f5359: a ball on
 * a 2:1 ramp is at 223.04, the 45° tile's own line (`15·√2` above it) 1.96
 * units before the ordinary reach and 1.96 below that tile's floor clamp.
 * Applying either rule from flat ground instead wrecked the waves' ramp
 * approaches (ToE 2, Geometrical Dominator).
 */
/** the ramp's surface line at `px`, extended past the tile's ends */
function slopeLineY(c: Collider, px: number): number {
  const s = c.slope!;
  const t = (px - (c.x - c.hw)) / (2 * c.hw);
  const frac = s.cx > 0 ? 1 - t : t;
  return s.cy < 0 ? c.y - c.hh + (1 - frac) * 2 * c.hh : c.y + c.hh - (1 - frac) * 2 * c.hh;
}

export function slopeRideTarget(
  c: Collider, px: number, half: number, handoff = false,
): number | null {
  const k = slopeGradient(c);
  const lift = half * Math.sqrt(1 + k * k);
  const reach = handoff ? c.hw + half : c.hw + (lift - half) / k;
  if (Math.abs(px - c.x) > reach) return null;
  const s = c.slope!;
  const x0 = c.x - c.hw;
  // the surface line, unclamped: low at the right-angle side's opposite end
  const t = (px - x0) / (2 * c.hw);
  const frac = s.cx > 0 ? 1 - t : t;
  const lineY = s.cy < 0
    ? c.y - c.hh + (1 - frac) * 2 * c.hh
    : c.y + c.hh - (1 - frac) * 2 * c.hh;
  const lo = c.y - c.hh, hi = c.y + c.hh;
  if (handoff) return s.cy < 0 ? Math.min(hi + half, lineY + lift) : Math.max(lo - half, lineY - lift);
  return s.cy < 0
    ? Math.min(hi + half, Math.max(lo + half, lineY + lift))
    : Math.max(lo - half, Math.min(hi - half, lineY - lift));
}

/**
 * Broad-phase for a slope tile — use this instead of `overlaps()` before
 * calling `resolveSlope`.
 *
 * A plain box overlap is subtly wrong at the tile's **high corner**: the
 * surface there is the top of the box, so a player resting on it has its centre
 * exactly `c.hh + PLAYER_HALF` from the tile's centre — precisely the exclusive
 * boundary `overlaps()` rejects. On a *descending* ramp that corner is the
 * entry edge, so at every tile handoff the next tile refused to claim a player
 * who was standing right on it: they fell free for a few steps until they sank
 * far enough into the box to be seen, were snapped back onto the surface, and
 * fell again. That is the staircase stutter (level 19, x~8790), and it is why
 * the fix does not belong in the ride logic — `resolveSlope` was never called.
 *
 * So reach a player's height past the surface, and keep the far side as tight
 * as the old box test so a player passing under a raised ramp is still ignored.
 */
export function nearSlope(
  px: number, py: number, c: Collider, sizeScale = 1, handoff = false,
): boolean {
  const half = PLAYER_HALF * sizeScale;
  if (slopeRideTarget(c, px, half, handoff) === null) return false;
  const surface = slopeSurfaceY(c, px);
  // A rider sits `half * sqrt(1 + k^2)` off the surface — past 2 x half on a
  // ramp steeper than sqrt(3), where the plain 2 x half reach dropped it at
  // every tile hand-off (Dash f19106: a mini cube climbing a 2:1 staircase
  // left the ramp at each tile edge, native rides it at 2 x speed)
  const k = slopeGradient(c);
  const reach = Math.max(2 * half, half * Math.sqrt(1 + k * k) + 1);
  return c.slope!.cy < 0
    ? py < surface + reach && py > c.y - c.hh - half
    : py > surface - reach && py < c.y + c.hh + half;
}

export function resolveSlope(
  px: number, py: number, yVel: number, c: Collider, g = 1, sizeScale = 1,
  bump = false, alreadyRiding = false, rideVel = 0, handoff = alreadyRiding,
  speed = 0,
): { result: SolidResult; landY: number; ledge?: boolean } {
  const half = PLAYER_HALF * sizeScale;
  const innerHalf = PLAYER_INNER_HALF * sizeScale;
  // A slope tile only acts on the player while the player is actually over it.
  // `slopeSurfaceY` clamps the sample to the tile's span, so a tile not yet
  // reached reports its *low end* — and a 30-wide player overlaps the next tile
  // ~15 units early. On a staircase of ramps that offered a landing target a
  // whole tile above the player, which the depth rule then read as "embedded"
  // and killed them (level 19, slope 665 at x=615: target 75 while climbing at
  // y=60, depth 15 > the 11.25 tolerance).
  const ride = slopeRideTarget(c, px, half, handoff);
  if (ride === null) return { result: "none", landY: py };
  // `GameObject::slopeYPos` samples the surface at the player's *leading* edge
  // (`slopeUphill ? rect.getMaxX() : rect.getMinX()`), not its centre. That was
  // tried and reverted: it blocks level 16 outright (100% -> 21.5%, unfixable at
  // beam 384) even with the launch disabled, while centre sampling keeps it at
  // 100%. Our collider boxes are whole-tile approximations rather than GD's
  // per-object hitboxes, so the leading edge lands half a tile off. Revisit if
  // the hitbox table is ever sourced.
  const surface = slopeSurfaceY(c, px);
  const solidBelow = c.slope!.cy < 0;

  // riding side: the player sits on the surface when gravity pulls it against it
  const riding = solidBelow ? g > 0 : g < 0;
  const target = ride;
  // The ride height held at the ledge's (the ramp's top plus `half`).
  const ledge = solidBelow ? c.y + c.hh + half : c.y - c.hh - half;

  if (riding && target === ledge) {
    // **The top of a ramp.** Once the ride height reaches the ledge the game
    // snaps a climbing rider onto it with its velocity zeroed, and from then on
    // the ramp no longer holds it: Geometrical Dominator frame 252 lands on
    // exactly 45.0, frame 253 falls one free gravity step (44.95) though still
    // over the ramp, and frame 254 is the launch (`getModifiedSlopeYVel`).
    const gap = (py - target) * g;
    // (arriving at ramp speed — a ship's thrust from rest on the ledge is a
    // few u/s, and must not re-snap it: ToE 2 f3012 moves on)
    if (alreadyRiding && yVel * g > 60 && gap > -1e-6 && gap <= SLOPE_STICK_RIDING) {
      return { result: "land", landY: target, ledge: true };
    }
    return { result: "none", landY: py };
  }
  if (riding) {
    // on or under the surface while moving toward it -> stand on it
    // A player *already* riding carries an upward tangential velocity, so the
    // "must be falling" test would drop them the moment they start climbing.
    // But that test still has to apply to everyone else, or a ramp snaps down a
    // player who is merely jumping past it.
    const below = (target - py) * g > 0;
    // TRIED AND REVERTED — do not "fix" this to compare against the surface.
    // The test looks wrong, and the flaw is real: an uphill ramp climbs at
    // `speed * gradient`, so a player who is genuinely rising can still be losing
    // ground to it, go unclaimed, and sink into the ramp. Reproducible on a
    // 45-degree ramp at speed 3 (surface 468 u/s against a 603 jump) — the player
    // sinks in and then either dies to the depth rule the moment they start
    // falling, or drops clean through the tile once past `nearSlope`'s lower
    // bound. It only became reachable when jumping off ramps started working.
    // But `yVel * g <= rideVel * g` costs **level 16 seventy points**
    // (100% -> 30.1%) and level 19 twenty-four (93.3% -> 69.0%), measured over
    // the full sweep. Level 16 is extremely sensitive to slopes claiming the
    // player more often — the same signature that made leading-edge sampling
    // unusable. Our colliders are whole tiles rather than GD's per-object
    // hitboxes, which is the likeliest reason a more permissive rule over-claims.
    // Revisit only with the real hitbox table, and re-run the sweep first.
    if (below && (yVel * g <= 0 || alreadyRiding)) {
      // Ramp-vs-wall was once decided at the tile's **entry edge** (an ascending
      // ramp presents its low end there and could never be a wall). That rule is
      // gone: on a *descending* ramp the entry edge is the tall end, so a player
      // legitimately riding down — or dropping onto the middle of one — is always
      // "below the entry surface" and it killed them.
      // How deep below the surface the player is decides ramp-vs-wall, and the
      // threshold is a whole **tile height** rather than the block rule's 11.25.
      // A ramp is allowed to push you up: landing partway up an ascending tile
      // (a ball arcing off the previous ramp) or dropping onto a descending one
      // both put you well below the surface legitimately. Only being deeper than
      // the tile itself means you ran into its face — e.g. meeting a descending
      // ramp's tall end at ground level, which must still kill.
      const depth = (target - py) * g;
      if (depth > 2 * c.hh) return { result: "death", landY: py };
      return { result: "land", landY: target };
    }
    // Going **downhill** the surface falls away faster than the player does, so
    // without this they leave the ramp, fall, land, leave again — a stutter that
    // reads as the ramp being a staircase rather than a smooth slope.
    //
    // The original calls this `slideStickiness` (`collidedWithSlopeInternal`):
    //     float slideStickiness = slidingDown;                  // 1 on contact
    //     if (m_wasOnSlope) slideStickiness = slidingDown * 4;  // 4 while riding
    // and gates it on **`!m_isJumping`** — the flag set the moment a jump fires.
    // Both parts matter:
    //   * **The velocity gate is what lets you jump off a ramp at all.** A jump
    //     lifts the player only ~2.5 units in one 240 Hz step, so an ungated band
    //     re-lands them and zeroes the jump before it leaves the ground. That is
    //     the "I get glued to the slope, it feels robotic" report. Testing the
    //     velocity rather than carrying a flag gets the clearing for free: the
    //     original clears `m_isJumping` once the player is falling again, which
    //     is exactly when `yVel * g <= 0` becomes true.
    //   * **The band is 4 units, not the 11.25 solid tolerance** it was first
    //     written with. 11.25 is `PLAYER_HALF - PLAYER_INNER_HALF`, which governs
    //     how deep you may be inside a *block* — a different rule that has no
    //     business setting how hard a ramp holds you down.
    // The source also gates on `slidingDown`, which falls out here: an uphill
    // rider carries `yVel * g > 0` (the climb rate) and so never reaches this.
    if (alreadyRiding && yVel * g <= 0) {
      const gap = (py - target) * g;
      if (gap > 0 && gap <= SLOPE_STICK_RIDING) return { result: "land", landY: target };
    }
    // An uphill rider moving at nearly the ramp's own rate stays on it even
    // when its own thrust carries it a hair off the line: Theory of
    // Everything 2 f3006-3010, the real (flipped, holding) mini ship holds
    // exactly -387.42 along wedge 673 while its thrust alone would add 5.5.
    if (alreadyRiding && rideVel !== 0 && Math.abs(yVel - rideVel) <= 30) {
      const gap = (py - target) * g;
      if (gap > 0 && gap <= SLOPE_STICK_RIDING) return { result: "land", landY: target };
    }
    return { result: "none", landY: py };
  }

  // Inside the solid half of the wedge: ship/UFO slide along it, others die.
  //
  // `target` is the free side of the surface — the same place the riding branch
  // puts a player standing on it — so a bump must clamp to exactly that. It used
  // to clamp to `surface - (solidBelow ? half : -half)`, the *negation*, which
  // pushes the player deeper into the solid instead of out of it. Most visible
  // on a ceiling wedge: a climbing ship was clamped to `surface + 15`, i.e.
  // inside the wedge, and then rode the descending underside embedded in it
  // rather than being stopped — level 16's diagonal ship corridor at x=3960-4100
  // let the ship fly straight through 51 steps of solid geometry.
  // **A ship/UFO heading into a wedge's underside meets its ride line**, the
  // same perpendicular line a rider holds — from within 1 unit short of it, or
  // anywhere past it. Theory of Everything 2 f8815: a ship thrusting up at 398
  // snaps 0.58 up onto a 2:1 ceiling wedge's line and then slides along it;
  // the port used to bump only once its centre was deep inside the solid, and
  // flew straight through. (A 2-unit reach was worse.)
  if (bump) {
    // how far short of the ride line the player still is (negative: past it)
    const short = (target - py) * (solidBelow ? -1 : 1);
    // The ride line moves too, at speed x gradient as the player travels. A
    // wedge whose underside comes down faster than the ship falls overtakes
    // it (Deadlocked f4314: a mini ship falling at -179 under a 45° wedge
    // descending at -387 is pushed down along it) — but only once the line
    // has actually passed the ship; the 1-unit reach is for a ship moving
    // toward the wedge itself.
    // (the unclamped line: `slopeSurfaceY` reads flat off the tile's span, which
    // stalled the tile hand-off — Hexagon Force f8892)
    const lineVel = (slopeLineY(c, px + 1) - slopeLineY(c, px)) * speed;
    const self = yVel * (solidBelow ? -1 : 1) > 0;
    const closing = (yVel - lineVel) * (solidBelow ? -1 : 1) > 0;
    const reach = self ? 1 : 0;
    if (closing && short <= reach && short > -(half + c.hh)) {
      return { result: "bump", landY: target };
    }
  }
  const inside = (py - surface) * (solidBelow ? 1 : -1) < 0;
  if (inside && Math.abs(py - surface) > half - innerHalf) {
    if (bump) return { result: "bump", landY: target };
    return { result: "death", landY: py };
  }
  return { result: "none", landY: py };
}

/**
 * Two oriented boxes (`OBB2D::overlaps1Way` both ways: the four face axes).
 * `a` is the player's box turned by `angle` (radians, CCW).
 */
export function obbTouches(
  a: Box, angle: number, o: Box & { obb?: Collider["obb"] },
): boolean {
  const ob = o.obb ?? { hw: o.hw, hh: o.hh, cos: 1, sin: 0 };
  const A = { cos: Math.cos(angle), sin: Math.sin(angle), hw: a.hw, hh: a.hh };
  const dx = o.x - a.x, dy = o.y - a.y;
  for (const [ux, uy] of [[A.cos, A.sin], [-A.sin, A.cos], [ob.cos, ob.sin], [-ob.sin, ob.cos]]) {
    const d = Math.abs(dx * ux + dy * uy);
    const ra = A.hw * Math.abs(A.cos * ux + A.sin * uy) + A.hh * Math.abs(-A.sin * ux + A.cos * uy);
    const rb = ob.hw * Math.abs(ob.cos * ux + ob.sin * uy) + ob.hh * Math.abs(-ob.sin * ux + ob.cos * uy);
    if (d > ra + rb) return false;
  }
  return true;
}

/** `rectIntersectsCircle` — nearest point on the rect to the centre */
export function rectHitsCircle(r: Box, cx: number, cy: number, radius: number): boolean {
  const dx = Math.max(Math.abs(cx - r.x) - r.hw, 0);
  const dy = Math.max(Math.abs(cy - r.y) - r.hh, 0);
  return dx * dx + dy * dy < radius * radius;
}

export function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;
}

/**
 * A dynamic collider moved to `x, y` and turned by `rot` radians CCW.
 *
 * A **circle** needs nothing beyond the new centre, which is the case that
 * matters: everything Fingerdash rotates is a fireball. A rectangle turns its
 * oriented box with it, synthesising one if it had none, and the enclosing AABB
 * is widened to match so the column index still finds it.
 *
 * APPROXIMATION, and the only one here: a **solid** keeps its axis-aligned box,
 * because `resolveSolid` has no oriented form. 12 objects in L22 are affected
 * and nothing else in the 22 levels is.
 */
function rotated(c: Collider, x: number, y: number, rot: number, lockRot: boolean): Collider {
  const out: Collider = { ...c, x, y };
  if (c.radius !== undefined || lockRot || c.kind !== "hazard") return out;
  const ca = Math.cos(rot), sa = Math.sin(rot);
  const base = c.obb ?? { hw: c.hw, hh: c.hh, cos: 1, sin: 0 };
  const cos = base.cos * ca - base.sin * sa;
  const sin = base.sin * ca + base.cos * sa;
  out.obb = { hw: base.hw, hh: base.hh, cos, sin };
  out.hw = Math.abs(cos) * base.hw + Math.abs(sin) * base.hh;
  out.hh = Math.abs(sin) * base.hw + Math.abs(cos) * base.hh;
  return out;
}

/** Outer player rectangle against the hazard's sourced circle/rectangle. */
/**
 * Level-header key `kA39` (`LevelSettingsObject` +0x1c7, read in
 * `objectFromDict` m1 0xe17cc): round hazards are met circle-vs-circle.
 * Of the main levels only Dash sets it.
 */
export function circleVsCircle(level: Level): boolean {
  return /(?:^|,)kA39,1(?:,|$)/.test(level.rawHeader);
}

export function hitsHazard(player: Box, hazard: Collider): boolean {
  // `playerCircleCollision` (m1 0xfbe18): with the level's flag set it is
  // `ccpDistance(player, object) <= getObjectRadius() + playerRect.width / 2`,
  // otherwise the rect-vs-circle test below
  if (hazard.circle && hazard.radius !== undefined) {
    return Math.hypot(player.x - hazard.x, player.y - hazard.y) <= hazard.radius + player.hw;
  }
  if (hazard.radius !== undefined) {
    return rectHitsCircle(player, hazard.x, hazard.y, hazard.radius);
  }
  return touchesRect(player, hazard, false);
}

/**
 * The player's box against an object's rectangle, turned or not. The world
 * axes are two of the four separating axes, and the enclosing AABB gives
 * exactly those projections; angled rectangles also need their local axes.
 *
 * **Portals, orbs and pads count touching edges** (`inclusive`, the default),
 * as `CCRect::intersectsRect` does: Stereo Madness f17617, the real cube's
 * right edge sits exactly on the ship portal's left edge (22918.0) and the
 * portal applies on that frame. Hazards keep the strict test — the runs cannot
 * tell the two apart there.
 */
/** the player's rect taken in a tilted object's own frame (inclusive edges) */
export function touchesInObjectFrame(player: Box, o: Box & { obb?: Collider["obb"] }): boolean {
  const ob = o.obb;
  if (!ob) return touchesRect(player, o);
  const dx = player.x - o.x, dy = player.y - o.y;
  return Math.abs(dx * ob.cos + dy * ob.sin) <= ob.hw + player.hw
    && Math.abs(-dx * ob.sin + dy * ob.cos) <= ob.hh + player.hh;
}

export function touchesRect(
  player: Box, o: Box & { obb?: Collider["obb"] }, inclusive = true,
): boolean {
  if (inclusive
    ? !(Math.abs(player.x - o.x) <= player.hw + o.hw && Math.abs(player.y - o.y) <= player.hh + o.hh)
    : !overlaps(player, o)) return false;
  const obb = o.obb;
  if (!obb) return true;
  const dx = player.x - o.x, dy = player.y - o.y;
  const ac = Math.abs(obb.cos), as = Math.abs(obb.sin);
  return Math.abs(dx * obb.cos + dy * obb.sin) < obb.hw + player.hw * ac + player.hh * as
    && Math.abs(-dx * obb.sin + dy * obb.cos) < obb.hh + player.hw * as + player.hh * ac;
}

// ---------------------------------------------------------------------------
// Solid-block resolution
//
// The original game gives the player two boxes: a 30x30 outer box that decides
// landing, and a much smaller inner box that is the only thing that can kill.
// The "am I on top of this?" test uses probe edges pulled 10 units inward from
// the player's top and bottom, which is what lets you catch the upper corner of
// a block and get clipped up onto it instead of dying.
//
// Net effect: the player may be embedded up to 11.25 units below a block's top
// and still land on it. The inset decides whether the landing branch runs at
// all; the inner box decides whether being there is fatal, so the tolerance is
// PLAYER_HALF - PLAYER_INNER_HALF, not something involving CLIP_INSET.
// ---------------------------------------------------------------------------

/**
 * How far above a ramp's surface the player is still held down to it, while
 * already riding it (`slideStickiness = slidingDown * 4` in the original; it is
 * 1 on the first contact frame, which we do not model separately). This is what
 * stops a descent reading as a staircase — see `resolveSlope`.
 */
export const SLOPE_STICK_RIDING = 4;

/**
 * A slope snap zeroes the player's vertical velocity, but the original puts it
 * straight back if it was a real upward move:
 *     float yVel = m_yVelocity; hitGround(object, false);
 *     if (yVel > 5.0f) setYVelocity(yVel, 0);
 * 5.0 raw is `54 * 5` in world units. A cube jump is 11.18 raw (603 u/s), well
 * clear of it, so this is the second safeguard behind the velocity gate on the
 * stick band: even if a ramp does claim a jumping player, the jump survives.
 */
export const SLOPE_KEEP_VEL = 270;

/** half of the 30x30 collision box — this is also the box hazards kill with */
export const PLAYER_HALF = 15;
/**
 * Half of the inner box — the only part that dies to a **solid**, and never
 * consulted for a hazard.
 *
 * `PlayerObject::collidedWithObjectInternal` gates its `destroyPlayer` on
 * `getObjectRect(0.3, 0.3)`, and `getObjectRect(w, h)` multiplies the object's
 * size about its centre, so this is 30 * 0.3 = **9x9**, half 4.5. Every hitbox
 * visualiser mod in the wild draws it as `0.25` (7.5x7.5) instead, which is
 * what this port used; the decompiled game says 0.3, so that is what we follow.
 */
export const PLAYER_INNER_HALF = 4.5;
/** how far the landing probe edges sit inside the player box (6 for ship) */
export const CLIP_INSET = 10;

export type SolidResult =
  /** snapped on top of the block (caller should zero yVel and ground the player) */
  | "land"
  /** ship/UFO only: clamped against the underside of a ceiling block */
  | "bump"
  /** the inner box is inside the block */
  | "death"
  /** touching, but not enough to matter */
  | "none";

/**
 * Resolve one overlapping solid.
 * `g` is the gravity sign (+1 normal, -1 flipped). Returns what happened; the
 * caller applies it. `landY` is where the player's centre should go on
 * "land"/"bump". `sizeScale` shrinks the player boxes for mini mode; `bump`
 * (ship/UFO) turns rising into a block's underside into a ceiling slide
 * instead of a death.
 */
export function resolveSolid(
  px: number, py: number, yVel: number, c: Collider, g = 1,
  inset = CLIP_INSET, sizeScale = 1, bump = false, moving = false,
): { result: SolidResult; landY: number } {
  const top = c.y + c.hh;
  const bottom = c.y - c.hh;
  const half = PLAYER_HALF * sizeScale;
  const innerHalf = PLAYER_INNER_HALF * sizeScale;
  // the surface the player lands on, and the leading edge that must clear it
  const surface = g > 0 ? top : bottom;
  const probe = py + g * (half - inset);
  const falling = yVel * g <= 0;

  // The inner box is a **rect**, and the original's one check of it
  // (`collidedWithObjectInternal`'s tail) intersects it on both axes. Testing
  // only the vertical overlap in the landing branch turned a deep landing on a
  // block's near edge into a death: in Polargeist the real run drops onto the
  // block at (15053, 45) with its bottom 11 units past the top and 0.7 units of
  // horizontal overlap, and the game lifts it onto the block — we killed it,
  // because 11 units is just past where a vertical-only test starts matching.
  //
  // Running into a block's side is still fatal: the landing branch needs the
  // player's underside to have reached the block's *top*, which a player level
  // with a wall never satisfies, so it falls through to the same two-axis test
  // below and dies once it has penetrated far enough — which is what the
  // original visibly does.
  const innerHits = Math.abs(py - c.y) < innerHalf + c.hh
    && Math.abs(px - c.x) < innerHalf + c.hw;

  if (falling && (probe - surface) * g >= 0) {
    if (innerHits) return { result: "death", landY: py };
    return { result: "land", landY: surface + g * half };
  }

  // ship/UFO ceiling: rising into the underside slides along it, same probe
  // rule mirrored onto the block's other face (cube/ball/… die instead). The
  // centre must be on the gravity side of the block centre, otherwise a ship
  // grazing the top while rising would be snapped below the block.
  if (bump && (py - c.y) * g < 0) {
    const ceil = g > 0 ? bottom : top;
    // The mirror of the landing rule, measured from the player's *other*
    // side: the bump holds while the centre is no deeper than
    // `half - inset` past the underside. Reusing the landing probe unchanged
    // asked the opposite — the ship had to be 6 units *into* the ceiling
    // before it bumped, three frames late: Theory of Everything frame 2046,
    // the real ship clamps to y=165 the first frame its top crosses 180.
    const probeUp = py - g * (half - inset);
    // Falling, it is pushed on down only by an underside that caught it up
    // from above, which only a trigger-moved block can do (Deadlocked f21509:
    // group 55 eases down faster than the UFO's 345.6 cap and pushes it 1.15
    // below its fall). A falling player in a static underside came in from
    // the side, and the original leaves it (ToE f13668: 0.1 into the block,
    // 0.43 across, it falls on untouched).
    const under = ceil - g * half;
    // (a player at rest counts as rising here: ToE 2 f8832, a ship pushed up
    // the underside of a ramp — its velocity zeroed by the ramp — is pushed
    // back down by the thin block it rides into)
    const fallingAway = yVel * g < 0;
    if ((ceil - probeUp) * g >= 0 && (!fallingAway || (moving && (py - under) * g > 0))) {
      if (innerHits) return { result: "death", landY: py };
      return { result: "bump", landY: under };
    }
  }

  return { result: innerHits ? "death" : "none", landY: py };
}
