// The whole per-step game rule set — physics, collision, portals/orbs/pads —
// as a pure function over a snapshot-able state.
//
// `playLevel.ts` used to own this inline. It lives here instead so that it can
// be run *without a browser*: the autopilot (`scripts/autoplay.mjs`) clones a
// SimState and rolls it forward thousands of times per decision to search for
// an input sequence that survives. Anything that touches rendering, input
// devices or the DOM stays in the scene; anything that decides where the player
// ends up belongs here.
//
// Invariant worth protecting: the scene must not duplicate any rule from this
// file. If the autopilot and the real game ever disagree, this is the only
// place they can disagree about.
import {
  NATIVE_SLOPES, NATIVE_DT, DIED, newNativeSlopeState, cloneNativeSlope, nativePreCollision,
  nativePostCollision, slopeHost, slopeObjectFor, slopePlayerView, type SlopeOutcome,
} from "./nativeSlope.ts";
import { collidedWithSlopeInternal, slopeCoveredFaces, type SlopePlayer } from "../gd/slopeCollision.ts";
import type { SlopeObject } from "../gd/slopeCollision.ts";
import {
  CollisionWorld, nearSlope, obbTouches, touchesInObjectFrame, overlaps, hitsHazard, touchesRect, hitsSlopeWall, resolveSolid, resolveSlope,
  slopeGradient, slopeLaunchVelocity, slopeUphill, CLIP_INSET, SLOPE_KEEP_VEL, SPECIAL_BLOCKS,
  type Box, type Collider, type Interactive,
} from "./collision.ts";
import {
  PLAYER_SIZE, MINI_SCALE, KILL_HEIGHT, snapRotation, gravitySign, flipGravity,
} from "../gd/physics.ts";
import { bandFor, cameraCenterForDualBall, cameraCenterForPortal } from "../gd/camera.ts";
import { hitboxScale, speedConstants, SPEED_PHYSICS, SPEEDS, RAW_VELOCITY } from "../gd/physics.ts";
import { freshPlayer, stepPlayer, stopDash, type Gamemode, type PlayerState, type StepInput } from "../gd/gamemodes.ts";
import {
  applyPortal, activateOrb, activatePad, spiderTeleport, spiderOrbJump, SPIDER_SIZE, GAMEMODE_PORTALS, type RunState,
} from "../gd/interactives.ts";
import { checkSnapJump } from "../gd/snapjump.ts";
import { easedValue } from "../gd/easing.ts";
import { LocalWorld, boxToWorld, isIdentity, toLocal, toWorld, viewFor, type WorldView } from "./frame.ts";
import {
  buildTriggers, buildCollisionBlocks, cloneRuntime, createRuntime, resetRuntime,
  restoreRuntime, updateTriggers, fireTouchTriggers, fireOnDeath, groupState,
  pairKey, pairA, pairB, addItemCount,
  handleBlockCollision, activateCustomRing, groupAnchor,
  type CollisionBlock, type RotateRequest, type Trigger, type TriggerRuntime,
} from "../gd/triggers.ts";
import type { Level } from "../gd/level.ts";
import { P, propBool, propFloat, propInt } from "../gd/props.ts";
import { endTriggerX, lastObjectX, levelLength } from "../gd/levelEnd.ts";

/** the game steps physics at this fixed rate */
export const STEP_HZ = 240;
export const STEP = 1 / STEP_HZ;

/**
 * Never simulate more than this much wall-clock time in one call to
 * `advanceFixedSteps` (the scene clamps `frame` to this before passing it
 * in). Without it, a long stall — a backgrounded tab, a slow device, a
 * debugger pause — would demand a burst of hundreds of catch-up steps the
 * instant the tab regains focus; capping the catch-up to 60 steps (0.25 s)
 * means the sim visibly "loses" the stalled time rather than fast-forwarding
 * through it.
 */
export const MAX_FRAME = 0.25;

/**
 * The fixed-step accumulator that decouples the sim's rate (240 Hz, always)
 * from however often the caller is woken up to advance it. The scene's
 * `requestAnimationFrame` loop calls this once per drawn frame with however
 * many seconds of wall time that frame covered (already clamped to
 * `MAX_FRAME` by the caller, so a stall does not demand a huge catch-up);
 * a 60 Hz display passes ~1/60 s a call, a 120 Hz one ~1/120 s twice as often,
 * and either way `step()` runs once per whole STEP that fits, with the
 * remainder carried in the returned accumulator. The same number of physics
 * steps — and so the same simulation result — comes out however often the
 * caller wakes, which is the whole point: render rate must never change
 * gameplay. `step()` returns `false` to stop early (the sim died mid-run).
 */
export function advanceFixedSteps(acc: number, frame: number, step: () => boolean | void): number {
  acc += frame;
  while (acc >= STEP) {
    acc -= STEP;
    if (step() === false) break;
  }
  return acc;
}

const HALF0 = PLAYER_SIZE / 2;

/** everything an attempt needs; `clone()` must copy all of it */
export interface SimState {
  player: PlayerState;
  /**
   * The player's last step was a jump rather than a movement (portal or spider
   * teleport); the next trigger update hands it to the lock-to-player moves
   * (`updateTriggers`' `teleported`), which then ignore that step's y movement.
   */
  teleportedStep?: boolean;
  run: RunState;
  dead: boolean;
  /** portals fire once per attempt */
  usedPortals: Set<number>;
  /**
   * Breakable blocks (`GameObjectType` 21) smashed this attempt, by collider
   * index. They stay solid until the moment they would have killed the player,
   * then break and are gone for the rest of the attempt — see `Collider.breakable`.
   */
  destroyed: Set<number>;
  /**
   * Presentation events this step produced, for the scene to draw. The sim
   * still holds no presentation rule — this only says *that* an orb fired and
   * which one, which the scene previously had to guess by diffing `usedOrbs`.
   * That guess missed every key-99 orb, because a multi-activate orb is never
   * added to the set (A13).
   *
   * Cleared at the top of every `simStep`, so it never grows: the scene drains
   * it inside its own stepping loop, and the autopilot simply ignores it.
   */
  effects: SimEffect[];
  /**
   * Interactive indices the player was inside **last step**.
   *
   * This must be a set rebuilt every step, not a sticky map. A map keyed by
   * index is only refreshed for interactives currently near the player, so an
   * entry set to `true` while passing one stays `true` forever once the player
   * moves away in x — and that interactive can never fire again. Level 20's
   * teleport lands you on two pads you have already grazed on the way in, and
   * they silently refused to launch.
   */
  touching: Set<number>;
  collected: Set<number>;
  /** was the player overlapping an orb last step (see StepInput.onOrb) */
  onOrb: boolean;
  /**
   * `_touchedRingObject`: the ring the collision pass last saw, or null. The
   * jump it causes runs at the top of the *next* step — see `fireTouchedOrb`.
   */
  touchedOrb: Interactive | null;
  /**
   * `m_lastGroundObject`, when it is a trigger-moved solid: the collider the
   * player last landed on and where it was then. A grounded player is carried
   * by that object's movement — see `carryOnGround`.
   */
  ground: { index: number; y: number } | null;
  /**
   * Orbs already spent during the current touch. An orb fires **once** no
   * matter how many times you click it while overlapping — releasing and
   * re-pressing on the same orb must not fire it again. Entries clear when the
   * player leaves the orb, and orbs with the multi-activate flag (key 99) are
   * never added.
   */
  usedOrbs: Set<number>;
  /**
   * Was the player overlapping any pad at the end of last step? A gravity pad
   * refuses to fire while the player is already on a pad
   * (`if (player->_touchedPadObject) break;`). Levels place gravity pads in
   * overlapping pairs; without this both fire, the two flips cancel, and the
   * pair appears to do nothing at all.
   */
  onPad: boolean;
  /**
   * Why the attempt ended, for tooling only (the autopilot prints it). Not
   * cloned-sensitive: it is overwritten on every death.
   */
  deathCause?: { reason: string; id: number; x: number; y: number };
  /**
   * Rolling log of what actually fired (portals, orbs, pads, teleports) with
   * the state at the time. Tooling only — `?debug=1` shows the last few. This
   * exists because "the pad did not fire" and "the pad fired but the launch was
   * wrong" look identical from the outside, and reproducing a player's exact
   * entry velocity by guesswork does not work.
   */
  events?: { what: string; x: number; y: number; yVel: number }[];
  /** M5: live trigger state, or undefined for a level with no triggers */
  triggers?: { list: Trigger[]; rt: TriggerRuntime; level: Level; blocks: CollisionBlock[] };
  /**
   * `m_levelLength` — the percentage denominator and where the end portal
   * stands (`levelEnd.ts`). `Infinity` for a sim built without a level.
   */
  levelLength: number;
  /** a trigger-moved ceiling the flier bumped last step (see the ceiling carry) */
  ceiling?: { index: number; y: number; py: number; hw: number; anyMode?: boolean };
  /**
   * `m_lastGroundObject` (+0x600) as `postCollision`'s stick check uses it:
   * the solid the player last landed on, and whether it was a moving one.
   */
  stick?: { index: number; moving: boolean };
  /** above this the player dies (`killHeightFor`) */
  killHeight: number;
  /** 2.2 force blocks (2069), world boxes — see `applyForceBlocks` */
  forces?: ForceBlock[];
  /**
   * The level's end has triggered (`PlayLayer::checkForEnd`): the player is
   * locked (`PlayerObject::lockPlayer`) and the scene animates the rest. From
   * here no rule runs for the player — it cannot move, jump or die. The
   * trigger runtime keeps going, as the original's does.
   */
  ended: boolean;
  /**
   * The ending came from a 2.2 End trigger (3600), not the end portal: the
   * real player just stays where it locked (Dash f21714 on, no pull).
   */
  endByTrigger?: boolean;
  /**
   * Jumps made this attempt, both players together: every ground jump of the
   * cube, robot and ball (`updateJump` +5724 → `incrementJumps`) and every orb
   * that fires (`ringJump` +1604). Pads, UFO flaps, swing flips and spider
   * teleports do not count. `PlayLayer::incrementJumps` (m1 `0xabd0c`) keeps
   * these on `PlayLayer`, not the player, so a practice checkpoint does not
   * rewind them: `restoreSim` leaves this field alone.
   */
  jumps: number;
  /**
   * Physics steps this attempt (`GJGameState::m_currentProgress`, layer
   * +0x3b8): a timestamped level's percentage is these over its timestamp
   * (`gd/levelEnd.ts` `progressPercent`). Part of the game state, so unlike
   * `jumps` a checkpoint rewinds it.
   */
  steps: number;
  /**
   * The dual partner (player 2), present only between a dual portal (286) and
   * the next solo portal (287). It is a full `SimState` so it carries its own
   * touched/used/pad state, but it **shares** this one's trigger runtime and
   * `destroyed` set — see `simStep`.
   */
  dual?: SimState;
}

/** one thing the sim did that the scene may want to draw */
export interface SimEffect {
  kind: "orb" | "coin" | "collect";
  /** Player slot, including events raised synchronously by simPress. */
  player: 0 | 1;
  /** Index into level.objects (not the interactive index). */
  obj: number;
  /** object id, so the scene can pick the wave's colour and radius */
  id: number;
  /** index into `CollisionWorld.interactives` */
  index: number;
  /** Resolved world coordinates at the event, including moving groups. */
  x: number;
  y: number;
}

/**
 * APPROXIMATION: Camera Static (1914) on y carries the free-fly band's centre
 * onto its target group, over the trigger's duration and easing. 2.2's
 * `checkCollisions` (m1 0xfe36c) takes the bounds from the camera — centre
 * ± half the view over the zoom, floor at 90 — when a camera mode is active;
 * which flag selects that path is not decoded, nor the zoom term. Evidence:
 * Dash f16012-16238 is the only stretch of any native run outside the
 * portal band, and it starts as the static camera at (17775, 1275) eases
 * onto y 765. Only y-only statics (key 101 = 2) do it: Dash's both-axis ones
 * at x=7965 moved the band where the native ball was never clamped.
 */
function followStaticCamera(s: SimState, cam: NonNullable<TriggerRuntime["cameraStatic"]>) {
  const target = groupAnchor(s.triggers!.level, s.triggers!.rt, cam.group);
  if (!target) return;
  const p = s.player;
  cam.from ??= p.cameraYCenter;
  const k = cam.dur > 0 ? easedValue(Math.min(1, cam.t / cam.dur), cam.type, cam.rate) : 1;
  p.cameraYCenter = cam.from + (target.y - cam.from) * k;
  if (s.dual) s.dual.player.cameraYCenter = p.cameraYCenter;
}

/**
 * The ship's sprite angle (`updateShipRotation` m1 0x382970 →
 * `updateRotation(dt, r)` m1 0x37a590): it eases toward the angle of the
 * step's own movement by `t = min(m_playerSpeed x 0.175 x 0.5 x dt, dt)`,
 * dt in 60 Hz frames, and does not retarget when the move is tiny.
 * Used for the ship's box against tilted hazards: Hexagon Force f20740, the
 * real ship slips past a 48-degree spike its upright box clips by 0.93.
 */
