/**
 * **Unrouted.** `?icons=1` is served by `src/scenes/garage.ts` (the reproduced
 * `GJGarageLayer`) and `?settings=1` by `src/scenes/mainMenu.ts` with the
 * reproduced `OptionsLayer` dropped in over it, so nothing imports this file
 * any more. It is kept as the pre-parity baseline the UI-parity work replaced.
 *
 * Original header follows.
 *
 * M7 — the icon kit and the settings screen.
 *
 * One scene with two panels because they share all their machinery (the icon
 * atlas, the palette, the save) and the original reaches both from the same
 * garage/options corner of the menu.
 *
 * **Icon kit**: a gamemode tab row, a paged grid of that gamemode's icons, the
 * 42-colour palette twice (primary and secondary), and a glow toggle — all
 * previewed live at the top and written straight to the save.
 *
 * **Settings**: music and sfx volume, applied to the live `AudioEngine` as you
 * move them so you can hear what you are setting.
 *
 * Everything draws in the 480x320 design space with the origin at the view
 * centre, the same as `menu.ts`.
 */

import { SceneFade } from "../engine/transition.ts";
import { Renderer } from "../engine/renderer.ts";
import { loadAtlas, createTexture, type SpriteFrame } from "../engine/atlas.ts";
import { LoadedFont } from "../engine/bmfont.ts";
import { AudioEngine } from "../engine/audio.ts";
import { resolveView } from "../gd/camera.ts";
import { HD } from "../gd/sheets.ts";
import type { Gamemode } from "../gd/gamemodes.ts";
import {
  ICON_TABS, ICON_COUNTS, PLAYER_COLORS, iconFrames, playerColor, clampIcon,
} from "../gd/icons.ts";
import * as save from "../gd/save.ts";
import { ASSET } from "../assetBase.ts";

/** icons per row / rows per page in the selection grid */
const COLS = 10;
const ROWS = 3;
const PER_PAGE = COLS * ROWS;
/** palette swatches per row */
const SWATCH_COLS = 21;

type Panel = "icons" | "settings";
/** which control the keyboard is driving */
type Focus = "tabs" | "grid" | "col1" | "col2" | "glow";

const FOCUS_ORDER: Focus[] = ["tabs", "grid", "col1", "col2", "glow"];

function whiteTexture(renderer: Renderer): { tex: WebGLTexture; frame: SpriteFrame } {
  const c = document.createElement("canvas");
  c.width = c.height = 2;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 2, 2);
  return {
    tex: createTexture(renderer.ctx, c),
    frame: { x: 0, y: 0, w: 2, h: 2, rotated: false, offsetX: 0, offsetY: 0, sourceW: 2, sourceH: 2 },
  };
}

