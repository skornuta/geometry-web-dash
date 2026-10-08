// Copies the assets the web port needs from ../steam-gd/Resources into public/assets.
// Uses -hd resolution atlases/fonts (2x). Skips -uhd to keep size reasonable.
import { cpSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "..", "steam-gd", "Resources");
const dst = join(root, "public", "assets");

if (!existsSync(src)) {
  console.error("steam-gd/Resources not found next to web-port/");
  process.exit(1);
}

/** the loose .ogg files gameplay actually uses */
const GAMEPLAY_SFX = new Set([
  "explode_11.ogg",   // death
  "endStart_02.ogg",  // level complete
  "playSound_01.ogg", // start / retry
  "quitSound_01.ogg",
]);

/**
 * The particle plists gameplay loads (src/gd/effects.ts `EFFECT_PLISTS`), and
 * the loose textures they and the streak name. These exist only at the SD
 * tier; a particle quad is stretched to its own size, so the tier does not
 * matter.
 */
const PARTICLE_FILES = new Set([
  ...["dragEffect", "landEffect", "shipDragEffect", "explodeEffect", "burstEffect2",
    "ringEffect", "bumpEffect", "portalEffect01", "portalEffect02", "portalEffect03",
    "portalEffect04", "portalEffect08", "portalEffect09", "speedEffect_slow",
    "speedEffect_normal", "speedEffect_fast", "speedEffect_vfast", "speedEffect_vvfast",
    "coinPickupEffect", "endEffectPortal", "levelComplete01", "firework",
    "boost_01_effect", "boost_02_effect", "boost_03_effect", "boost_04_effect", "glitterEffect"].map((n) => `${n}.plist`),
  "square.png", "circle.png", "streak_01_001.png", "gravityLine_001.png",
]);

const files = readdirSync(src);
const want = (f) => {
  if (f.endsWith("-hd.png") || f.endsWith("-hd.plist") || f.endsWith("-hd.fnt")) return true;
  if (f.endsWith(".mp3")) return true; // main-level music
  // classic gameplay sfx live loose in Resources, not in sfx/ (which is the
  // numeric 2.2 library) — without these the game is silent on death/complete
  if (GAMEPLAY_SFX.has(f)) return true;
  if (f === "LevelStats.dat") return true;
  if (PARTICLE_FILES.has(f)) return true;
  return false;
};

mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of files) {
  if (want(f)) {
    cpSync(join(src, f), join(dst, f));
    n++;
  }
}
// sfx + levels folders wholesale (small)
for (const dir of ["sfx", "levels"]) {
  cpSync(join(src, dir), join(dst, dir), { recursive: true });
  n += readdirSync(join(src, dir)).length;
}
// GD 2.2 ships every icon as its own small sheet in icons/ (player_485-hd.plist
// etc.); GJ_GameSheetIcons holds only the older half of them. The -hd tier of
// all of them is ~11 MB, loaded one icon at a time (src/gd/iconSheets.ts).
const iconSrc = join(src, "icons");
const iconDst = join(dst, "icons");
mkdirSync(iconDst, { recursive: true });
for (const f of readdirSync(iconSrc)) {
  if (f.endsWith("-hd.png") || f.endsWith("-hd.plist")) {
    cpSync(join(iconSrc, f), join(iconDst, f));
    n++;
  }
}
console.log(`copied ${n} asset files -> public/assets/`);
