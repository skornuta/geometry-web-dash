// The settings screens' geometry, read out of the shipping 2.2081 binary:
//
//   Slider::init                     m1 0x2952d4
//   SliderThumb::getValue/setValue   m1 0x2943f0 / 0x294474
//   GJDropDownLayer::init            m1 0x5124fc  (one-arg form 0x512908)
//   GJListLayer::init                m1 0x4fec74
//   OptionsLayer::customSetup        m1 0x6a1ba0
//   GameToolbox::createToggleButton  m1 0x448c1c
//   GJOptionsLayer::nextPosition     m1 0x23c494
//   GameOptionsLayer::init/setupOptions m1 0x24f210 / 0x24f268
//   MoreOptionsLayer::nextPosition   m1 0x6a53c8
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DROP_HEIGHT, GAME_OPTIONS, GAME_OPTIONS_COL_X, GAME_OPTIONS_LABEL_SCALE,
  GAME_OPTIONS_PER_PAGE, GAME_OPTIONS_ROW_STEP, GAME_OPTIONS_Y_OFFSET,
  LIST_WIDTH, MENU_MUSIC_DX, MENU_MUSIC_DY, MORE_OPTIONS, MORE_OPTIONS_ROW_STEP,
  MUSIC_LABEL_Y, OPTIONS_BUTTONS, POPUP_H, POPUP_W, SFX_LABEL_DY,
  SLIDER_BAR_HEIGHT, SLIDER_LENGTH_INSET, dropDownLayout, easeInOut,
  optionsLayout, sliderLength, thumbOffset, togglePosition, toggleLabelPosition,
  valueFromOffset, MORE_OPTIONS_PAGES, MORE_OPTIONS_PAGE_TITLES, initialDropProgress,
} from "../src/ui/optionsMenu.ts";
import { SETTINGS_KEYS } from "../src/gd/save.ts";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("m_length is the groove width less 4, and the bar rect is 8 tall", () => {
  // the shipped slidergroove-hd.png is 420 px, i.e. 210 design units
  close(sliderLength(420), 210 - SLIDER_LENGTH_INSET);
  assert.equal(SLIDER_BAR_HEIGHT, 8);
});

test("the thumb travels +/- length*scale/2 about the centre", () => {
  const length = sliderLength(420);
  close(thumbOffset(0, length, 1), -length / 2);
  close(thumbOffset(0.5, length, 1), 0);
  close(thumbOffset(1, length, 1), length / 2);
  // and scale multiplies the whole travel, as `SliderThumb::getValue` divides by it
  close(thumbOffset(1, length, 0.8), (length * 0.8) / 2);
});

test("getValue and setValue are inverses, and both clamp", () => {
  const length = sliderLength(420);
  for (const v of [0, 0.13, 0.5, 0.87, 1]) {
    close(valueFromOffset(thumbOffset(v, length, 1), length, 1), v);
  }
  // dragging past either end pins rather than wrapping
  close(valueFromOffset(-9999, length, 1), 0);
  close(valueFromOffset(9999, length, 1), 1);
  // a degenerate slider cannot divide by zero
  close(valueFromOffset(10, 0, 1), 0);
});

test("the drop-down starts a screen height above and eases to its resting place", () => {
  const top = dropDownLayout(480, 320, DROP_HEIGHT, 0);
  const settled = dropDownLayout(480, 320, DROP_HEIGHT, 1);
  close(top.slide, 320);
  close(settled.slide, 0);
  // the settled panel is `GJListLayer::create(..., 356, 220, ...)` at
  // `((winW - 356)/2, (winH - 220)/2 - 10 + 5)`
  close(settled.width, LIST_WIDTH);
  close(settled.left, -LIST_WIDTH / 2);
  close(settled.bottom, -DROP_HEIGHT / 2 - 5);
  // half way through, `CCEaseInOut(rate 2)` is exactly half way
  close(easeInOut(0.5), 0.5);
  close(easeInOut(0), 0);
  close(easeInOut(1), 1);
  // and it is symmetric, which a plain power curve is not
  close(easeInOut(0.25) + easeInOut(0.75), 1);
});