export async function startIconKit(renderer: Renderer, panel: Panel = "icons") {
  /** `CCTransitionFade` in and out of this scene */
  const fade = new SceneFade(renderer);
  const icons = await loadAtlas(renderer,
    `${ASSET}GJ_GameSheetIcons-hd.plist`, `${ASSET}GJ_GameSheetIcons-hd.png`).catch(() => null);
  const font = await LoadedFont.load(renderer, `${ASSET}bigFont-hd.fnt`, `${ASSET}bigFont-hd.png`)
    .catch(() => null);
  const white = whiteTexture(renderer);
  const audio = new AudioEngine();

  const kit = save.icons();
  const settings = save.settings();
  audio.setMusicVolume(settings.musicVolume);
  audio.setSfxVolume(settings.sfxVolume);

  let tab = 0;
  let focus: Focus = "grid";
  /** first icon index shown in the grid, so long lists page rather than shrink */
  let page = 0;

  const mode = (): Gamemode => ICON_TABS[tab];
  const selected = () => clampIcon(mode(), kit[mode()] ?? 1);

  let musicStarted = false;
  const startMusic = () => {
    if (musicStarted) return;
    musicStarted = true;
    void audio.playMenuMusic();
  };

  const back = () => {
    fade.go(() => { audio.leaveMenuMusic(); location.search = ""; });
  };

  /** keep the selected icon on the visible page */
  const syncPage = () => {
    const i = selected() - 1;
    if (i < page) page = Math.floor(i / PER_PAGE) * PER_PAGE;
    else if (i >= page + PER_PAGE) page = Math.floor(i / PER_PAGE) * PER_PAGE;
  };
  syncPage();

  const setIcon = (n: number) => {
    const m = mode();
    save.setIcons({ [m]: clampIcon(m, n) } as Partial<typeof kit>);
    kit[m] = clampIcon(m, n);
    syncPage();
  };

  const setColor = (which: "col1" | "col2", idx: number) => {
    const v = Math.max(0, Math.min(PLAYER_COLORS.length - 1, idx));
    kit[which] = v;
    save.setIcons({ [which]: v } as Partial<typeof kit>);
  };

  const setVolume = (which: "musicVolume" | "sfxVolume", v: number) => {
    const c = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
    settings[which] = c;
    save.setSettings({ [which]: c });
    if (which === "musicVolume") audio.setMusicVolume(c);
    else audio.setSfxVolume(c);
  };

  /** settings panel: which row the keyboard is on */
  let settingRow = 0;

  const moveH = (d: number) => {
    if (panel === "settings") {
      setVolume(settingRow === 0 ? "musicVolume" : "sfxVolume",
        (settingRow === 0 ? settings.musicVolume : settings.sfxVolume) + d * 0.05);
      return;
    }
    switch (focus) {
      case "tabs":
        tab = (tab + ICON_TABS.length + d) % ICON_TABS.length;
        page = 0;
        syncPage();
        break;
      case "grid": setIcon(selected() + d); break;
      case "col1": setColor("col1", kit.col1 + d); break;
      case "col2": setColor("col2", kit.col2 + d); break;
      case "glow":
        kit.glow = !kit.glow;
        save.setIcons({ glow: kit.glow });
        break;
    }
  };

  const moveV = (d: number) => {
    if (panel === "settings") {
      settingRow = (settingRow + 2 + d) % 2;
      return;
    }
    // inside the grid, up/down moves a whole row before leaving the control
    if (focus === "grid") {
      const i = selected() - 1;
      const next = i + d * COLS;
      if (next >= 0 && next < ICON_COUNTS[mode()]) { setIcon(next + 1); return; }
    }
    if (focus === "col1" || focus === "col2") {
      const which = focus;
      const next = kit[which] + d * SWATCH_COLS;
      if (next >= 0 && next < PLAYER_COLORS.length) { setColor(which, next); return; }
    }
    const at = FOCUS_ORDER.indexOf(focus);
    focus = FOCUS_ORDER[Math.max(0, Math.min(FOCUS_ORDER.length - 1, at + d))];
  };

  addEventListener("keydown", (e) => {
    audio.ensure();
    startMusic();
    switch (e.code) {
      case "Escape": e.preventDefault(); back(); break;
      case "ArrowLeft": case "KeyA": e.preventDefault(); moveH(-1); break;
      case "ArrowRight": case "KeyD": e.preventDefault(); moveH(1); break;
      // screen y is up, so "down" walks forward through the control order
      case "ArrowUp": case "KeyW": e.preventDefault(); moveV(-1); break;
      case "ArrowDown": case "KeyS": e.preventDefault(); moveV(1); break;
      case "Tab":
        e.preventDefault();
        panel = panel === "icons" ? "settings" : "icons";
        break;
      case "KeyG":
        if (panel === "icons") {
          e.preventDefault();
          kit.glow = !kit.glow;
          save.setIcons({ glow: kit.glow });
        }
        break;
    }
  });

  const rect = (x: number, y: number, w: number, h: number,
    r: number, g: number, b: number, a = 1) => {
    renderer.draw(white.tex, 2, 2, white.frame, x, y, w, h, 0, r, g, b, a);
  };

  /** draw one icon's layers at a position, tinted with the current palette */
  const drawIcon = (m: Gamemode, idx: number, x: number, y: number, scale: number, a = 1) => {
    if (!icons) return;
    const n = iconFrames(m, idx);
    const c1 = playerColor(kit.col1), c2 = playerColor(kit.col2);
    const put = (name: string | undefined, r: number, g: number, b: number) => {
      const f = name ? icons.atlas.get(name) : null;
      if (!f) return;
      renderer.draw(icons.tex, icons.texW, icons.texH, f,
        x, y, f.w * HD * scale, f.h * HD * scale, 0, r, g, b, a);
    };
    put(n.main, c1.r, c1.g, c1.b);
    put(n.detail, c2.r, c2.g, c2.b);
    put(n.extra, 1, 1, 1);
    put(n.dome, 1, 1, 1);
  };

  let lastFrame = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - lastFrame) / 1000);
    lastFrame = now;
    renderer.resize();
    const { scale, viewW, viewH } = resolveView(renderer.canvas.width, renderer.canvas.height);
    renderer.camera = { x: 0, y: 0, scale };
    renderer.begin();
    rect(0, 0, viewW, viewH, 0.13, 0.15, 0.28);

    if (panel === "icons") drawIconPanel(viewW, viewH);
    else drawSettingsPanel(viewW, viewH);

    if (font) {
      font.draw(renderer, panel === "icons" ? "ICON KIT" : "SETTINGS",
        0, viewH / 2 - 24, 0.34, 1, 1, 1, 1, 0);
      font.draw(renderer, "tab switches panel    esc back to menu",
        0, -viewH / 2 + 8, 0.15, 1, 1, 1, 0.55, 0);
    }

    fade.draw(dt, scale, viewW, viewH);
    renderer.flush();
    requestAnimationFrame(loop);
  };

  function drawIconPanel(viewW: number, _viewH: number) {
    const m = mode();
    const sel = selected();

    // --- gamemode tabs ---
    const tabW = 40;
    ICON_TABS.forEach((t, i) => {
      const x = (i - (ICON_TABS.length - 1) / 2) * tabW;
      const on = i === tab;
      rect(x, 96, tabW - 4, 30, 1, 1, 1, on ? 0.22 : 0.08);
      if (on && focus === "tabs") rect(x, 96, tabW - 4, 30, 0.4, 1, 0.6, 0.3);
      drawIcon(t, clampIcon(t, kit[t] ?? 1), x, 96, 0.42, on ? 1 : 0.55);
    });

    // --- big preview ---
    drawIcon(m, sel, -viewW / 2 + 52, 40, 1.5);
    if (font) {
      font.draw(renderer, `${m}  ${sel}/${ICON_COUNTS[m]}`,
        -viewW / 2 + 52, 4, 0.17, 1, 1, 1, 0.8, 0);
    }

    // --- icon grid ---
    const gx = 34, gy = 62, step = 30;
    for (let i = 0; i < PER_PAGE; i++) {
      const n = page + i + 1;
      if (n > ICON_COUNTS[m]) break;
      const cx = gx + ((i % COLS) - (COLS - 1) / 2) * step;
      const cy = gy - Math.floor(i / COLS) * step;
      const on = n === sel;
      rect(cx, cy, step - 3, step - 3, 1, 1, 1, on ? 0.26 : 0.07);
      if (on && focus === "grid") rect(cx, cy, step - 3, step - 3, 0.4, 1, 0.6, 0.35);
      drawIcon(m, n, cx, cy, 0.38);
    }
    if (font && ICON_COUNTS[m] > PER_PAGE) {
      font.draw(renderer, `${page + 1}-${Math.min(ICON_COUNTS[m], page + PER_PAGE)}`,
        gx, gy - ROWS * step + 6, 0.14, 1, 1, 1, 0.5, 0);
    }

    // --- the two palettes ---
    const paletteRow = (label: string, which: "col1" | "col2", y: number) => {
      if (font) font.draw(renderer, label, -viewW / 2 + 8, y - 4, 0.14, 1, 1, 1, 0.7, -1);
      const sw = 9, gap = 10;
      for (let i = 0; i < PLAYER_COLORS.length; i++) {
        const row = Math.floor(i / SWATCH_COLS);
        const col = i % SWATCH_COLS;
        const x = 30 + (col - (SWATCH_COLS - 1) / 2) * gap;
        const cy = y - row * gap;
        const c = playerColor(i);
        const on = kit[which] === i;
        if (on) rect(x, cy, sw + 4, sw + 4, 1, 1, 1, focus === which ? 1 : 0.6);
        rect(x, cy, sw, sw, c.r, c.g, c.b, 1);
      }
    };
    paletteRow("col 1", "col1", -34);
    paletteRow("col 2", "col2", -66);

    // --- glow ---
    if (font) {
      const on = focus === "glow";
      font.draw(renderer, `GLOW: ${kit.glow ? "ON" : "OFF"}   [G]`,
        0, -98, 0.19, on ? 0.5 : 1, 1, on ? 0.6 : 1, on ? 1 : 0.75, 0);
    }
  }

  function drawSettingsPanel(viewW: number, _viewH: number) {
    const row = (label: string, v: number, y: number, i: number) => {
      const on = settingRow === i;
      if (font) {
        font.draw(renderer, label, -150, y - 5, 0.22, on ? 0.5 : 1, 1, on ? 0.6 : 1, 1, -1);
        font.draw(renderer, `${Math.round(v * 100)}%`, 190, y - 5, 0.2, 1, 1, 1, 0.85, 1);
      }
      const barW = 170;
      rect(20, y, barW + 4, 14, 1, 1, 1, 0.12);
      if (v > 0) rect(20 - barW / 2 + (barW * v) / 2, y, barW * v, 10, 0.35, 0.85, 1, 1);
    };
    row("Music", settings.musicVolume, 30, 0);
    row("SFX", settings.sfxVolume, -10, 1);
    if (font) {
      font.draw(renderer, "left / right to adjust", 0, -60, 0.16, 1, 1, 1, 0.55, 0);
    }
    void viewW;
  }

  loop();

  (window as unknown as Record<string, unknown>).__kit = {
    get info() {
      return {
        panel, tab, mode: mode(), selected: selected(), focus,
        col1: kit.col1, col2: kit.col2, glow: kit.glow,
        musicVolume: settings.musicVolume, sfxVolume: settings.sfxVolume,
        saved: save.icons(), savedSettings: save.settings(),
      };
    },
    setPanel: (p: Panel) => { panel = p; },
    setTab: (i: number) => { tab = i; page = 0; syncPage(); },
    setFocus: (f: Focus) => { focus = f; },
    setIcon,
    setColor,
    setVolume,
    moveH,
    moveV,
  };
}
