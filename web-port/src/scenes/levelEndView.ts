/**
 * Drawing for the level's ending: the end portal (`EndPortalObject`) and
 * everything `EndSequence` produces. Presentation only — the rules are in
 * `sim.ts`, the sourced values in `gd/levelEnd.ts`, the timeline in
 * `gd/endSequence.ts`.
 *
 * cocos draws the circle waves and light strips with `ccDrawFilledCircle`,
 * `ccDrawCircle` and `ccDrawSolidPoly`, not sprites. The renderer only draws
 * textured quads, so a filled disc is a quad over a disc texture, a ring is
 * the same segment count `CCCircleWave::draw` picks as thin quads, and a strip
 * is a quad over a trapezoid texture whose narrow end is a quarter of the wide
 * one — `CCLightStrip::draw` (m1 `0x45c044`) makes the base
 * `start + (width − start) · 0.25` wide.
 *
 * APPROXIMATION: `glLineWidth(4)` is 4 framebuffer pixels in cocos, so a ring's
 * thickness depends on the display; it is drawn as 4 HD pixels (2 units).
 */

import { createTexture, type SpriteFrame } from "../engine/atlas.ts";
import type { Renderer } from "../engine/renderer.ts";
import { HD } from "./levelScene.ts";
import {
  END_GRADIENT_DX, END_GRADIENT_FRAME, END_WALL_FRAME, END_WALL_HEIGHT_MULT,
  END_WALL_ROTATION, GHOST_FADE, GHOST_OPACITY, GHOST_SCALE, COMPLETE_FLASH,
  endWallSquares, type Point,
} from "../gd/levelEnd.ts";
import type { EndGhost, EndSequence, EndTint } from "../gd/endSequence.ts";

interface Tex { tex: WebGLTexture; texW: number; texH: number; frame: SpriteFrame }

function canvasTexture(renderer: Renderer, w: number, h: number,
  paint: (g: CanvasRenderingContext2D) => void): Tex {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  paint(g);
  return {
    tex: createTexture(renderer.ctx, c), texW: w, texH: h,
    frame: { x: 0, y: 0, w, h, rotated: false, offsetX: 0, offsetY: 0, sourceW: w, sourceH: h },
  };
}

export interface EndViewTextures {
  white: Tex;
  disc: Tex;
  trapezoid: Tex;
}

export function createEndViewTextures(renderer: Renderer, white: Tex): EndViewTextures {
  return {
    white,
    disc: canvasTexture(renderer, 128, 128, (g) => {
      g.beginPath();
      g.arc(64, 64, 63, 0, Math.PI * 2);
      g.fill();
    }),
    // wide end up: the strip grows away from its base
    trapezoid: canvasTexture(renderer, 64, 128, (g) => {
      g.beginPath();
      g.moveTo(24, 128);
      g.lineTo(40, 128);
      g.lineTo(64, 0);
      g.lineTo(0, 0);
      g.closePath();
      g.fill();
    }),
  };
}

type Rgb = { r: number; g: number; b: number };

export interface EndViewColors { p1: Rgb; p2: Rgb }

function tint(t: EndTint, c: EndViewColors): Rgb {
  return t === "p1" ? c.p1 : t === "p2" ? c.p2 : { r: 1, g: 1, b: 1 };
}

/** `CCCircleWave::draw`'s segment count for `ccDrawCircle` (+144..276) */
function ringSegments(radius: number): number {
  if (radius < 10) return 10;
  if (radius < 20) return 15;
  if (radius < 40) return 20;
  if (radius < 200) return 30;
  return 50;
}

export function drawWave(renderer: Renderer, tx: EndViewTextures, x: number, y: number,
  radius: number, lineWidth: number, outline: boolean, c: Rgb, a: number) {
  if (!outline) {
    const d = tx.disc;
    renderer.draw(d.tex, d.texW, d.texH, d.frame, x, y, radius * 2, radius * 2, 0,
      c.r, c.g, c.b, a, "additive");
    return;
  }
  const n = ringSegments(radius);
  const w = tx.white;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const x0 = x + Math.cos(a0) * radius, y0 = y + Math.sin(a0) * radius;
    const x1 = x + Math.cos(a1) * radius, y1 = y + Math.sin(a1) * radius;
    renderer.draw(w.tex, w.texW, w.texH, w.frame, (x0 + x1) / 2, (y0 + y1) / 2,
      Math.hypot(x1 - x0, y1 - y0), lineWidth * HD, Math.atan2(y1 - y0, x1 - x0),
      c.r, c.g, c.b, a, "additive");
  }
}

