/**
 * M7 — the 22 classic main levels, as the level-select screen needs them.
 *
 * **Sourcing, honestly.** Three different provenances are mixed here and it is
 * worth knowing which is which before "fixing" anything:
 *
 * - **Song file and artist** are lifted from OpenGD's `Source/LevelTools.cpp`
 *   (`getAudioFilename` / `getArtistForAudio` / `getNameForArtist`). Watch the
 *   off-by-one: OpenGD's `lid` is **0-based**, so its `case 1` (Back On Track)
 *   is *level 2* here. Level 22 (Dash) postdates that table and falls into its
 *   `default`, so its artist is the one thing in this column not from the file.
 * - **Level names** use the game's own spelling, including `Cant Let Go`
 *   without the apostrophe, which is how the game writes it.
 * - **Difficulty and star values are community-known, NOT read out of the
 *   binary or any decompile.** OpenGD carries no star table and neither Ghidra
 *   decompile covers the level-select layer. They are correct as far as the
 *   published lists go, but they are the softest data in this file — if a star
 *   count ever looks wrong, this is why, and it is a one-line fix.
 *
 * `stars` is what a *normal-mode* completion awards. Every main level has
 * exactly **3 secret coins**.
 */

/** difficulty face, matching the `difficulty_NN_btn_001.png` frames in GJ_GameSheet02 */
export type Difficulty = "easy" | "normal" | "hard" | "harder" | "insane" | "demon";

/** difficulty -> the atlas frame that draws its face */
export const DIFFICULTY_FRAME: Record<Difficulty, string> = {
  easy: "difficulty_01_btn_001.png",
  normal: "difficulty_02_btn_001.png",
  hard: "difficulty_03_btn_001.png",
  harder: "difficulty_04_btn_001.png",
  insane: "difficulty_05_btn_001.png",
  demon: "difficulty_06_btn_001.png",
};

export interface LevelInfo {
  /** 1-22, and the `?level=` value */
  n: number;
  name: string;
  difficulty: Difficulty;
  /** stars awarded for a normal-mode completion */
  stars: number;
  /** song artist (see the sourcing note above) */
  artist: string;
}

export const LEVELS: LevelInfo[] = [
  { n: 1,  name: "Stereo Madness",        difficulty: "easy",   stars: 1,  artist: "ForeverBound" },
  { n: 2,  name: "Back On Track",         difficulty: "easy",   stars: 2,  artist: "DJVI" },
  { n: 3,  name: "Polargeist",            difficulty: "normal", stars: 3,  artist: "Step" },
  { n: 4,  name: "Dry Out",               difficulty: "normal", stars: 4,  artist: "ForeverBound" },
  { n: 5,  name: "Base After Base",       difficulty: "hard",   stars: 5,  artist: "ForeverBound" },
  { n: 6,  name: "Cant Let Go",           difficulty: "hard",   stars: 6,  artist: "ForeverBound" },
  { n: 7,  name: "Jumper",                difficulty: "harder", stars: 7,  artist: "DJVI" },
  { n: 8,  name: "Time Machine",          difficulty: "harder", stars: 8,  artist: "Waterflame" },
  { n: 9,  name: "Cycles",                difficulty: "harder", stars: 9,  artist: "DJVI" },
  { n: 10, name: "xStep",                 difficulty: "insane", stars: 10, artist: "DJVI" },
  { n: 11, name: "Clutterfunk",           difficulty: "insane", stars: 11, artist: "Waterflame" },
  { n: 12, name: "Theory of Everything",  difficulty: "insane", stars: 12, artist: "DJ-Nate" },
  { n: 13, name: "Electroman Adventures", difficulty: "insane", stars: 10, artist: "Waterflame" },
  { n: 14, name: "Clubstep",              difficulty: "demon",  stars: 14, artist: "DJ-Nate" },
  { n: 15, name: "Electrodynamix",        difficulty: "insane", stars: 12, artist: "DJ-Nate" },
  { n: 16, name: "Hexagon Force",         difficulty: "insane", stars: 12, artist: "Waterflame" },
  { n: 17, name: "Blast Processing",      difficulty: "harder", stars: 10, artist: "Waterflame" },
  { n: 18, name: "Theory of Everything 2", difficulty: "demon", stars: 14, artist: "DJ-Nate" },
  { n: 19, name: "Geometrical Dominator", difficulty: "harder", stars: 10, artist: "Waterflame" },
  { n: 20, name: "Deadlocked",            difficulty: "demon",  stars: 15, artist: "F-777" },
  { n: 21, name: "Fingerdash",            difficulty: "insane", stars: 12, artist: "MDK" },
  { n: 22, name: "Dash",                  difficulty: "harder", stars: 12, artist: "MDK" },
];

/** every main level has exactly three secret coins */
export const COINS_PER_LEVEL = 3;

export function levelInfo(n: number): LevelInfo | undefined {
  return LEVELS.find((l) => l.n === n);
}

export function starsFor(n: number): number {
  return levelInfo(n)?.stars ?? 0;
}

/**
 * The level-select background colour per level, as the original varies it down
 * the list. The game cycles a fixed palette rather than storing one per level,
 * so this is derived the same way: the level's own background colour channel is
 * what the play scene uses, and the menu just tints from the same hue wheel.
 */
export function menuHue(n: number): number {
  return ((n - 1) * 37) % 360;
}
