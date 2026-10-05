// Easing for tweened triggers — property key 30 (type) and key 85 (rate).
//
// SOURCED from `GameToolbox::getEasedValue` in the shipping 2.2081 binary
// (m1 `0x44f990`), with its bounce helper at `0x44f8a8`. The reference used to
// say the id -> curve mapping was unverified and that the community table must
// not be implemented as fact; decoding the function's 18-entry jump table (at
// `0x1007287a4`) and each case settles it, and the community table turns out to
// be right. Every case is the stock cocos2d-x curve.
//
// Shape of the original, in order:
//   if (type == 0) return value;                 // before the rate guard
//   rate = rate > 0 ? rate : 2.0;                // fcsel s8, s1, s2, hi
//   if ((unsigned)(type - 1) > 17) return value;  // nothing outside 1..18
//   switch (type) { ... }

export const EASING_NAMES = [
  "None",
  "EaseInOut", "EaseIn", "EaseOut",
  "ElasticInOut", "ElasticIn", "ElasticOut",
  "BounceInOut", "BounceIn", "BounceOut",
  "ExponentialInOut", "ExponentialIn", "ExponentialOut",
  "SineInOut", "SineIn", "SineOut",
  "BackInOut", "BackIn", "BackOut",
] as const;

/** the constant every Back curve is built on */
const BACK = 1.70158;
/** BackInOut's is the same one scaled, as in cocos — the binary carries 3.5949095 / 2.5949095 */
const BACK_IO = BACK * 1.525;

/** the bounce curve, m1 0x44f8a8: four parabolas at 4/11, 8/11, 10/11 */
function bounce(t: number): number {
  if (t < 4 / 11) return 7.5625 * t * t;
  if (t < 8 / 11) { const x = t - 6 / 11; return 7.5625 * x * x + 0.75; }
  if (t < 10 / 11) { const x = t - 9 / 11; return 7.5625 * x * x + 0.9375; }
  const x = t - 21 / 22;
  return 7.5625 * x * x + 0.984375;
}

export function easedValue(t: number, type: number, rate: number): number {
  // type 0 returns before the rate guard, so a linear tween never touches it
  if (type === 0) return t;
  const r = rate > 0 ? rate : 2;
  if (type < 1 || type > 18) return t;

  switch (type) {
    case 1: { // EaseInOut
      const t2 = t * 2;
      return t2 < 1 ? 0.5 * t2 ** r : 1 - 0.5 * (2 - t2) ** r;
    }
    case 2: return t ** r;          // EaseIn
    case 3: return t ** (1 / r);    // EaseOut

    case 4: { // ElasticInOut
      if (t === 0 || t === 1) return t;
      const s = r / 4;
      const x = t * 2 - 1;
      return x < 0
        ? -0.5 * 2 ** (10 * x) * Math.sin(((x - s) * Math.PI * 2) / r)
        : 0.5 * 2 ** (-10 * x) * Math.sin(((x - s) * Math.PI * 2) / r) + 1;
    }
    case 5: { // ElasticIn
      if (t === 0 || t === 1) return t;
      const s = r / 4;
      const x = t - 1;
      return -(2 ** (10 * x) * Math.sin(((x - s) * Math.PI * 2) / r));
    }
    case 6: { // ElasticOut
      if (t === 0 || t === 1) return t;
      const s = r / 4;
      return 2 ** (-10 * t) * Math.sin(((t - s) * Math.PI * 2) / r) + 1;
    }

    case 7: // BounceInOut
      return t < 0.5
        ? (1 - bounce(1 - t * 2)) * 0.5
        : bounce(t * 2 - 1) * 0.5 + 0.5;
    case 8: return 1 - bounce(1 - t); // BounceIn
    case 9: return bounce(t);         // BounceOut

    case 10: { // ExponentialInOut
      // t = 0 takes the first branch and yields 0.5 * 2^-10, not 0. Faithful.
      const t2 = t * 2;
      return t2 < 1
        ? 0.5 * 2 ** (10 * (t2 - 1))
        : 0.5 * (2 - 2 ** (-10 * (t2 - 1)));
    }
    case 11: return t === 0 ? 0 : 2 ** (10 * (t - 1)); // ExponentialIn
    case 12: return t === 1 ? 1 : 1 - 2 ** (-10 * t);  // ExponentialOut

    case 13: return -0.5 * (Math.cos(Math.PI * t) - 1); // SineInOut
    case 14: return 1 - Math.cos((t * Math.PI) / 2);    // SineIn
    case 15: return Math.sin((t * Math.PI) / 2);        // SineOut

    case 16: { // BackInOut
      const t2 = t * 2;
      if (t2 < 1) return 0.5 * (t2 * t2 * ((BACK_IO + 1) * t2 - BACK_IO));
      const x = t2 - 2;
      return 0.5 * (x * x * ((BACK_IO + 1) * x + BACK_IO)) + 1;
    }
    case 17: return t * t * ((BACK + 1) * t - BACK);    // BackIn
    default: { // 18 BackOut
      const x = t - 1;
      return x * x * ((BACK + 1) * x + BACK) + 1;
    }
  }
}
