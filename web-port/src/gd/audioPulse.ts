// Music-reactive object scale ("audio scale"): orbs and the pulsing balls /
// rings beat with the song.
//
// From the 2.2081 arm64 binary:
//
// * `FMODAudioEngine::updateMetering` (m1 0x35dd20) reads the output's peak
//   level (`FMOD::DSP::getMeteringInfo`, the mean of left and right when
//   stereo), divides it by the music volume (+0x1b8) and runs this state
//   machine over `m_pulse1..3` / `m_pulseCounter` (+0x1c8/+0x1cc/+0x1d0/+0x1d4)
//   — see `stepPulse`.
// * `PlayLayer::updateVisibility` (m1 0xa4d8c, 0xa5414) takes the pulse through
//   `getMeteringValue` (m1 0x360cbc) and, for every object whose
//   `customSetup` set `m_usesAudioScale` (+0x3c8) and whose level key 372
//   (`m_hasNoAudioScale`, +0x3c9, parsed in `objectFromVector` m1 0x4f1d70)
//   is off, calls `setRScale(pulse)` — the object drawn at its own scale times
//   the pulse (`setRScaleX` m1 0x4ed7bc). Objects with `m_customAudioScale`
//   (+0x41e) map it into their range instead: `min + (pulse - 0.1)·(max - min)`.
//
// The id table and ranges come from running `customSetup` (m1 0x4e866c) for
// every id under an emulator (scratchpad emu_cs3.py).

/** ids with `m_usesAudioScale`; value = the custom [min, max], or null */
export const AUDIO_SCALE: ReadonlyMap<number, readonly [number, number] | null> = new Map<number, readonly [number, number] | null>([
  // orbs and pads' rings
  [36, null], [84, null], [141, null], [1333, null], [1594, null], [1704, null], [1751, null], [3004, null],
  // pulsing balls and rods
  [37, null], [50, null], [51, null], [52, null], [53, null], [54, null], [60, null],
  [148, null], [149, null], [405, null], [3027, null],
  // the 0.8–1.2 ones
  [132, [0.8, 1.2]], [133, [0.8, 1.2]], [136, [0.8, 1.2]], [150, [0.8, 1.2]], [236, [0.8, 1.2]],
  [460, [0.8, 1.2]], [494, [0.8, 1.2]], [495, [0.8, 1.2]], [496, [0.8, 1.2]], [497, [0.8, 1.2]],
]);

/** level key 372: "no audio scale" */
export const KEY_NO_AUDIO_SCALE = 372;

export interface PulseState {
  /** m_pulse1: the value objects scale by */
  p1: number;
  /** m_pulse2: last step's value */
  p2: number;
  /** m_pulse3: the peak that started the current beat */
  p3: number;
  /** m_pulseCounter */
  n: number;
}

export function newPulse(): PulseState {
  return { p1: 0, p2: 0, p3: 0, n: 0 };
}

const f = Math.fround;

/**
 * One `updateMetering` step. `peak` is the output peak already divided by the
 * music volume. A loud enough new peak starts a beat at 1.1× its level;
 * otherwise the pulse decays by 0.93 a step.
 */
export function stepPulse(s: PulseState, peak: number): void {
  const v = f(peak);
  const beat = s.n >= 3
    && f(v + f(0.1)) >= f(s.p2 * f(1.1))
    && !(v < f(s.p3 * f(0.95)) && s.p2 > f(s.p3 * f(0.2)));
  let p1: number;
  if (beat) {
    s.p3 = v;
    p1 = f(v * f(1.1));
    s.n = 1;
  } else {
    p1 = f(s.p2 * f(0.93));
    s.n++;
  }
  s.p1 = p1;
  if (!(p1 > f(0.1))) s.p3 = 0;
  s.p2 = p1;
}

/**
 * The relative scale an audio-scale object draws at for pulse `p`. Orbs are
 * `RingObject`s, whose `setRScale` (m1 0x16e5dc) lifts it to
 * `min(p + 0.3, 1.2)` — so they beat between 0.4 and 1.2 rather than shrinking
 * to the 0.1 rest the pulsing balls fall to.
 */