export interface GameSheet {
  tex: WebGLTexture; texW: number; texH: number;
  atlas: { get(name: string): SpriteFrame | null | undefined };
}

/**
 * The end portal: the column of `square_02_001` and the additive
 * `gradientBar` (`EndPortalObject::init` `0x321974`). Its particle
 * (`endEffectPortal.plist`) belongs to the effects pass.
 */
export function drawEndPortal(renderer: Renderer, sheet: GameSheet | null | undefined,
  portal: Point, viewH: number) {
  if (!sheet) return;
  const sq = sheet.atlas.get(END_WALL_FRAME);
  const bar = sheet.atlas.get(END_GRADIENT_FRAME);
  if (bar) {
    const h = viewH * END_WALL_HEIGHT_MULT;
    renderer.draw(sheet.tex, sheet.texW, sheet.texH, bar,
      portal.x + END_GRADIENT_DX, portal.y, bar.w * HD, h, 0, 1, 1, 1, 1, "additive");
  }
  if (sq) {
    const rot = (-END_WALL_ROTATION * Math.PI) / 180;
    for (const dy of endWallSquares(viewH)) {
      // rotated −90, so the drawn width is the frame's height
      renderer.draw(sheet.tex, sheet.texW, sheet.texH, sq,
        portal.x - 15, portal.y + dy, sq.w * HD, sq.h * HD, rot, 1, 1, 1, 1);
    }
  }
}

/** the ghost trail, drawn under the icons it copies; `draw` puts one icon copy */
export function drawEndGhosts(
  seq: EndSequence, draw: (g: EndGhost, alpha: number, scale: number) => void,
) {
  for (const g of seq.ghosts) {
    const k = Math.min(1, (seq.t - g.born) / GHOST_FADE);
    draw(g, GHOST_OPACITY * (1 - k), 1 + (GHOST_SCALE - 1) * k);
  }
}

/** world-space parts over the players: the circle waves on the portal and the light strips */
export function drawEndWorld(
  renderer: Renderer, seq: EndSequence, tx: EndViewTextures, colors: EndViewColors,
  viewW: number, viewH: number,
) {
  for (const { wave, radius, opacity } of seq.liveWaves()) {
    if (wave.screen) continue;
    drawWave(renderer, tx, wave.x, wave.y, radius, wave.spec.lineWidth,
      wave.spec.outline, tint(wave.tint, colors), opacity);
  }
  // `endHeight`: the screen diagonal sqrt(w² + (h/2)²) + 10 (showCompleteEffect +260..304)
  const endHeight = Math.hypot(viewW, viewH / 2) + COMPLETE_FLASH.endHeightPad;
  const c = colors.p1;
  const t = tx.trapezoid;
  for (const { strip, width, height } of seq.liveStrips(endHeight)) {
    if (height <= 0) continue;
    // `setRotation` is degrees clockwise about the base; the strip reaches up
    const r = (-strip.rotation * Math.PI) / 180;
    const cx = seq.portal.x - Math.sin(r) * height / 2;
    const cy = seq.portal.y + Math.cos(r) * height / 2;
    renderer.draw(t.tex, t.texW, t.texH, t.frame, cx, cy, width, height, r,
      c.r, c.g, c.b, strip.opacity, "additive");
  }
}

/**
 * Screen-space parts, drawn with the camera at the view centre: the waves
 * `showCompleteText` puts on `PlayLayer` itself (banner wave, fireworks) and
 * the banner.
 */
export function drawEndScreen(
  renderer: Renderer, seq: EndSequence, tx: EndViewTextures, colors: EndViewColors,
  banner: (scale: number) => void,
) {
  for (const { wave, radius, opacity } of seq.liveWaves()) {
    if (!wave.screen) continue;
    drawWave(renderer, tx, wave.x, wave.y, radius, wave.spec.lineWidth,
      wave.spec.outline, tint(wave.tint, colors), opacity);
  }
  const s = seq.bannerScale();
  if (s > 0) banner(s);
}

/** `fadeAndRemove`'s white additive layer, over everything including the results */
export function drawEndFlash(
  renderer: Renderer, seq: EndSequence, tx: EndViewTextures, viewW: number, viewH: number,
) {
  const f = seq.flashOpacity();
  if (f <= 0) return;
  const w = tx.white;
  renderer.draw(w.tex, w.texW, w.texH, w.frame, 0, 0, viewW, viewH, 0, 1, 1, 1, f, "additive");
}