function easeShipRotation(p: PlayerState, dx: number, dy: number, dt: number, speed: number, modeMult = 0.5) {
  // dt as the whole 60 Hz frame: the rotation is handed the frame's delta on
  // every physics substep (the per-substep 0.25 eases 4x too slowly — it
  // leaves Hexagon Force f20740's ship clipping the spike; 1.0 clears it,
  // resync 33 -> 32). APPROXIMATION: inferred, not read from the caller.
  // the wave fits the substep dt as decoded (Deadlocked f17894: the 45° solo
  // portal is met while the wave is still turning); the ship needs 4x that
  const frames = modeMult === 1 ? dt * 60 : 1;
  if (dx * dx + dy * dy < 1.2 * frames * (dt * 60) ** 2) return;
  const target = Math.atan2(dy, dx);
  const row = SPEED_PHYSICS.find((r) => Math.abs(r.xVel * r.mult * 60 - speed) < 0.01) ?? SPEED_PHYSICS[1];
  // The wave has its own rate in `updateShipRotation` (m1 0x382bb0): 0.25 per
  // 60 Hz frame at normal size, 0.4 when mini (`[0x9a0] != 1`), a quarter of
  // that while it slides on the ground (`[0x650]`, 0x382cbc) — not the ship's
  // speed-scaled one. The turn is a slerp (m1 0x22515c) along the shorter arc.
  // Theory of Everything 2 f20490 (native capture 2026-09-29): the mini wave
  // must be most of the way round to its new path to miss portal 12.
  const t = modeMult === 1
    ? Math.min((p.mini ? 0.4 : 0.25) * (p.onGround ? 0.25 : 1) * frames, frames)
    : Math.min(row.mult * 0.175 * modeMult * frames, frames);
  const cur = p.shipRot ?? 0;
  let d = target - cur;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  p.shipRot = cur + d * t;
}

interface ForceBlock { x: number; y: number; hw: number; hh: number; force: number; id: number }

/**
 * 2.2's force block (2069, `ForceBlockGameObject`: key 149 `m_force`). While
 * the player overlaps one it is pushed along the block's up direction by
 * `force x 0.9` raw per 60 Hz frame, added after the terminal clamp: Dash
 * (21555, 2543.78), force 4.2 — the real flipped cube gains exactly 51.03 a
 * 240 Hz step (4.2 x 0.9 x 54 / 4) on top of its gravity and tops out at
 * 861 = 810 + 51. All 13 in the main levels (Dash only) are unrotated and
 * absolute; `m_relativeForce`/ranges (keys 526-529) are not modelled.
 */
function forceBlocksOf(level: Level): ForceBlock[] {
  const out: ForceBlock[] = [];
  for (const o of level.objects) {
    if (o.id !== 2069) continue;
    const scale = propFloat(o.props, P.SCALE, 1);
    const sx = o.props.has(128) ? propFloat(o.props, 128, 1) : scale;
    const sy = o.props.has(129) ? propFloat(o.props, 129, 1) : scale;
    out.push({ x: o.x, y: o.y, hw: 15 * sx, hh: 15 * sy, force: propFloat(o.props, 149, 0), id: propInt(o.props, 530, 0) });
  }
  return out;
}

/**
 * APPROXIMATION: the height above which the player is destroyed. The 2.1-era
 * reference gave a fixed 1290 (`KILL_HEIGHT`), but the 2.2 binary's
 * `checkCollisions` (m1 0xfe188) holds no such constant, and Dash's native run
 * climbs to y 2807 (f13836, a linked teleport to 1815 and on up) alive. Until
 * the real limit is decoded it sits a screen above the level's tallest object,
 * never lower than 1290.
 */
function killHeightFor(level?: Level): number {
  if (!level) return KILL_HEIGHT;
  let top = 0;
  for (const o of level.objects) if (o.y > top) top = o.y;
  return Math.max(KILL_HEIGHT, top + 320);
}

export function createSim(startX: number, startSpeed: number, level?: Level): SimState {
  return {
    levelLength: level ? levelLength(lastObjectX(level)) : Infinity,
    killHeight: killHeightFor(level),
    forces: level ? forceBlocksOf(level) : undefined,
    ended: false,
    jumps: 0,
    steps: 0,
    triggers: level
      ? {
        list: buildTriggers(level), rt: createRuntime(level), level,
        blocks: buildCollisionBlocks(level),
      }
      : undefined,
    player: {
      ...freshPlayer(startX, HALF0),
      kA32: !!level && /(?:^|,)kA32,1(?:,|$)/.test(level.rawHeader),
      fixRobotJump: !!level && /(?:^|,)kA34,1(?:,|$)/.test(level.rawHeader),
      squeeze: !!level && /(?:^|,)kA31,1(?:,|$)/.test(level.rawHeader),
    },
    run: {
      speed: startSpeed, mirrored: false, coins: 0,
    },
    dead: false,
    usedPortals: new Set(),
    destroyed: new Set(),
    effects: [],
    touching: new Set(),
    collected: new Set(),
    usedOrbs: new Set(),
    onOrb: false,
    touchedOrb: null,
    ground: null,
    onPad: false,
  };
}

/** reset in place, so the scene can keep its object identities */
export function resetSim(s: SimState, startX: number, startSpeed: number) {
  Object.assign(s.player, freshPlayer(startX, HALF0), { kA32: s.player.kA32, fixRobotJump: s.player.fixRobotJump, squeeze: s.player.squeeze });
  s.run.speed = startSpeed;
  s.run.mirrored = false;
  s.run.coins = 0;
  s.dead = false;
  s.ended = false;
  s.jumps = 0;
  s.steps = 0;
  s.deathCause = undefined;
  s.onOrb = false;
  s.touchedOrb = null;
  s.ground = null;
  s.onPad = false;
  s.dual = undefined;
  s.usedPortals.clear();
  s.destroyed.clear();
  s.effects.length = 0;
  s.usedOrbs.clear();
  s.touching.clear();
  s.collected.clear();
  if (s.triggers) resetRuntime(s.triggers.rt, s.triggers.level);
}

/** deep enough copy that rolling the copy forward cannot touch the original */
/** the routine's view of each slope collider, one per world (identity matters) */
const slopeCaches = new WeakMap<object, Map<number, SlopeObject>>();
function slopeCache(world: object): Map<number, SlopeObject> {
  let m = slopeCaches.get(world);
  if (!m) slopeCaches.set(world, m = new Map());
  return m;
}

export function cloneSim(s: SimState): SimState {
  const out: SimState = {
    levelLength: s.levelLength,
    killHeight: s.killHeight,
    forces: s.forces,
    ended: s.ended,
    endByTrigger: s.endByTrigger,
    jumps: s.jumps,
    steps: s.steps,
    player: s.player.ns ? { ...s.player, ns: cloneNativeSlope(s.player.ns) } : { ...s.player },
    run: { ...s.run },
    dead: s.dead,
    usedPortals: new Set(s.usedPortals),
    destroyed: new Set(s.destroyed),
    effects: s.effects.map((e) => ({ ...e })),
    usedOrbs: new Set(s.usedOrbs),
    touching: new Set(s.touching),
    collected: new Set(s.collected),
    onOrb: s.onOrb,
    touchedOrb: s.touchedOrb,
    ground: s.ground && { ...s.ground },
    ceiling: s.ceiling && { ...s.ceiling },
    stick: s.stick && { ...s.stick },
    onPad: s.onPad,
    deathCause: s.deathCause,
    triggers: s.triggers && {
      list: s.triggers.list,
      level: s.triggers.level,
      blocks: s.triggers.blocks,
      rt: cloneRuntime(s.triggers.rt),
    },
  };
  if (s.dual) {
    const dual = cloneSim(s.dual);
    // Preserve shared world state across the clone; otherwise the players
    // could collect the same item independently after branching or rewinding.
    dual.triggers = out.triggers;
    dual.destroyed = out.destroyed;
    dual.collected = out.collected;
    out.dual = dual;
  }
  return out;
}

/**
 * Restore a snapshot **in place**, so the scene keeps its object identities
 * (`sim.player` and `sim.run` are captured by reference all over `playLevel`).
 *
 * This is the inverse of `cloneSim` and exists for practice-mode checkpoints:
 * dying in practice rewinds the whole world — trigger state, smashed breakables
 * and spent portals included — to the moment the checkpoint was taken, not just
 * the player's position. Rewinding position alone leaves a level whose colour
 * triggers have already fired and whose breakables are already gone, which
 * plays differently from the first time through.
 *
 * `snap` must not be reused afterwards: the sets and the runtime are re-cloned
 * on every restore so that dying twice at one checkpoint restores the same
 * state twice.
 */
export function restoreSim(s: SimState, snap: SimState) {
  Object.assign(s.player, snap.player);
  Object.assign(s.run, snap.run);
  s.dead = snap.dead;
  s.ended = snap.ended;
  s.endByTrigger = snap.endByTrigger;
  // `jumps` is deliberately not restored — see its field note
  s.steps = snap.steps;
  s.deathCause = snap.deathCause;
  s.onOrb = snap.onOrb;
  s.touchedOrb = snap.touchedOrb;
  s.ground = snap.ground && { ...snap.ground };
  s.ceiling = snap.ceiling && { ...snap.ceiling };
  s.stick = snap.stick && { ...snap.stick };
  s.onPad = snap.onPad;
  copySet(s.usedPortals, snap.usedPortals);
  copySet(s.destroyed, snap.destroyed);
  s.effects.length = 0;
  for (const e of snap.effects) s.effects.push({ ...e });
  copySet(s.usedOrbs, snap.usedOrbs);
  copySet(s.touching, snap.touching);
  copySet(s.collected, snap.collected);
  if (s.triggers && snap.triggers) restoreRuntime(s.triggers.rt, snap.triggers.rt);
  if (snap.dual) {
    // the partner is re-created rather than restored in place: nothing outside
    // the sim holds a reference to it, and it may not have existed before
    const dual = cloneSim(snap.dual);
    dual.triggers = s.triggers;
    dual.destroyed = s.destroyed;
    dual.collected = s.collected;
    s.dual = dual;
  } else {
    s.dual = undefined;
  }
}

function copySet<T>(dst: Set<T>, src: Set<T>) {
  dst.clear();
  for (const v of src) dst.add(v);
}

/**
 * The button went down (GD `pushButton`). This *buffers* the press: it stays
 * live with no time limit until it is released or consumed, which is what lets
 * you hold early and have the jump or orb fire the moment it becomes possible.
 */
/**
 * Apply every portal the player would have passed to reach `x`.
 *
 * `?x=` drops the player straight into the middle of a level, but portals only
 * fire when you cross them — so without this you arrive as a default cube at
 * normal speed no matter what the section actually is. Level 20 at x=3300 is a
 * *wave* corridor; starting there as a cube looks exactly like a broken level
 * (you fall through everything and die), which is a debugging trap worth not
 * falling into twice.
 */
export function applyPortalsBefore(s: SimState, world: CollisionWorld, x: number) {
  if (x <= 0) return;
  const passed = world.interactives
    .filter((it) => (it.kind === "portal" || it.kind === "speed") && it.x <= x)
    .sort((a, b) => a.x - b.x);
  for (const it of passed) {
    s.usedPortals.add(it.index);
    // A dual portal behind us means we are *inside* a dual section, so the
    // partner has to exist here too — otherwise `?x=` drops you into a dual
    // corridor with half the players, which looks exactly like the section
    // being broken. (This is the debugging path; live play spawns it normally.)
    if (it.id === 286 && !s.dual) s.dual = spawnDual(s, it.y);
    else if (it.id === 287) s.dual = undefined;
    const anchor = s.player.cameraYCenter;
    applyPortal(it.id, it.props, s.player, s.run);
    // a dual keeps its own centre through gamemode portals, as in `stepOne`
    if (s.dual) s.player.cameraYCenter = anchor;
  }
  if (s.dual) s.dual.player.cameraYCenter = s.player.cameraYCenter;
  if (s.dual) s.dual.player.x = x;
  // a teleport in that list would have moved the player; keep the asked-for x
  s.player.x = x;
}

/**
 * The button went down — for **every** player under control.
 *
 * The dual partner has its own `PlayerState`, so it has its own `queuedHold`
 * and `justHeld`. Pressing only player 1 left the partner unable to do anything
 * that needs a *press* rather than a hold: **orbs, ball jumps, spider teleports
 * and UFO flaps all read `queuedHold`/`justHeld`**, while an ordinary cube jump
 * only reads `holding` — which is why the partner looked like it half-worked
 * (it ran and jumped) but "couldn't click orbs".
 */
