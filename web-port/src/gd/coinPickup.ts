/**
 * Secret-coin pickup presentation, decoded from GD 2.209 arm64 (not certified
 * 2.2081 parity). Addresses below are image-relative, without 0x100000000:
 *   pickup 0x1f2604..0x1f2744: four frames at .05s, .75s flight,
 *     delay .5s then fade .25s; no rotation action for the secret coin.
 *   cubic helper 0x1f16b4: controls/endpoint below, in y-up world units.
 * Idle spin is separate (`objectAnim.ts`, .115s/frame). Particles and circle
 * waves are also separate: this module owns only the transient coin sprite.
 */
export const COIN_PICKUP_DURATION = 0.75;
export const COIN_PICKUP_FRAME_TIME = 0.05;
export const COIN_PICKUP_FADE_DELAY = 0.5;
export const COIN_PICKUP_FADE_DURATION = 0.25;

export interface CoinPickupOptions {
  /** Resolved world position at collection, including moving-group transforms. */
  readonly x: number;
  readonly y: number;
  /** Saved before the attempt, not newly collected this attempt. */
  readonly outline?: boolean;
  /** Sample once on creation: native r1 in [-1,1], r2 in [0,1]. No RNG here. */
  readonly randomX: number;
  readonly randomY: number;
  /** Caller-supplied sprite scale; flight distances do not scale with HD art. */
  readonly scale?: number;
}

/** Transient presentation only: clear on restart/checkpoint rewind, not sim state. */
export interface CoinPickup {
  readonly x: number;
  readonly y: number;
  readonly outline: boolean;
  readonly randomX: number;
  readonly randomY: number;
  readonly scale: number;
  /** Elapsed game seconds since collection (pause must not advance this). */
  readonly age: number;
}

export interface CoinPickupPose {
  readonly x: number;
  readonly y: number;
  /** 1-based atlas frame, `secretCoin_[b_]01_001..004.png`. */
  readonly frame: number;
  readonly alpha: number;
  readonly outline: boolean;
  readonly scale: number;
}

export function createCoinPickup(options: CoinPickupOptions): CoinPickup {
  return { ...options, outline: options.outline ?? false, scale: options.scale ?? 1, age: 0 };
}

/** Immutable stepping; null removes the sprite when the native action ends. */
export function stepCoinPickup(state: CoinPickup, dt: number): CoinPickup | null {
  const age = state.age + Math.max(0, dt);
  return age >= COIN_PICKUP_DURATION ? null : { ...state, age };
}

/** Absolute-age sampling, independent of render rate or the level's idle clock. */
export function coinPickupPose(state: CoinPickup): CoinPickupPose {
  const age = Math.max(0, state.age);
  const t = Math.min(1, age / COIN_PICKUP_DURATION), u = 1 - t;
  const dx = 50 * state.randomX;
  const lift = 1 + 0.1 * state.randomY;
  // Use relative coordinates to avoid unnecessary cancellation at large level x.
  return {
    x: state.x + (3 * u * t * t + t * t * t) * dx,
    y: state.y + 3 * u * u * t * 90 * lift + 3 * u * t * t * 180 * lift - t * t * t * 80,
    frame: Math.floor(age * (1 / COIN_PICKUP_FRAME_TIME)) % 4 + 1,
    alpha: 1 - Math.min(1, Math.max(0, (age - COIN_PICKUP_FADE_DELAY) / COIN_PICKUP_FADE_DURATION)),
    outline: state.outline,
    scale: state.scale,
  };
}
