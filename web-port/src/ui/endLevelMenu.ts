/**
 * `EndLevelLayer` — the results screen — reproduced from the shipping 2.2081
 * binary (`customSetup` m1 `0x41fe0c`, `getEndText` `0x4218d8`). The working is
 * in `docs/ui-parity/REFERENCE.md` §17.
 *
 * What this replaces: a `LEVEL COMPLETE` heading over a 0.62 black wash and a
 * vertical list of grey rectangles reading `Next level` / `Replay` /
 * `Level select`.
 *
 * `EndLevelLayer` is itself a `GJDropDownLayer`, so the panel, the chains and
 * the slide-in all come from `optionsMenu.ts` — the same code the settings
 * screen uses.
 */

import type { Renderer } from "../engine/renderer.ts";
import type { LoadedFont } from "../engine/bmfont.ts";
import { HD } from "../gd/sheets.ts";
import { drawUiSprite, type UiFrame } from "./sprites.ts";
import { drawLabel } from "./optionsMenu.ts";

/* ---------------- sourced constants ---------------- */

/** the banner: `setScale(0.8)`, z 15, at `(winW*0.5, winH*0.5 + 75)` — customSetup +520..664 */
export const COMPLETE_FRAME = "GJ_levelComplete_001.png";
export const PRACTICE_COMPLETE_FRAME = "GJ_practiceComplete_001.png";
export const BANNER_Y = 75;
export const BANNER_SCALE = 0.8;

/** `m_endPosition += (0, 5)` — the results layer settles 5 higher than a plain drop-down */
export const END_LEVEL_Y_NUDGE = 5;
/** `EndLevelLayer::init` is `GJDropDownLayer::init(" ", 230, noBack = true)` — m1 `0x41fbcc` */
export const END_LEVEL_HEIGHT = 230;

/** the stat labels: goldFont, z 3, scale 0.8, from `banner + (0, -40)`, step -24 */
export const STAT_FIRST_DY = -40;
export const STAT_STEP = -24;
export const STAT_SCALE = 0.8;
/** `Time:` alone is width-limited — `limitLabelWidth(150, 0.8, 0)` — +1544..1572 */
export const TIME_MAX_WIDTH = 150;

/**
 * The line under the statistics, `customSetup` +2464..2920 — only one of two
 * things, and for most clears neither:
 *
 * - **practice**: a `TextArea` (`bigFont`, width 620, anchor (0.5, 1)) set to
 *   `PRACTICE_HINT`, `setScale(0.55)`, at `(winW/2, winH/2 - 51)`;
 * - **normal, and only for a level with no secret coins** (`GJGameLevel +
 *   0x350 <= 0`): `getEndText()` in a `bigFont` label,
 *   `limitLabelWidth(260, 0.9, 0)`, at `(winW/2, winH/2 - 65)`.
 *
 * A level with coins shows its coin row there instead — which is every one of
 * the 22 main levels, so a normal clear of them shows no end text at all. The
 * port used to print one under the statistics on every clear.
 */
export const PRACTICE_HINT = "Well done... Now try to complete it without any checkpoints!";
export const PRACTICE_HINT_Y = -51;
export const PRACTICE_HINT_SCALE = 0.55;
export const END_TEXT_WIDTH = 620;
export const END_TEXT_Y = -65;
export const END_TEXT_SCALE = 0.9;
export const END_TEXT_MAX_WIDTH = 260;

/** the button row sits at `winH*0.5 - 115 - 10` — customSetup +3256..3288 */
export const BUTTON_ROW_Y = -125;
export const REPLAY_X = -100;
export const MENU_X = 100;
/** practice only, three buttons wide */
export const RESTART_CHECKPOINT_X = -180;

/** the coin row: `(winW*0.5, winH*0.5 - 64)` — +4460..4772 */
export const COIN_ROW_Y = -64;
/** `alignItemsHorisontally` gap: 20, or 15 at exactly four coins and 13 above */
export function coinGap(count: number): number {
  if (count > 4) return 13;
  if (count === 4) return 15;
  return 20;
}
export const COIN_BLANK_FRAME = "secretCoin_b_01_001.png";
export const COIN_FILLED_FRAME = "secretCoinUI_001.png";

