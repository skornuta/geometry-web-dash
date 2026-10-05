# Dash pixel detail verification

Native references: `../visual/objs-l22-2300.csv`, `sprites-l22-2300.txt`,
`objs-l22-9500.csv`, and `web-port/data/native-geometry.jsonl`.

The object generator now includes separate `_color` sprites for all 28 pixel-art
types with detail channels in those two native object dumps. Defaults are
channels 1 and 2. Authored channels continue to override them.

Browser captures use `scripts/port-at.mjs 22 <x> <output> --draws=<json>`.
`before.png` and `after.png` show x=2301.897461; `swing-before.png` and
`swing-after.png` show x=9500. These are rendered macro-path replays, not
proof of unassisted physics completion.

At x=2301 the object comparison fell from 148 to 98 discrepancies. At x=9500,
adding the rock fragments' detail layers reduced 90 to 75 discrepancies across
110 compared objects (2 unmatched). Camera framing differs significantly, so
these counts are diagnostics rather than whole-scene parity scores.

Remaining evidence at x=9500: animated objects 3000, 2032 and 2888 lack detail
layers; 2065 is a custom particle object currently skipped by the renderer;
The glowing balls' square backgrounds were subsequently fixed (see below).
Flame 1936 at x=2301 has a static
`fire_b_01_2_001.png` detail child and a doubled animated grandchild, confirmed
by matching native sprite rects to the shipping SD FireSheet plist.

Validation after the last change: 465 tests pass; Vite production build passes
with the existing bundle-size warning. Regression test was observed failing
on the missing layers before regenerating the object definitions.

## Circular glow anchor fix

`swing-glow-fixed.png` is the same replay after fixing native child anchors.
Object 1888 consists of four 30x30 quarter gradients, each positioned at (0,0)
with anchor (1,0) and mirrored scales. The generator previously treated node
positions as sprite centers and overlaid all four quarters. Correct centers
are (-15,15), (15,15), (15,-15), (-15,-15). The native geometry generator now
applies the anchor displacement through each child's scale and rotation.
This also corrects objects 1840, 1886 and 1887; no other generated offsets
changed. Browser replay confirms the square edges are gone and the glows
extend smoothly around the balls and flames. This was a geometry issue,
not a blend-state or texture-alpha issue.

The regression failed with an absent offset entry before the fix. Afterward,
all 466 tests and the production build pass (existing bundle-size warning).
Camera framing and animated detail layers remain unresolved.

## Electric-ball detail experiment — rejected, then shipped after the batching fix

Native geometry confirms object 2032 has a centered, unit-scale detail child
at z=-100, with defaults 1/2. Both eight-frame sequences exist in FireSheet
(`gj22_anim_13` and `gj22_anim_13_color`). Adding this child made all 11
missing-detail comparisons disappear (75 to 64 discrepancies at x=9500),
and passed 467 tests and the build, but **the rendered result regressed**:
`rejected-ball-detail-order.png` shows hollow rings — the orange cores the
native capture has are gone. The patch and its test were removed rather than
keeping the lower diagnostic count as a false success.

Cause in the port: `LevelScene.drawObjects` split the whole z-layer into
additive-first and normal-second passes. Main channel 148 is additive while
detail channel 149 is normal, so the detail painted over the main regardless
of its negative child z. Native 2032's dump reports parent batch -720 and
blend 1/771.

**The premise was wrong, and that is what the batching fix turned on.** Every
one of the 178 objects in the x=9500 `objects` dump reports the same
`bsrc`/`bdst` of 1/771 — `GL_ONE, GL_ONE_MINUS_SRC_ALPHA`, the sprite's
*default*. The additive state is not a per-sprite property at all: the game
puts a whole `GameObject` — main sprite, colour sprite and every ordinary
child — into one `CCSpriteBatchNode` per z layer, and the two batches that
layer draws through are chosen by the object's blending state. A child cannot
pick a different batch from its parent. `LevelScene.assignPassChannels` now
points every sprite of an object at the channel of the object's own main
sprite, which is what the batch node does.

With that in place the detail child draws in the object's own additive batch at
its own z -100, i.e. under the main sprite, and the cores are back:
`ball-detail-batch-fixed.png`. **Discrepancies at x=9500 fall 75 → 36**, and
2032 no longer appears in the diff at all. Reversing the two global passes was
never the answer and is not done — native Geometrical Dominator still needs
additive below normal *between* objects.

## The detail overlay for every object that has one

The colour sprite is not a Dash quirk. `GameObject::m_colorSprite` exists on
every object, and for art that ships a `_color` overlay it *is* that overlay.
The native `geometry` dump records one for 507 ids. `scripts/gen-objects.mjs`
now builds the child from the game rather than from OpenGD's table, which had
the wrong frame in places (id 453's child was `d_link_b_02_color_001.png` where
the game draws `d_link_c_01_color_001.png`) and a baked editor tint of
150,255,255 on all of them. 128 ids changed: 10 placed where the port already
had a child, 118 added.

`scripts/gen-color-sprites.mjs` builds `data/native-color-sprites.json` from
the per-instance `sprites` dumps, which are read through the object and so
state the node as the child it is. It wins over the `geometry` dump, whose
colour sprite was caught before the game had parented it — loose in the layer
on the object's own position at z 0, where the live dump has the same sprite,
the same size, at the object's centre at z ±100. That disagreement is the
whole reason the first attempt at 2032 looked wrong.

The 2.2 pixel art also draws in the player's own channels: the `objects` dump
reports `m_defaultColorID` 1 and 2 for every one of them, not the OBJ channel
OpenGD assigns.

