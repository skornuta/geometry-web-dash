/**
 * `CCMenu` / `CCMenuItemSpriteExtra`, ported behaviour-for-behaviour.
 *
 * Every number and every branch below is read out of the shipping 2.2081 binary
 * — see `docs/ui-parity/REFERENCE.md` §4, which names the function and offset
 * for each. Nothing here is a generic web button:
 *
 * - press scales the **item** to `baseScale * 1.26` over **0.3 s**, release back
 *   to `baseScale` over **0.4 s**, both with `CCEaseBounceOut`;
 * - the hit rectangle is the item's *content size* (the sprite's **untrimmed**
 *   size times the sprite's own scale) centred on the item, and is **not**
 *   affected by the press scale;
 * - `setSizeMult` inflates that rectangle about its centre — it does **not**
 *   change the press animation, whatever the geode binding's field name
 *   suggests;
 * - hit testing runs twice, first ignoring the size multiplier and then
 *   honouring it, so an overlapping plain rect beats an inflated one;
 * - dragging off a pressed item deselects it, and releasing then does nothing.
 *
 * This module is deliberately free of DOM and WebGL in its geometry so the
 * rules above can be unit-tested headlessly; `MenuHost` is the thin DOM glue.
 */

import type { Renderer } from "../engine/renderer.ts";
import { easedValue } from "../gd/easing.ts";
import { contentSize, drawUiSprite, type UiFrame } from "./sprites.ts";

/** `CCMenuItemSpriteExtra::init` writes 1.26 into the press-scale field */
export const PRESS_SCALE = 1.26;
/** `m_duration`, from the constructor */
export const PRESS_DURATION = 0.3;
/** `m_unselectedDuration`, from the constructor */
export const RELEASE_DURATION = 0.4;

/** `CCEaseBounceOut::update` — bit-for-bit `easing.ts`'s curve 9, already sourced */
export function bounceOut(t: number): number {
  return easedValue(t, 9, 0);
}

export interface Rect { x: number; y: number; w: number; h: number }

