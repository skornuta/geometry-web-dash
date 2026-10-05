/**
 * The music / SFX `Slider` pair, as a live control: pointer capture, the thumb
 * hit test and drawing. `OptionsLayer` and `PauseLayer` both build this pair
 * (REFERENCE.md §16.0, §15) — at different scales and positions, but with the
 * same `Slider` underneath, so they share this rather than each owning a copy.
 *
 * Positions are design-space, origin at the view centre — the space
 * `toDesignSpace` maps pointers into. `draw` takes the camera offset the scene
 * renders the layer at.
 */

import type { Renderer } from "../engine/renderer.ts";
import { HD } from "../gd/sheets.ts";
import { toDesignSpace } from "./controls.ts";
import {
  SLIDER_THUMB_LENGTH, drawSlider, thumbOffset, valueFromOffset, type SliderTextures,
} from "./optionsMenu.ts";

export type VolumeId = "music" | "sfx";

interface SliderState {
  id: VolumeId;
  x: number;
  y: number;
  value: number;
  held: boolean;
}

export interface VolumeSlidersDeps {
  canvas: HTMLCanvasElement;
  textures: SliderTextures;
  /** `Slider::create`'s scale: 1 in `OptionsLayer`, 0.8 in `PauseLayer` */
  scale: number;
  /** design units -> canvas pixels, for mapping pointers */
  viewScale(): number;
  /** false while something else owns the screen (a popup over the layer) */
  enabled?(): boolean;
  music: number;
  sfx: number;
  /** `musicSliderChanged` / `sfxSliderChanged`: store and apply the value */
  onChange(id: VolumeId, value: number): void;
}

export class VolumeSliders {
  private readonly deps: VolumeSlidersDeps;
  private readonly sliders: [SliderState, SliderState];
  private readonly disposers: (() => void)[] = [];

  constructor(deps: VolumeSlidersDeps) {
    this.deps = deps;
    this.sliders = [
      { id: "music", x: 0, y: 0, value: deps.music, held: false },
      { id: "sfx", x: 0, y: 0, value: deps.sfx, held: false },
    ];
    this.installPointer();
  }

  private get(id: VolumeId): SliderState {
    return this.sliders[id === "music" ? 0 : 1];
  }

  place(id: VolumeId, x: number, y: number) {
    const s = this.get(id);
    s.x = x;
    s.y = y;
  }

  value(id: VolumeId): number { return this.get(id).value; }

  /**
   * The thumbs are not menu items, so they get their own pointer capture. It
   * coexists with `MenuHost`'s because `MenuHost` only captures when one of its
   * own items is hit, and no thumb overlaps one.
   */
  private installPointer() {
    const { canvas } = this.deps;
    let pointerId: number | null = null;
    let active: SliderState | null = null;

    const point = (e: PointerEvent) =>
      toDesignSpace(canvas, e.clientX, e.clientY, this.deps.viewScale());
    const setFrom = (px: number) => {
      if (!active) return;
      active.value = valueFromOffset(px - active.x, SLIDER_THUMB_LENGTH, this.deps.scale);
      this.deps.onChange(active.id, active.value);
    };

    const down = (e: Event) => {
      const ev = e as PointerEvent;
      if (ev.button !== 0 || pointerId !== null) return;
      if (this.deps.enabled && !this.deps.enabled()) return;
      const p = point(ev);
      const hit = this.thumbAt(p.x, p.y);
      if (!hit) return;
      ev.preventDefault();
      // the level's own press handler must not also see this as a jump
      ev.stopImmediatePropagation();
      pointerId = ev.pointerId;
      active = hit;
      hit.held = true;
      canvas.setPointerCapture(ev.pointerId);
      setFrom(p.x);
    };
    const move = (e: Event) => {
      const ev = e as PointerEvent;
      if (ev.pointerId !== pointerId) return;
      setFrom(point(ev).x);
    };
    const release = (e: Event) => {
      const ev = e as PointerEvent;
      if (ev.pointerId !== pointerId) return;
      pointerId = null;
      if (active) active.held = false;
      active = null;
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    };
    const blur = () => {
      pointerId = null;
      if (active) active.held = false;
      active = null;
    };

    for (const [type, fn] of [
      ["pointerdown", down], ["pointermove", move],
      ["pointerup", release], ["pointercancel", release],
    ] as const) {
      // capture phase: registered before the scene's own listeners run
      canvas.addEventListener(type, fn, { capture: true });
      this.disposers.push(() => canvas.removeEventListener(type, fn, { capture: true }));
    }
    addEventListener("blur", blur);
    this.disposers.push(() => removeEventListener("blur", blur));
  }

  /**
   * `Slider` routes touches through `SliderThumb`, a `CCMenuItemSpriteExtra`
   * whose rect is the thumb sprite's content size — so grabbing the groove
   * itself does nothing, exactly as in the original.
   */
  private thumbAt(px: number, py: number): SliderState | null {
    const t = this.deps.textures;
    const w = t.thumb.texW * HD * this.deps.scale;
    const h = t.thumb.texH * HD * this.deps.scale;
    for (const s of this.sliders) {
      const cx = s.x + thumbOffset(s.value, SLIDER_THUMB_LENGTH, this.deps.scale);
      if (Math.abs(px - cx) <= w / 2 && Math.abs(py - s.y) <= h / 2) return s;
    }
    return null;
  }

  /** each thumb's design-space rect, for the browser harness */
  controls(): { id: string; x: number; y: number; w: number; h: number }[] {
    const t = this.deps.textures;
    return this.sliders.map((s) => ({
      id: `slider-${s.id}`,
      x: s.x + thumbOffset(s.value, SLIDER_THUMB_LENGTH, this.deps.scale), y: s.y,
      w: t.thumb.texW * HD * this.deps.scale, h: t.thumb.texH * HD * this.deps.scale,
    }));
  }

  draw(renderer: Renderer, ox = 0, oy = 0) {
    for (const s of this.sliders) {
      drawSlider({
        renderer, textures: this.deps.textures, cx: ox + s.x, cy: oy + s.y,
        value: s.value, scale: this.deps.scale, held: s.held,
      });
    }
  }

  dispose() {
    for (const d of this.disposers.splice(0)) d();
  }
}
