/**
 * The level's ending as the scene plays it — presentation only.
 *
 * `sim.ts` decides *that* the ending has started (`SimState.ended`, from
 * `PlayLayer::checkForEnd`) and locks the players. Everything after that is a
 * timeline of cocos actions in the original, and this class is that timeline:
 * it is advanced by render time, owns no rule, and never feeds back into the
 * sim. The sourced values and their addresses live in `levelEnd.ts`.
 *
 * What it produces each frame, for `scenes/levelEndView.ts` to draw:
 * - where each player is drawn along the pull into the portal, and its spin;
 * - the ghost trail behind them;
 * - circle waves (world or screen space);
 * - the `CCLightFlash` light strips and the white additive flash after them;
 * - the "Level Complete!" banner's scale;
 * - one-shot events (`complete`, `text`, `endLayer`) for the scene to act on
 *   (save, sfx, shake, the results layer).
 */

import {
  COMPLETE_FLASH, COMPLETE_SHAKE_DURATION, COMPLETE_WAVE, FIREWORK_BASES,
  FIREWORK_JITTER, FIREWORK_MARGIN, GHOST_FADE, GHOST_INTERVAL, SPAWN_CIRCLE_DELAYS,
  bannerScale, circleWaveAt, endTimeline, fireworkWave, pullPose, spawnCircleWave,
  textWaves, type CircleWaveSpec, type Point,
} from "./levelEnd.ts";

export type EndEvent = "complete" | "text" | "endLayer";

/** which player colour a piece of the ending is tinted with */
export type EndTint = "p1" | "p2" | "white";

export interface EndWave {
  spec: CircleWaveSpec;
  /** world position, or screen-centred design position when `screen` */
  x: number;
  y: number;
  screen: boolean;
  /** start time on the sequence clock */
  at: number;
  tint: EndTint;
}

export interface EndStrip {
  /** start time on the sequence clock (`CCLightStrip`'s delay) */
  at: number;
  duration: number;
  /** degrees, clockwise, as `setRotation` */
  rotation: number;
  toWidth: number;
  opacity: number;
}

export interface EndGhost {
  x: number;
  y: number;
  /** degrees CW, the spin at the moment of the snapshot */
  spin: number;
  born: number;
  /** 1 or 2 — whose icon it copies */
  player: 1 | 2;
}

export interface EndSequenceOptions {
  practice: boolean;
  /** each player's position the moment the ending triggered */
  start: Point;
  startP2?: Point;
  /** the end portal, `(m_levelLength, updateEndPos's y)` */
  portal: Point;
  viewW: number;
  viewH: number;
  /** `rand() / RAND_MAX`, injectable so tests are deterministic */
  rand?: () => number;
}

export class EndSequence {
  /** seconds since the ending triggered */
  t = 0;
  readonly practice: boolean;
  readonly start: Point;
  readonly startP2?: Point;
  readonly portal: Point;
  readonly times: ReturnType<typeof endTimeline>;
  readonly waves: EndWave[] = [];
  readonly strips: EndStrip[] = [];
  readonly ghosts: EndGhost[] = [];
  /**
   * The fireworks' screen positions and start times — each also gets a
   * `firework.plist` burst, which the scene owns (`gd/effects.ts`).
   */
  readonly fireworks: { x: number; y: number; at: number; spawned: boolean }[] = [];
  /** the white `CCLayerColor` `fadeAndRemove` lays over the screen, or null */
  flashLayer: { at: number } | null = null;
  /** when the light strips are removed (`removeLights`), sequence clock */
  stripsGoneAt = Infinity;
  private fired = new Set<EndEvent>();
  private nextGhost = 0;
  private readonly rand: () => number;
  private readonly viewW: number;
  private readonly viewH: number;

  constructor(o: EndSequenceOptions) {
    this.practice = o.practice;
    this.start = o.start;
    this.startP2 = o.startP2;
    this.portal = o.portal;
    this.viewW = o.viewW;
    this.viewH = o.viewH;
    this.rand = o.rand ?? Math.random;
    this.times = endTimeline(o.practice);
  }