export function simPress(s: SimState, world?: CollisionWorld, partner = false, root = s) {
  if (s.dual) simPress(s.dual, world, true, root);
  // an Options trigger (2899) has switched this player's controls off
  if (s.triggers?.rt.controlsOff[partner ? 1 : 0]) return;
  s.player.queuedHold = true;
  s.player.justHeld = true;
  s.player.freshPress = true;
  // `pushButton` +516 clears the ring flags, so each press may take one more
  // toggle orb
  s.player.usedCustomRing = false;
  // **The spider teleports inside `pushButton`, the moment the press arrives**
  // — not at the next step, as a cube's jump starts. Fingerdash f8321 and
  // every other spider flip in the native runs: the recorded position already
  // shows the flip on the press's own frame, one step before a cube's jump
  // would move. Callers with the collision world get this; without it the
  // buffered press still teleports at the top of the next step (`stepOne`).
  if (world && spiderCanTeleport(s)) {
    const p = s.player;
    const l = toLocal(p, p.x, p.y);
    p.x = l.x; p.y = l.y;
    spiderTeleport(p, viewFor(world, p), s.triggers?.rt);
    s.teleportedStep = true;
    const w = toWorld(p, p.x, p.y);
    p.x = w.x; p.y = w.y;
    s.player.queuedHold = false;
  } else if (world && s.touchedOrb?.id === 3004 && s.player.dash === 0) {
    // **The spider orb flips inside the press too.** Dash f10382: a cube over
    // the spider orb at (13965, 885) is on the ceiling on the press's own
    // frame, one step before an ordinary orb would fire.
    const p = s.player;
    const l = toLocal(p, p.x, p.y);
    p.x = l.x; p.y = l.y;
    fireTouchedOrb(s, true, root, viewFor(world, p), partner ? 1 : 0);
    s.teleportedStep = true;
    const w = toWorld(p, p.x, p.y);
    p.x = w.x; p.y = w.y;
  }
}

/**
 * A spider teleports only from the ground (Fingerdash f9386: a press made in
 * mid-air stays buffered and is spent on an orb five frames later), never
 * during a dash, and not while an orb has the press.
 */
function spiderCanTeleport(s: SimState): boolean {
  const p = s.player;
  return p.mode === "spider" && p.dash === 0 && !s.onOrb && !s.dead && !s.ended
    && p.onGround;
}

/** record an interaction for the debug readout */
function note(s: SimState, what: string) {
  if (!s.events) s.events = [];
  s.events.push({ what, x: s.player.x, y: s.player.y, yVel: s.player.yVel });
  if (s.events.length > 8) s.events.shift();
}

function die(s: SimState, reason: string, id: number) {
  s.dead = true;
  s.deathCause = { reason, id, x: s.player.x, y: s.player.y };
  note(s, `DIED ${reason}${id ? " id" + id : ""}`);
  // every on-death trigger (1812) the attempt armed fires now
  if (s.triggers) fireOnDeath(s.triggers.rt);
}

/**
 * Collision blocks (1816): move the dynamic ones with their groups, find every
 * pair of block ids that overlaps, and hand the enter/exit edges to the
 * registered collision triggers.
 *
 * `GJBaseGameLayer::updateCollisionBlocks` (m1 `0x102f6c`) runs once per step
 * and `checkCollisionBlocks` (`0x103718`) is a plain AABB test of the two
 * objects' rects, so that is what this is.
 */
function stepCollisionBlocks(s: SimState) {
  const t = s.triggers;
  if (!t || !t.blocks.length || !t.rt.collisions.length) return;
  const rt = t.rt;
  const now = new Set<number>();
  const live = t.blocks.map((b) => {
    let dx = 0, dy = 0, hidden = false;
    if (b.dynamic) {
      for (const g of b.groups) {
        const gs = groupState(rt, g);
        dx += gs.dx; dy += gs.dy;
        if (!gs.enabled) hidden = true;
      }
    }
    return { b, x: b.x + dx, y: b.y + dy, hidden };
  });
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i], B = live[j];
      if (A.hidden || B.hidden || A.b.block === B.b.block) continue;
      if (Math.abs(A.x - B.x) > A.b.hw + B.b.hw) continue;
      if (Math.abs(A.y - B.y) > A.b.hh + B.b.hh) continue;
      now.add(pairKey(A.b.block, B.b.block));
    }
  }
  for (const key of now) {
    if (rt.collidingPairs.has(key)) continue;
    handleBlockCollision(rt, pairA(key), pairB(key), false);
  }
  for (const key of rt.collidingPairs) {
    if (now.has(key)) continue;
    handleBlockCollision(rt, pairA(key), pairB(key), true);
  }
  rt.collidingPairs = now;
}

/**
 * One fixed physics step. `holding` is the current held state of the jump
 * input; a *fresh* press must additionally be announced with `simPress()`.
 * Sets `s.dead` instead of throwing; the caller decides what that means.
 */
/**
 * Build the dual partner at the moment a dual portal (286) fires.
 *
 * **The defining property of dual is that the two players have opposite
 * gravity** — hold the button and one rises while the other falls, which is
 * what every dual section is built around. So the partner starts as a copy of
 * player 1 with the gravity flag inverted.
 *
 * `gravityFlipped` is set **directly** here rather than through `flipGravity()`.
 * That function exists to model a mid-run flip and halves `yVel` as the original
 * does; this is not a flip, it is spawning a second player that was *always*
 * the other way up, so halving would be wrong.
 *
 * The partner is a **mirror image about the portal's own y**, not a copy at the
 * same spot. Level 16's first dual portal shows why: it sits at y=419 in a
 * corridor whose floor plates top out at y=360 and whose ceiling plates start at
 * y=480 — dead centre. Player 1 stands on the floor at y=375, and 375 mirrored
 * about 419 is 463, which is exactly where a flipped player stands under that
 * ceiling. Spawning the partner co-located instead put it inside the floor and
 * it died on contact within a few steps.
 *
 * NOT SOURCED: `GJBaseGameLayer::toggleDualMode` is compiled in every decompile
 * available, so this is inferred from how the levels are actually built rather
 * than read from the game. The symmetry above is strong evidence, and the
 * acceptance test is that the dual sections become passable.
 */
function spawnDual(s: SimState, portalY: number): SimState {
  const p = s.player;
  // The dual portal sits at the centre of the corridor it opens (that is what
  // makes the mirror work), so it is also the right **static** anchor for the
  // camera. Installing it on player 1 as well means the pair share one anchor
  // until each crosses its own gamemode portal. Without this a dual *cube*
  // section inherits whatever centre some earlier ship/ball portal left behind,
  // which can sit far below the corridor — the level then renders with the
  // ground in view and the section off-screen.
  //
  // The anchor is **quantised exactly as a flying-mode portal's is** (below 270
  // in GD space it snaps to 240, else to the 30-unit grid), not the portal's raw
  // y. Level 17's dual wave (portal y=165) proves it: the corridor is built
  // symmetric about y=150, the real player 1 rides its ceiling at 290 = 150 +
  // 140, and anchoring on 165 instead held player 2 on a band floor at 30 —
  // into the hazard at (15600, 31) that its true mirror (y=10) passes under,
  // so the partner died there on the real run's inputs.
  p.cameraYCenter = cameraCenterForPortal("ship", portalY)!;
  return {
    levelLength: s.levelLength,
    killHeight: s.killHeight,
    forces: s.forces,
    ended: false,
    jumps: 0,
    steps: 0,
    // **Player 2 starts exactly on player 1**, flipped, with its velocity
    // negated — every dual start in the native runs (Blast Processing f11818,
    // Deadlocked f17088, Hexagon Force f7047/f12686/f18349) has p2 at p1's
    // own (x, y) on the first frame. It used to be mirrored about the portal,
    // 88 units off on Hexagon Force's first dual.
    player: {
      ...p,
      gravityFlipped: !p.gravityFlipped,
      yVel: -p.yVel,
      // its own `PlayerObject`: never share player 1's slope state
      // (a fresh state measures the same: 21 either way)
      ns: p.ns && cloneNativeSlope(p.ns),
    },
    run: s.run,
    dead: false,
    usedPortals: new Set(s.usedPortals),
    // shared with player 1 on purpose — one world, one set of broken blocks
    destroyed: s.destroyed,
    effects: s.effects,
    touching: new Set(),
    collected: s.collected,
    usedOrbs: new Set(),
    onOrb: false,
    touchedOrb: null,
    ground: null,
    onPad: false,
    triggers: s.triggers,
  };
}

/**
 * Step **one** player. `simStep` wraps this and drives the dual partner too.
 *
 * `skipTriggers` exists because the trigger runtime is *shared* between the two
 * players and must advance exactly once per step — advancing it twice would
 * double every tween's speed. Player 1 owns that advance, which also matches
 * the original: triggers fire off player 1's x.
 */
/**
 * `ringJump`, run from `updateJump` at the top of the step — **not** from the
 * collision pass that touched the ring.
 *
 * It needs `_touchedRingObject && _queuedHold && m_bIsHolding`, and consumes the
 * queued hold. So: one orb per press, holding through a chain fires only the
 * first — but a press made *before* reaching the orb still works however early
 * it was, because the buffer never times out. That is the buffered-orb click.
 *
 * **The step it runs in is the whole point.** Firing it from the collision pass
 * instead — at the *end* of the step that touched the ring — costs a frame,
 * because the press that arrives for frame F is not visible until the top of
 * F + 1: the ring then fired at the end of F + 1 and the velocity only reached
 * a position on F + 2. One frame of a 600 u/s flip is 2.5 units, and it was
 * enough to clip a solid the real run passes.
 */
function fireTouchedOrb(
  s: SimState, holding: boolean, root: SimState, world?: WorldView,
  slot: 0 | 1 = s === root ? 0 : 1,
): boolean {
  const it = s.touchedOrb;
  const { player } = s;
  if (!it || !holding || !player.queuedHold || s.usedOrbs.has(it.index)) return false;
  // The **toggle orb** (1594, a `CustomRing`) is not a jump: `ringJump`
  // +616..652 sends it to `activateCustomRing` and returns without touching the
  // velocity, and +560..596 skips the flag that consumes the press — so an
  // ordinary orb in the same press still fires. Only one custom ring per press
  // (`[0x93c]`, cleared by `pushButton`).
  if (it.id === 1594) {
    if (!player.usedCustomRing) {
      player.usedCustomRing = true;
      s.usedOrbs.add(it.index);
      if (s.triggers) activateCustomRing(s.triggers.rt, it.props);
      root.jumps++;
      note(s, "toggle orb");
    }
    return false;
  }
  // 2.2's spider orb (3004, `GameObjectType` SpiderOrb) flips the player to
  // the surface along its gravity, as the spider's own jump does
  if (it.id === 3004 && world) {
    spiderOrbJump(player, world, s.triggers?.rt, it.props);
    player.holdSpent = true;
  } else if (!activateOrb(it.id, player, s.run.speed, it.props)) return false;
  player.queuedHold = false;
  root.jumps++;
  // the scene's activation wave — pushed here rather than diffed out of
  // `usedOrbs`, which a key-99 orb never enters
  root.effects.push({ kind: "orb", player: slot, obj: it.obj, id: it.id, index: it.index,
    ...toWorld(player, it.x, it.y) });
  // key 99 orbs may be re-used; every other orb is spent for as long as the
  // player stays on it
  if (!propBool(it.props, P.MULTI_ACTIVATE_ORB)) s.usedOrbs.add(it.index);
  note(s, `orb ${it.id}`);
  return true;
}

/**
 * A grounded player rides the trigger-moved solid under it (`m_lastGroundObject`
 * / `m_groundYVelocity`): its vertical movement since last step is added to the
 * player before the player moves. Geometrical Dominator f5813-5949: the real
 * ship sits on group 11's descending platform for 137 frames and follows its
 * easing exactly; without the carry it fell off on the first frame.
 */
function carryOnGround(s: SimState, world: WorldView, rt: TriggerRuntime | undefined): number {
  const g = s.ground;
  if (!g || !s.player.onGround || !rt) return 0;
  const now = world.placedCollider(g.index, rt);
  if (!now) { s.ground = null; return 0; }
  const d = now.y - g.y;
  s.player.y += d;
  g.y = now.y;
  return d;
}

/**
 * `PlayerObject::rotateGameplay` (m1 0x387c94): set the frame flags from the
 * trigger's keys, and — **only when the sideways flag changes** — hand the old
 * travel velocity to the gravity axis:
 *
 *   m_yVelocity = xVel            (plain)
 *   m_yVelocity = xVel * modY     (key 169 m_editVelocity, key 583 modY)
 *   m_yVelocity = modY            (key 584 m_overrideVelocity)
 *
 * `xVel` is read before the flags change (`m_xVelocity * m_playerSpeed`, raw
 * units per 1/60 s) and is a speed, never negative, so in port units it is
 * `0.9 * speed`: travel is raw * 60 per second, yVel raw * 54. Dash,
 * native: the trigger at (8247, 873) (modY 1.1, speed 387.42) leaves the ball
 * on +383.6, and the one at (6875, 795) (modY -1) leaves the robot on -348.7 —
 * both exactly 0.9 * 387.42 * modY; the spider at (2143.5, 135), travelling
 * *down* (reversed) with modY -1, falls onto the floor (f1817) — so no sign
 * for the reversal. When sideways does not change the velocity is left alone.
 */
/**
 * Whether `collisionCheckObjects` (m1 0xfea44) tests object `a` before `b`:
 * it walks x-sections, then y-sections, 100 units each (`[0x3488]`,
 * `[0x348c]` = 0.01, m1 0xeb400 / 0x128800), then each bucket in
 * `m_uniqueID` order, which follows the level order.
 */