export function rectContains(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export interface MenuItemOptions {
  /**
   * The artwork. Optional because `CCMenuItemSpriteExtra` wraps an arbitrary
   * `CCNode`, not only a `CCSprite` — the settings screen's buttons are
   * `ButtonSprite`s, a nine-slice plus a label — so an item may instead supply
   * its own `content` size and `render`.
   */
  frame?: UiFrame;
  /** content size override, in design units, for a non-sprite child node */
  content?: { w: number; h: number };
  /** custom drawing for a non-sprite child node; receives the item's live scale */
  render?: (renderer: Renderer, x: number, y: number, scale: number) => void;
  /** position in the menu's node space; defaults to the origin, as in the original */
  x?: number;
  y?: number;
  /** the child sprite's own scale — e.g. 0.8 for the social icons */
  spriteScale?: number;
  /** `setSizeMult`: click-area multiplier, applied only when > 1 */
  sizeMult?: number;
  /** what the button does. Omit for a control that is in scope to *draw* but not to *act* */
  onActivate?: () => void;
  /** identifier used by tests and the browser harnesses */
  id: string;
}

export class MenuItem {
  readonly id: string;
  readonly frame: UiFrame | null;
  readonly content: { w: number; h: number } | null;
  readonly render: ((renderer: Renderer, x: number, y: number, scale: number) => void) | null;
  readonly spriteScale: number;
  readonly sizeMult: number;
  readonly onActivate: (() => void) | null;
  x: number;
  y: number;

  /** `m_baseScale`; `init` sets it to 1 and nothing in MenuLayer changes it */
  baseScale = 1;
  /**
   * The press-scale field (`+0x190`). `CCMenuItemSpriteExtra::init` sets 1.26,
   * and a caller can overwrite it — `LevelPage::init` writes 1.1 for the level
   * panel, which is why this is settable rather than a module constant.
   */
  pressScale = PRESS_SCALE;
  /** the live animated scale of the *item* */
  scale = 1;

  private animFrom = 1;
  private animTo = 1;
  private animT = 0;
  private animDuration = 0;

  constructor(opts: MenuItemOptions) {
    this.id = opts.id;
    this.frame = opts.frame ?? null;
    this.content = opts.content ?? null;
    this.render = opts.render ?? null;
    if (!this.frame && !this.content) {
      throw new Error(`menu item "${opts.id}" has neither a frame nor a content size`);
    }
    this.spriteScale = opts.spriteScale ?? 1;
    this.sizeMult = opts.sizeMult ?? 1;
    this.onActivate = opts.onActivate ?? null;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
  }

  /** `CCMenuItemSpriteExtra::init`: contentSize = child.contentSize * child.scale */
  get contentW(): number {
    const w = this.content ? this.content.w : contentSize(this.frame!.frame).w;
    return w * this.spriteScale;
  }

  get contentH(): number {
    const h = this.content ? this.content.h : contentSize(this.frame!.frame).h;
    return h * this.spriteScale;
  }

  /**
   * `CCMenuItem::rect()` — `position - contentSize * anchor`, anchor (0.5,0.5),
   * in the parent menu's node space. The press scale is deliberately absent.
   */
  rect(): Rect {
    return { x: this.x - this.contentW / 2, y: this.y - this.contentH / 2, w: this.contentW, h: this.contentH };
  }

  /** `CCMenu::itemForTouch +420` — inflate about the centre, only when mult > 1 */
  touchRect(useSizeMult: boolean): Rect {
    const r = this.rect();
    if (!useSizeMult || !(this.sizeMult > 1)) return r;
    const m = this.sizeMult;
    return {
      x: r.x - r.w * (m - 1) * 0.5,
      y: r.y - r.h * (m - 1) * 0.5,
      w: r.w * m,
      h: r.h * m,
    };
  }

  /** `selected()`: stop the running action, bounce up to base * 1.26 over 0.3 s */
  select() { this.startScale(this.baseScale * this.pressScale, PRESS_DURATION); }

  /** `unselected()`: bounce back to base over 0.4 s */
  deselect() { this.startScale(this.baseScale, RELEASE_DURATION); }

  private startScale(to: number, duration: number) {
    // `CCScaleTo` starts from whatever the scale is *now*, and `stopActionByTag`
    // discards the action in flight — so an interrupted press eases from where
    // it got to, not from the base scale.
    this.animFrom = this.scale;
    this.animTo = to;
    this.animT = 0;
    this.animDuration = duration;
  }

  update(dt: number) {
    if (this.animDuration <= 0) return;
    this.animT += dt;
    const k = Math.min(1, this.animT / this.animDuration);
    this.scale = this.animFrom + (this.animTo - this.animFrom) * bounceOut(k);
    if (k >= 1) this.animDuration = 0;
  }

  draw(renderer: Renderer, menuX: number, menuY: number) {
    const x = menuX + this.x, y = menuY + this.y;
    const scale = this.spriteScale * this.scale;
    if (this.render) this.render(renderer, x, y, scale);
    else drawUiSprite(renderer, this.frame!, x, y, { scale });
  }
}

/**
 * `CCMenu`: a positioned container whose children are laid out in its own node
 * space. Items are stored in child order, which is the order `itemForTouch`
 * walks and the order `alignItemsHorizontallyWithPadding` uses.
 */
export class UiMenu {
  readonly id: string;
  x = 0;
  y = 0;
  readonly items: MenuItem[] = [];

  // no TS parameter properties anywhere in src/: node's type-stripping loader
  // rejects them outright and every test importing this file would fail to load
  constructor(id: string) { this.id = id; }

  add(item: MenuItem): MenuItem {
    this.items.push(item);
    return item;
  }

  setPosition(x: number, y: number) { this.x = x; this.y = y; }

  /** the menu's node space -> design space */
  toDesign(x: number, y: number): { x: number; y: number } {
    return { x: this.x + x, y: this.y + y };
  }

  /**
   * `CCMenu::alignItemsHorizontallyWithPadding`: total width is the sum of the
   * items' content widths plus padding between them, and each item is centred
   * on its own slot, starting at `-width/2`.
   */
  alignItemsHorizontallyWithPadding(padding: number) {
    let width = -padding;
    for (const item of this.items) width += item.contentW + padding;
    let x = -width / 2;
    for (const item of this.items) {
      item.x = x + item.contentW / 2;
      item.y = 0;
      x += item.contentW + padding;
    }
  }

  /**
   * `CCMenu::itemForTouch(touch, useSizeMult)` — design-space point in, item out.
   * Child order, first hit wins; that is the original's order, and no two items
   * on any MenuLayer menu overlap.
   */
  itemForPoint(px: number, py: number, useSizeMult: boolean): MenuItem | null {
    const lx = px - this.x, ly = py - this.y;
    for (const item of this.items) {
      if (rectContains(item.touchRect(useSizeMult), lx, ly)) return item;
    }
    return null;
  }

  /** `ccTouchBegan`/`ccTouchMoved`: try the plain rect first, then the inflated one */
  pick(px: number, py: number): MenuItem | null {
    return this.itemForPoint(px, py, false) ?? this.itemForPoint(px, py, true);
  }

  update(dt: number) { for (const item of this.items) item.update(dt); }

  draw(renderer: Renderer) { for (const item of this.items) item.draw(renderer, this.x, this.y); }
}

/**
 * Touch state machine shared by every menu on a screen, matching
 * `CCMenu::ccTouchBegan / ccTouchMoved / ccTouchEnded / ccTouchCancelled`.
 *
 * Menus are searched **most recently added first**, so a menu drawn over
 * another is the one you hit. Within one menu the order is the original's.
 */
export class MenuTouchState {
  private readonly menus: readonly UiMenu[];
  /**
   * The menu that returned true from `ccTouchBegan`. It keeps the whole gesture
   * (cocos dispatches to the delegate that claimed the touch), and it keeps it
   * even while no item is selected — which is what lets a drag off a button and
   * back on re-select it.
   */
  private capture: UiMenu | null = null;
  /** `m_pSelectedItem`; null while the finger is off every item */
  private selected: MenuItem | null = null;

  constructor(menus: readonly UiMenu[]) { this.menus = menus; }

  get selectedItem(): MenuItem | null { return this.selected; }

  /** `ccTouchBegan`: returns true when a control took the press */
  began(px: number, py: number): boolean {
    for (let i = this.menus.length - 1; i >= 0; i--) {
      const menu = this.menus[i];
      const item = menu.pick(px, py);
      if (item) {
        this.capture = menu;
        this.selected = item;
        item.select();
        return true;
      }
    }
    return false;
  }

  /** `ccTouchMoved`: re-pick within the capturing menu and swap the selection */
  moved(px: number, py: number) {
    if (!this.capture) return;
    const item = this.capture.pick(px, py);
    if (item === this.selected) return;
    this.selected?.deselect();
    this.selected = item;
    item?.select();
  }

  /** `ccTouchEnded`: release then activate, but only if something is still selected */
  ended(): MenuItem | null {
    const item = this.selected;
    this.capture = null;
    this.selected = null;
    if (!item) return null;
    item.deselect();
    item.onActivate?.();
    return item;
  }

  /** `ccTouchCancelled`: release without activating */
  cancelled() {
    this.selected?.deselect();
    this.capture = null;
    this.selected = null;
  }
}

/** client pixels -> design-space units, origin at the view centre, +Y up */
export function toDesignSpace(
  canvas: HTMLCanvasElement, clientX: number, clientY: number, scale: number,
): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((clientX - box.left) * canvas.width / box.width - canvas.width / 2) / scale,
    y: (canvas.height / 2 - (clientY - box.top) * canvas.height / box.height) / scale,
  };
}

