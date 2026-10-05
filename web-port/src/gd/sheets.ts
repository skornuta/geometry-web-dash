// Sheet name -> asset basename. Kept free of any renderer/DOM import so that
// headless tooling (scripts/autoplay.mjs) can load the same atlases in node.
import type { SheetName } from "./objects.ts";

export const SHEET_FILES: Record<SheetName, string> = {
  game: "GJ_GameSheet-hd",
  game02: "GJ_GameSheet02-hd",
  game03: "GJ_GameSheet03-hd",
  game04: "GJ_GameSheet04-hd",
  icons: "GJ_GameSheetIcons-hd",
  fire: "FireSheet_01-hd",
  particle: "GJ_ParticleSheet-hd",
  // level 22's pixel-art decoration lives here and nowhere else; without it
  // 138 generated defs resolve to a sheet with no file and the atlas loader
  // asks for `undefined.plist`.
  pixel: "PixelSheet_01-hd",
  // object glow (`gd/glow.ts`): one additive batch under each z layer
  glow: "GJ_GameSheetGlow-hd",
};

/** hd art is 2x world units, so world size = frame size * HD */
export const HD = 0.5;
