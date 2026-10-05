# Classic level select — comparison record

**Status: implemented, NOT visually verified.** No native capture exists; see
[REFERENCE.md §2](../REFERENCE.md).

Route: `?levels=1`, reached from the main menu's Play button. `&sel=N` preselects a level, which
is how returning from a level lands back on the one you were playing.

## Port captures

`level-select-port-1280x720.png`, `-1920x1080.png`, `-1024x768.png`, `-narrow-420x900.png`, plus
five save-state fixtures: `level-select-state-{fresh,complete,partial,practice-only,coins-0-2}.png`
— covering normal=0, partial progress, practice complete, normal complete and 0/1/3 coins, as the
plan asks. Regenerate with `node scripts/menutest.mjs` (dev server on 3222); every capture uses an
isolated context with a fixture save and never touches a real one.

## What the rewrite replaced, and with what

| was | now | source |
|---|---|---|
| flat white card, 300×230 | `CCScale9Sprite("square02_001.png")` at 340×95, opacity 125 | `LevelPage::init +88, +296` |
| hue-wheel page tint | `colorForPage`'s nine-entry table + `getColorValue`'s clamped ramp | `0x3a6a44`, `0x3a67a0` |
| arbitrary 360-unit page width | the window width (`m_width = winSize.width`) | `LevelSelectLayer::init +1812` |
| exponential scroll chase that never arrives | 0.96 s `CCEaseElasticOut(period 0.5)` | `BoomScrollLayer::moveToPage 0x32ae64` |
| clickable left/middle/right screen thirds | nav arrows, back arrow, and the level panel itself as the play button | `init +2216/+2348/+2488`, `LevelPage::init +524` |
| custom keyboard hint footer | "Download the soundtrack" where the original has it (inert) | `init +1920, +2056` |
| `difficulty_NN_btn_001.png` | `diffIcon_%02d_btn_001.png` | `updateDynamicPage +3396` |
| invented bar geometry | `GJ_progressBar_001.png`, fill 0.992 × 0.86, green / cyan | `LevelPage::init +784, +848, +1240` |
| — | top bar, both side-art corners, page dots (16 apart, grey 125) | `init +492, +624, +1780`, `updateDots +376` |

## What the harness checks

`scripts/menutest.mjs`, 33 checks: art resolution for every difficulty face and every loose file,
the win-size page width, browsing and clamping, the sourced page colour at pages 1 and 10, an inert
background, both nav arrows, the panel's 1.1 press and its play action, the back arrow, `?sel=N`
restoration, Escape, and name fitting plus vertical clipping at four viewport shapes.

`tests/level-select.test.ts` pins the colour table, the non-linear cross-fade ramp, and the
difficulty frame family headlessly.

## Known differences

See [REFERENCE.md §11a](../REFERENCE.md) — six, all of them scope exceptions or undecoded values,
none an unexplained layout or art mismatch.
