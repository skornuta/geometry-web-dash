/**
 * The invisible objects (144, 145, 205, 459) and the screen-edge fade.
 *
 * **SOURCED** from the 2.2081 binary (arm64 slice, geode m1 addresses).
 *
 * `PlayLayer::updateVisibility` (m1 `0xa4b78`) hands every `[0x430]` object to
 * `PlayLayer::updateInvisibleBlock` (m1 `0xa5820`) once a frame. It computes
 * its four bounds first (+664..720), from the window size `W` and a second
 * screen measure `R`:
 *
 * ```
 *   leftFadeBound  = W/2 - 75          rightFadeBound = W/2 + 35
 *   leftFadeWidth  = (W/2 - 75) - 30   rightFadeWidth = R - (W/2 + 35) - 90
 * ```
 *
 * and `updateInvisibleBlock` turns them into two opacities (+240..400):
 *
 * ```
 *   d = objX > camLeft + rightFadeBound ? objX - (camLeft + rightFadeBound)
 *                                       : (camLeft + leftFadeBound) - objX
 *   f = clamp(d / max(width, 1), 0, 1)
 *   setOpacity    ((f * 0.95 + 0.05) * 255, capped)
 *   setGlowOpacity((f * 0.85 + 0.15) * 255, capped)
 * ```
 *
 * The cap is the **screen-edge fade** (+84..236, and the same ramp standalone
 * at `0xa6a48`): the object's x is first pulled toward the screen centre by its
 * own half-width, and then
 *
 * ```
 *   cap = clamp(coef * (halfW - |x - centre|), 0, 1),  coef = 0.02 right, 0.0143 left
 * ```
 *
 * so an object is at full strength everywhere except the last ~50 (right) or
 * ~70 (left) units before the screen edge, where it fades out.
 *
 * Above 0.8 opacity the object's colour is mixed toward the background colour
 * (+420..580, `GJEffectManager::getMixedColor` `0x28475c`):
 *
 * ```
 *   ratio = ((opacity - 0.8) / -0.2 + 1) * 0.3 + 0.7     // 1.0 at 0.8, 0.7 at 1.0
 * ```
 *
 * **APPROXIMATION A30.** Three inputs are not identified: the layer fields
 * `[0x4b4]` (read as the camera's left edge), `[0x30d0]` (read as half the
 * visible width) and `[0x30cc]` (read as the screen centre), plus `R`, the
 * return of the cocos getter at `0x3ea8e8` (read as the visible width). Each is
 * consistent with every use seen, but none was confirmed against a running
 * game — the native capture is blocked.
 */

/** how strongly an invisible object draws, and how its glow does */
export interface InvisibleFade {
  opacity: number;
  glowOpacity: number;
  /** how far to mix the object's colour toward the background (0 = not at all) */
  mix: number;
}

/**
 * `updateInvisibleBlock` for one object.
 *
 * `x` is the object's world x, `camX` the camera centre and `viewW` the visible
 * width — the port's equivalents of `[0x4b4] + W/2`, `[0x30cc]` and `W`.
 * `halfWidth` is the object's own half-width, which the original subtracts so
 * the *near* edge decides the edge fade.
 */
export function invisibleFade(
  x: number, halfWidth: number, camX: number, viewW: number,
): InvisibleFade {
  const halfW = viewW / 2;
  // +88..112: nudge the position toward the screen centre by the half-width
  const nudged = x > camX ? x - halfWidth : x + halfWidth;
  // the screen-edge cap (+128..236)
  const coef = nudged > camX ? 0.02 : 0.0143;
  const cap = clamp01(coef * (halfW - Math.abs(nudged - camX)));
  // the fade band around the player (+240..292)
  const leftBound = camX - 75, rightBound = camX + 35;
  const past = x > rightBound;
  const d = past ? x - rightBound : leftBound - x;
  const width = Math.max(past ? halfW - 125 : halfW - 105, 1);
  const f = clamp01(d / width);
  const opacity = Math.min(f * 0.95 + 0.05, cap);
  const glowOpacity = Math.min(f * 0.85 + 0.15, cap);
  // +420..580: over 0.8 the colour mixes toward the background
  const mix = opacity > 0.8 ? clamp01(((opacity - 0.8) / -0.2 + 1) * 0.3 + 0.7) : 0;
  return { opacity, glowOpacity, mix };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