test("the seven Settings buttons sit where customSetup puts them", () => {
  assert.deepEqual(OPTIONS_BUTTONS.map((b) => b.id), [
    "account", "howToPlay", "options", "graphics", "rate", "songs", "help",
  ]);
  const byId = (id: string) => OPTIONS_BUTTONS.find((b) => b.id === id)!;
  // the top pair is +/- 79 about the menu origin, the middle pair 40 below it
  assert.deepEqual([byId("account").dx, byId("account").dy], [-79, 0]);
  assert.deepEqual([byId("howToPlay").dx, byId("howToPlay").dy], [79, 0]);
  assert.deepEqual([byId("options").dx, byId("options").dy], [-79, -40]);
  assert.deepEqual([byId("graphics").dx, byId("graphics").dy], [79, -40]);
  // the bottom three are the narrow 78-wide buttons at -105 / 0 / +105
  for (const id of ["rate", "songs", "help"]) assert.equal(byId(id).width, 78);
  for (const id of ["account", "howToPlay", "options", "graphics"]) {
    assert.equal(byId(id).width, 130);
  }
  assert.deepEqual([byId("rate").dx, byId("songs").dx, byId("help").dx], [-105, 0, 105]);
  // only `Options` has a destination in this port; the rest are inventoried
  // exceptions that still draw and still animate
  assert.deepEqual(OPTIONS_BUTTONS.filter((b) => b.supported).map((b) => b.id), ["options"]);
  for (const b of OPTIONS_BUTTONS) assert.ok(b.note, `${b.id} has a recorded reason`);
});

test("the volume rows and the menu-music toggle are where customSetup puts them", () => {
  const l = optionsLayout(480, 320);
  close(l.musicLabelY, MUSIC_LABEL_Y);
  close(l.musicSliderY, MUSIC_LABEL_Y - 20);
  close(l.sfxLabelY, MUSIC_LABEL_Y + SFX_LABEL_DY);
  close(l.sfxSliderY, MUSIC_LABEL_Y + SFX_LABEL_DY - 20);
  // the toggle hangs off the **music** label, not the SFX one
  close(l.menuMusicX, MENU_MUSIC_DX);
  close(l.menuMusicY, MUSIC_LABEL_Y + MENU_MUSIC_DY);
  // the lock is 20 in and 18 down from the top-right corner, at any view size
  close(l.vaultX, 480 / 2 - 20);
  close(l.vaultY, 320 / 2 - 18);
  const wide = optionsLayout(640, 360);
  close(wide.vaultX, 640 / 2 - 20);
  // the drop-down's own contents do not move with the view width
  close(wide.musicLabelY, MUSIC_LABEL_Y);
});

test("createToggleButton puts the label above or to the right", () => {
  // `labelTop` (OptionsLayer's Menu Music): centred above, bottom-anchored
  const above = toggleLabelPosition({
    x: 10, y: 20, boxW: 30, boxH: 40, offsetX: 0, offsetY: 2, labelTop: true,
  });
  assert.deepEqual([above.x, above.y], [10, 20 + 20 + 2]);
  assert.equal(above.align, 0);
  assert.equal(above.baseline, "bottom");
  // otherwise (every GJOptionsLayer row): left-anchored to the right of the box
  const right = toggleLabelPosition({
    x: 10, y: 20, boxW: 30, boxH: 40, offsetX: 8, offsetY: 0, labelTop: false,
  });
  assert.deepEqual([right.x, right.y], [10 + 15 + 8, 20]);
  assert.equal(right.align, -1);
});

