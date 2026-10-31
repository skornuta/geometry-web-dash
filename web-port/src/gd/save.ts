/**
 * M7 save data — one localStorage blob, mirroring what the original keeps in
 * `CCGameManager`/`GameStatsManager` for the 22 main levels.
 *
 * Rules taken from the game, not invented:
 * - **Normal and practice percent are separate stats.** Practice never touches
 *   the normal bar, and a level is only "completed" by a normal 100%.
 * - **Coins collected in practice mode do not count.** The original refuses to
 *   award them; only a normal-mode pickup is written here.
 * - **Attempts and jumps are cumulative per level** and survive a reload, which
 *   is the whole reason this file exists — the HUD used to restart at 1.
 *
 * Everything is best-effort: a browser with localStorage disabled (private
 * mode, file://) must still play, so every read/write is guarded and failure
 * degrades to an in-memory save rather than throwing.
 */

import { EXTRA_COUNTS, EXTRA_KEYS, ICON_COUNTS, ICON_TABS, PLAYER_COLORS } from "./icons.ts";

const KEY = "gd-web-save";
const VERSION = 1;

export interface LevelStats {
  /** best normal-mode percent, 0-100 */
  normal: number;
  /** best practice-mode percent, 0-100 */
  practice: number;
  /** ordinals (0-2) of the secret coins picked up in normal mode */
  coins: number[];
  /** cumulative attempts, including the one in progress */
  attempts: number;
  /** cumulative jumps */
  jumps: number;
}

export interface Settings {
  /** 0..1 */
  musicVolume: number;
  /** 0..1 */
  sfxVolume: number;
  /**
   * Whether the garage has ever been opened. The original keeps the same bit on
   * the GameManager (`+0x377`, set by `MenuLayer::onGarage`) and uses it for one
   * thing only: hiding the `GJ_chrSel_001` "new" flag next to the main menu's
   * garage button. Defaults to false, so a save written before this field
   * existed simply shows the flag once and then clears it.
   */
  seenGarage: boolean;
  /**
   * The three HUD visibility options the original keeps as game variables, plus
   * the one that moves the pause button.
   *
   * `PlayLayer::toggleProgressbar` gates the bar on `GameManager+0x374` and the
   * percentage on game variable `"0040"`; `UILayer::init` gates the pause button
   * on `"0024"` and mirrors it to the left edge on `"0015"`.
   *
   * **The values below are the port's defaults, not decoded ones.** GD seeds its
   * game variables from a first-launch save this port has no equivalent of, so
   * what is reproduced here is the *rule*, not the factory setting.
   */
  showProgressBar: boolean;
  showPercentage: boolean;
  showPauseButton: boolean;
  pauseButtonOnLeft: boolean;
  /**
   * The menu-music switch `OptionsLayer::customSetup` builds as a toggle over
   * game variable **"0122"** (`customSetup +2204..2216`). The original stores
   * the variable *inverted* — the checkbox is created with
   * `toggle(!getGameVariable("0122"))` — so "0122 set" means *menu music off*.
   * This field is the checkbox, i.e. the un-inverted sense.
   */
  menuMusic: boolean;
  /**
   * `Auto-Checkpoints`, game variable **"0027"**, which the original exposes
   * both in `MoreOptionsLayer` and in the pause gear's `GameOptionsLayer`
   * (`setupOptions +128..160`). Persisting it is what makes the pause-menu
   * toggle survive a reload.
   *
   * **The default below is the port's, not a decoded one**, and it is `true`
   * to keep the behaviour `CheckpointStack.auto` has always had here.
   */
  autoCheckpoints: boolean;
  /**
   * `Hide Attempts`, game variable **"0135"** — `MoreOptionsLayer`'s "Visual"
   * page, slot 1: hides the attempt counter in normal-mode play.
   */
  hideAttempts: boolean;
  /**
   * `Percentage Decimals`, game variable **"0126"** — `MoreOptionsLayer`'s
   * "Other" page, slot 5: the HUD label reads `"%.2f%%"` instead of a whole
   * number (`PlayLayer::updateProgressbar` +212..268). Off by default.
   */
  percentageDecimals: boolean;
  /**
   * `GameManager::m_clickedPractice` (`+0x37a`): set the first time the pause
   * menu's practice button is pressed (`PauseLayer::onPracticeMode` +16..24).
   * Until then the pause menu shows the `GJ_practiceTxt_001` hint.
   */
  clickedPractice: boolean;
  /**
   * `Fast Menu`, game variable **"0168"**: when set, the Options drop-down
   * opens already settled — no slide and no dim fade (`GJDropDownLayer::showLayer`
   * snaps it, REFERENCE.md §16.1). Off by default, so the animation plays.
   */
  fastMenu: boolean;
  /**
   * The rest of `GameOptionsLayer`'s toggles (REFERENCE.md §16.2). The defaults
   * are the port's own, not decoded ones.
   * `Auto-Retry` ("0026"): off, a death waits for a press before restarting.
   */
  autoRetry: boolean;
  /** `Show Time` ("0145"): the attempt's clock under the percentage */
  showTime: boolean;
  /** `Show Info Label` ("0109"): FPS, the session's best run and clicks per second */
  showInfoLabel: boolean;
  /** `Disable Checkpoints` ("0146"): practice mode places none */
  disableCheckpoints: boolean;
  /** `Show Hitboxes` ("0166"): the collision boxes while in practice mode */
  showHitboxes: boolean;
  /** `Hitbox On Death` ("0179"): the collision boxes once the player has died */
  hitboxOnDeath: boolean;
}

