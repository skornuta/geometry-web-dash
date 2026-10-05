/**
 * Shared UI sprite drawing — the `CCSprite`-from-a-sprite-frame half of the
 * original's menus, and nothing more.
 *
 * Everything here is sourced; see `docs/ui-parity/REFERENCE.md` §4 and §7.
 *
 * Three facts drive the whole file:
 *
 * 1. **A cocos sprite built from a trimmed frame reports the *untrimmed* size
 *    as its content size.** `spriteSourceSize` is therefore the layout and
 *    hit-box box, while `textureRect` is only what gets rasterised.
 * 2. **The trim offset is the drawn quad's centre offset.** Working through
 *    `CCSprite::setTextureRect`, the quad centre ends up at
 *    `offsetPosition + rectSize/2 = spriteOffset + contentSize/2`, i.e. exactly
 *    `spriteOffset` away from the anchor point. No other term survives.
 * 3. **`atlas.ts` already normalises *atlas packing* rotation**: `frame.w/h` is
 *    the displayed size and the renderer remaps the UVs, so a 90°-packed frame
 *    needs no special handling. The sprite's *own* rotation is different — that
 *    turns the trim offset with it, which `drawUiSprite` does.
 *
 * HD art is 2x design units (`HD = 0.5`), the same conversion the level
 * renderer uses.
 */

import type { Renderer } from "../engine/renderer.ts";
import {
  createTexture, loadAtlas, loadImage, setRepeatWrap,
  type Atlas, type SpriteFrame,
} from "../engine/atlas.ts";
import { HD } from "../gd/sheets.ts";

export interface UiSheet {
  name: string;
  atlas: Atlas;
  tex: WebGLTexture;
  texW: number;
  texH: number;
}

/** a frame plus the sheet it was found in — everything `drawUiSprite` needs */
export interface UiFrame {
  sheet: UiSheet;
  frame: SpriteFrame;
  name: string;
}

/** design-space size of a frame's *untrimmed* box: the cocos content size */
export function contentSize(frame: SpriteFrame): { w: number; h: number } {
  return { w: frame.sourceW * HD, h: frame.sourceH * HD };
}

/** design-space size of the drawn (trimmed) quad */
export function drawnSize(frame: SpriteFrame): { w: number; h: number } {
  return { w: frame.w * HD, h: frame.h * HD };
}

/**
 * A name -> frame index across several atlases.
 *
 * Lookup is **required by default**: a missing frame throws rather than
 * silently drawing nothing. The whole point of the plan's rule is that a
 * mistyped or unshipped frame has to fail loudly in development and in the
 * browser harnesses, not disappear behind a `.catch(() => null)`.
 */
export class UiSprites {
  private readonly sheets: UiSheet[] = [];
  private readonly index = new Map<string, UiFrame>();

  /** `basenames` are asset basenames without extension, e.g. `GJ_GameSheet03-hd` */
  static async load(renderer: Renderer, basenames: readonly string[]): Promise<UiSprites> {
    const sprites = new UiSprites();
    for (const base of basenames) {
      const loaded = await loadAtlas(renderer, `/assets/${base}.plist`, `/assets/${base}.png`);
      sprites.add({ name: base, ...loaded });
    }
    return sprites;
  }