function testedBefore(s: SimState, a: number, b: number): boolean {
  const lv = s.triggers?.level;
  const ao = lv?.objects[a], bo = lv?.objects[b];
  if (!ao || !bo) return a < b;
  const ax = Math.floor(ao.x / 100), bx = Math.floor(bo.x / 100);
  if (ax !== bx) return ax < bx;
  // APPROXIMATION (A47): the game sets the y size only when a level setting
  // asks for it (m1 0x128800 via 0xe17ac, flags +0x155/+0x1c5); taken as on
  // everywhere, in level coordinates (replay-neutral outside Dash)
  const ay = Math.floor(ao.y / 100), by = Math.floor(bo.y / 100);
  if (ay !== by) return ay < by;
  return a < b;
}

function rotateGameplay(s: SimState, r: RotateRequest) {
  const p = s.player;
  const wasSideways = p.sideways;
  const xVel = 0.9 * s.run.speed;
  p.sideways = r.ground === 3 || r.ground === 4;
  p.reversed = r.move === 2 || r.move === 3;
  // set through `flipGravity(…, noEffects = true)`: it stamps the flip time
  // and halves the velocity (only `[0x7a9]` skips that) — visible only when
  // sideways does not change, since otherwise the hand-off below overwrites it
  const flipped = r.ground === 1 || r.ground === 4;
  if (flipped !== p.gravityFlipped) {
    p.flipAge = 0;
    if (p.sideways === wasSideways) p.yVel /= 2;
  }
  p.gravityFlipped = flipped;
  if (p.sideways !== wasSideways) {
    p.yVel = r.override ? r.modY * 54 : r.edit ? xVel * r.modY : xVel;
    // The old band does not come back with the axes. Dash f6873: the ball
    // turns out of its sideways section at y 330 under a band anchored at 900
    // by the portal before it, and the real run falls on freely instead of
    // being clamped 465 up. Inferred from the run, not decoded: the band stays
    // off until a gamemode portal anchors a new one.
    p.bandless = true;
  }
  p.onGround = false;
  // a remembered moving platform was in the old frame
  s.ground = null;
}

/**
 * **A pad fires once per attempt** unless it is marked Multi Activate (key 99).
 * Fingerdash f7978: a flipped cube bouncing along a chain of blue pads comes
 * back up under the pad it used at f7948 and the real run does not fire it
 * again (the port re-armed pads the moment the player left them). The same
 * rule settles Clubstep f7074's upside-down blue pad. Resync faults 51 -> 48.
 * (Orbs tested the same way: no change either way, so they still re-arm.)
 */
function padSpent(s: SimState, it: Interactive): boolean {
  return s.usedPortals.has(it.index);
}
function spendPad(s: SimState, it: Interactive) {
  if (!propBool(it.props, P.MULTI_ACTIVATE_ORB)) s.usedPortals.add(it.index);
}

function stepOne(
  s: SimState, world: CollisionWorld, dt: number, holding: boolean,
  onDual?: () => void, skipTriggers = false, root: SimState = s,
) {
  const { player } = s;
  // Triggers advance before the player moves, so a trigger the player just
  // reached is already applied when collision runs this step.
  if (s.triggers && !skipTriggers) {
    // playerY matters for move triggers that lock to the player (key 59)
    updateTriggers(s.triggers.rt, s.triggers.list, player.x, dt * s.triggers.rt.timeWarp, player.y, !!s.teleportedStep);
    s.teleportedStep = false;
    // the blocks have just moved with their groups, so the collision triggers
    // see this step's positions
    stepCollisionBlocks(s);
  }
  if (player.flipAge !== undefined) player.flipAge += dt;
  const rt = s.triggers?.rt;
  if (rt?.cameraStatic && s.triggers) followStaticCamera(s, rt.cameraStatic);
  if (rt?.rotations.length) {
    for (const r of rt.rotations) rotateGameplay(s, r);
    // the partner shares the runtime and turns with player 1
    if (s.dual) for (const r of rt.rotations) rotateGameplay(s.dual, r);
    rt.rotations.length = 0;
  }
  // Above this the original destroys the player outright, whatever the mode.
  if (player.y > s.killHeight) { die(s, "kill-height", 0); return; }
  // Time Warp scales the step the player takes (set by the triggers just run)
  if (rt) dt *= rt.timeWarp;
  if (isIdentity(player)) {
    stepCore(s, world, dt, holding, onDual, skipTriggers, root);
    return;
  }
  const view = viewFor(world, player);
  const w = { x: player.x, y: player.y };
  const l = toLocal(player, w.x, w.y);
  player.x = l.x; player.y = l.y;
  try {
    stepCore(s, view, dt, holding, onDual, skipTriggers, root);
  } finally {
    const back = toWorld(player, player.x, player.y);
    player.x = back.x; player.y = back.y;
  }
}

/**
 * The step proper, in the player's gameplay frame: x is the direction of
 * travel and y the gravity axis (see `src/game/frame.ts`). In a normal level
 * that frame is the world's and `world` is the collision world itself.
 */