test("nextPosition alternates columns and steps down every second toggle", () => {
  const base = togglePosition(0).y;
  close(base, 80 + GAME_OPTIONS_Y_OFFSET);
  // left, right, left, right ...
  assert.deepEqual([0, 1, 2, 3].map((i) => togglePosition(i).x), [
    GAME_OPTIONS_COL_X[0], GAME_OPTIONS_COL_X[1],
    GAME_OPTIONS_COL_X[0], GAME_OPTIONS_COL_X[1],
  ]);
  // ... and the first two share a row, the next two are one step lower
  close(togglePosition(1).y, base);
  close(togglePosition(2).y, base - GAME_OPTIONS_ROW_STEP);
  close(togglePosition(3).y, base - GAME_OPTIONS_ROW_STEP);
  close(togglePosition(4).y, base - 2 * GAME_OPTIONS_ROW_STEP);
  // MoreOptionsLayer is the same shape with a 48 step and no page offset
  close(togglePosition(2, 0, MORE_OPTIONS_ROW_STEP).y, 80 - MORE_OPTIONS_ROW_STEP);
  assert.equal(GAME_OPTIONS_ROW_STEP, 37);
  assert.equal(MORE_OPTIONS_ROW_STEP, 48);
  assert.equal(GAME_OPTIONS_PER_PAGE, 12);
});

test("the popup is 400 x 280 and its label scale is the decoded 0.4", () => {
  assert.equal(POPUP_W, 400);
  assert.equal(POPUP_H, 280);
  close(GAME_OPTIONS_LABEL_SCALE, 0.4);
});

test("every inventoried option row names a real setting or says why not", () => {
  for (const row of [...GAME_OPTIONS, ...MORE_OPTIONS]) {
    assert.ok(row.label.length > 0);
    assert.ok(row.gameVariable.length > 0);
    if (row.setting === null) {
      assert.ok(row.note, `${row.label} has no setting, so it must record why`);
    } else {
      assert.ok(SETTINGS_KEYS.includes(row.setting),
        `${row.label} -> ${String(row.setting)} is a real Settings key`);
    }
  }
  // the four HUD options the port really honours are all reachable
  const supported = [...GAME_OPTIONS, ...MORE_OPTIONS]
    .filter((r) => r.setting !== null).map((r) => r.setting);
  for (const key of ["showProgressBar", "showPercentage", "showPauseButton",
    "pauseButtonOnLeft", "autoCheckpoints"]) {
    assert.ok(supported.includes(key as never), `${key} has a control`);
  }
});

test("MoreOptions pages keep the original's titles and slots", () => {
  assert.deepEqual([...MORE_OPTIONS_PAGE_TITLES],
    ["Gameplay", "Visual", "Visual", "Practice", "Performance", "Audio", "Other"]);
  for (const page of MORE_OPTIONS_PAGES) {
    assert.equal(page.title, MORE_OPTIONS_PAGE_TITLES[page.page]);
    assert.ok(page.options.length <= 10, "a page holds at most ten rows");
    assert.ok(page.options.some((o) => o.setting !== null), `${page.title} has a supported row`);
  }
  const other = MORE_OPTIONS_PAGES.find((p) => p.title === "Other")!;
  const slot = other.options.findIndex((o) => o.gameVariable === "0126");
  assert.equal(slot, 5, "Percentage Decimals is the Other page's sixth row");
  assert.equal(other.options[slot].setting, "percentageDecimals");
  // slot 5 is the right column's third line
  const p = togglePosition(slot, 0, MORE_OPTIONS_ROW_STEP);
  assert.equal(p.x, GAME_OPTIONS_COL_X[1]);
});

test("F4: Fast Menu on opens the drop-down already settled, with no slide and no dim fade", () => {
  // `showLayer` snaps to the end position when game variable 0168 is set
  assert.equal(initialDropProgress(true), 1);
  // and with it off the animation starts as it always has, at the top
  assert.equal(initialDropProgress(false), 0);
  const snapped = dropDownLayout(480, 320, DROP_HEIGHT, initialDropProgress(true));
  close(snapped.slide, 0);
  const plain = dropDownLayout(480, 320, DROP_HEIGHT, initialDropProgress(false));
  close(plain.slide, 320);
});
