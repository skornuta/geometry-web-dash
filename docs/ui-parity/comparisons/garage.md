# Garage and colour page — comparison record

**Status: implemented, NOT visually verified.** No native capture exists; see
[REFERENCE.md §2](../REFERENCE.md).

Route: `?icons=1`, reached from the main menu's garage button (which also clears the
character-select flag, as `MenuLayer::onGarage` does).

## Port captures

`garage-port-{1280x720,1920x1080,1024x768,narrow-420x900}.png`, one per gamemode tab
(`garage-tab-{cube,ship,ball,ufo,wave,robot,spider,swing}.png`), and `garage-colour-page.png`.
Regenerate with `node scripts/kittest.mjs`; every capture uses an isolated context.

## What the rewrite replaced, and with what

| was | now | source |
|---|---|---|
| custom dark flat layout | `GJ_gradientBG` at the sourced `(150,150,150)`, four side-art corners, the floor line and the standing preview | `init +164..2480` |
| 10x3 grid, invented spacing | **12x3 at a 30-unit pitch** on a 385x100 `square02_001` nine-slice at opacity 75 | `ListButtonBar/Page::init` |
| textual mode + index preview | `CCMenuItemToggler` tabs with the real off/on art at scale 0.9, padding 2, plus two `GJ_select_001` rings at 0.85 | `setupIconSelect` |
| grid icons in the player's colours | grey `(175,175,175)` / white, at the sourced per-type scale table | `getItems +332..392` |
| robot/spider shown as a bare head | all seven skeletal parts in the game's own `idle` pose, back limbs darkened | `objectDefinitions.plist` via `anim.ts` |
| two compact 21-wide palettes | the **107-colour** palette in the 18-column staggered grid the game lays out, inside the 450x300 `GJ_square05` popup with Col1/Col2/Glow and a close button | `CharacterColorPage`, `colorForIndex`, `offsetForIndex` |
| Tab-key panel switch | the paint button opens the popup; Escape closes it, then leaves the garage | `onPaint`, `onBack` |

## What the harness checks

`scripts/kittest.mjs`, 42 checks: frame and loose-asset resolution, the 12x3 grid geometry measured
from the live layout, selection by clicking a real cell, paging without losing the selection, all
eight tabs and per-tab selection memory, first/last icon paging, the popup's 107 swatches, both
colour channels independently, the glow toggle, persistence across a reload, back routing, the kit
reaching gameplay, and no vertical clipping at four viewport shapes.

`tests/icons.test.ts` pins the extended palette and, separately, that **no index a save could hold
moved** when it grew from 42 to 107.

## Known differences

See [REFERENCE.md §13a](../REFERENCE.md) — six, all scope exceptions or one undecoded value
(which `GJRobotSprite` frame the garage passes).
