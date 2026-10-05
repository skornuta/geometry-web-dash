// cocos2d sprite-frame atlas: parses a plist (via parsePlist) into a name->frame map.
import { parsePlist, type PlistValue } from "./plist.ts";

export interface SpriteFrame {
  /** texture rect in pixels */
  x: number; y: number; w: number; h: number;
  /** whether the frame is rotated 90° CW in the texture */
  rotated: boolean;
  /** offset of the trimmed frame center from the untrimmed center (pixels, y-up) */
  offsetX: number; offsetY: number;
  /** untrimmed size (pixels) */
  sourceW: number; sourceH: number;
}

export type Atlas = Map<string, SpriteFrame>;

function parsePoint(s: string): [number, number] {
  const m = s.match(/\{?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}?/);
  if (!m) throw new Error(`bad point: ${s}`);
  return [parseFloat(m[1]), parseFloat(m[2])];
}

function parseRect(s: string): [number, number, number, number] {
  const nums = [...s.matchAll(/-?[\d.]+/g)].map((m) => parseFloat(m[0]));
  if (nums.length !== 4) throw new Error(`bad rect: ${s}`);
  return [nums[0], nums[1], nums[2], nums[3]];
}

export function parseAtlas(plistXml: string): Atlas {
  const root = parsePlist(plistXml) as { frames: { [k: string]: PlistValue } };
  const atlas: Atlas = new Map();
  for (const [name, raw] of Object.entries(root.frames)) {
    const f = raw as Record<string, PlistValue>;
    // cocos2d v3 format uses textureRect/textureRotated/spriteOffset/spriteSourceSize;
    // older format uses frame/rotated/offset/sourceSize.
    let x: number, y: number, w: number, h: number, rotated: boolean;
    let offsetX = 0, offsetY = 0, sourceW: number, sourceH: number;
    if (f.textureRect !== undefined) {
      [x, y, w, h] = parseRect(f.textureRect as string);
      rotated = f.textureRotated === true;
      [offsetX, offsetY] = parsePoint((f.spriteOffset as string) ?? "{0,0}");
      [sourceW, sourceH] = parsePoint((f.spriteSourceSize as string) ?? `{${w},${h}}`);
    } else {
      [x, y, w, h] = parseRect(f.frame as string);
      rotated = f.rotated === true;
      [offsetX, offsetY] = parsePoint((f.offset as string) ?? "{0,0}");
      [sourceW, sourceH] = parsePoint((f.sourceSize as string) ?? `{${w},${h}}`);
    }
    if (rotated) [w, h] = [h, w]; // normalize: w/h = displayed size
    atlas.set(name, {
      x, y,
      w: rotated ? h : w, h: rotated ? w : h,
      rotated,
      offsetX, offsetY,
      sourceW, sourceH,
    });
  }
  return atlas;
}

/** Load atlas plist + texture in the browser. */
export async function loadAtlas(gl: GL, plistUrl: string, pngUrl: string): Promise<{ atlas: Atlas; tex: WebGLTexture; texW: number; texH: number }> {
  const [xml, img] = await Promise.all([
    fetch(plistUrl).then((r) => r.text()),
    loadImage(pngUrl),
  ]);
  const tex = createTexture(gl.ctx, img);
  return { atlas: parseAtlas(xml), tex, texW: img.width, texH: img.height };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

export function createTexture(ctx: WebGL2RenderingContext, img: TexImageSource): WebGLTexture {
  const tex = ctx.createTexture()!;
  ctx.bindTexture(ctx.TEXTURE_2D, tex);
  ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, img);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
  return tex;
}

/**
 * cocos's `CCTexture2D::setTexParameters({GL_LINEAR, GL_LINEAR, GL_REPEAT,
 * GL_REPEAT})`, which `Slider::init` and `PlayLayer::setupHasCompleted` both
 * apply to their bar texture. Without it a rect wider than the texture clamps
 * to its last column instead of tiling, and a 32-unit bar art stretched across
 * a 206-unit slider loses its pattern entirely.
 */
export function setRepeatWrap(ctx: WebGL2RenderingContext, tex: WebGLTexture) {
  ctx.bindTexture(ctx.TEXTURE_2D, tex);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.REPEAT);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.REPEAT);
}

// local alias to avoid circular import
export interface GL { ctx: WebGL2RenderingContext }