function stepCore(
  s: SimState, world: WorldView, dt: number, holding: boolean,
  onDual: (() => void) | undefined, skipTriggers: boolean, root: SimState,
) {
  const { player, run } = s;
  const rt = s.triggers?.rt;
  /** the world is turned: the ground plane and the free-fly band do not apply */
  const turned = player.sideways;
  // A ring touched last step jumps at the top of this one (`updateJump`)
  // **before** this step's release is applied: Hexagon Force frame 2002, the
  // real run's blue orb fires on the very frame the button comes up.
  let consumedByOrb = fireTouchedOrb(s, holding || player.queuedHold, root, world);
  // releasing the button drops the buffered press (GD `releaseButton`)
  if (!holding) { player.queuedHold = false; player.justHeld = false; }
  let consumed = false;

  // The spider's teleport needs the collision world, so it lives here.
  //
  // `!s.onOrb` is REASONED, not sourced: the cube's documented rule is that an
  // ordinary jump clears `_queuedHold` only *when no ring is touched*, so a
  // press made over an orb reaches the orb. The spider had no such guard and
  // its teleport ate every one of those presses, which is why Fingerdash could
  // never take the pink orb at (13275, 195) into the dash orb at (13359, 221).
  // Extending the same "rings take the press" rule to the spider takes L21 from
  // 58.7% to 100% and changes no other level's sweep result.
  if (holding && player.queuedHold && spiderCanTeleport(s)) {
    spiderTeleport(player, world, s.triggers?.rt);
    s.teleportedStep = true;
    player.queuedHold = false;
    consumed = true;
  }

  consumed = consumedByOrb || consumed;

  const input: StepInput = {
    holding, onOrb: s.onOrb, jumped: false, pressed: player.freshPress,
  };
  // one step only: the *next* step sees a button that was already down
  player.freshPress = false;
  // a player about to jump is not carried: `stepPlayer` must run first
  const wasOnGround = player.onGround;
  const preX = player.x, preY = player.y;
  consumed = stepPlayer(player, dt, run.speed, input) || consumed;
  // the collision pass sees the angle from before this step's turn: the game
  // turns the sprite after its collisions (ToE 2 f20490-20491, native capture)
  const rotForPass = player.shipRot ?? 0;
  if (player.mode === "ship" || player.mode === "wave") {
    easeShipRotation(player, player.x - preX, player.y - preY, dt, run.speed, player.mode === "ship" ? 0.5 : 1);
  } else player.shipRot = 0;
  // **The platform carries only a player who stays on it**: Dash f3105, an
  // upside-down cube jumps off a descending ceiling and the real jump is the
  // bare jump velocity, with none of the platform's 0.109 for that step.
  const carried = wasOnGround && player.onGround ? carryOnGround(s, world, rt) : 0;
  // **A moving ceiling pushes a flier pressed against it** (Deadlocked f6386:
  // a UFO that bumps the underside of group 11's descending block is carried
  // down with it — -237.9, -236.7, ... a step — instead of stopping)
  if (s.ceiling && rt && (player.mode === "ship" || player.mode === "ufo" || s.ceiling.anyMode)) {
    const c = s.ceiling;
    let now = world.placedCollider(c.index, rt);
    // sliding along the moving row: the next block of it takes over
    if (now) {
      const row = now.y; // the tracked block's row, this step
      const under = world.near({ x: player.x, y: row, hw: c.hw, hh: 1 }, rt)
        .find((o) => world.isDynamic(o.index) && Math.abs(o.y - row) < 0.01 && Math.abs(player.x - o.x) < o.hw + c.hw);
      if (under) {
        c.index = under.index;
        now = { x: under.x, y: under.y };
      } else now = null;
    }
    const d = now ? now.y - c.y : 0;
    // pinned under it, as a bump every step would leave it: the block's
    // motion from where it was pressed, not its own fall on top
    if (now && d * gravitySign(player) < 0 && (player.y - (s.ceiling.py + d)) * gravitySign(player) >= 0) {
      player.y = s.ceiling.py + d;
      // a ceiling pushing the player keeps it moving at least 1 raw toward
      // gravity: the native capture of Deadlocked (2026-09-29, `vseek`) reads
      // 0 on the bump (f6386), exactly -1.000 on the first pushed step, then
      // -1.101, -1.202, … — the port had -0.101, -0.202 and left the ceiling
      // 0.9 raw slow at f6412
      const gs = gravitySign(player);
      if (player.yVel * gs > -RAW_VELOCITY) player.yVel = -RAW_VELOCITY * gs;
      s.ceiling.y = now.y;
      s.ceiling.py = player.y;
    } else s.ceiling = undefined;
  } else s.ceiling = undefined;
  if (wasOnGround && !player.onGround) s.ground = null;
  // the jump counter belongs to the attempt, not the player, so the partner
  // counts into player 1's state
  if (input.jumped) root.jumps++;

  const g = gravitySign(player);
  const sizeScale = player.mini ? MINI_SCALE : 1;
  // Landing still uses the full-size box (the cube's 30x30 is what snaps onto
  // block tops); the *hitbox* that kills shrinks per gamemode.
  // the spider's box is 27, not 30 — see `SPIDER_SIZE`
  const half = HALF0 * sizeScale * (player.mode === "spider" ? SPIDER_SIZE : 1);
  const hitScale = sizeScale * hitboxScale(player.mode);
  const modeHalf = HALF0 * hitScale;
  // The landing tolerance shrinks with the player: Clubstep f9604, a mini
  // ball lands from 9.33 inside a block's top — within 2·9 − 10·0.6 = 12,
  // past the unscaled 2·9 − 10 = 8. This made Clubstep frame-exact.
  const inset = (player.mode === "ship" ? 6 : CLIP_INSET) * sizeScale;
  const bump = player.mode === "ship" || player.mode === "ufo" || player.mode === "swing";
  // **A spider slides along the underside of a ramp** as the fliers do, though
  // a block's underside still kills it: Dash f8809, under the steep wedges
  // 1746 at (11415, 390)/(11431, 360), the native spider is pushed down the
  // face at exactly 2 x 387.42 and lives. (The plain replay died there.)
  const slopeBump = bump || player.mode === "spider";

  // The free-fly band. Outside cube the camera is locked to `cameraYCenter`,
  // and the player is clamped between a floor and a ceiling measured from it —
  // this, not the kill height, is what stops a ship climbing over a level.
  // Hitting either is a clamp, not a death (`setYVel(0)`), and touching the one
  // gravity pulls you toward counts as ground.
  // Only the CEILING is applied — that is the roof, and it is what stops a
  // free-fly mode climbing over a level. The floor half derives to
  // `centre - band.below` but is demonstrably wrong: it blocks level 16's ship
  // section outright (100% -> 21.5%, and the resulting death is reported
  // against a *slope*, which is misleading). The likely reason is that
  // `_bottomGround` is not static — `tweenBottomGround` animates it and cube
  // mode rewrites it every frame from the camera — so a fixed offset cannot
  // model it. The level's own geometry is the floor that matters anyway.
  // in a dual the non-fliers take the dual's own ground and ceiling (below)
  const band = turned || player.bandless || player.freeMode || (player.inDual && player.dualEdge && !isFlyingMode(player.mode))
    ? null : bandFor(player.mode, player.mini, s.triggers?.rt.zoom ?? 1);
  if (band) {
    const hi = player.cameraYCenter + band.above;
    // The ceiling holds the position; only a player moving into it loses its
    // velocity (a flipped one lands on it). And the step after a teleport it
    // is not applied at all. Deadlocked f9187: a mini ball teleported to 415,
    // above the band's 411, falls to 413.24 unclamped, is set to exactly 411
    // on f9189 and falls on at its full speed; f9643 (the same drop) is under
    // 411 by the second step.
    if (player.teleported) player.teleported = false;
    else if (player.y > hi) {
      player.y = hi;
      if (player.yVel >= 0) player.yVel = 0;
      if (player.gravityFlipped) player.onGround = true;
    }
    // **The floor is applied too, and leaving it off was a real bug.** An
    // earlier note here said the floor "blocks level 16's ship section outright
    // (100% -> 21.5%)" and disabled it. That reasoning was backwards: the 100%
    // it was protecting was itself fake. Replaying the autopilot's winning L16
    // run in the browser shows the player at **y=15, "ship ground", at 36% and
    // 43%** — flying *under* the whole level, never touching the dual portal at
    // (10551, 419) or either ship portal at x=12825, with the real corridor
    // sitting hundreds of units overhead. Without a floor a ship simply sinks
    // out of its section and coasts along the ground, which is also why the
    // camera looked wrong there: it was anchored to a stale `cameraYCenter`
    // from a portal far behind while the player sat on the ground.
    const lo = player.cameraYCenter - band.below;
    if (player.y < lo) {
      player.y = lo;
      player.yVel = 0;
      if (!player.gravityFlipped) player.onGround = true;
    }
  }

  // the player can only be "on ground" while something is under it
  let grounded = false;
  /** pushed along a ramp's wrong side this step (see `slopeBumpRide`) */
  let bumpRide = false;
  /** riding a ramp this step (drives the slope launch below) */
  let onSlope = false;

  // Solid ground plane at y = 0. Under flipped gravity the floor is a *ceiling*
  // — the player is falling away from it — so touching it follows the ceiling
  // rule (death for cube/ball/…, a clamp for ship/UFO), not the landing rule.
  // Treating it as ground let a flipped cube rest on the floor and slide along
  // spike pits unharmed.
  // The wave rests 10 above the ground (mini 6), not 15: Blast Processing
  // frame 4255 on, the real wave slides along the floor at y=10 — the same
  // half-size its band gives (see `bandFor`).
  const floorHalf = player.mode === "wave" ? 10 * sizeScale : half;
  if (!turned && player.y - floorHalf <= 0 && player.yVel <= 0) {
    // The wave slides along the floor rather than dying on it — only spikes
    // sitting on the ground kill it, and those are ordinary hazards.
    // `PlayerObject::isSafeFlip(0.1)` (m1 0x381e74, from `checkCollisions`
    // +0x23c): within 0.1 s of a gravity flip the floor catches a flipped
    // player (`setPosition` onto it + `hitGround`) instead of killing it.
    const safeFlip = player.flipAge !== undefined && player.flipAge < 0.1;
    if (g < 0 && player.mode !== "wave") {
      if (!bump && !safeFlip) { die(s, "ceiling-floor", 0); return; }
      player.y = floorHalf;
      player.yVel = 0;
    } else {
      player.y = floorHalf;
      player.yVel = 0;
      grounded = true;
    }
  }

  // **The dual's ground and ceiling** (`updateDualGround`, above): every mode
  // has both in a dual, not only the flying ones. `checkCollisions` treats
  // them as it treats the level floor — the side gravity pulls toward is
  // ground, and a head-first hit is death (`destroyFromHitHead`) unless the
  // player is a flier, which the band above already clamps. The grounds
  // tween into place in the game; here they are there at once (APPROXIMATION
  // A40).
  if (player.inDual && player.dualEdge && !turned && !isFlyingMode(player.mode)) {
    const hi = player.cameraYCenter + player.dualEdge - half;
    const lo = player.cameraYCenter - player.dualEdge + half;
    const safeFlip = player.flipAge !== undefined && player.flipAge < 0.1;
    if (player.y > hi) {
      if (g < 0) {
        if (player.yVel >= 0) { player.y = hi; player.yVel = 0; grounded = true; }
      } else if (!safeFlip) { die(s, "ceiling", 0); return; }
      else { player.y = hi; player.yVel = 0; }
    }
    if (player.y <= lo) {
      if (g > 0) { if (player.yVel <= 0) { player.y = lo; player.yVel = 0; grounded = true; } }
      else if (!safeFlip) { die(s, "ceiling-floor", 0); return; }
      else { player.y = lo; player.yVel = 0; }
    }
  }

  /** the velocity going into the collision pass (see the teleport below) */
  const velBeforeCollisions = player.yVel;
  /** the solid whose landing (or bump) zeroed the velocity this pass */
  let zeroedBy: Collider | null = null;
  /** colliders the player landed on this pass, for the cube's landing snap */
  const landed: Collider[] = [];
  /** the solid the landing branch placed the player on this step */
  let landedOn: Collider | null = null;
  /** the floor and ceiling surfaces touched this step, for the squeeze test */
  let floorAt: number | undefined, ceilAt: number | undefined;
  const b: Box = { x: player.x, y: player.y, hw: half, hh: half };
  // Touch triggers (key 11) fire from the collision pass, against the player's
  // full rect — `collisionCheckObjects` +1508 -> `playerTouchedTrigger`.
  if (s.triggers) {
    fireTouchTriggers(s.triggers.rt, s.triggers.list,
      world instanceof LocalWorld ? boxToWorld(world.frame, b) : b);
  }
  // **Hazards are tested against the player's FULL box, not the inner one.**
  // The two boxes are not two levels of the same rule — they belong to
  // different rules:
  //   * the inner box (`getObjectRect(0.3, 0.3)`) is checked in exactly one
  //     place, the tail of `PlayerObject::collidedWithObjectInternal`, and that
  //     function only ever sees **solids and breakables** — it never compares
  //     `getType()` against anything but `Breakable`;
  //   * hazards are collected separately by `collisionCheckObjects` into
  //     `m_hazardCollisionObjects` and killed against the plain
  //     `player->getObjectRect()`. The surviving circle branch proves the size:
  //     `playerIntersectsCircle` uses `player->getObjectRect().size.width * .5f`
  //     as the player's radius — the full 30, not the inner 9.
  // GD Creator School's hitbox guide says the same in prose: the main hitbox is
  // what spikes collide with; the small one is "exclusively for solid blocks".
  //
  // This is why you could sink 23 of a spike's 30 units into it before dying:
  // the inner box shrank the player *and* the hand-tuned hazard shapes shrank
  // the spike, so the two forgivenesses multiplied. With the real hitbox table
  // (src/gd/hitboxes.ts) a spike is 6x12 and the player is 30x30, so contact
  // kills 13 units in — you die on the spike instead of standing inside it.
  const ib: Box = { x: player.x, y: player.y, hw: modeHalf, hh: modeHalf };

  // Special blocks (1755 D, 1813 J, 1829 S, 1859 H — see `SPECIAL_BLOCKS`):
  // invisible, never solid, and read against the full box before the solids
  // are resolved, because D and H change how this step's solids treat you.
  let dartSlide = false, hitHead = false, noAutoJump = false, flipOnHit = false;
  for (const it of world.nearInteractives(b, s.triggers?.rt)) {
    if (it.kind !== "special" || !touchesRect(b, it)) continue;
    switch (SPECIAL_BLOCKS.get(it.id)) {
      case "D": dartSlide = true; break;
      case "H": hitHead = true; break;
      case "F": flipOnHit = true; break;
      case "J": noAutoJump = true; break;
      case "S":
        // the S block takes the press with the dash: a button held through it
        // does not re-jump on landing until it is let go (Dash f2253, USER-12)
        player.holdSpent = true;
        player.queuedHold = false;
        if (player.dash !== 0) { stopDash(player); note(s, "dash stopped"); }
        break;
    }
  }
  // J is read by the *next* step's jump, as the original reads last frame's flag
  player.noAutoJump = noAutoJump;

  // **Pads fire before the solids are resolved.** The game applies a pad
  // inside the same collision pass, so a pad reached on the frame the player
  // lands has already set an upward velocity when the platform is tested, and
  // there is no landing snap: Electrodynamix frame 1134, the real cube
  // launches from 0.74 inside the platform where the port snapped it on top
  // first. Same rules as the main pass below, which then skips these.
  const padsFired = new Set<number>();
  let touchedPadEarly = s.onPad;
  const padBox: Box = player.mode === "wave" ? ib : b;
  for (const it of world.nearInteractives(padBox, s.triggers?.rt)) {
    if (it.kind !== "pad" || !touchesRect(padBox, it)) continue;
    if (it.id === 67) {
      const angle = Math.abs(Math.trunc(propFloat(it.props, P.ROTATION)));
      const facesDown = (angle > 90 && angle < 270) !== propBool(it.props, P.FLIP_Y);
      if (facesDown !== player.gravityFlipped) continue;
    }
    if (!s.touching.has(it.index) && !(it.id === 67 && touchedPadEarly) && !padSpent(s, it)) {
      activatePad(it.id, player);
      spendPad(s, it);
      note(s, `pad ${it.id}`);
    }
    touchedPadEarly = true;
    padsFired.add(it.index);
  }

  // Two passes: **slopes first**, then flat solids.
  //
  // A ramp meeting a flat ledge overlaps the player's box a step or two before
  // the ledge is actually underfoot, and the ledge's landing target is its own
  // top — so a player still climbing the ramp reads as "embedded" below it and
  // the two-hitbox rule kills them. The original gives the slope priority
  // (`m_isOnSlope`, `handleRotatedSlopeCollision`), so once the ramp has taken
  // the player this step, a flat solid may still stop or carry them but must
  // not kill them off its landing branch.
  // `destroyed` is empty for all but a handful of objects in two levels, and
  // this runs 240x a second across thousands of autopilot clones — so only pay
  // for the copy when something has actually been broken.
  const near = s.destroyed.size === 0
    ? world.near(b, rt)
    : world.near(b, rt).filter((c) => !s.destroyed.has(c.index));
  // **Native slopes** (`NATIVE_SLOPES`): the transcribed routine, driven as
  // the game drives it — flags aged in `preCollision`, each slope offered to
  // `collidedWithSlope`, the ride-end launch in `postCollision` (below).
  const nativeOn = NATIVE_SLOPES && !turned;
  let ns = player.ns;
  let slopeView: SlopePlayer | null = null;
  const nativeOut: SlopeOutcome = { died: false, grounded: false, strips: [] };
  if (nativeOn) {
    ns = player.ns ??= newNativeSlopeState();
    // `m_gameModeChangedTime`: the port's portals run after this pass, so a
    // change is noticed here, one step on, at the time it was made
    // (`m_lastFlipTime` is stamped by `flipGravity` itself)
    if (ns.lastMode !== undefined && ns.lastMode !== player.mode) ns.gameModeChangedTime = ns.time;
    ns.lastMode = player.mode;
    ns.time += dt;
    nativePreCollision(ns);
    const box = player.mode === "wave" ? 10 : player.mode === "spider" ? 30 * SPIDER_SIZE : 30;
    slopeView = slopePlayerView(player, ns, { dartSlide, hitHead, size: box * sizeScale, speed: run.speed });
    const host = slopeHost(nativeOut);
    const cache = slopeCache(world);
    for (const c of near) {
      if (!c.slope || c.kind === "hazard") continue;
      try {
        collidedWithSlopeInternal(host, slopeView, slopeObjectFor(c, cache), NATIVE_DT, false);
      } catch (e) { if (e !== DIED) throw e; }
      if (nativeOut.died) { die(s, "slope", c.id); return; }
    }
    b.y = player.y;
    if (ns.isOnSlope) {
      onSlope = true;
      if (nativeOut.grounded) { grounded = true; floorAt = player.y - g * half; }
      else if (ns.upsideDownSlope) ceilAt = player.y + g * half;
    }
  }
  for (const c of nativeOn ? [] : near) {
    // hazards are tested after every solid has been resolved — see below
    if (c.kind === "hazard") continue;
    // The wave dies on every solid it touches, a ramp's vertical side included
    // — `resolveSlope` only models the hypotenuse, which let it fly through.
    if (c.slope && player.mode === "wave" && hitsSlopeWall(ib, c, near)) {
      die(s, "wave-solid", c.id); return;
    }
    // a rider handed from one ramp to the next (not the wave, which slides)
    // A flier pushed along the wrong side of a ramp is handed from tile to
    // tile as a rider is: Hexagon Force f8876-9866, a flipped ship climbs a
    // 45-degree staircase at exactly 387.42 while the port, capped at each
    // tile's ledge, fell off at every tile edge (902 resync faults).
    const handoff = (player.slopeTime > 0 || player.slopeBumpRide === true) && player.mode !== "wave";
    // **The wave meets a ramp with its own 10-unit half-size**, as it does the
    // floor: Geometrical Dominator f7053, the real wave descends past the
    // 15-unit ride line (15·√2 above the ramp) where the port landed it.
    const slopeScale = player.mode === "wave" ? sizeScale * 10 / 15 : sizeScale;
    if (!c.slope || !nearSlope(player.x, player.y, c, slopeScale, handoff)) continue;
    // Ride *tangentially*: the climb rate is vx * gradient, so the player
    // already carries the velocity it will leave with. Zeroing yVel while riding
    // and bolting a launch on at the end made the exit a discontinuity — and any
    // step where the ramp briefly stopped claiming the player fired that launch
    // early, mid-ramp, at a fraction of its strength.
    // Only an *uphill* ramp carries velocity. Going downhill the surface holds
    // the player against gravity anyway, and handing them a -387 tangential
    // velocity instead slammed them into whatever flat solid the ramp ended at
    // (level 16 x=9320 died on a thin ledge that way).
    const uphill = slopeUphill(c) === (c.slope.cy < 0);
    const rideVel = uphill ? run.speed * slopeGradient(c) * g : 0;
    const launchVel = uphill ? slopeLaunchVelocity(c, run.speed, player.mode) * g : 0;
    const r = resolveSlope(player.x, player.y, player.yVel, c, g, slopeScale, slopeBump,
      player.slopeTime > 0, rideVel, handoff, run.speed);
    if (r.result === "death") { die(s, "slope", c.id); return; }
    // Two ramps in one step: the higher placement wins. Hexagon Force f6383,
    // on a staircase of 45° tiles the next tile lifts the cube to its line
    // (166.04) and the tile it is leaving must not then snap it back down to
    // its ledge (165) — the real cube runs straight on up.
    if (r.result === "land" && onSlope && (r.landY - player.y) * g < 0) continue;
    if (r.result === "land" || r.result === "bump") {
      player.y = r.landY;
      // `hitGround` zeroes the velocity, but the original restores it when the
      // player was genuinely moving up (`if (yVel > 5.0f) setYVelocity(yVel)`),
      // so a ramp can never swallow a jump. See SLOPE_KEEP_VEL.
      // (not at a ramp's ledge, where the game zeroes it outright)
      const keep = !r.ledge && player.yVel * g > SLOPE_KEEP_VEL ? player.yVel : 0;
      player.yVel = keep;
      b.y = player.y;
      if (r.result === "bump") {
        bumpRide = true;
        // A flier pushed up a ramp's wrong side launches off its top like a
        // rider: Hexagon Force f8911-8912, the flipped ship leaves the
        // staircase at 368.3 (= 372.9, the off-cube ramp launch, less one
        // step of its gravity) rather than stopping at the ledge. Only a
        // launch away from the solid side (up a floor ramp, down a ceiling one).
        // (not after sliding along the ledge — Hexagon Force f4036: that ship
        // drops off it with no launch)
        const rising = (c.slope.cx > 0) === (c.slope.cy < 0);
        const away = c.slope.cy < 0 ? 1 : -1;
        const half = HALF0 * sizeScale;
        const atLedge = Math.abs(r.landY - (c.y + away * (c.hh + half))) < 1e-6;
        // one step at the ledge is the top of the climb (f8910); a second is
        // sliding along it
        if (atLedge && player.slopeBumpLedge) { player.slopeVelocity = 0; player.slopeBumpLaunch = false; }
        player.slopeBumpLedge = atLedge;
        if (!atLedge && (rising ? 1 : -1) === away) {
          player.slopeVelocity = Math.abs(slopeLaunchVelocity(c, run.speed, player.mode)) * away;
          player.slopeBumpLaunch = true;
        }
      }
      if (r.result === "land") {
        grounded = true;
        onSlope = true;
        player.slopeVelocity = launchVel;
        // ...but never over the top of a jump the snap just preserved, or the
        // ramp eats it after all — downhill hands out a flat 0. At the ledge
        // the snap zeroes it (see `resolveSlope`).
        if (!keep) player.yVel = r.ledge ? 0 : rideVel;
      }
    }
  }

  // the wave's own 10 x 10 x scale rect (`toggleDartMode`): Dash f20713, a
  // wave sliding onto D-blocked floor rests 5 above it, not 15
  const waveBox: Box = { x: player.x, y: player.y, hw: 5 * sizeScale, hh: 5 * sizeScale };
  // (`preSlopeCollision`'s side and base strips resolve as ordinary solids)
  const solids: readonly Collider[] = nativeOut.strips.length === 0 ? near : [...near, ...nativeOut.strips.map(
    (r, i): Collider => ({ kind: "solid", x: r.x + r.w / 2, y: r.y + r.h / 2, hw: r.w / 2, hh: r.h / 2, id: 0, index: -1 - i, groups: [] }))];
  for (const c of solids) {
    if (c.kind === "hazard" || c.slope) continue;
    if (!overlaps(player.mode === "wave" && dartSlide ? waveBox : b, c)) continue;
    // A D block lets the wave slide along solids like a ship instead of dying
    if (player.mode === "wave" && !dartSlide) {
      const wb: Box = { x: player.x, y: player.y, hw: modeHalf, hh: modeHalf };
      if (overlaps(wb, c)) { die(s, "wave-solid", c.id); return; }
      continue;
    }
    // ...clamped like the ship, whose tighter inset puts the bump ahead of the
    // inner box; and an H block turns a head hit into a bump for every mode
    const wave = player.mode === "wave";
    const { result, landY } = resolveSolid(
      player.x, player.y, player.yVel, c, g, wave ? 2 * sizeScale : inset, sizeScale * (player.mode === "spider" ? SPIDER_SIZE : wave ? 1 / 3 : 1),
      bump || hitHead || flipOnHit || wave, world.isDynamic(c.index));
    // a slope the player may be riding onto hides the block face tucked
    // under it (`collidedWithObjectInternal`'s potential-slope scan): ToE 2
    // f21032, the real cube falls past the block beneath a ramp's tall end
    // and lands on the ramp beyond a frame later
    if (slopeView && c.index >= 0 && (result === "land" || result === "bump")) {
      const faces = slopeCoveredFaces(slopeView,
        { x: Math.fround(c.x - c.hw), y: Math.fround(c.y - c.hh), w: Math.fround(2 * c.hw), h: Math.fround(2 * c.hh) }, Math.fround(c.x));
      const topFace = (result === "land") === (g > 0);
      if (topFace ? faces.top : faces.bottom) continue;
    }
    // a ramp already has hold of the player — let it carry them onto the ledge
    if (result === "death" && !onSlope) {
      // A **breakable** block (type 21) takes the death in the player's place:
      // `if (type == Breakable) { destroyObject(object); return 1; }` sits
      // exactly where `destroyPlayer` does for an ordinary solid. It is solid in
      // every other respect, so it still carries you when you land on top —
      // which is why making breakables simply non-solid is wrong.
      if (c.breakable) {
        s.destroyed.add(c.index);
        note(s, `broke id${c.id}`);
        continue;
      }
      die(s, "solid", c.id);
      return;
    }
    // The frame after a ramp let go of the rider, a flat solid does not
    // catch it before the ramp's launch fires (`m_wasOnSlope`): Geometrical
    // Dominator frame 505, the cube dips 0.05 into the ledge at y=90 and
    // launches on the next frame instead of landing on it.
    if (result === "land" && !onSlope && player.slopeTime > 0) continue;
    // A ramp that has just taken the player wins over a flat block that only
    // reaches under the player's box, not its centre: Hexagon Force f5887, a
    // cube lands 4.16 past a thin ledge's end onto the downhill ramp that starts
    // there and rides the ramp's line (224.69), not the ledge's top (224.95).
    if (result === "land" && onSlope && Math.abs(player.x - c.x) > c.hw) continue;
    if (result === "land") {
      player.y = landY;
      if (player.yVel !== 0) zeroedBy = c;
      player.yVel = 0;
      grounded = true;
      b.y = player.y;
      floorAt = landY - g * half;
      s.ground = world.isDynamic(c.index) ? { index: c.index, y: c.y } : null;
      landedOn = c;
      // the cube's landing snap: keeps a chain of identical jumps aligned.
      // Cube only, exactly as the original guards the call.
      if (player.mode === "cube") landed.push(c);
    } else if (result === "bump") {
      player.y = landY;
      ceilAt = landY + g * half;
      // a push from a block that caught a falling player up leaves its fall
      // speed alone (Deadlocked f21527: freed, it is at the cap at once)
      if (player.yVel * g > 0) { player.yVel = 0; zeroedBy = c; }
      b.y = player.y;
      // remember a trigger-moved ceiling a flier is pressed against
      if ((player.mode === "ship" || player.mode === "ufo") && world.isDynamic(c.index)) {
        s.ceiling = { index: c.index, y: c.y, py: player.y, hw: b.hw };
      }
      // **F block: a head hit flips gravity** (`didHitHead`, m1 0x3834bc: with
      // `m_stateFlipGravity` set it calls `flipGravity(!m_isUpsideDown)` and
      // sets the velocity to 2.0 raw toward the new ground, marking a jump).
      // Dash f3012: the cube jumps into a rising ceiling inside an F block and
      // then rides that ceiling upside down instead of dying against it.
      if (flipOnHit) {
        flipGravity(player, !player.gravityFlipped);
        player.yVel = -2 * 54 * gravitySign(player);
        player.jumping = true;
      }
    }
  }

  // The cube's landing snap. The original runs it once per colliding object,
  // from inside `collidedWithObjectInternal`, and the last call is the one that
  // sets `m_lastGroundObject` — so the iteration order decides which block the
  // *next* landing measures its rhythm from.
  //
  // **Every block under the resolved player counts, not just the one our loop
  // resolved against.** `CCRect::intersectsRect` counts exact touching, so a
  // player that lands straddling two blocks collides with both and the snap
  // runs twice; our resolver stops at the first, because once it has lifted the
  // player onto the surface the second only touches. Missing the second block
  // cost a snap every time a landing straddled a seam — the single largest
  // remaining source of x drift in the recorded runs.
  if (landed.length && player.mode === "cube") {
    const surface = player.y - g * half;
    const touching = near.filter((c) =>
      c.kind === "solid" && !c.slope &&
      Math.abs(player.x - c.x) <= half + c.hw + 1e-6 &&
      Math.abs(surface - (c.y + g * c.hh)) <= 1e-6);
    // Breakable blocks never take part in the rhythm snap: Electroman
    // Adventures frame 2121, the real cube lands from one brick (143) onto
    // another at a snapping offset and is not moved.
    const list = (touching.length ? touching : landed).filter((c) => !c.breakable);
    // Reverse level order. **This one is measured, not read out of the
    // binary**: the original's section iteration is not the level's object
    // order, and over the 21 recorded runs reverse order costs 378 divergences
    // against 440 for forward order and 398 for right-to-left. Revisit if the
    // section build order ever gets decoded.
    list.sort((p, q) => q.index - p.index);
    const speedIndex = (SPEEDS as readonly number[]).indexOf(run.speed);
    for (const c of list) {
      // **Both blocks where they are now.** The game keeps a pointer to the
      // last ground object (`m_lastGroundObject`), not a copy of its position,
      // so a moved block is compared at its current place with the new one's
      // current place. Geometrical Dominator f8156: a block lifted 90 lands
      // the real cube in rhythm with its predecessor (nudged 1.0); f1130: two
      // blocks moved together by one group keep their spacing, so no nudge —
      // which a stored (stale) predecessor position had got wrong.
      const obj = { index: c.index, x: c.x - (c.ox ?? 0), y: c.y - (c.oy ?? 0) };
      if (rt && player.snapObject >= 0 && player.snapObject !== c.index
          && world.isDynamic(player.snapObject)) {
        const now = world.placedCollider(player.snapObject, rt);
        if (now) { player.snapObjectX = now.x; player.snapObjectY = now.y; }
      }
      if (checkSnapJump(player, obj, speedIndex)) b.x = player.x;
    }
  }

  // **Hazards last, against where the solids put the player.** The game
  // collects hazards into `m_hazardCollisionObjects` during the collision pass
  // and kills against them only after the solids have moved the player.
  // Testing them first killed a landing that the game lets through: Can't Let
  // Go frame 2437, the real run drops past a spike's tip while its edge
  // overlaps the next block by 0.74 units, the block lifts it to y=45, and it
  // jumps on — the port died on the spike from the pre-landing position.
  const hb: Box = { x: player.x, y: player.y, hw: modeHalf, hh: modeHalf };
  for (const c of near) {
    if (c.kind !== "hazard") continue;
    // the ship's box turns with it against a tilted hazard (see `easeShipRotation`)
    const hit = c.obb && c.radius === undefined && player.mode === "ship" && player.shipRot
      ? obbTouches(hb, player.shipRot, c) : hitsHazard(hb, c);
    if (hit) { die(s, "hazard", c.id); return; }
  }

  // **Stick to the ground** (`postCollision`, m1 0x37cea4–0x37d0f8): a player
  // who did not land this step but landed on a solid last step is placed back
  // on it when its top is less than 5·dt (1.25 at a 240 Hz step) below the
  // player's underside and they still overlap across; failing that — when the
  // last ground was a moving block — on a moving block found the same way
  // (`testForMoving` m1 0x37dde4, `[0x5f8]`). Geometrical Dominator f21373: a
  // mini ship walks off descending block 469 onto 468 (0.05 lower, same group)
  // and the real ship is on 468's top that same step.
  // APPROXIMATION (A53): the 10·dt ([0xb08]) and 20·dt ([0x514]) tolerances,
  // the `[0x650]` gate and sideways play are not modelled.
  if (!grounded && s.stick && !turned && player.yVel * g <= 0) {
    const tol = 5 * dt * 60;
    const bottom = player.y - g * half;
    const stickTo = (c: Collider): boolean => {
      if (c.kind !== "solid" || c.slope || Math.abs(player.x - c.x) > b.hw + c.hw) return false;
      const top = g > 0 ? c.y + c.hh : c.y - c.hh;
      const gap = (bottom - top) * g;
      if (gap < 0 || gap >= tol) return false;
      player.y = top + g * half;
      player.yVel = 0;
      grounded = true;
      floorAt = top;
      b.y = player.y;
      landedOn = c;
      s.ground = world.isDynamic(c.index) ? { index: c.index, y: c.y } : null;
      return true;
    };
    const last = near.find((c) => c.index === s.stick!.index);
    if (!(last && stickTo(last)) && s.stick.moving) {
      for (const c of near) if (world.isDynamic(c.index) && c.index !== s.stick.index && stickTo(c)) break;
    }
  }
  s.stick = landedOn ? { index: landedOn.index, moving: world.isDynamic(landedOn.index) } : undefined;

  // **A player who walks off the platform this step is not carried by it**:
  // Dash f543, the real cube leaving a platform that is still easing to a stop
  // drops exactly one gravity step, without the platform's last 0.002.
  if (!grounded && carried !== 0) player.y -= carried;
  if (grounded) {
    if (!player.onGround && (player.mode === "cube" || player.mode === "robot")) {
      player.rotation = snapRotation(player.rotation);
    }
    player.onGround = true;
    player.groundGrace = 0;
  } else if (player.yVel !== 0) {
    s.ground = null;
    // An upside-down player off its surface keeps its jump while it is still
    // drifting slowly back toward that surface: `0 ≤ yVel ≤ 2·m_gravity` raw (see
    // `GROUND_GRACE` below).
    const still = player.gravityFlipped && !isFlyingMode(player.mode)
      && (player.onGround || player.groundGrace > 0)
      && player.yVel >= 0 && player.yVel <= speedConstants(s.run.speed).rise;
    player.groundGrace = still ? 1 : 0;
    player.onGround = false;
  }

  // **Player squeeze** (level header kA31, "Destroys player when squeezed
  // between two objects"; `postCollision` m1 0x37c6bc): a step that touched
  // both a floor and a ceiling whose gap is under 0.7 of the player's height
  // destroys it (0.8 in platformer). Without it a flier caught between a floor
  // and a descending crusher was flattened and lived.
  if (player.squeeze && floorAt !== undefined && ceilAt !== undefined
    && Math.abs(ceilAt - floorAt) < 0.7 * 2 * half) {
    die(s, "squeeze", 0);
    return;
  }

  // --- slope launch ---
  // `getModifiedSlopeYVel()` decompiles as:
  //     if (diff > 0.1) { if (diff * 10.0 > 0.4) return v * diff; else return v * 0.4f; }
  //     else return v * 1.f;
  // The inner test is **dead code** — under `diff > 0.1`, `diff * 10` is always
  // above 0.4 — which is the signature of a lost `* 10.0`. Read literally the
  // launch off a two-tile ramp is 60 u/s, an apex of 0.6 units: invisible, and
  // players report ramps should hop you. Read as `clamp(diff * 10, 0.4, 1)` it
  // is 312 u/s, an apex of ~17 units — a small hop, which matches. Taking the
  // clamped reading; revisit if a cleaner decompilation turns up.
  if (nativeOn && ns && slopeView) {
    if (nativePostCollision(player, ns, slopeView)) player.noClamp = true;
    // what `updateJump`'s slope boost reads next step (see applySlopeBoost)
    player.slopeVelocity = ns.slopeVelocity * RAW_VELOCITY;
    player.slopeTime = ns.isOnSlope || ns.wasOnSlope ? ns.time - ns.slopeStartTime : 0;
  } else {
  player.slopeBumpRide = bumpRide;
  if (!bumpRide) player.slopeBumpLedge = false;
  if (onSlope || bumpRide) {
    player.slopeTime += dt;
  } else if (player.slopeTime > 0) {
    const diff = player.slopeTime;
    const launch = player.slopeVelocity * Math.min(1, Math.max(0.4, diff * 10));
    // a bump launch points away from the ramp, whichever way gravity pulls
    const dir = player.slopeBumpLaunch ? Math.sign(launch) : g;
    if (launch * dir > player.yVel * dir) {
      player.yVel = launch;
      player.noClamp = true;
    }
    player.slopeBumpLaunch = false;
    player.slopeTime = 0;
    player.slopeVelocity = 0;
  }
  }

  // --- portals / orbs / pads / coins ---
  // Tested against the player's full box, not a centre point. A pad lies flat
  // on the floor (box y = 0..4) while a grounded player's centre sits at y=15,
  // so a point test can never reach one — ground pads simply never fired.
  // The wave meets them with its own small rect (10 x 10 x scale — see the
  // `toggleDartMode` note below), not the 30-unit box.
  // (queried with the wave's real 10 x 10 x scale rect — see the
  // `toggleDartMode` note below; querying with the inner box never fetched the
  // objects only that rect reaches: Deadlocked f18783, ship portal #178)
  const wh = 5 * (player.mini ? MINI_SCALE : 1);
  // (and the spider its 27-wide one, `toggleSpiderMode`: Dash f9310, a spider
  // meets the cube portal a frame after a 30 box would)
  const sh = 15 * SPIDER_SIZE * (player.mini ? MINI_SCALE : 1);
  const pb: Box = player.mode === "wave" ? { x: b.x, y: b.y, hw: wh, hh: wh }
    : player.mode === "spider" ? { x: b.x, y: b.y, hw: sh, hh: sh } : b;
  let anyPad = false;
  let anyOrb = false;
  /** rebuilt from scratch each step, so leaving an interactive re-arms it */
  const nowTouching = new Set<number>();
  // and so does the touched ring: `_touchedRingObject` only ever names a ring
  // the player is on *now*, or a press made long after leaving one would still
  // fire it from across the level
  s.touchedOrb = null;
  /** teleports run after every other portal in this pass — see below */
  const teleports: Interactive[] = [];
  // `_touchedPadObject` is set the instant a pad fires and is read by the next
  // pad in the *same* collision pass, so start from last step's value and
  // update it immediately. Reading only last step's value let two pads whose
  // trigger ranges overlap both fire on the same step — two gravity flips that
  // cancel, which is why level 12's pair did nothing unless you clipped the
  // leading edge of the first one on its own.
  let touchedPad = s.onPad;
  /** the pass box — a wave that turns into another mode mid-pass meets the rest of the pass with its new, larger box */
  let passBox = pb;
  const startedWave = player.mode === "wave";
  for (const it of world.nearInteractives(pb, s.triggers?.rt)) {
    const was = s.touching.has(it.index);
    // **The box is the one the pass started with**, whatever a portal earlier
    // in the pass turns the player into (`getObjectRect()` reads the size the
    // mode switch leaves, but the whole pass runs on the same rect). Both
    // directions are in the runs: Geometrical Dominator f19315 (a wave's rect
    // meets the UFO and mini portals in one pass) and Dash f20236 (a cube's
    // box meets the wave portal and the size portal just past it).
    let cur = it.kind === "speed" ? pb : passBox;
    // **The wave meets portals, orbs and pads with a 10 x 10 rect**, scaled
    // by the player's scale: `toggleDartMode` (m1 0x38cf84) sets the wave's
    // `m_width = m_height = 10` (+0x2fc/+0x300), and `collisionCheckObjects`
    // tests objects against `getObjectRect()` = size x `m_playerScale`. This
    // replaces two fitted sizes (3.75 for size portals, 5.25 for gravity and
    // dual portals — the latter's 4.9-5.8 fit contains the real 5). Resync
    // 49 -> 48: Blast Processing and Fingerdash gain, Deadlocked f867 and Dash
    // f20237 (mini/2.2 wave cases) do not — see BUGS.
    // **A wave's rect turns with its path** when it meets a tilted object
    // (`OBB2D` both ways): an upright square reaches a tilted portal sooner
    // than one angled along the wave's diagonal. Fingerdash f15957 (its last
    // fault) and Deadlocked's tilted portals; resync 37 -> 36.
    // APPROXIMATION (A50): a tilted **speed** portal meets the player's rect
    // taken in the portal's own frame (as if turned with it) — Deadlocked
    // f8959, a mini ball reaches the 53° portal 201 two steps after the
    // plain oriented test says; the same test for every tilted interactive
    // costs three faults elsewhere (BUGS PHY-95)
    const inside = it.obb && player.mode === "wave"
      ? obbTouches(cur, rotForPass, it)
      : it.obb && it.kind === "speed"
        ? touchesInObjectFrame(cur, it)
        : touchesRect(cur, it);
    if (!inside) continue;
    // GJBaseGameLayer::gravBumpPlayer (m1 0x1006dc) rejects a blue pad
    // unless isFacingDown() matches the player's gravity. The facing test
    // truncates rotation to integer degrees and XORs the Y flip
    // (GameObject::isFacingDown, 0x4f9198). Reject before recording contact:
    // a co-located portal may change gravity while we're still inside it.
    if (it.kind === "pad" && it.id === 67) {
      const angle = Math.abs(Math.trunc(propFloat(it.props, P.ROTATION)));
      const facesDown = (angle > 90 && angle < 270) !== propBool(it.props, P.FLIP_Y);
      if (facesDown !== player.gravityFlipped) continue;
    }
    nowTouching.add(it.index);
    switch (it.kind) {
      case "portal":
      case "speed":
        // A teleport is deferred to the end of the pass: it moves the player,
        // and levels stack other portals at the same spot (level 20 x=3327 has
        // a normal-gravity portal on top of the teleport). Firing the teleport
        // first carries the player out of the gravity portal's reach, so it
        // never applies and you arrive at the destination still flipped — the
        // pads there then launch you *into* the floor.
        if (it.id === 747 || it.id === 2902) { teleports.push(it); break; }
        // once per portal per attempt
        if (!s.usedPortals.has(it.index)) {
          s.usedPortals.add(it.index);
          // Dual (286) / solo (287). Only player 1 owns the partner — a partner
          // crossing the same portal must not spawn a third player, which is
          // why this is skipped for the partner's own pass.
          if (!skipTriggers) {
            if (it.id === 286 && !s.dual) { s.dual = spawnDual(s, it.y); note(s, "dual on"); }
            else if (it.id === 287 && s.dual) { s.dual = undefined; note(s, "dual off"); }
          }
          const before = player.y;
          const anchor = player.cameraYCenter;
          const wasFlipped = player.gravityFlipped;
          // **A grounded player grows on the portal's frame only if the game
          // reaches the portal before the block it stands on** (Dash f9310: a
          // spider on block 8931 turns cube and the real one rises a step
          // later, lifted by that block on the next pass; f1167 and f20734,
          // portal first, rise at once)
          const lift = !(player.onGround && zeroedBy && zeroedBy.index >= 0
            && !testedBefore(s, it.obj, zeroedBy.index));
          applyPortal(it.id, it.props, player, run, onDual, undefined, lift);
          if (startedWave && passBox === pb && GAMEMODE_PORTALS[it.id] && GAMEMODE_PORTALS[it.id] !== "wave") {
            const half = 15 * (player.mini ? MINI_SCALE : 1) * (player.mode === "spider" ? SPIDER_SIZE : 1);
            passBox = { x: pb.x, y: pb.y, hw: half, hh: half };
          }
          // **A dual keeps the pair on opposite gravity.** `GJBaseGameLayer::
          // flipGravity` (m1 0xfd41c): when the flip changes the player and the
          // two are in the same mode (and the level is not two-player, kA10),
          // the other player gets `flipGravity(!flip)` too — halving included.
          // Hexagon Force f13494: player 1 crosses a normal-gravity portal and
          // the real player 2 flips (and halves) on the same frame.
          // A gravity flip on a moving block turns that block into the
          // ceiling that pushes the player (Dash f6857: a sideways ball riding
          // group 300 flipped back by portal 81 is pushed off it at -1 raw,
          // as a UFO under a descending block is — PHY-97)
          if (player.gravityFlipped !== wasFlipped && s.ground) {
            s.ceiling = { index: s.ground.index, y: s.ground.y, py: player.y, hw: b.hw, anyMode: true };
            s.ground = null;
          }
          const partner = s === root ? root.dual : root;
          if ((it.id === 10 || it.id === 11) && partner && player.gravityFlipped !== wasFlipped
            && partner.player.mode === player.mode) {
            flipGravity(partner.player, !player.gravityFlipped);
            // The partner then meets the portal on its own pass this frame
            // and, being on the other gravity now, flips back — flipping player
            // 1 back in turn. That is the real run: player 1 is halved twice
            // (65.66 -> 32.83, leaving at 39.4 on f13495) and so is player 2.
          }
          // **Inside a dual, a gamemode portal does not move the band.** Both
          // players stay confined around the dual portal's centre — measured
          // on level 16's dual ship (x=12800..13700): each player crosses its
          // own ship portal (centres 450 and 330), yet the real player 1 flies
          // exactly 255..525, which is 390 ± 135 with 390 the dual's anchor.
          // Taking each portal's own centre put player 2's floor 60 units low
          // and its ceiling in the middle of the corridor.
          if (s.dual || root !== s) player.cameraYCenter = anchor;
          // the view's centre inside a dual: a ball portal sets it with the dual's 270 height
          // (`cameraCenterForDualBall`); any other mode change returns it to the dual's anchor
          if (s === root && s.dual && GAMEMODE_PORTALS[it.id]) {
            player.dualCamCentre = GAMEMODE_PORTALS[it.id] === "ball"
              ? cameraCenterForDualBall(propFloat(it.props, P.Y, player.y)) : undefined;
          }
          if (it.id === 287) player.dualCamCentre = undefined;
          note(s, `portal ${it.id}`
            + (Math.abs(player.y - before) > 1 ? ` y${before.toFixed(0)}->${player.y.toFixed(0)}` : ""));
        }
        break;
      case "orb":
        anyOrb = true;
        // `m_touchedRingObject`: the collision pass only **records** the ring.
        // `ringJump` runs from `updateJump`, so the jump itself happens at the
        // top of the next step, *before* the player moves — see `fireTouchedOrb`.
        if (!s.usedOrbs.has(it.index)) s.touchedOrb = it;
        break;
      case "pad":
        anyPad = true;
        // Auto-fire on entry, re-arming only once the player leaves every pad.
        // The original guards the gravity pad this way; levels stack pads in
        // overlapping pairs, and firing the second one cancels the first
        // (two gravity flips) or re-launches from the wrong place.
        if (!padsFired.has(it.index) && !was && !(it.id === 67 && touchedPad) && !padSpent(s, it)) {
          activatePad(it.id, player);
          spendPad(s, it);
          note(s, `pad ${it.id}`);
        }
        touchedPad = true;
        break;
      case "coin":
        if (!s.collected.has(it.index)) {
          s.collected.add(it.index);
          s.destroyed.add(it.obj);
          root.effects.push({ kind: "coin", player: s === root ? 0 : 1,
            obj: it.obj, id: it.id, index: it.index, ...toWorld(player, it.x, it.y) });
          run.coins++;
        }
        break;
      case "collect":
        // The collectible (1614). `collisionCheckObjects` (+1516..1628) guards
        // it with `hasBeenTriggered`/`storeTriggeredID` — once per object per
        // attempt — then runs the object's own pickup, which adds key 77 to
        // key 80's item. The object is removed from the level, so the scene
        // stops drawing it.
        if (!s.collected.has(it.index)) {
          s.collected.add(it.index);
          s.destroyed.add(it.obj);
          root.effects.push({ kind: "collect", player: s === root ? 0 : 1,
            obj: it.obj, id: it.id, index: it.index, ...toWorld(player, it.x, it.y) });
          if (!skipTriggers && s.triggers) {
            const item = propInt(it.props, P.ITEM_ID, 0);
            if (item) {
              const n = it.props.has(P.COUNT) ? propInt(it.props, P.COUNT, 0) : 1;
              addItemCount(s.triggers.rt, item, propBool(it.props, P.SUBTRACT_COUNT) ? -n : n);
            }
          }
          note(s, `collect ${it.id}`);
        }
        break;
    }
  }

  // Teleports last, on ordinary box overlap. (A centre-reached rule used to
  // stand in for the hitbox's 12-unit offset, which interactives did not
  // apply; with the offset turned with the portal, plain overlap matches the
  // real runs — Fingerdash f4923, and three fewer faults in Deadlocked.)
  for (const it of teleports) {
    if (s.usedPortals.has(it.index)) continue;
    s.usedPortals.add(it.index);
    const before = player.y;
    const anchor = it.id === 2902 && s.triggers
      ? groupAnchor(s.triggers.level, s.triggers.rt, propInt(it.props, P.TARGET_GROUP_ID, -1))
      : null;
    // the step runs in the player's frame (src/game/frame.ts)
    const exit = anchor && toLocal(player, anchor.x, anchor.y);
    applyPortal(it.id, it.props, player, run, onDual, exit);
    player.teleported = true;
    s.teleportedStep = true;
    note(s, `portal ${it.id} y${before.toFixed(0)}->${player.y.toFixed(0)}`);
    // **A teleport always reaches the player before the block that stopped
    // it**: `checkCollisions` (m1 0xfe188) walks the sections through
    // 0xff074, which acts on portals, pads and orbs as it meets them but only
    // *collects* solids (type 0/0x15, into [0x3008]) and resolves them after
    // the walk, last collected first (0xfecf8 → `collidedWithObject`). So the
    // player leaves with the velocity it had before this pass's blocks: Dash
    // f14826 (a cube on a block, gravity step kept), Deadlocked f14070 (a
    // flipped ship on a ceiling block). This replaces the fitted section-order
    // test (BUGS PHY-88/92) and is fault-neutral against it.
    if (zeroedBy && zeroedBy.index >= 0) {
      player.yVel = velBeforeCollisions;
    }
    // **The pass carries on at the exit, in object order**: objects listed
    // *after* the teleport are tested at the new position in this same pass
    // (`collisionCheckObjects` walks one list), earlier ones next frame.
    // Deadlocked f11480: teleport #122 drops the flipped cube onto yellow pad
    // #124 and normal-gravity portal #125 — the real cube leaves at exactly
    // -345.6, the pad's -691.2 (fired while still flipped) halved by the
    // flip. Fingerdash f4712 (portal #19 before teleport #20) and Deadlocked
    // f2531 (pads #28/#29 before teleport #30) meet theirs a step later.
    const h = player.mode === "wave" ? 5 * (player.mini ? MINI_SCALE : 1) : b.hw;
    const at: Box = { x: player.x, y: player.y, hw: h, hh: h };
    const there = world.nearInteractives(at, s.triggers?.rt)
      .filter((o) => o.index > it.index && !nowTouching.has(o.index) && touchesRect(at, o))
      .sort((p, q) => p.index - q.index);
    const seen = new Set<number>();
    for (const o of there) {
      if (seen.has(o.index)) continue;
      seen.add(o.index);
      if (o.kind === "pad" && !padSpent(s, o)) {
        nowTouching.add(o.index);
        activatePad(o.id, player);
        spendPad(s, o);
        note(s, `pad ${o.id} at teleport exit`);
      } else if ((o.kind === "portal" || o.kind === "speed") && o.id !== 747 && o.id !== 2902
        && o.id !== 286 && o.id !== 287 && !s.usedPortals.has(o.index)) {
        // (any portal or speed change: Deadlocked f7240, a speed portal listed
        // after the teleport sets the new speed on the exit frame)
        s.usedPortals.add(o.index);
        nowTouching.add(o.index);
        applyPortal(o.id, o.props, player, run, onDual);
        note(s, `portal ${o.id} at teleport exit`);
      }
    }
  }

  // force blocks (world boxes), sideways too: Dash f17615, a sideways robot
  // reaches the 1.4 block at (20085, 1725) on the step a Rotate Gameplay turns
  // it upright, and the real one gets that step's push on the handed-over
  // velocity (421.2 - 10.53 + 15.3 = 425.95)
  if (s.forces?.length) {
    const wb = world instanceof LocalWorld ? boxToWorld(world.frame, b) : b;
    // (blocks sharing a force ID, key 530, push once: Dash's pair at x 21555)
    const seen = new Set<number>();
    for (const f of s.forces) {
      if (Math.abs(wb.x - f.x) < wb.hw + f.hw && Math.abs(wb.y - f.y) < wb.hh + f.hh) {
        if (f.id !== 0) { if (seen.has(f.id)) continue; seen.add(f.id); }
        player.pendingForce = (player.pendingForce ?? 0) + f.force * 0.9 * 54 * 60 * dt;
      }
    }
  }
  // leaving an orb re-arms it, exactly as for pads
  for (const idx of [...s.usedOrbs]) if (!nowTouching.has(idx)) s.usedOrbs.delete(idx);
  s.touching = nowTouching;
  s.onPad = anyPad;
  s.onOrb = anyOrb;
}