  /** the `EndLevelLayer` has been told to drop */
  get resultsShown(): boolean {
    return this.fired.has("endLayer");
  }

  /** the pull has finished and `levelComplete` has run */
  get complete(): boolean {
    return this.fired.has("complete");
  }

  /** where player `n` is drawn, and how far it has spun (degrees CW) */
  pose(n: 1 | 2 = 1) {
    const from = n === 2 && this.startP2 ? this.startP2 : this.start;
    return pullPose(from, this.portal, this.t);
  }

  /** the banner's scale, 0 when not shown */
  bannerScale(): number {
    return bannerScale(this.t - this.times.text, this.practice);
  }

  /** a shake in flight, as `shakeCamera(1.755, 3, 0)` leaves it */
  shaking(): boolean {
    if (this.practice) return false;
    const s = this.t - this.times.complete;
    return s >= 0 && s < COMPLETE_SHAKE_DURATION;
  }

  /** every live wave with its radius and opacity */
  liveWaves() {
    const out: { wave: EndWave; radius: number; opacity: number }[] = [];
    for (const w of this.waves) {
      const s = circleWaveAt(w.spec, this.t - w.at);
      if (s) out.push({ wave: w, ...s });
    }
    return out;
  }

  /**
   * Advance by `dt` and return the events whose time has come, in order. The
   * ghost trail snapshots are taken here too, at their own 0.05 s interval.
   */
  update(dt: number): EndEvent[] {
    this.t += dt;
    const events: EndEvent[] = [];
    const due = (e: EndEvent, at: number) => {
      if (!this.fired.has(e) && this.t >= at) {
        this.fired.add(e);
        events.push(e);
        this.onEvent(e, at);
      }
    };
    due("complete", this.times.complete);
    due("text", this.times.text);
    due("endLayer", this.times.endLayer);

    // `GhostTrailEffect::trailSnapshot`, scheduled every 0.05 s while the
    // player is being pulled; the ghost stays in the object layer where it was
    // taken and fades on its own
    while (this.nextGhost <= Math.min(this.t, this.times.complete)) {
      for (const n of (this.startP2 ? [1, 2] : [1]) as (1 | 2)[]) {
        const p = pullPose(n === 2 && this.startP2 ? this.startP2 : this.start,
          this.portal, this.nextGhost);
        this.ghosts.push({ x: p.x, y: p.y, spin: p.spin, born: this.nextGhost, player: n });
      }
      this.nextGhost += GHOST_INTERVAL;
    }
    // drop the ones that have faded
    while (this.ghosts.length && this.t - this.ghosts[0].born > GHOST_FADE) this.ghosts.shift();
    return events;
  }

  private onEvent(e: EndEvent, at: number) {
    const sr = this.viewW;
    const px = this.portal.x, py = this.portal.y;
    if (e === "complete") {
      // `levelComplete` +2232..2668: five spawnCircles and one filled wave
      for (const d of SPAWN_CIRCLE_DELAYS) {
        this.waves.push({ spec: spawnCircleWave(sr), x: px, y: py, screen: false, at: at + d, tint: "p1" });
      }
      this.waves.push({ spec: COMPLETE_WAVE, x: px, y: py, screen: false, at, tint: "p1" });
      if (!this.practice) this.playFlash(at);
    } else if (e === "text" && !this.practice) {
      // `showCompleteText` +808..2184
      const w = textWaves(sr);
      this.waves.push({ spec: w.portal, x: px, y: py, screen: false, at, tint: "p1" });
      this.waves.push({ spec: w.banner, x: 0, y: 35, screen: true, at, tint: "p1" });
      for (const d of SPAWN_CIRCLE_DELAYS) {
        this.waves.push({ spec: spawnCircleWave(sr), x: px, y: py, screen: false, at: at + d, tint: "p1" });
      }
      for (const base of FIREWORK_BASES) {
        const when = at + Math.max(0, base + (2 * this.rand() - 1) * FIREWORK_JITTER);
        // a random point at least 50 from every edge, in screen space
        const fx = FIREWORK_MARGIN + (this.viewW - 2 * FIREWORK_MARGIN) * this.rand() - this.viewW / 2;
        const fy = FIREWORK_MARGIN + (this.viewH - 2 * FIREWORK_MARGIN) * this.rand() - this.viewH / 2;
        this.waves.push({ spec: fireworkWave(this.rand()), x: fx, y: fy, screen: true, at: when, tint: "p2" });
        this.fireworks.push({ x: fx, y: fy, at: when, spawned: false });
      }
    }
  }

