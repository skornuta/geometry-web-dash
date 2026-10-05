# Main menu — comparison record

**Status (2026-09-10): static layout and colour verified against a native capture.** Every element
the port draws is within 0.65 design units (≤ 4 px at 2x) of the native game; Play and RobTop are
pixel-exact. Rasterization differs because the native game is on the Low (SD) art tier and the port
uses HD; animation was not compared. Full numbers and the three capture traps (which app needs the
permission, the 32 pt title bar, Display P3 tagging) are in [REFERENCE.md §19](../REFERENCE.md).

Native vs port at the same 1768x992 @2x content resolution:
`../reference/native-main-menu-1768x992@2x.png`, `../reference/port-main-menu-1768x992@2x.png`,
and the side-by-side / 50-50 overlay `../reference/compare-main-menu-{pair,blend}.png`.

## Port captures

| file | viewport | device scale |
|---|---|---|
| `main-menu-port-1280x720.png` | 1280×720 | 1 |
| `main-menu-port-1920x1080.png` | 1920×1080 | 1 |
| `main-menu-port-1024x768.png` | 1024×768 | 1 |
| `main-menu-port-narrow-420x900.png` | 420×900 | 2 |

Regenerate with `node scripts/mainmenutest.mjs` (dev server on 3222). Each capture is taken in an
isolated browser context, so no real save is touched.

`current/` alongside these holds the whole-port capture set from `node scripts/ui-baseline.mjs`.
The frozen 2026-09-09 before-set stays in `../before/` and is not overwritten.

## Native reference to place here when available

`../reference/main-menu-settled-<w>x<h>.png` and `../reference/main-menu-pressed-play-<w>x<h>.png`,
plus the build/window metadata REFERENCE.md §2 asks for. Until then no overlay or diff exists and
this screen must not be described as 1:1.

## What is checked automatically

`scripts/mainmenutest.mjs` asserts, in Chromium:

- all 14 controls present, and every sprite frame resolves (a missing one now throws at load
  instead of drawing nothing);
- garage/creator at ±110 from play; the bottom row aligned with padding 5 and centred; discord
  hanging off youtube rather than twitch;
- exactly `play`, `garage`, `options` act, so no out-of-scope control silently does something;
- press settles at 1.26 and release returns to 1;
- a drag off a button cancels it, and clicking empty background does nothing at all;
- play/garage/options reach `?levels=1` / `?icons=1` / `?settings=1`, the garage visit clears the
  character-select flag, and level select returns to the menu;
- nothing clips and hit areas still land at 1280×720, 1920×1080, 1024×768 and a narrow 420×900 @2x.

`tests/ui-controls.test.ts` covers the control mechanics headlessly: trim/content-size split, the
hit rect, `setSizeMult`, the two-pass hit test, the bounce timings, drag-off/cancel semantics,
`alignItemsHorizontallyWithPadding`, and the client→design-space conversion at any backing scale.

## Known differences

See [REFERENCE.md §9a](../REFERENCE.md). None of them is a layout, art or text mismatch that has
been observed and left unexplained — they are all features the port does not implement, each with
the reason and the evidence section that would be needed to implement it.