/**
 * Advance the whole attempt by one physics step: player 1, then the dual
 * partner if one exists.
 *
 * **Why the partner is a whole `SimState` rather than a second `PlayerState`:**
 * almost everything in `stepOne` is per-player — the interactives it is
 * touching, the orbs it has spent, the portals it has used, whether it is on a
 * pad. In the original these all live on the `PlayerObject`, and two players
 * genuinely do trigger their own copies of the same portal. Giving the partner
 * its own state gets all of that for free and leaves `stepOne` untouched;
 * splitting `PlayerState` out of `SimState` instead would have meant rewriting
 * 300 lines of collision code that is currently correct.
 *
 * Two things are deliberately **shared** rather than copied, by holding the
 * same object on both sides: the **trigger runtime** (one world, one set of
 * tweens — see `skipTriggers`) and the **destroyed** set (a breakable block
 * smashed by one player is gone for both).
 */
/**
 * **An upside-down player that runs off a surface can still jump while it is
 * slow.** Native, logged per step with the game's own `m_isOnGround`
 * (gd-ui-capture `vseek`, 2026-10-03): an upside-down cube or ball that walks
 * off its ceiling keeps the flag while its world y velocity is still small —
 * Cycles f8759–8761 (ball, +0.129/+0.258/+0.387 raw, grounded), Electroman
 * f15576 (cube, +0.216, grounded) — and loses it once past `2·m_gravity` raw
 * (`updateJump`'s clearing test, m1 0x3773bc, compares the velocity with
 * ±2·`[0x790]`); upright players lose it at once (Hexagon Force f2322, Time
 * Machine f11334). That is ~9 steps for a cube at 1x and ~15 for a ball, which
 * is why every fixed window from 5 to 10 fit the runs and 11 did not (Hexagon
 * Force f1778). A player moving away from the surface (a ball's flip off
 * it, Hexagon Force f13130–13160: grounded 0 throughout) has no grace. The
 * flying modes have no jump to keep. The 0.05 s hold-off at the same site is platformer-only
 * (`[0xb08]` = `m_isPlatformer`). `groundGrace` is 1 while the rule holds.
 */