/**
 * Every `Settings` key, at runtime. The settings screens map option rows onto
 * these by name, so a typo has to fail a test rather than silently write a
 * field nothing reads.
 */
export const SETTINGS_KEYS = [
  "musicVolume", "sfxVolume", "seenGarage",
  "showProgressBar", "showPercentage", "showPauseButton", "pauseButtonOnLeft",
  "menuMusic", "autoCheckpoints", "hideAttempts", "percentageDecimals", "clickedPractice",
  "fastMenu", "autoRetry", "showTime", "showInfoLabel", "disableCheckpoints",
  "showHitboxes", "hitboxOnDeath",
] as const satisfies readonly (keyof Settings)[];

/** the icon kit selection; indices are 1-based frame numbers as in the game */
export interface IconKit {
  cube: number;
  ship: number;
  ball: number;
  ufo: number;
  wave: number;
  robot: number;
  spider: number;
  swing: number;
  /**
   * The garage's three extra categories (all 1-based, like the icons): the jetpack
   * skin, the trail (`player_special_NN`) and the death effect (`explosionIcon_NN`).
   * Only the garage reads them so far.
   */
  jetpack: number;
  trail: number;
  deathEffect: number;
  /** colour channel indices into the game's 42-entry player palette */
  col1: number;
  col2: number;
  glow: boolean;
}

export interface SaveData {
  v: number;
  levels: Record<string, LevelStats>;
  settings: Settings;
  icons: IconKit;
}

export function emptyStats(): LevelStats {
  return { normal: 0, practice: 0, coins: [], attempts: 0, jumps: 0 };
}

function defaults(): SaveData {
  return {
    v: VERSION,
    levels: {},
    settings: {
      musicVolume: 1, sfxVolume: 1, seenGarage: false,
      showProgressBar: true, showPercentage: true,
      showPauseButton: true, pauseButtonOnLeft: false,
      menuMusic: true, autoCheckpoints: true, hideAttempts: false,
      percentageDecimals: false, clickedPractice: false, fastMenu: false,
      autoRetry: true, showTime: false, showInfoLabel: false, disableCheckpoints: false,
      showHitboxes: false, hitboxOnDeath: false,
    },
    // the game's own starting kit: cube 1, default green/white, no glow
    icons: {
      cube: 1, ship: 1, ball: 1, ufo: 1, wave: 1, robot: 1, spider: 1, swing: 1,
      jetpack: 1, trail: 1, deathEffect: 1,
      col1: 0, col2: 3, glow: false,
    },
  };
}

