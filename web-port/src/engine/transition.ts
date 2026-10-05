// `CCTransitionFade::create(0.5, scene)` — the game's scene change: the old
// scene fades to black over the first half, the new one fades in from black
// over the second. `MenuLayer::onPlay`/`onGarage`/`onCreator` use 0.5 s.
//
// Each port scene is its own page load, so the two halves live in two pages:
// the outgoing page fades out and leaves a note in sessionStorage, and the
// incoming page fades in when it finds the note.
import { createTexture } from "./atlas.ts";
import type { Renderer } from "./renderer.ts";

export const SCENE_FADE = 0.5;
const KEY = "gd-scene-fade";

function blackTexture(renderer: Renderer) {
  const c = document.createElement("canvas");
  c.width = c.height = 2;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 2, 2);
  return {
    tex: createTexture(renderer.ctx, c), texW: 2, texH: 2,
    frame: { x: 0, y: 0, w: 2, h: 2, rotated: false, offsetX: 0, offsetY: 0, sourceW: 2, sourceH: 2 },
  };
}

function takeNote(): boolean {
  try {
    const had = sessionStorage.getItem(KEY) === "1";
    sessionStorage.removeItem(KEY);
    return had;
  } catch { return false; }
}

function leaveNote() {
  try { sessionStorage.setItem(KEY, "1"); } catch { /* private mode: no fade-in */ }
}

export class SceneFade {
  private renderer: Renderer;
  private tex: ReturnType<typeof blackTexture>;
  /** seconds into the incoming half, or null once it is done */
  private inT: number | null;
  /** the outgoing half, once a navigation has been asked for */
  private outgoing: { t: number; go: () => void } | null = null;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.tex = blackTexture(renderer);
    this.inT = takeNote() ? 0 : null;
  }

  /** a navigation is under way — input should be ignored */
  get leaving(): boolean { return this.outgoing !== null; }

  /** fade out, then run `go` (which changes the page) */
  go(go: () => void) {
    if (this.outgoing) return;
    this.outgoing = { t: 0, go };
  }

  /**
   * Advance and draw the fade over everything else. Call last, before
   * `renderer.flush()`, with the scene's view scale and size.
   */
  draw(dt: number, scale: number, viewW: number, viewH: number) {
    const half = SCENE_FADE / 2;
    let a = 0;
    if (this.inT !== null) {
      this.inT += dt;
      a = Math.max(0, 1 - this.inT / half);
      if (this.inT >= half) this.inT = null;
    }
    if (this.outgoing) {
      this.outgoing.t += dt;
      a = Math.max(a, Math.min(1, this.outgoing.t / half));
    }
    if (a > 0) {
      const { tex, texW, texH, frame } = this.tex;
      // whatever was batched under the scene's own camera goes out first
      this.renderer.flush();
      this.renderer.camera = { x: 0, y: 0, scale };
      this.renderer.draw(tex, texW, texH, frame, 0, 0, viewW, viewH, 0, 0, 0, 0, a);
    }
    if (this.outgoing && this.outgoing.t >= half) {
      const go = this.outgoing.go;
      this.outgoing = null;
      leaveNote();
      go();
    }
  }
}