export const REPLAY_FRAME = "GJ_replayBtn_001.png";
export const MENU_FRAME = "GJ_menuBtn_001.png";
export const RESTART_CHECKPOINT_FRAME = "GJ_restartCheckBtn_001.png";

/** every atlas frame the results screen needs */
export const END_LEVEL_FRAMES = [
  COMPLETE_FRAME, PRACTICE_COMPLETE_FRAME,
  REPLAY_FRAME, MENU_FRAME, RESTART_CHECKPOINT_FRAME,
  COIN_BLANK_FRAME, COIN_FILLED_FRAME,
] as const;

/**
 * `getEndText()` (m1 `0x4218d8`): `rand() % 18`, **minus 2**, indexing a
 * 16-entry table — so the two results that fall through (0 and 1) both give
 * `"Awesome!"`, which is therefore twice as likely as any other line.
 *
 * The table is at `0x100866740`, read verbatim.
 */
export const END_TEXT_TABLE: readonly string[] = [
  "Good Job!", "Well Done!", "Impressive!", "Amazing!", "Incredible!",
  "Skillful!", "Brilliant!", "You are... The One!", "How is this possible!?",
  "You beat me...", "Challenge Breaker!", "I am speechless...",
  "Reflex Master!", "Not bad!", "Warp Speed!", "Y u do dis?",
];
export const END_TEXT_FALLBACK = "Awesome!";

/** the original's own selection rule; `roll` is `rand()` */
export function endTextFor(roll: number): string {
  const i = (((roll % 18) + 18) % 18) - 2;
  return i >= 0 && i < END_TEXT_TABLE.length ? END_TEXT_TABLE[i] : END_TEXT_FALLBACK;
}

export function randomEndText(): string {
  return endTextFor(Math.floor(Math.random() * 18));
}

/**
 * `customSetup +1180..1480`. `t` is the run's whole seconds; the original
 * switches to `h:mm:ss` when `t + 3599 > 7198`, i.e. above one hour.
 */
