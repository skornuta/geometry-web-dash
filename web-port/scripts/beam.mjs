// The beam search's *selection policy*, extracted from autoplay.mjs so it can
// be unit-tested. Nothing here touches a world, a sim step or the filesystem:
// it decides which of many candidate states survive to the next tick, which is
// the part that decides whether the search finds a level's real route.
//
// A candidate is `{ sim, ... }`; only `sim.player`, `sim.dual` and `sim.run`
// are read, so tests can hand these functions plain objects.
import { ROBOT_HOLD_MAX } from "../src/gd/gamemodes.ts";
import { toLocal } from "../src/game/frame.ts";

/**
 * Height along the player's own gravity axis. In a normal level that is world
 * y; under Rotate Gameplay (Dash) the gravity axis may be world x, and sorting
 * or bucketing by world y there collapsed every candidate of a vertical section
 * into one — they all travel the same y at the same rate.
 */
export function lat(p) {
  return p.sideways || p.reversed ? toLocal(p, p.x, p.y).y : p.y;
}

/**
 * The robot can cancel gravity for `ROBOT_HOLD_MAX` seconds *per jump*, so its
 * jump height is continuously variable rather than fixed. That makes the
 * remaining budget genuine search state: two robots at the same y and yVel, one
 * fresh off the ground and one with the float spent, reach completely different
 * heights from here. Without this the beam collapsed them into one entry and
 * kept whichever it happened to see first.
 *
 * `jumping` is in the key for the same reason: the charge only runs on an arc
 * the robot's own jump started, so an identical-looking arc off a pad or an
 * orb cannot float at all.
 */
export function robotKey(p) {
  if (p.mode !== "robot") return "";
  return `|R${p.jumping ? 1 : 0}${Math.round((p.holdTime / ROBOT_HOLD_MAX) * 10)}`;
}

/**
 * The cube's landing snap slides x by up to a unit, so two candidates at the
 * same frame are no longer at the same x — and the block it last landed on
 * decides whether the *next* landing snaps at all. Both are genuine search
 * state; without them the beam collapsed a snapped candidate into an unsnapped
 * one and kept whichever came first, which cost whole sections in levels 11,
 * 19 and 21.
 */
export function snapKey(p) {
  if (p.mode !== "cube") return "";
  return `|S${Math.round(p.x)}|${p.snapObject}`;
}

/**
 * Buckets a state so that near-identical candidates collapse into one. The
 * resolution is deliberately coarse: two runs 2 units apart in y play the same.
 */
export function key(s) {
  const p = s.player;
  const d = s.dual?.player;
  // The dual partner is part of the state: two branches with player 1 in the
  // same place but the partner at different heights are NOT interchangeable,
  // and deduping them together would silently throw away the surviving one.
  return `${p.mode}|${p.gravityFlipped ? 1 : 0}|${p.mini ? 1 : 0}|${p.dash}|`
    + `${p.sideways ? "S" : ""}${p.reversed ? "R" : ""}`
    + `${Math.round(lat(p) / 3)}|${Math.round(p.yVel / 30)}|${p.onGround ? 1 : 0}|`
    + `${Math.round(s.run.speed)}`
    + robotKey(p) + snapKey(p)
    + (d ? `|D${Math.round(d.y / 3)}|${Math.round(d.yVel / 30)}|${d.onGround ? 1 : 0}${robotKey(d)}${snapKey(d)}` : "");
}

/** drop candidates that play identically, preserving order */
function dedupe(nodes) {
  const seen = new Set();
  const uniq = [];
  for (const n of nodes) {
    const k = key(n.sim);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(n);
  }
  return uniq;
}

/** `count` items spread evenly across an already-sorted list */
function evenly(sorted, count) {
  if (count >= sorted.length) return sorted.slice();
  if (count === 1) return [sorted[0]];
  return Array.from({ length: count }, (_, i) =>
    sorted[Math.round((i * (sorted.length - 1)) / (count - 1))]);
}

/**
 * The smallest slice of the beam any live gamemode is guaranteed. It exists to
 * prevent extinction, not to give every class equal billing — see `prune`.
 */
