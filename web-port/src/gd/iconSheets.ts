/**
 * GD 2.2's per-icon sprite sheets.
 *
 * The shipped game keeps each icon in its own small atlas under `icons/` —
 * `player_31-hd.plist`, `robot_05-hd.plist` and so on — and the legacy
 * `GJ_GameSheetIcons` holds only the older half of them (248 of 485 cubes, one
 * swing of 43). A native garage capture showed 14 pages of cubes against the
 * port's 7 (REFERENCE.md §19.5), which is how this was found.
 *
 * Frame names inside a per-icon sheet are the same ones `iconFrames` already
 * produces (`player_31_001.png`, `robot_05_01_2_001.png`, …), so a loaded sheet
 * is simply added to whatever `UiSprites` the scene draws from.
 */

import type { Renderer } from "../engine/renderer.ts";
import { loadAtlas } from "../engine/atlas.ts";
import type { Gamemode } from "./gamemodes.ts";
import type { UiSheet, UiSprites } from "../ui/sprites.ts";

/** the file prefix each gamemode's sheets use */
export const ICON_SHEET_PREFIX: Record<Gamemode, string> = {
  cube: "player",
  ship: "ship",
  ball: "player_ball",
  ufo: "bird",
  wave: "dart",
  robot: "robot",
  spider: "spider",
  swing: "swing",
};

/** `player_31-hd`: indices are zero-padded to two digits, as the files are */
export function iconSheetBase(mode: Gamemode, idx: number): string {
  return `${ICON_SHEET_PREFIX[mode]}_${String(idx).padStart(2, "0")}-hd`;
}

/**
 * Loads icon sheets on demand and adds each to one `UiSprites`. A sheet is
 * fetched once however many callers ask for it; a sheet that fails to load
 * rejects, so a missing icon is an error in the console rather than a silently
 * blank square.
 */
export class IconSheets {
  private readonly renderer: Renderer;
  private readonly sprites: UiSprites;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly loaded = new Set<string>();

  constructor(renderer: Renderer, sprites: UiSprites) {
    this.renderer = renderer;
    this.sprites = sprites;
  }

  isLoaded(mode: Gamemode, idx: number): boolean {
    return this.loaded.has(iconSheetBase(mode, idx));
  }

  load(mode: Gamemode, idx: number): Promise<void> {
    const base = iconSheetBase(mode, idx);
    let p = this.pending.get(base);
    if (!p) {
      p = loadAtlas(this.renderer, `/assets/icons/${base}.plist`, `/assets/icons/${base}.png`)
        .then((sheet) => {
          const ui: UiSheet = { name: base, ...sheet };
          this.sprites.add(ui);
          this.loaded.add(base);
        });
      this.pending.set(base, p);
    }
    return p;
  }

  loadAll(list: readonly (readonly [Gamemode, number])[]): Promise<void> {
    return Promise.all(list.map(([m, i]) => this.load(m, i))).then(() => undefined);
  }
}
