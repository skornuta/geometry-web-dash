// The edge fade and enter effects — how objects appear and disappear at the
// sides of the screen. Every rule here is read out of the shipping binary
// (GD 2.2081 arm64); none of it is tuned.
//
// `PlayLayer::updateVisibility` (m1 0xa4b78): an object within 70 units of the
// view's left or right edge gets `t = clamp(distance / 70, 0, 1)` and
// `setOpacity(t * 255)`. It then calls the effect helper (m1 0xa623c), which
// moves or scales the object by the **active enter effect** for its side:
// objects in the right half use the "enter" table, the left half the "exit"
// table (`+0x598` / `+0x5b0` on the layer).
//
// The tables are indexed by enter channel and start at -2 (fade only,
// `resetActiveEnterEffects`, pattern 0xfffffffe). The legacy enter-effect
// triggers write a code into both when they fire (`updateActiveEnterEffect`,
// m1 0xf6eb4) — every classic level uses them (ids 22-28, 55-59).
//
// Measured against native GD at Theory of Everything x=2326, where trigger 27
// is active: opacity and scale both equal t (e.g. 225/255 = 0.885 at 62 units
// from the right edge), and fully faded objects sit at scale 0.

/** width of the fade band at each edge (`0x428c0000`) */
export const FADE_WIDTH = 70;

/** the effect every channel starts with: fade only */
export const DEFAULT_ENTER_CODE = -2;

/** legacy trigger id -> effect code (`updateActiveEnterEffect`) */
export const ENTER_CODE_BY_ID: ReadonlyMap<number, number> = new Map([
  [22, -2],  // no effect: fade only
  [23, -6],  // enter from below
  [24, -5],  // enter from above
  [25, -7],  // enter from the left
  [26, -8],  // enter from the right
  [27, -3],  // scale in from 0
  [28, -4],  // scale down from 1.75
  [55, -11], // random direction
  [56, -10], // diagonal, by screen half
  [57, -9],  // diagonal, by screen half (mirrored)
  [58, -12], // vertical, by screen half
  [59, -13], // vertical, by screen half (mirrored)
  // 2.2's "no effect" (1915, toolbox `edit_eeNone2Btn`): full opacity, no
  // movement (`updateVisibility` +0x96c: code −14 sets opacity 255 and skips
  // the effect helper) — the same code a don't-fade object (+0x541) gets
  [1915, -14],
]);

/** the "no fade, no enter" code */
export const NO_ENTER_CODE = -14;
/** the code a 2.2 custom enter effect (3017–3021) writes: the object takes its channel's custom effects */
export const CUSTOM_ENTER_CODE = -15;

/**
 * A 2.2 custom enter effect (`EnterEffectObject`, ids 3017 move … 3020 fade,
 * 3021 tint). `GJBaseGameLayer` m1 0xa5aa0 runs a channel's list for each
 * object: v = clamp((distance into the view from that side's edge − offset)
 * / length, 0, 1), eased by the ease-in pair; fade multiplies the opacity by
 * it, tint pulls the colour toward the tint channel by (1 − v)·strength.
 */
export interface CustomEnter {
  id: number;
  length: number; offset: number;
  easing: number; rate: number;
  tintCh: number; tint: number;
}

/**
 * Objects that never edge-fade under the default effect. `updateVisibility`
 * (+0x970..0x9b8) gives an object full opacity instead of the 70-unit ramp
 * when `[0x409]` is set, the fade-only code (-2) is in force and it is not a
 * UI object — unless `[0x40c]` is also set and the main sprite sits in the
 * blending layer (`[0x458]`, set by `addMainSpriteToParent` m1 0x4ef2ac).
 * Both flags are per-id defaults from `GameObject::customSetup` (m1
 * 0x4e866c), read by emulating it for every id 1..4599: the outline blocks,
 * their slopes and the light triangles.
 */
export const NO_EDGE_FADE_IDS: ReadonlySet<number> = new Set([
  90, 91, 92, 93, 94, 95, 96, 207, 208, 209, 210, 211, 212, 213, 309, 311,
  331, 333, 472, 473, 474, 687, 688, 693, 694, 1747, 1748,
]);
/** of those, the ones (`[0x40c]`) that fade after all while blending */
export const EDGE_FADE_WHEN_BLENDING_IDS: ReadonlySet<number> = new Set([
  207, 208, 209, 210, 211, 212, 213, 331, 333, 693, 694,
]);

/** whether an object keeps full opacity at the screen edge (see above) */
export function skipsEdgeFade(id: number, code: number, mainBlending: boolean): boolean {
  if (code !== DEFAULT_ENTER_CODE || !NO_EDGE_FADE_IDS.has(id)) return false;
  return !(mainBlending && EDGE_FADE_WHEN_BLENDING_IDS.has(id));
}