const MIN_CLASS_SHARE = 1 / 8;

/** how many of `width` slots each class holds in `kept` */
function countByClass(nodes) {
  const counts = new Map();
  for (const n of nodes) {
    const c = modeClass(n);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return counts;
}

/**
 * Rebuild a pruned beam so no class sits below `floor`, paying for the top-up
 * out of the classes that hold the most slots. Only reached when some class is
 * actually starving; otherwise `prune` returns the altitude spread untouched.
 */
function liftStarvedClasses(all, kept, floor) {
  const target = countByClass(kept);
  let owed = 0;
  for (const [c, g] of all) {
    const want = Math.min(g.length, floor);
    const has = target.get(c) ?? 0;
    if (has < want) {
      owed += want - has;
      target.set(c, want);
    }
  }
  // pay for it from the most over-represented class first, one slot at a time,
  // so the cost lands where there is the most redundancy
  const payers = [...target.keys()].filter((c) => target.get(c) > floor);
  while (owed > 0 && payers.length) {
    payers.sort((a, b) => target.get(b) - target.get(a));
    const c = payers[0];
    if (target.get(c) <= floor) break;
    target.set(c, target.get(c) - 1);
    owed--;
  }
  const out = [];
  for (const [c, g] of all) {
    const take = target.get(c) ?? 0;
    if (!take) continue;
    g.sort((a, b) => lat(a.sim.player) - lat(b.sim.player));
    out.push(...evenly(g, take));
  }
  return out;
}

/**
 * Keep at most `width` candidates, spread by altitude — with a floor under
 * every live gamemode so none of them can be squeezed out of existence.
 *
 * The altitude spread is what a beam wants *within* one kind of player, but
 * across kinds it hands out slots by POPULATION, and that silently loses
 * levels. Measured on level 19: past the ship portal at x=17055 the beam held
 * thousands of robots that had missed the portal and were coasting along the
 * ground, against a few dozen UFOs actually flying the route. x advances at a
 * fixed rate for everyone, so the stragglers looked exactly as "productive" as
 * the real route; the UFOs got ~5 of 256 slots, died out by x=20500, and the
 * last robot's death at x=22130 was reported as the level's wall — a solid
 * band an isolated UFO search flies straight past. The floor took level 19
 * from 69.0% back to 89.9%, its pre-regression baseline.
 *
 * **A floor, not an even split.** Splitting the beam equally between classes
 * also fixes level 19, but it promotes minorities that were never starving:
 * level 17's dual wave corridor runs two classes at ~50/50 and needs every
 * slot's worth of altitude resolution, and an even split cost it its
 * completion (100% -> 50.9%). So when no class is below the floor — which is
 * every prune on most levels — this returns the plain altitude spread
 * unchanged, exactly as before.
 */
export function prune(nodes, width) {
  const uniq = dedupe(nodes);
  if (uniq.length <= width) return uniq;
  uniq.sort((a, b) => lat(a.sim.player) - lat(b.sim.player));
  const kept = evenly(uniq, width);

  const all = new Map();
  for (const n of uniq) {
    const c = modeClass(n);
    const g = all.get(c);
    if (g) g.push(n);
    else all.set(c, [n]);
  }
  if (all.size === 1) return kept;
  // The floor must stay affordable: with enough live classes an eighth each
  // costs more than the beam has, nobody is above the floor to pay for it, and
  // the beam silently runs wide — which makes `--beam=N` mean nothing.
  const floor = Math.max(1, Math.min(Math.floor(width * MIN_CLASS_SHARE),
                                     Math.floor(width / all.size)));
  const have = countByClass(kept);
  const starved = [...all].some(([c, g]) => (have.get(c) ?? 0) < Math.min(g.length, floor));
  return starved ? liftStarvedClasses(all, kept, floor) : kept;
}

/** the coarse "kind of player" a candidate is: mode, gravity, size */
export function modeClass(n) {
  const p = n.sim.player;
  return `${p.mode}${p.gravityFlipped ? "f" : ""}${p.mini ? "m" : ""}`;
}
