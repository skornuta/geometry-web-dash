// The shared UI control rules, all sourced from the shipping 2.2081 binary and
// written up in docs/ui-parity/REFERENCE.md §4:
//
//   CCMenuItemSpriteExtra ctor  m1 0x49240    init        m1 0x2190f4
//   selected                    m1 0x2193d4   unselected  m1 0x219620
//   CCMenuItem::rect            m1 0x3406cc   itemForTouch m1 0x69ce24
//   CCMenu ccTouchBegan/Moved/Ended/Cancelled  0x69baf4 / 0x69bdcc / 0x69bcdc / 0x69bd64
//   CCMenu::alignItemsHorizontallyWithPadding  m1 0x69c108
//
// These tests pin behaviour, not constants copied out of the implementation:
// each one describes something a user can observe (where a click lands, what a
// press looks like, whether a drag-off fires the action).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpriteFrame } from "../src/engine/atlas.ts";
import { contentSize, drawnSize } from "../src/ui/sprites.ts";
import {
  MenuItem, MenuTouchState, PRESS_DURATION, PRESS_SCALE, RELEASE_DURATION, UiMenu,
  bounceOut, rectContains, toDesignSpace,
} from "../src/ui/controls.ts";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** a frame shaped like a real trimmed, rotated atlas entry */
function frame(w: number, h: number, sourceW = w, sourceH = h, offsetX = 0, offsetY = 0): SpriteFrame {
  return { x: 0, y: 0, w, h, rotated: false, offsetX, offsetY, sourceW, sourceH };
}

const uiFrame = (f: SpriteFrame) => ({
  name: "test.png",
  frame: f,
  sheet: { name: "test", atlas: new Map(), tex: {} as WebGLTexture, texW: 1, texH: 1 },
});

// GJ_optionsBtn_001: displayed 99x102 hd, untrimmed 101x108 hd.
const OPTIONS = frame(99, 102, 101, 108, 1, -3);

test("content size is the untrimmed box, drawn size is the trimmed one", () => {
  // A cocos sprite built from a trimmed frame reports spriteSourceSize as its
  // content size, so layout and hit boxes use the original art box while only
  // the packed rect is rasterised. hd art is 2x design units.
  assert.deepEqual(contentSize(OPTIONS), { w: 50.5, h: 54 });
  assert.deepEqual(drawnSize(OPTIONS), { w: 49.5, h: 51 });
});

test("the hit rectangle is the content box centred on the item, ignoring the press scale", () => {
  const item = new MenuItem({ id: "options", frame: uiFrame(OPTIONS), x: 10, y: -20 });
  assert.deepEqual(item.rect(), { x: 10 - 25.25, y: -20 - 27, w: 50.5, h: 54 });

  // Pressing animates the item's scale; CCMenuItem::rect() reads position,
  // contentSize and anchor only, so the clickable area must not move.
  item.select();
  item.update(PRESS_DURATION);
  close(item.scale, PRESS_SCALE);
  assert.deepEqual(item.rect(), { x: 10 - 25.25, y: -20 - 27, w: 50.5, h: 54 });
});

test("the sprite's own scale multiplies into the content box", () => {
  // The social icons draw at 0.8; their click area shrinks with the art.
  const item = new MenuItem({ id: "fb", frame: uiFrame(frame(63, 63)), spriteScale: 0.8 });
  close(item.contentW, 63 * 0.5 * 0.8);
  close(item.contentH, 63 * 0.5 * 0.8);
});

test("setSizeMult inflates the click area about its centre and never below 1", () => {
  const big = new MenuItem({ id: "fb", frame: uiFrame(frame(40, 40)), sizeMult: 1.5 });
  const plain = big.rect();
  const grown = big.touchRect(true);
  close(grown.w, plain.w * 1.5);
  close(grown.h, plain.h * 1.5);
  // same centre
  close(grown.x + grown.w / 2, plain.x + plain.w / 2);
  close(grown.y + grown.h / 2, plain.y + plain.h / 2);

  // `if (mult > 1.0f)` — the default of 1 leaves the rect exactly alone.
  const unset = new MenuItem({ id: "plain", frame: uiFrame(frame(40, 40)) });
  assert.deepEqual(unset.touchRect(true), unset.rect());
});