  /**
   * `CCLightFlash::playEffect` with `showCompleteEffect`'s arguments (m1
   * `0x45b718`). With `circleRotation` the strip angles are spread evenly
   * over `rotation ± variation` and dealt out in random order; each strip
   * starts `i · interval + delay ± variation` in, and `fadeAndRemove`
   * (`0x45bb5c`) runs `delay` after the last one: a white additive
   * `CCLayerColor` fades in over 0.3 s (`CCEaseIn(2)`), the strips are
   * removed, and after 0.5 s it fades out over 1.5 s (`CCEaseInOut(2)`).
   */
  private playFlash(at: number) {
    const f = COMPLETE_FLASH;
    const angles: number[] = [];
    const lo = f.stripRotation - f.stripRotationVariation;
    const span = 2 * f.stripRotationVariation;
    for (let i = 0; i < f.stripCount; i++) angles.push(lo + (span / f.stripCount) * i);
    let last = 0;
    for (let i = 0; i < f.stripCount; i++) {
      const pick = Math.floor(this.rand() * angles.length) % angles.length;
      const rotation = angles.splice(pick, 1)[0];
      const delay = i * f.stripInterval + f.stripStartDelay
        + (2 * this.rand() - 1) * f.stripStartDelayVariation;
      last = Math.max(last, delay);
      this.strips.push({
        at: at + delay,
        duration: f.stripDuration + (2 * this.rand() - 1) * f.stripDurationVariance,
        rotation,
        toWidth: f.endWidth + (2 * this.rand() - 1) * f.endWidthVariation,
        opacity: Math.max(0, Math.min(255, f.stripOpacity + (2 * this.rand() - 1) * f.stripOpacityVariation)) / 255,
      });
    }
    const flashAt = at + last + f.delay;
    this.flashLayer = { at: flashAt };
    this.stripsGoneAt = flashAt + FLASH_FADE_IN;
  }

  /** the white flash's opacity (0..1) right now */
  flashOpacity(): number {
    if (!this.flashLayer) return 0;
    const s = this.t - this.flashLayer.at;
    if (s < 0) return 0;
    if (s < FLASH_FADE_IN) return (s / FLASH_FADE_IN) ** 2; // CCEaseIn(2)
    const s2 = s - FLASH_FADE_IN - FLASH_HOLD;
    if (s2 < 0) return 1;
    if (s2 < FLASH_FADE_OUT) {
      const k = (s2 / FLASH_FADE_OUT) * 2; // CCEaseInOut(2)
      const e = k < 1 ? 0.5 * k * k : 1 - 0.5 * (2 - k) * (2 - k);
      return 1 - e;
    }
    return 0;
  }

  /** every visible light strip, with its current width and length */
  liveStrips(endHeight: number) {
    const out: { strip: EndStrip; width: number; height: number }[] = [];
    if (this.t >= this.stripsGoneAt) return out;
    for (const s of this.strips) {
      const k = (this.t - s.at) / s.duration;
      if (k < 0) continue;
      // `CCLightStrip::init`: width and height tween over `duration`, `CCEaseOut(2)`
      const e = Math.sqrt(Math.min(1, k));
      const f = COMPLETE_FLASH;
      out.push({
        strip: s,
        width: f.startWidth + (s.toWidth - f.startWidth) * e,
        height: endHeight * e,
      });
    }
    return out;
  }
}

/** `fadeAndRemove`: `CCFadeIn(0.3)`, then `CCDelayTime(0.5)`, then `CCFadeOut(1.5)` */
export const FLASH_FADE_IN = 0.3;
export const FLASH_HOLD = 0.5;
export const FLASH_FADE_OUT = 1.5;