/** clamp/repair anything that came out of storage, so a corrupt blob cannot crash play */
function migrate(raw: unknown): SaveData {
  const base = defaults();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<SaveData>;
  const out: SaveData = base;
  if (o.settings && typeof o.settings === "object") {
    const s = o.settings as Partial<Settings>;
    if (typeof s.musicVolume === "number") out.settings.musicVolume = clamp01(s.musicVolume);
    if (typeof s.sfxVolume === "number") out.settings.sfxVolume = clamp01(s.sfxVolume);
    if (typeof s.seenGarage === "boolean") out.settings.seenGarage = s.seenGarage;
    for (const k of ["showProgressBar", "showPercentage", "showPauseButton",
      "pauseButtonOnLeft", "menuMusic", "autoCheckpoints", "hideAttempts",
      "percentageDecimals", "clickedPractice", "fastMenu", "autoRetry", "showTime",
      "showInfoLabel", "disableCheckpoints", "showHitboxes", "hitboxOnDeath"] as const) {
      if (typeof s[k] === "boolean") out.settings[k] = s[k];
    }
  }
  if (o.icons && typeof o.icons === "object") {
    // each field is kept only if it is a valid index; anything else keeps its default
    const ic = o.icons as Partial<Record<keyof IconKit, unknown>>;
    for (const m of ICON_TABS) {
      if (isIndex(ic[m], 1, ICON_COUNTS[m])) out.icons[m] = ic[m];
    }
    for (const k of EXTRA_KEYS) {
      if (isIndex(ic[k], 1, EXTRA_COUNTS[k])) out.icons[k] = ic[k];
    }
    if (isIndex(ic.col1, 0, PLAYER_COLORS.length - 1)) out.icons.col1 = ic.col1;
    if (isIndex(ic.col2, 0, PLAYER_COLORS.length - 1)) out.icons.col2 = ic.col2;
    out.icons.glow = ic.glow === true;
  }
  if (o.levels && typeof o.levels === "object") {
    for (const [k, v] of Object.entries(o.levels as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const s = v as Partial<LevelStats>;
      out.levels[k] = {
        normal: clampPct(s.normal),
        practice: clampPct(s.practice),
        coins: Array.isArray(s.coins)
          ? [...new Set(s.coins.filter((n) => typeof n === "number" && n >= 0 && n < 3))]
          : [],
        attempts: count(s.attempts),
        jumps: count(s.jumps),
      };
    }
  }
  return out;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1);
/** a whole count, never negative; NaN and Infinity (e.g. JSON `1e999`) read as 0 */
const count = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
};
/** a whole number in [lo, hi]; anything else is not a usable icon or colour index */
const isIndex = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const clampPct = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
};

let cache: SaveData | null = null;

/** the whole save, loaded once and then kept in memory */
export function save(): SaveData {
  if (cache) return cache;
  let raw: unknown = null;
  try {
    const text = localStorage.getItem(KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    // disabled storage or malformed JSON — fall through to defaults
  }
  cache = migrate(raw);
  return cache;
}

/** write the in-memory save back to storage; safe to call often */
export function flush() {
  if (!cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // quota or disabled storage: keep playing with the in-memory copy
  }
}

/** per-level stats, created on first access */
export function levelStats(level: number): LevelStats {
  const s = save();
  const key = String(level);
  return (s.levels[key] ??= emptyStats());
}

/** a level is complete only at a normal-mode 100% */
export function isCompleted(level: number): boolean {
  return levelStats(level).normal >= 100;
}

/** count a new attempt on this level and return the running total */
export function recordAttempt(level: number): number {
  const st = levelStats(level);
  st.attempts++;
  flush();
  return st.attempts;
}

/** count a jump (any gamemode's activation press that actually did something) */
export function recordJump(level: number, n = 1) {
  levelStats(level).jumps += n;
  // deliberately not flushed per jump — the attempt/death path flushes instead
}

/**
 * Record progress. Practice writes only the practice bar; neither bar ever
 * moves backwards. Returns true if this was a new best for that mode.
 */
export function recordProgress(level: number, percent: number, practice: boolean): boolean {
  const st = levelStats(level);
  const p = clampPct(percent);
  const field = practice ? "practice" : "normal";
  if (p <= st[field]) return false;
  st[field] = p;
  flush();
  return true;
}

/** Award a secret coin. Practice-mode pickups are ignored, as in the original. */
export function recordCoin(level: number, ordinal: number, practice: boolean): boolean {
  if (practice || ordinal < 0 || ordinal > 2) return false;
  const st = levelStats(level);
  if (st.coins.includes(ordinal)) return false;
  st.coins.push(ordinal);
  st.coins.sort();
  flush();
  return true;
}

export function settings(): Settings {
  return save().settings;
}

export function setSettings(patch: Partial<Settings>) {
  Object.assign(save().settings, patch);
  flush();
}

export function icons(): IconKit {
  return save().icons;
}

export function setIcons(patch: Partial<IconKit>) {
  Object.assign(save().icons, patch);
  flush();
}

/** total coins across all levels, for the menu counter */
export function totalCoins(): number {
  return Object.values(save().levels).reduce((n, s) => n + s.coins.length, 0);
}

/** total stars earned — the sum of each completed level's star value */
export function totalStars(starsFor: (level: number) => number, levels: number[]): number {
  return levels.reduce((n, l) => n + (isCompleted(l) ? starsFor(l) : 0), 0);
}

/** test/tooling hook: drop the in-memory copy so the next read re-parses */
export function resetCache() {
  cache = null;
}

/** test/tooling hook: replace the whole save (used by the tests) */
export function loadFrom(raw: unknown) {
  cache = migrate(raw);
}