export function audioScaleFactor(range: readonly [number, number] | null, p: number, ring = false): number {
  const r = range ? range[0] + (p - 0.1) * (range[1] - range[0]) : p;
  return ring ? Math.min(r + 0.3, 1.2) : r;
}

/**
 * `AudioEffectsLayer`, the pulse an official song drives from its audio string
 * (`LevelTools::getAudioString`, m1 0x458324: "time~pulse~time~pulse…", built
 * into the layer by `PlayLayer::setupHasCompleted` at m1 0x9cb60). When a song
 * has one, `PlayLayer::postUpdate` (m1 0xa8434) steps this every frame and
 * `updateVisibility` scales the audio-scale objects by its `m_audioScale`
 * (+0x244) instead of the FMOD meter.
 *
 * * `audioStep(dt)` (m1 0x4119a8): the clock (+0x238) advances by dt; if the
 *   next pair's time has passed, that one pair is taken and — unless in
 *   practice ([PlayLayer+0x3058]) — `triggerEffect(pulse)` runs. One pair per
 *   step.
 * * `triggerEffect(p)` (m1 0x411a64): p 1 → 4, 0.9 → 3, 0.8 → 2.5, else p;
 *   target = min(scale + 0.2·that, 1.1). Ignored while the last beat is still
 *   rising (!+0x240) above the new target (+0x23c). Otherwise: a 0.05 s tween
 *   of "audioScale" to the target, then (+0x240 set) a 0.2 s tween down to 0.1
 *   — the rest value, which is what a paused native frame shows (L16 75%: the
 *   d_ball at scale 0.1).
 */
export class AudioEffects {
  private pairs: number[] = [];
  private next = 0;
  private time = 0;
  /** m_audioScale */
  value = 0.1;
  private lastTarget = 0;
  private goingDown = false;
  private tween: { from: number; to: number; t: number; dur: number; then: "down" | null } | null = null;

  constructor(audioString: string) {
    const parts = audioString.split("~").map(Number);
    for (let i = 0; i + 1 < parts.length; i += 2) {
      if (Number.isFinite(parts[i]) && Number.isFinite(parts[i + 1])) this.pairs.push(parts[i], parts[i + 1]);
    }
  }

  /** level time this layer has reached */
  get clock(): number { return this.time; }

  /**
   * Restart at level time `t` (a new attempt or a practice checkpoint —
   * `resetAudioVars`, m1 0x411960, rebuilds the layer): at rest, with the
   * pairs before `t` already spent.
   */
  seek(t: number): void {
    this.time = t;
    this.next = 0;
    while (this.next + 1 < this.pairs.length && this.pairs[this.next] < t) this.next += 2;
    this.value = 0.1; this.lastTarget = 0; this.goingDown = false; this.tween = null;
  }

  /** `audioStep` + the running tween, over `dt` seconds of level time */
  step(dt: number, practice = false): void {
    this.time += dt;
    this.advanceTween(dt);
    if (this.next + 1 < this.pairs.length && this.pairs[this.next] < this.time) {
      const p = this.pairs[this.next + 1];
      this.next += 2;
      if (!practice) this.trigger(p);
    }
  }

  private trigger(p: number): void {
    const f32 = Math.fround;
    const m = p === 1 ? 4 : p === f32(0.9) || p === 0.9 ? 3 : p === f32(0.8) || p === 0.8 ? 2.5 : p;
    const target = Math.min(this.value + m * 0.2, 1.1);
    if (!this.goingDown && this.lastTarget > target) return;
    this.lastTarget = target;
    this.goingDown = false;
    this.tween = { from: this.value, to: target, t: 0, dur: 0.05, then: "down" };
  }

  private advanceTween(dt: number): void {
    let tw = this.tween;
    let left = dt;
    while (tw && left > 0) {
      const use = Math.min(left, tw.dur - tw.t);
      tw.t += use; left -= use;
      this.value = tw.from + (tw.to - tw.from) * Math.min(1, tw.t / tw.dur);
      if (tw.t >= tw.dur) {
        if (tw.then === "down") {
          this.goingDown = true;
          tw = this.tween = { from: tw.to, to: 0.1, t: 0, dur: 0.2, then: null };
        } else tw = this.tween = null;
      }
    }
  }
}