test("hit testing tries the plain rects before the inflated ones", () => {
  // Two items whose inflated areas overlap: a point inside the second item's
  // plain rect must pick the second, even though the first's inflated rect
  // reaches it and the first is earlier in child order.
  const menu = new UiMenu("m");
  const a = menu.add(new MenuItem({ id: "a", frame: uiFrame(frame(40, 40)), x: 0, sizeMult: 3 }));
  const b = menu.add(new MenuItem({ id: "b", frame: uiFrame(frame(40, 40)), x: 25 }));
  assert.equal(menu.itemForPoint(25, 0, false), b);
  assert.equal(menu.itemForPoint(25, 0, true), a); // inflated pass alone would be wrong
  assert.equal(menu.pick(25, 0), b);

  // Outside every plain rect, the inflated pass is what makes a small icon
  // comfortable to click.
  assert.equal(menu.pick(-28, 0), a);
});

test("a menu's position offsets its items' hit areas", () => {
  const menu = new UiMenu("m");
  menu.setPosition(100, -60);
  const item = menu.add(new MenuItem({ id: "a", frame: uiFrame(frame(40, 40)) }));
  assert.equal(menu.pick(100, -60), item);
  assert.equal(menu.pick(0, 0), null);
});

test("press and release use the sourced 1.26 / 0.3s / 0.4s bounce", () => {
  const item = new MenuItem({ id: "play", frame: uiFrame(frame(219, 219)) });
  close(item.scale, 1);

  item.select();
  item.update(PRESS_DURATION / 2);
  assert.ok(item.scale > 1 && item.scale <= PRESS_SCALE, `mid-press ${item.scale}`);
  item.update(PRESS_DURATION / 2);
  close(item.scale, PRESS_SCALE);
  item.update(1); // the action is finished; extra time changes nothing
  close(item.scale, PRESS_SCALE);

  item.deselect();
  item.update(RELEASE_DURATION);
  close(item.scale, 1);
});

test("a press that interrupts a release eases from where the scale actually is", () => {
  // `stopActionByTag(0)` discards the in-flight CCScaleTo and the new one starts
  // from the current scale, so a fast double-click does not snap.
  const item = new MenuItem({ id: "play", frame: uiFrame(frame(219, 219)) });
  item.select();
  item.update(PRESS_DURATION);
  item.deselect();
  item.update(RELEASE_DURATION / 4);
  const interrupted = item.scale;
  assert.ok(interrupted > 1 && interrupted < PRESS_SCALE, `partway ${interrupted}`);

  item.select();
  item.update(0); // no time has passed: still exactly where it was
  close(item.scale, interrupted);
  item.update(PRESS_DURATION);
  close(item.scale, PRESS_SCALE);
});

test("the bounce curve is easing.ts's sourced BounceOut", () => {
  close(bounceOut(0), 0);
  close(bounceOut(1), 1);
  // 7.5625 * t^2 on the first parabola
  close(bounceOut(0.2), 7.5625 * 0.04);
  // an overshoot-free curve: it never leaves [0,1]
  for (let i = 0; i <= 100; i++) {
    const v = bounceOut(i / 100);
    assert.ok(v >= 0 && v <= 1, `bounceOut(${i / 100}) = ${v}`);
  }
});

test("releasing on the button activates it; dragging off first does not", () => {
  const menu = new UiMenu("m");
  let fired = 0;
  const item = menu.add(new MenuItem({
    id: "play", frame: uiFrame(frame(40, 40)), onActivate: () => { fired++; },
  }));
  const touch = new MenuTouchState([menu]);

  assert.equal(touch.began(0, 0), true);
  assert.equal(touch.selectedItem, item);
  assert.equal(touch.ended(), item);
  assert.equal(fired, 1);

  // press, drag away, release: ccTouchMoved clears the selection, so
  // ccTouchEnded has nothing to activate.
  touch.began(0, 0);
  touch.moved(500, 500);
  assert.equal(touch.selectedItem, null);
  assert.equal(touch.ended(), null);
  assert.equal(fired, 1);

  // dragging back on re-selects and the release does fire
  touch.began(0, 0);
  touch.moved(500, 500);
  touch.moved(0, 0);
  assert.equal(touch.selectedItem, item);
  touch.ended();
  assert.equal(fired, 2);
});