export function formatTime(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const s = t % 60;
  const m = Math.floor(t / 60) % 60;
  if (t + 3599 > 7198) return `${pad(Math.floor(t / 3600))}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export interface EndLevelStats {
  attempts: number;
  /** the session's jumps, `PlayLayer + 0x3728` */
  jumps: number;
  /** the run's elapsed seconds */
  time: number;
  practice: boolean;
  /** how many secret coins this level has, and which ordinals are held */
  coinCount: number;
  coinsHeld: readonly number[];
}

export interface EndLevelLayout {
  bannerY: number;
  /** the stat labels, top to bottom, already positioned */
  stats: { label: string; y: number; maxWidth?: number }[];
  /**
   * The line under the statistics: the practice hint, the random end text (a
   * coin-less level only), or nothing. `random` means "print `getEndText()`".
   */
  endLine: { text: "practice" | "random"; y: number } | null;
  buttonRowY: number;
  replayX: number;
  menuX: number;
  restartCheckpointX: number | null;
  coinRowY: number;
  /** x of each coin slot, left to right; empty when the level has no coins */
  coinXs: number[];
}

/**
 * Every position, in design space with the origin at the view centre, for a
 * layer that has finished sliding in. The caller adds the drop-down's own
 * `slide` (§16.1), exactly as the settings screen does.
 *
 * The three classic rows are `Attempts: %i`, `Jumps: %i` and `Time: %s`, in
 * that order, 24 apart (REFERENCE.md §17.1). `Jumps` is `PlayLayer + 0x3728`,
 * the session's count, which the sim now keeps (`SimState.jumps`).
 */
export function endLevelLayout(stats: EndLevelStats, coinW: number): EndLevelLayout {
  const bannerY = BANNER_Y;
  const rows: { label: string; y: number; maxWidth?: number }[] = [
    { label: `Attempts: ${stats.attempts}`, y: bannerY + STAT_FIRST_DY },
    { label: `Jumps: ${stats.jumps}`, y: bannerY + STAT_FIRST_DY + STAT_STEP },
    {
      label: `Time: ${formatTime(stats.time)}`,
      y: bannerY + STAT_FIRST_DY + 2 * STAT_STEP,
      maxWidth: TIME_MAX_WIDTH,
    },
  ];
  // the coin row exists only for a non-practice clear of a level with coins
  const coins = stats.practice ? 0 : stats.coinCount;
  const gap = coinGap(coins);
  const total = coins > 0 ? coins * coinW + (coins - 1) * gap : 0;
  const coinXs: number[] = [];
  for (let i = 0; i < coins; i++) coinXs.push(-total / 2 + coinW / 2 + i * (coinW + gap));
  return {
    bannerY,
    stats: rows,
    endLine: stats.practice
      ? { text: "practice", y: PRACTICE_HINT_Y }
      : stats.coinCount <= 0 ? { text: "random", y: END_TEXT_Y } : null,
    buttonRowY: BUTTON_ROW_Y,
    replayX: REPLAY_X,
    menuX: MENU_X,
    restartCheckpointX: stats.practice ? RESTART_CHECKPOINT_X : null,
    coinRowY: COIN_ROW_Y,
    coinXs,
  };
}

/** greedy word wrap at `width` font units (unscaled HD pixels * HD) */
export function wrapLines(font: LoadedFont, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.measure(next) * HD > width) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

export interface DrawEndLevelArgs {
  renderer: Renderer;
  /** goldFont for the statistics, bigFont for the end text */
  goldFont: LoadedFont;
  bigFont: LoadedFont;
  banner: UiFrame;
  coinBlank: UiFrame;
  coinFilled: UiFrame;
  layout: EndLevelLayout;
  stats: EndLevelStats;
  endText: string;
  /** design-space offset — the drop-down's slide */
  slide: number;
}

/** banner, statistics, end text and the coin row; the buttons are menu items */
export function drawEndLevel(a: DrawEndLevelArgs) {
  const { renderer, layout: L } = a;
  const dy = a.slide;

  drawUiSprite(renderer, a.banner, 0, L.bannerY + dy, { scale: BANNER_SCALE });

  for (const row of L.stats) {
    let scale = STAT_SCALE;
    if (row.maxWidth) {
      // `limitLabelWidth(width, defaultScale, 0)`
      const natural = a.goldFont.measure(row.label) * HD;
      if (natural * scale > row.maxWidth) scale = row.maxWidth / natural;
    }
    drawLabel(renderer, a.goldFont, row.label, 0, row.y + dy, scale);
  }

  if (L.endLine?.text === "random") {
    // `limitLabelWidth(260, 0.9, 0)`
    const natural = a.bigFont.measure(a.endText) * HD;
    const scale = natural * END_TEXT_SCALE > END_TEXT_MAX_WIDTH
      ? END_TEXT_MAX_WIDTH / natural : END_TEXT_SCALE;
    drawLabel(renderer, a.bigFont, a.endText, 0, L.endLine.y + dy, scale);
  } else if (L.endLine?.text === "practice") {
    // A `TextArea` wraps at 620 font units and hangs from its top edge.
    // APPROXIMATION: its line spacing is the font's own line height; the
    // `TextArea` internals were not decoded.
    const lines = wrapLines(a.bigFont, PRACTICE_HINT, END_TEXT_WIDTH);
    const lh = a.bigFont.font.lineHeight * HD * PRACTICE_HINT_SCALE;
    lines.forEach((line, i) => {
      drawLabel(renderer, a.bigFont, line, 0,
        L.endLine!.y + dy - lh / 2 - i * lh, PRACTICE_HINT_SCALE);
    });
  }

  L.coinXs.forEach((x, i) => {
    drawUiSprite(renderer, a.coinBlank, x, L.coinRowY + dy);
    if (a.stats.coinsHeld.includes(i)) {
      drawUiSprite(renderer, a.coinFilled, x, L.coinRowY + dy);
    }
  });
}
