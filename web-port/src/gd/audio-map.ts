// Which music each main level plays, and the handful of gameplay sounds.
//
// The header key kA1 (audio track) is **absent from all 22 main levels** — they
// each ship with a fixed song rather than naming one — so the table below is
// the mapping, in level order. kA13 (song offset) is present but 0 everywhere;
// it is still honoured so custom offsets work if they ever appear.

/** level number (1-22) -> music file in public/assets */
export const LEVEL_MUSIC: Record<number, string> = {
  1: "StereoMadness",
  2: "BackOnTrack",
  3: "Polargeist",
  4: "DryOut",
  5: "BaseAfterBase",
  6: "CantLetGo",
  7: "Jumper",
  8: "TimeMachine",
  9: "Cycles",
  10: "xStep",
  11: "Clutterfunk",
  12: "TheoryOfEverything",
  13: "Electroman",
  14: "Clubstep",
  15: "Electrodynamix",
  16: "HexagonForce",
  17: "BlastProcessing",
  18: "TheoryOfEverything2",
  19: "GeometricalDominator",
  20: "Deadlocked",
  21: "Fingerdash",
  22: "Dash",
};

export function musicUrl(levelNum: number): string | null {
  const name = LEVEL_MUSIC[levelNum];
  return name ? `/assets/${name}.mp3` : null;
}

/**
 * Gameplay sounds. These live loose in the game's Resources rather than in the
 * numeric `sfx/` library, and are copied by `npm run assets`.
 *
 * Classic gameplay is deliberately quiet: there is **no jump sound**, and orbs
 * and pads are silent — only death, completion and coins make noise. Do not add
 * a jump sfx "for feel"; it is wrong.
 */
export const SFX = {
  death: "/assets/explode_11.ogg",
  complete: "/assets/endStart_02.ogg",
  coin: "/assets/secretKey.ogg",
} as const;
