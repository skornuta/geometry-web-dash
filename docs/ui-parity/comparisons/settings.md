# Settings — comparison record

**Status: implemented, NOT visually verified.** No native capture exists; see
[REFERENCE.md §2](../REFERENCE.md).

## Port captures

`settings-dropdown.png`, `settings-more-options.png`, `settings-game-options.png`, and
`settings-{1280x720,1920x1080,1024x768,narrow-420x900}.png` — regenerate with
`node scripts/settingstest.mjs`. `current/settings.png` comes from `scripts/ui-baseline.mjs`.

## The shape of the screen, which the port had wrong

The old `?settings=1` was one flat panel inside the icon-kit scene with two click-only volume rows
quantised to 5 %, reached by pressing Tab. The original is **three separate layers**:

| layer | reached from | what it is |
|---|---|---|
| `OptionsLayer` | the main menu's gear | a `GJDropDownLayer` that slides down **over the running menu** |
| `MoreOptionsLayer` | its `Options` button | a 400x280 `GJ_square01` popup of paged toggles |
| `GameOptionsLayer` | the **pause menu's** gear | a 400x280 `GJ_square02` popup — a different one |

## What the rewrite replaced, and with what

| was | now | source |
|---|---|---|
| a scene change to `?settings=1` | `OptionsLayer` added over `MenuLayer`, sliding in with `CCEaseInOut(CCMoveTo(0.5, end), 2)` over a black layer fading to opacity 125; the cube, the music and the background cycle keep running behind it | `GJDropDownLayer::init` / `showLayer` |
| no panel | `GJListLayer`: a 356x220 `(0,0,0,180)` rect with `GJ_table_top/bottom/side_001`, two `chain_01_001` hanging above, and a `limitLabelWidth(280, 0.8, 0)` title | `GJListLayer::init` |
| no buttons | the seven sourced `ButtonSprite` buttons in **goldFont**, at their decoded widths and offsets | `customSetup +112..1044` |
| two 5 %-stepped rows | two real `Slider`s: `slidergroove` + a **repeat-wrapped** `sliderBar` cropped from `(2, 4)` + `sliderthumb`/`sliderthumbsel`, dragged by the thumb only | `Slider::init`, `SliderThumb::getValue` |
| no menu-music switch | the `Menu\nMusic` toggle at `musicLabel + (145, -35)`, label above the box | `customSetup +2168..2392` |
| nothing in the corner | the secret-vault lock and, while locked, the player's **real** secret-coin count | `customSetup +1080..1560` |
| a Tab key to reach it | the menu's own gear, `?settings=1`, and `O` | `MenuLayer::onOptions` |
| the pause gear did nothing | it opens `GameOptionsLayer` with the sourced `Show Progress Bar` / `Show Percentage` / `Auto-Checkpoints` rows | `GJOptionsLayer` + `GameOptionsLayer::setupOptions` |
| a port-invented "Auto checkpoints" row on the pause menu | removed — it is game variable `0027` on `GameOptionsLayer`, where the original keeps it, and it now **persists** | as above |

## Also fixed by this task

`Slider`'s bar is repeat-wrapped, and it is the same construction as the gameplay progress bar —
which showed that Task 6's HUD bar was smearing `sliderBar2`'s last texel column across 206 units
instead of tiling it. `engine/atlas.ts` gained `setRepeatWrap`; both bars use it.

## What the harness checks

`scripts/settingstest.mjs`, 56 checks: every sourced asset is served; the layer really slides
rather than appearing; the seven buttons are at the mirrored/decoded offsets; a mouse drag on the
music thumb sets ~0.5, reaches the save and the live audio engine, and does not move the SFX
slider; clicking the groove away from the thumb does nothing (as `SliderThumb` is the hit target);
the menu-music checkbox round-trips; the `Options` popup carries the supported rows and its
toggles write; Escape unwinds popup → drop-down → menu; the pause gear opens `GameOptionsLayer`
and hiding the progress bar visibly changes the HUD strip; a save written before `menuMusic` /
`autoCheckpoints` existed keeps every old field and gains the new ones at their defaults; the
screen still opens and toggles with `localStorage` throwing; and four viewport shapes.

`scripts/practicetest.mjs` and `scripts/navigationtest.mjs` reach Auto-Checkpoints through the gear
on both mouse-landscape and touch-portrait @2x. `tests/options-menu.test.ts` covers the geometry
headlessly (10 tests).

## Known differences

See [REFERENCE.md §16.5](../REFERENCE.md) — eight, all inventoried scope exceptions or browser
equivalents.