test("a cancelled gesture never activates and always releases the press", () => {
  const menu = new UiMenu("m");
  let fired = 0;
  const item = menu.add(new MenuItem({
    id: "play", frame: uiFrame(frame(40, 40)), onActivate: () => { fired++; },
  }));
  const touch = new MenuTouchState([menu]);
  touch.began(0, 0);
  item.update(PRESS_DURATION);
  close(item.scale, PRESS_SCALE);

  touch.cancelled();
  assert.equal(fired, 0);
  assert.equal(touch.selectedItem, null);
  item.update(RELEASE_DURATION);
  close(item.scale, 1);
});

test("a press on empty background is not taken by any menu", () => {
  const menu = new UiMenu("m");
  menu.add(new MenuItem({ id: "a", frame: uiFrame(frame(40, 40)) }));
  const touch = new MenuTouchState([menu]);
  assert.equal(touch.began(300, 300), false);
  assert.equal(touch.selectedItem, null);
  assert.equal(touch.ended(), null);
});

test("overlapping menus resolve topmost-first", () => {
  const under = new UiMenu("under");
  const over = new UiMenu("over");
  const a = under.add(new MenuItem({ id: "a", frame: uiFrame(frame(80, 80)) }));
  const b = over.add(new MenuItem({ id: "b", frame: uiFrame(frame(40, 40)) }));
  const touch = new MenuTouchState([under, over]);
  touch.began(0, 0);
  assert.equal(touch.selectedItem, b);
  touch.cancelled();
  touch.began(18, 0); // outside `over`, inside `under`
  assert.equal(touch.selectedItem, a);
  assert.notEqual(a, b);
});

test("alignItemsHorizontallyWithPadding reproduces the native bottom row", () => {
  // The real MenuLayer bottom menu: achievements, options, stats, newgrounds,
  // padding 5. Content widths come from each frame's spriteSourceSize / 2.
  const menu = new UiMenu("bottom");
  const widths = [102, 101, 101, 102]; // hd source widths
  for (const [i, w] of widths.entries()) {
    menu.add(new MenuItem({ id: `b${i}`, frame: uiFrame(frame(w, 108)) }));
  }
  menu.alignItemsHorizontallyWithPadding(5);

  const design = widths.map((w) => w / 2);
  const total = design.reduce((a, b) => a + b, 0) + 3 * 5;
  close(total, 218);

  // centred as a group, each item centred on its own slot, gaps exactly 5
  close(menu.items[0].rect().x, -total / 2);
  const last = menu.items[3].rect();
  close(last.x + last.w, total / 2);
  for (let i = 1; i < 4; i++) {
    const prev = menu.items[i - 1].rect();
    close(menu.items[i].rect().x - (prev.x + prev.w), 5);
  }
  for (const item of menu.items) close(item.y, 0);
});

test("client pixels map to design space at any backing-store scale", () => {
  // 1280x720 canvas at deviceScaleFactor 2 displayed in a 640x360 CSS box:
  // the design-space answer must not depend on either.
  const canvas = {
    width: 1280, height: 720,
    getBoundingClientRect: () => ({ left: 40, top: 10, width: 640, height: 360 }),
  } as unknown as HTMLCanvasElement;
  const scale = 720 / 320; // FIXED_HEIGHT on 16:9

  // the middle of the canvas is the design origin
  const mid = toDesignSpace(canvas, 40 + 320, 10 + 180, scale);
  close(mid.x, 0);
  close(mid.y, 0);

  // top-left corner: x = -viewW/2, y = +160 (design height is 320)
  const tl = toDesignSpace(canvas, 40, 10, scale);
  close(tl.y, 160);
  close(tl.x, -(1280 / scale) / 2);

  // y is up: a click lower on the screen has a smaller y
  const low = toDesignSpace(canvas, 40 + 320, 10 + 270, scale);
  assert.ok(low.y < 0);
});

test("rectContains is inclusive on the edges, as CCRect::containsPoint is", () => {
  const r = { x: -10, y: -5, w: 20, h: 10 };
  assert.ok(rectContains(r, -10, -5));
  assert.ok(rectContains(r, 10, 5));
  assert.ok(!rectContains(r, 10.001, 0));
});
