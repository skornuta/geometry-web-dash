// BMFont (.fnt text format) parser + text drawing on top of Renderer.
import { Renderer } from "./renderer.ts";
import { createTexture, loadImage } from "./atlas.ts";

export interface Glyph {
  x: number; y: number; w: number; h: number;
  xoffset: number; yoffset: number; xadvance: number;
}

export interface BMFont {
  lineHeight: number;
  base: number;
  scaleW: number; scaleH: number;
  glyphs: Map<number, Glyph>;
  kernings: Map<string, number>;
}

export function parseBMFont(text: string): BMFont {
  const font: BMFont = { lineHeight: 0, base: 0, scaleW: 0, scaleH: 0, glyphs: new Map(), kernings: new Map() };
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0]) continue;
    const attrs = new Map<string, string>();
    for (const p of parts.slice(1)) {
      const eq = p.indexOf("=");
      if (eq > 0) attrs.set(p.slice(0, eq), p.slice(eq + 1).replace(/^"|"$/g, ""));
    }
    if (parts[0] === "common") {
      font.lineHeight = parseInt(attrs.get("lineHeight") ?? "0");
      font.base = parseInt(attrs.get("base") ?? "0");
      font.scaleW = parseInt(attrs.get("scaleW") ?? "0");
      font.scaleH = parseInt(attrs.get("scaleH") ?? "0");
    } else if (parts[0] === "char") {
      const id = parseInt(attrs.get("id") ?? "0");
      font.glyphs.set(id, {
        x: parseInt(attrs.get("x") ?? "0"),
        y: parseInt(attrs.get("y") ?? "0"),
        w: parseInt(attrs.get("width") ?? "0"),
        h: parseInt(attrs.get("height") ?? "0"),
        xoffset: parseInt(attrs.get("xoffset") ?? "0"),
        yoffset: parseInt(attrs.get("yoffset") ?? "0"),
        xadvance: parseInt(attrs.get("xadvance") ?? "0"),
      });
    } else if (parts[0] === "kerning") {
      font.kernings.set(`${attrs.get("first")},${attrs.get("second")}`, parseInt(attrs.get("amount") ?? "0"));
    }
  }
  return font;
}

export class LoadedFont {
  font: BMFont;
  tex: WebGLTexture;
  constructor(font: BMFont, tex: WebGLTexture) {
    this.font = font;
    this.tex = tex;
  }

  static async load(renderer: Renderer, fntUrl: string, pngUrl: string): Promise<LoadedFont> {
    const [text, img] = await Promise.all([
      fetch(fntUrl).then((r) => r.text()),
      loadImage(pngUrl),
    ]);
    return new LoadedFont(parseBMFont(text), createTexture(renderer.ctx, img));
  }

  /**
   * A single line's width in font pixels — **`CCLabelBMFont`'s content width**,
   * which is what every anchor, `limitLabelWidth` and scale-to-fit in the
   * original is computed from (`createFontChars`, cocos2d-x 2.2):
   *
   *   longestLine = the furthest the pen reaches, advancing by
   *                 `xadvance + kerning` per glyph;
   *   width = longestLine + (last.width - last.xadvance)   if the last glyph is
   *           wider than its advance, else longestLine.
   *
   * The second term was missing here, and it is not cosmetic: bigFont's `s` is
   * 9 px wider than its advance, so "Stereo Madness" measured 272 pt instead of
   * cocos's 276.5, the level page picked a 2% larger name scale, and every
   * centred label sat half an overhang to the right. A native capture showed
   * it (REFERENCE.md §19.4).
   */
  measure(s: string): number {
    let pen = 0, longest = 0, prev = -1;
    let last: { w: number; xadvance: number } | null = null;
    for (const ch of s) {
      const id = ch.codePointAt(0)!;
      const g = this.font.glyphs.get(id);
      if (!g) { prev = id; continue; }
      pen += g.xadvance + (prev >= 0 ? this.font.kernings.get(`${prev},${id}`) ?? 0 : 0);
      longest = Math.max(longest, pen);
      prev = id;
      last = g;
    }
    if (last && last.xadvance < last.w) return longest + last.w - last.xadvance;
    return longest;
  }

  /**
   * Draw text. x/y = world-space position of the text baseline start (y-up).
   * align: -1 left, 0 center, 1 right (affects x only).
   * scale: world units per font pixel.
   */
  draw(
    renderer: Renderer, s: string, x: number, y: number, scale: number,
    r: number, g: number, b: number, a = 1, align: -1 | 0 | 1 = -1,
  ) {
    const { font } = this;
    let penX = align === 0 ? x - (this.measure(s) * scale) / 2 : align === 1 ? x - this.measure(s) * scale : x;
    let prev = -1;
    for (const ch of s) {
      const id = ch.codePointAt(0)!;
      const gl = font.glyphs.get(id);
      if (!gl) { prev = id; continue; }
      if (prev >= 0) penX += (font.kernings.get(`${prev},${id}`) ?? 0) * scale;
      if (gl.w > 0 && gl.h > 0) {
        const frame = {
          x: gl.x, y: gl.y, w: gl.w, h: gl.h,
          rotated: false, offsetX: 0, offsetY: 0, sourceW: gl.w, sourceH: gl.h,
        };
        // BMFont y is down from top; world y is up. Glyph top sits at baseline - (lineHeight - yoffset)... use base.
        const gx = penX + gl.xoffset * scale;
        const gy = y + (font.base - gl.yoffset - gl.h) * scale;
        renderer.draw(this.tex, font.scaleW, font.scaleH, frame, gx + (gl.w * scale) / 2, gy + (gl.h * scale) / 2, gl.w * scale, gl.h * scale, 0, r, g, b, a);
      }
      penX += gl.xadvance * scale;
      prev = id;
    }
  }
}