/**
 * A legacy enter trigger: where it fires, the code it writes and its enter
 * channel (key 344, `+0x7ec`). `updateActiveEnterEffect` (m1 0xf6eb4) writes
 * the code into `table[channel]`, and `updateVisibility` (m1 0xa52d8) reads
 * the table at the object's own channel (key 343, `+0x3f4`) — so a trigger
 * only moves the objects of its channel. Dash puts 3,046 objects on channels
 * 1, 3 and 4, and 1915s on those channels hold them still.
 */
export interface EnterTrigger {
  x: number; code: number; channel: number;
  /** key 217: 0 both sides, 1 the enter (right) side only, 2 the exit (left) only */
  sides: number;
  custom?: CustomEnter;
}

/** the enter-effect triggers of a level, in x order */
export function enterTriggers(
  objects: readonly { id: number; x: number; props?: ReadonlyMap<number, string> }[],
): EnterTrigger[] {
  return objects
    .filter((o) => ENTER_CODE_BY_ID.has(o.id) || (o.id >= 3017 && o.id <= 3021))
    .map((o) => {
      const n = (k: number, d = 0) => { const v = parseFloat(o.props?.get(k) ?? ""); return Number.isFinite(v) ? v : d; };
      const custom = o.id >= 3017 && o.id <= 3021;
      return {
        x: o.x, code: custom ? CUSTOM_ENTER_CODE : ENTER_CODE_BY_ID.get(o.id)!, channel: n(344) | 0,
        sides: custom ? n(217) | 0 : 0,
        custom: custom ? {
          id: o.id, length: Math.max(1, n(222)), offset: n(220),
          easing: n(242) | 0, rate: n(243, 2), tintCh: n(260) | 0, tint: n(265),
        } : undefined,
      };
    })
    .sort((a, b) => a.x - b.x);
}

/**
 * The code and custom effects in force on one side of one channel once the
 * player has reached `playerX`. A legacy trigger replaces the code (and so
 * the custom list); a custom one sets −15 and joins the list
 * (`updateActiveEnterEffect` / `addCustomEnterEffect` m1 0xf726c).
 */
export function activeEnterEffects(
  triggers: readonly EnterTrigger[], playerX: number, channel: number, enterSide: boolean,
): { code: number; customs: CustomEnter[] } {
  let code = DEFAULT_ENTER_CODE;
  let customs: CustomEnter[] = [];
  for (const t of triggers) {
    if (t.x > playerX) break;
    if (t.channel !== channel) continue;
    if (t.sides === 1 && !enterSide) continue;
    if (t.sides === 2 && enterSide) continue;
    if (t.custom) {
      if (code !== CUSTOM_ENTER_CODE) customs = [];
      code = CUSTOM_ENTER_CODE;
      customs = [...customs.filter((c) => c.id !== t.custom!.id), t.custom];
    } else { code = t.code; customs = []; }
  }
  return { code, customs };
}

/** the code in force once the player has reached `playerX` */
export function activeEnterCode(triggers: readonly EnterTrigger[], playerX: number, channel = 0): number {
  let code = DEFAULT_ENTER_CODE;
  for (const t of triggers) {
    if (t.x > playerX) break;
    if (t.channel === channel) code = t.code;
  }
  return code;
}

/**
 * How far into the view an object at `x` is, 0 at an edge and 1 once it is
 * `FADE_WIDTH` inside. `right` says which half it is in, which picks the table.
 */
export function edgeFade(x: number, left: number, right: number): { t: number; right: boolean } {
  const isRight = x > (left + right) / 2;
  const d = isRight ? right - x : x - left;
  return { t: Math.min(1, Math.max(0, d / FADE_WIDTH)), right: isRight };
}

/**
 * The offset (world units) and scale an effect code applies at fade `t`.
 * `above` is whether the object sits above the screen's vertical centre, which
 * the diagonal/vertical codes use to pick a direction; `randomDeg` is the
 * object's own random angle for code -11 (the game rolls it once on entry).
 */
export function enterTransform(
  code: number, t: number, above: boolean, randomDeg = 0,
): { dx: number; dy: number; scale: number } {
  const k = 1 - t;
  switch (code) {
    case -3: return { dx: 0, dy: 0, scale: t };
    case -4: return { dx: 0, dy: 0, scale: 1 + 0.75 * k };
    case -5: return { dx: 0, dy: 100 * k, scale: 1 };
    case -6: return { dx: 0, dy: -100 * k, scale: 1 };
    case -7: return { dx: -100 * k, dy: 0, scale: 1 };
    case -8: return { dx: 100 * k, dy: 0, scale: 1 };
    case -9: case -10: case -11: case -12: case -13: {
      let deg: number;
      if (code === -11) deg = randomDeg;
      else if (code === -10) deg = above ? -135 : -45;
      else if (code === -9) deg = above ? 135 : 45;
      else if (code === -12) deg = above ? 180 : 0;
      else deg = above ? 360 : 180;
      // `ccpForAngle((angle - 90) degrees) * 100 * (1 - t)`
      const a = (deg - 90) * Math.PI / 180;
      return { dx: Math.cos(a) * 100 * k, dy: Math.sin(a) * 100 * k, scale: 1 };
    }
    default: return { dx: 0, dy: 0, scale: 1 };
  }
}
