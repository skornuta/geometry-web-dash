// HSV colour transformation, read out of the shipping 2.2081 binary rather than
// reconstructed from a community write-up.
//
// | function | m1 address |
// |---|---|
// | `GameToolbox::transformColor(ccColor3B const&, ccHSVValue)` | `0x449884` |
// | cocos `RGBtoHSV` | `0x32d930` |
// | cocos `HSVtoRGB` | `0x32d9dc` |
//
// The one surprise is the identity test. `transformColor` opens by comparing
// the value against a static at `0x1008b97e0`, which sits in __DATA's zero-fill
// tail and is never written — so the sentinel it compares against is an
// **all-zero** `ccHSVValue`, and that is also what `EffectGameObject`'s
// constructor stores as the default copy-HSV (`0x1a230c`). A copy channel with
// no key 10 therefore copies its source *verbatim*; it does not multiply
// saturation and brightness by zero and come out black.

export interface HSV {
  /** degrees, added to the source hue */
  h: number;
  s: number;
  v: number;
  /** true adds `s` instead of multiplying by it */
  sAbsolute: boolean;
  vAbsolute: boolean;
}

export interface Rgb { r: number; g: number; b: number }

/** the value that means "leave the colour alone" — see the note above */
export const NO_HSV: HSV = { h: 0, s: 0, v: 0, sAbsolute: false, vAbsolute: false };

/** `fmaxnm d1, d1, 0x3f1a36e2e0000000` — the floor both channels clamp to */
const HSV_FLOOR = 1e-4;

export function isNoHSV(x: HSV): boolean {
  return x.h === 0 && x.s === 0 && x.v === 0 && !x.sAbsolute && !x.vAbsolute;
}

/**
 * `h_s_v_sAbsolute_vAbsolute`, separated by the letter `a`
 * (`"0a1a0.7a0a0"`, `"-50a1a1a0a0"`). Anything that does not parse is the
 * no-transform sentinel — a malformed string must not tint a level black.
 */
export function parseHSV(s: string): HSV {
  const p = s.split("a");
  if (p.length !== 5) return NO_HSV;
  const n = p.map(Number);
  if (n.some((x) => !Number.isFinite(x))) return NO_HSV;
  return { h: n[0], s: n[1], v: n[2], sAbsolute: n[3] === 1, vAbsolute: n[4] === 1 };
}

/** cocos `RGBtoHSV` (0x32d930): components in 0..1, hue in degrees 0..360 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max <= 0) return { h: -1, s: 0, v: max };
  const delta = max - min;
  let h: number;
  if (r >= max) h = delta === 0 ? 0 : (g - b) / delta;
  else if (g >= max) h = 2 + (b - r) / delta;
  else h = 4 + (r - g) / delta;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: delta / max, v: max };
}

/** cocos `HSVtoRGB` (0x32d9dc): hue in degrees, components in 0..1 */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  // `fcmp d1, #0.0; b.ls` also takes the branch on NaN, and a NaN hue then
  // yields black rather than the value
  if (!(s > 0)) {
    const grey = Number.isNaN(h) ? 0 : v;
    return { r: grey, g: grey, b: grey };
  }
  const sector = h < 360 ? h / 60 : 0;
  const i = Math.trunc(sector);
  const f = sector - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}

const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x)));

/** `GameToolbox::transformColor` (0x449884) */
export function transformColor(c: Rgb, x: HSV): Rgb {
  if (isNoHSV(x)) return { r: byte(c.r), g: byte(c.g), b: byte(c.b) };

  let { h, s, v } = rgbToHsv(byte(c.r) / 255, byte(c.g) / 255, byte(c.b) / 255);

  if (x.h !== 0) {
    h += x.h;
    if (h < 0) {
      // one addition only, and the >360 wrap below is skipped
      h += 360;
    } else if (h > 360) {
      // the original truncates to int before the modulo, dropping the fraction
      h = Math.trunc(h) % 360;
    }
  }
  s = x.sAbsolute ? s + x.s : s * x.s;
  s = Math.max(Math.min(s, 1), HSV_FLOOR);
  v = x.vAbsolute ? v + x.v : v * x.v;
  v = Math.max(Math.min(v, 1), HSV_FLOOR);

  const o = hsvToRgb(h, s, v);
  // `fcvtzs` truncates toward zero — it does not round
  return { r: Math.trunc(o.r * 255), g: Math.trunc(o.g * 255), b: Math.trunc(o.b * 255) };
}

/**
 * Channel 1007, "LBG" — `GJEffectManager::calculateLightBGColor` (m1
 * 0x2845c8), which `PlayLayer::updateVisibility` calls every frame with
 * player colour 1 (`activeColorForIndex(1005)`):
 *
 *   L = transformColor(BG, h 0, s -0.2, v +0.2, both absolute)
 *   sum = BG.r + BG.g + BG.b
 *   LBG = sum > 149 ? L : clamp(L * sum/150 + P1 * (1 - sum/150))
 *
 * so a dark background's LBG leans toward the player's colour. Fingerdash's
 * lava waves (1050) draw in it: yellow-orange natively, white while the port
 * left 1007 unset.
 */
export function lightBgColor(bg: Rgb, p1: Rgb): Rgb {
  const L = transformColor(bg, { h: 0, s: -0.2, v: 0.2, sAbsolute: true, vAbsolute: true });
  const sum = byte(bg.r) + byte(bg.g) + byte(bg.b);
  if (sum > 149) return L;
  const t = sum / 150;
  const mix = (l: number, p: number) => Math.trunc(Math.max(0, Math.min(255, l * t + p * (1 - t))));
  return { r: mix(L.r, p1.r), g: mix(L.g, p1.g), b: mix(L.b, p1.b) };
}