export const GROUND_GRACE = 1;

/** `PlayerObject::isFlying`: the modes that clamp against a ceiling */
function isFlyingMode(m: Gamemode): boolean {
  return m === "ship" || m === "ufo" || m === "wave" || m === "swing";
}

export function simStep(
  s: SimState, world: CollisionWorld, dt: number, holding: boolean,
  onDual?: () => void,
) {
  // one step's worth of presentation events, drained by the scene
  s.effects.length = 0;
  // Once the ending has triggered the players are locked — `lockPlayer`
  // stops their update — but the level's triggers carry on.
  if (s.ended) {
    if (s.triggers) {
      updateTriggers(s.triggers.rt, s.triggers.list, s.player.x, dt, s.player.y);
    }
    return;
  }
  s.steps++;
  const hadDual = s.dual;
  s.player.inDual = !!s.dual;
  if (s.dual) s.dual.player.inDual = true;
  if (s.dual) {
    const edge = isFlyingMode(s.player.mode) || isFlyingMode(s.dual.player.mode) ? 150 : 135;
    s.player.dualEdge = edge;
    s.dual.player.dualEdge = edge;
  }
  // both players move before either one's collisions: a speed portal player 1
  // meets this step must not speed up player 2's move of the same step
  const speedAtStart = s.run.speed;
  // controls switched off by an Options trigger (2899) read as released
  const off = s.triggers?.rt.controlsOff;
  stepOne(s, world, dt, holding && !off?.[0], onDual, false);
  const dual = s.dual;
  // A partner the portal spawned during this step already stands where
  // player 1 ended it — it is not stepped again: Deadlocked f17088, native p2
  // is at p1's own (x, y) on its first frame, not one step ahead.
  if (dual && dual === hadDual && !s.dead) {
    // the partner takes the same input, and the run state (speed, camera
    // centre) is the level's, not the player's — keep them in step
    dual.run = s.run;
    // Hexagon Force f12691 (native capture 2026-09-29): player 1 takes speed
    // portal 202 and the real player 2 still moves at the old speed that step
    // — both keep the same x (the port's partner ran 0.314 ahead ever after).
    const speedAfterP1 = s.run.speed;
    s.run.speed = speedAtStart;
    stepOne(dual, world, dt, holding && !off?.[1], undefined, true, s);
    if (s.run.speed === speedAtStart) s.run.speed = speedAfterP1;
    // either player dying ends the attempt
    if (dual.dead) {
      s.dead = true;
      s.deathCause = dual.deathCause && { ...dual.deathCause, reason: `P2 ${dual.deathCause.reason}` };
    }
  }
  // `PlayLayer::checkForEnd` (m1 0xa84a0): player 1 reaching the portal's
  // spawn x, 300 short of `m_levelLength`, starts the ending — unless dead
  // (`EndPortalObject::triggerObject` +20..36 checks `m_isDead`).
  // A 2.2 End trigger (3600) ends the level on the step the player passes it
  // — after the move, as the real run locks at x 21853.89 (Dash f21714).
  const endPassed = s.triggers !== undefined && !s.player.sideways && (s.triggers.rt.endHit
    || s.triggers.list.some((t) => t.id === 3600 && t.channel === s.triggers!.rt.channel
      && (s.player.reversed ? s.player.x <= t.x : s.player.x >= t.x)));
  if (!s.dead && (s.player.x >= endTriggerX(s.levelLength) || endPassed)) {
    s.ended = true;
    if (endPassed && s.player.x < endTriggerX(s.levelLength)) s.endByTrigger = true;
    note(s, "level end");
  }
}