  add(sheet: UiSheet) {
    this.sheets.push(sheet);
    for (const [name, frame] of sheet.atlas) {
      // first sheet listed wins, so the caller controls precedence by order
      if (!this.index.has(name)) this.index.set(name, { sheet, frame, name });
    }
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  /** the only lookup the UI should use: an unknown frame is a bug, not a blank */
  require(name: string): UiFrame {
    const found = this.index.get(name);
    if (!found) {
      throw new Error(
        `UI sprite frame "${name}" is in none of the loaded sheets ` +
        `(${this.sheets.map((s) => s.name).join(", ")})`,
      );
    }
    return found;
  }

  /** every frame name that was asked for and missing is reported at once */
  requireAll(names: readonly string[]): Map<string, UiFrame> {
    const missing = names.filter((n) => !this.index.has(n));
    if (missing.length) {
      throw new Error(
        `UI sprite frames missing from ${this.sheets.map((s) => s.name).join(", ")}: ` +
        missing.join(", "),
      );
    }
    return new Map(names.map((n) => [n, this.require(n)]));
  }
}

export interface DrawOptions {
  /** uniform scale, multiplying the HD conversion */
  scale?: number;
  /** rgba tint, 0..1 each; defaults to opaque white */
  r?: number; g?: number; b?: number; a?: number;
  rotation?: number;
  /** an extra y scale on top of `scale`, as `setScaleY` — the trim offset's y scales with it */
  scaleY?: number;
  /**
   * `CCSprite::setFlipX/Y`. Flipping mirrors the texture **and negates that
   * axis of the trim offset** (`setTextureRect`, cocos2d-x issue #732). A
   * mirrored frame drawn with a raw `renderer.draw` loses its offset entirely,
   * which put the level select's prev arrow 2.5 units too high (REFERENCE.md
   * §19.4).
   */
  flipX?: boolean;
  flipY?: boolean;
}

/**
 * Draw a UI sprite whose **anchor point is its centre** at design-space (x, y).
 *
 * `x`/`y` name the anchor, which for a trimmed frame is *not* the middle of the
 * drawn pixels — the trim offset moves the quad. Getting this wrong shifts
 * `GJ_logo_001` (offset 3,-3) by a pixel and a half and every button by half of
 * its own trim, which is exactly the class of error the plan calls out.
 */
export function drawUiSprite(
  renderer: Renderer, uiFrame: UiFrame, x: number, y: number, opts: DrawOptions = {},
) {
  const { sheet, frame } = uiFrame;
  const scale = opts.scale ?? 1;
  const sy = scale * (opts.scaleY ?? 1);
  const rot = opts.rotation ?? 0;
  const size = drawnSize(frame);
  // The trim offset lives in the sprite's own space, so it turns with the
  // sprite. It is zero for most UI art and non-zero for exactly the frames a
  // rotating decoration uses, which is where getting this wrong would show.
  let ox = frame.offsetX * HD * scale * (opts.flipX ? -1 : 1);
  let oy = frame.offsetY * HD * sy * (opts.flipY ? -1 : 1);
  if (rot !== 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    [ox, oy] = [ox * c - oy * s, ox * s + oy * c];
  }
  renderer.draw(
    sheet.tex, sheet.texW, sheet.texH, frame,
    x + ox, y + oy,
    size.w * scale, size.h * sy, rot,
    opts.r ?? 1, opts.g ?? 1, opts.b ?? 1, opts.a ?? 1,
    "normal", opts.flipX ?? false, opts.flipY ?? false,
  );
}

/**
 * Convert a position expressed in the original's UI space — origin at the
 * bottom-left of the win size, +Y up — into the port's design space, whose
 * origin is the middle of the view.
 *
 * This is a **UI-local** conversion. It has nothing to do with the gameplay
 * `gd_y = our_y + 90` offset; menu positions are not world heights.
 */
export function fromGdUi(x: number, y: number, viewW: number, viewH: number): { x: number; y: number } {
  return { x: x - viewW / 2, y: y - viewH / 2 };
}

/**
 * The original's screen-bounds accessors. On desktop, with no safe-area inset,
 * `CCDirector` sets them straight from the win size — see REFERENCE.md §3 for
 * the four one-instruction getters and the single writer that fills them.
 */
export function screenBounds(viewW: number, viewH: number) {
  return { top: viewH, bottom: 0, left: 0, right: viewW };
}

/**
 * `CCScale9Sprite`, the nine-slice panel. Added because `LevelPage::init`
 * needs one: `CCScale9Sprite::create("square02_001.png", CCRect(0,0,80,80))`.
 *
 * **The cap insets are not a design choice.** cocos's `initWithFile(file, rect)`
 * leaves `capInsets` zero, and `updateWithBatchNode` then derives them as the
 * middle third of the rect on each axis — so an 80x80 rect gives 26.667-point
 * borders. Passing a hand-picked inset here would be exactly the "insets from
 * defaults rather than evidence" the plan forbids.
 */
export interface LooseTexture {
  tex: WebGLTexture;
  /** texture size in pixels */
  texW: number;
  texH: number;
}

/**
 * A whole PNG as a single frame. The original loads a handful of UI textures
 * this way rather than out of an atlas — the slider parts, the progress bars,
 * the panel nine-slices — so `require()`ing them from a sheet would be wrong.
 *
 * `repeat` applies cocos's own repeat wrap, which the slider and progress bars
 * need so a rect wider than the texture tiles instead of smearing its last
 * column.
 */
export async function loadLooseTexture(
  renderer: Renderer, url: string, opts: { repeat?: boolean } = {},
): Promise<LooseTexture & { frame: SpriteFrame }> {
  const img = await loadImage(url);
  const tex = createTexture(renderer.ctx, img);
  if (opts.repeat) setRepeatWrap(renderer.ctx, tex);
  return {
    tex, texW: img.width, texH: img.height,
    frame: {
      x: 0, y: 0, w: img.width, h: img.height, rotated: false,
      offsetX: 0, offsetY: 0, sourceW: img.width, sourceH: img.height,
    },
  };
}

export function drawNineSlice(
  renderer: Renderer, t: LooseTexture,
  cx: number, cy: number, w: number, h: number,
  opts: DrawOptions = {},
) {
  // design-space size of the whole texture, and the middle-third borders
  const fullW = t.texW * HD, fullH = t.texH * HD;
  const bw = fullW / 3, bh = fullH / 3;
  const midW = Math.max(0, w - bw * 2);
  const midH = Math.max(0, h - bh * 2);
  const r = opts.r ?? 1, g = opts.g ?? 1, b = opts.b ?? 1, a = opts.a ?? 1;
  // column/row extents in texture pixels and in design units
  const colPx = [0, t.texW / 3, (t.texW * 2) / 3];
  const colWpx = [t.texW / 3, t.texW / 3, t.texW / 3];
  const rowPx = [0, t.texH / 3, (t.texH * 2) / 3];
  const rowHpx = [t.texH / 3, t.texH / 3, t.texH / 3];
  const colW = [bw, midW, bw];
  const rowH = [bh, midH, bh];
  // left edge and top edge of the panel in design space
  let x = cx - w / 2;
  for (let c = 0; c < 3; c++) {
    let y = cy + h / 2;
    for (let rI = 0; rI < 3; rI++) {
      const cw = colW[c], ch = rowH[rI];
      if (cw > 0 && ch > 0) {
        renderer.draw(t.tex, t.texW, t.texH, {
          x: colPx[c], y: rowPx[rI], w: colWpx[c], h: rowHpx[rI],
          rotated: false, offsetX: 0, offsetY: 0, sourceW: colWpx[c], sourceH: rowHpx[rI],
        }, x + cw / 2, y - ch / 2, cw, ch, 0, r, g, b, a);
      }
      y -= ch;
    }
    x += colW[c];
  }
}