/**
 * DOM glue: pointer capture, so a drag that leaves the canvas still delivers
 * its up/cancel and the button never sticks pressed.
 */
export class MenuHost {
  readonly touch: MenuTouchState;
  readonly menus: readonly UiMenu[];
  private readonly canvas: HTMLCanvasElement;
  private readonly scaleOf: () => number;
  private readonly onFirstGesture?: () => void;
  private pointerId: number | null = null;
  private readonly disposers: (() => void)[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    menus: readonly UiMenu[],
    scaleOf: () => number,
    onFirstGesture?: () => void,
  ) {
    this.canvas = canvas;
    this.menus = menus;
    this.scaleOf = scaleOf;
    this.onFirstGesture = onFirstGesture;
    this.touch = new MenuTouchState(menus);
    canvas.style.touchAction = "none";
    this.on("pointerdown", (e) => this.down(e as PointerEvent));
    this.on("pointermove", (e) => this.move(e as PointerEvent));
    this.on("pointerup", (e) => this.up(e as PointerEvent));
    this.on("pointercancel", (e) => this.cancel(e as PointerEvent));
    // Losing the window mid-press must not leave a button stuck at 1.26.
    const blur = () => { this.pointerId = null; this.touch.cancelled(); };
    addEventListener("blur", blur);
    this.disposers.push(() => removeEventListener("blur", blur));
  }

  private on(type: string, fn: (e: Event) => void) {
    this.canvas.addEventListener(type, fn);
    this.disposers.push(() => this.canvas.removeEventListener(type, fn));
  }

  private point(e: PointerEvent) {
    return toDesignSpace(this.canvas, e.clientX, e.clientY, this.scaleOf());
  }

  private down(e: PointerEvent) {
    if (e.button !== 0 || this.pointerId !== null) return;
    this.onFirstGesture?.();
    const p = this.point(e);
    if (!this.touch.began(p.x, p.y)) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    const p = this.point(e);
    this.touch.moved(p.x, p.y);
  }

  private up(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.touch.ended();
  }

  private cancel(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.touch.cancelled();
  }

  update(dt: number) { for (const menu of this.menus) menu.update(dt); }

  dispose() {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
