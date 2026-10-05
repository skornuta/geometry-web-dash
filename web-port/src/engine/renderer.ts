// WebGL2 batched quad renderer: positions, UVs, RGBA tint per vertex.
// One draw call per (texture, blendMode) batch — mirrors cocos2d SpriteBatchNode.
import type { SpriteFrame } from "./atlas.ts";

export type BlendMode = "normal" | "additive";

export interface Camera {
  x: number;
  y: number;
  scale: number;
  mirrorX?: boolean;
  /** horizontal scale about the view centre, overriding `mirrorX` (the mirror flip's squash) */
  flipScale?: number;
  /** screen rotation in degrees, clockwise (camera rotate trigger 2015) */
  rotation?: number;
}

const VERT = `#version 300 es
precision mediump float;
in vec2 aPos;
in vec2 aUV;
in vec4 aColor;
uniform vec2 uResolution; // canvas pixels
uniform vec4 uCamera;     // x, y, scale, horizontal direction
uniform vec2 uRot;        // cos, sin of the screen rotation (clockwise)
out vec2 vUV;
out vec4 vColor;
void main() {
  vec2 p = (aPos - uCamera.xy) * uCamera.z;
  p.x *= uCamera.w;
  p = vec2(p.x * uRot.x + p.y * uRot.y, -p.x * uRot.y + p.y * uRot.x);
  // world is y-up and so is clip space; origin = screen center
  vec2 clip = vec2(p.x / (uResolution.x * 0.5), p.y / (uResolution.y * 0.5));
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV;
  vColor = aColor;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vColor;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  // One blend state for everything (ONE, ONE_MINUS_SRC_ALPHA) with
  // premultiplied output: a normal sprite writes (rgb·a, a), an additive one
  // (rgb·a, 0), which is exactly what (SRC_ALPHA, ONE) gave it. Additive
  // vertices carry alpha + 2.
  float add = step(1.5, vColor.a);
  vec4 t = texture(uTex, vUV);
  float a = t.a * (vColor.a - 2.0 * add);
  outColor = vec4(t.rgb * vColor.rgb * a, a * (1.0 - add));
}`;

/**
 * The screen shaders' colour pass — `ShaderLayer`'s fragment shader, whose
 * GLSL is embedded in the GD binary (grayscale, sepia, invert, hue shift,
 * colour change, in that order), ported to GLSL ES 3 unchanged in its maths.
 */
const POST_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const POST_FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uGray; uniform vec3 uGrayTint; uniform bool uGrayLum;
uniform float uSepia;
uniform vec4 uInvert;
uniform float uHueCos; uniform float uHueSin;
uniform vec3 uChangeC; uniform vec3 uChangeB;
uniform float uLensStrength; uniform float uLensStart; uniform float uLensEnd;
uniform vec2 uLensOrigin; uniform vec3 uLensTint; uniform bool uLensAdditive; uniform float uAspect;
uniform vec2 uChromatic;
// chromatic glitch: (rgb offset, y offset, time, strength), (height, line width, line strength)
uniform vec4 uCG; uniform vec3 uCG2;
// radial blur: (value, fade, onlyEmpty, -), centre in texture UV
uniform vec4 uRB; uniform vec2 uRBC;
// bulge: (value, value2, radius, -), origin in UV
uniform vec4 uBG; uniform vec2 uBGO;
// shock line: (time, waves, strength, maxDist), edges (t1..t4), (centre, axis, dual, flip)
uniform vec4 uSL; uniform vec4 uSL2; uniform vec4 uSL3;
// shock wave: (time, waves, strength, maxDist), edges (t1..t4), (centre x, centre y, minSize, maxSize), invert
uniform vec4 uSW; uniform vec4 uSW2; uniform vec4 uSW3; uniform float uSWInv;
// GLSL leaves smoothstep undefined for edge0 > edge1, which the game's shock
// edges use; written out it is the same curve either way round
float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 437.5854); }
float noise(vec2 n) {
  const vec2 d = vec2(0.0, 1.0);
  vec2 b = floor(n), f = smoothstep(vec2(0.0), vec2(1.0), fract(n));
  return mix(mix(rand(b), rand(b + d.yx), f.x), mix(rand(b + d.xy), rand(b + d.yy), f.x), f.y);
}
const mat4 sepiaMat = mat4(0.393, 0.769, 0.189, 0.0, 0.349, 0.686, 0.168, 0.0, 0.272, 0.534, 0.131, 0.0, 0,0,0,0);
const vec3 hueK = vec3(0.57735, 0.57735, 0.57735);
out vec4 outColor;
void main() {
  vec2 tv = vUV;
  if (uSW.x > 0.0) {
    // SHOCKWAVE, as the game's ShaderLayer runs it (texture scale 1)
    vec2 p = (tv - uSW3.xy) * vec2(1.0, uAspect);
    float dis = max(length(p), 0.0001);
    float k = uSW.w != 0.0 ? clamp(1.0 - dis * uSW.w, 0.0, 1.0) : 1.0;
    if (uSWInv > 0.5) dis = uSW3.w - max(dis, uSW3.z);
    k *= clamp(sstep(uSW2.x, uSW2.y, dis) - sstep(uSW2.z, uSW2.w, dis), 0.0, 1.0);
    tv += k * ((p / dis) * sin(dis * uSW.y - uSW.x) * uSW.z) * vec2(1.0, 1.0 / uAspect);
  }
  if (uSL.x != 0.0) {
    // SHOCKLINE, as the game's ShaderLayer runs it (texture scale 1)
    float dis = uSL3.y > 0.5 ? (tv.y - uSL3.x) * uAspect : (tv.x - uSL3.x);
    float k = uSL.w == 0.0 ? 1.0 : clamp(1.0 + (dis < 0.0 ? 1.0 : -1.0) * dis * uSL.w, 0.0, 1.0);
    if (uSL3.z > 0.5) dis = abs(dis);
    if (uSL3.w > 0.5) dis = 1.0 - dis;
    k *= clamp(sstep(uSL2.x, uSL2.y, dis) - sstep(uSL2.z, uSL2.w, dis), 0.0, 1.0);
    tv += k * sin(dis * uSL.y - uSL.x) * uSL.z * vec2(1.0, 1.0 / uAspect);
  }
  if (uBG.x > 0.0) {
    // BULGE, as the game's ShaderLayer runs it (texture scale 1)
    vec2 d = (tv - uBGO) * vec2(1.0, uAspect);
    float di = length(d);
    if (di < uBG.z) {
      float fadeValue = pow(di / uBG.z, 3.0);
      vec2 bulged = (uBGO * vec2(1.0, uAspect) + normalize(d) * tan(sqrt(dot(d, d)) * uBG.x) * uBG.y) * vec2(1.0, 1.0 / uAspect);
      tv = tv * fadeValue + bulged * (1.0 - fadeValue);
    }
  }
  vec4 c = texture(uTex, tv);
  if (uCG.x != 0.0) {
    // CHROMATICGLITCH, as the game's ShaderLayer runs it
    float cVal = (vUV.y + uCG.y) * 50.0 * uCG2.x;
    tv.x += (noise(vec2(uCG.z, cVal)) - noise(vec2(0.0, cVal))) * uCG.w;
    vec4 r = texture(uTex, vec2(tv.x - uCG.x, tv.y));
    vec4 g = texture(uTex, tv);
    vec4 b = texture(uTex, vec2(tv.x + uCG.x, tv.y));
    vec3 color = vec3(r.r, g.g, b.b);
    if (uCG2.y > 0.0) color -= smoothstep(uCG2.y - 0.01, uCG2.y + 0.01, sin((vUV.y + uCG.y) * 300.0 * uCG2.x)) * uCG2.z;
    c = vec4(color, (r.a + g.a + b.a) * 0.3333);
  }
  if (uChromatic.x != 0.0 || uChromatic.y != 0.0) {
    vec4 r = texture(uTex, vUV + uChromatic);
    vec4 b = texture(uTex, vUV - uChromatic);
    c = vec4(r.r, c.g, b.b, max(r.a, max(c.a, b.a)));
  }
  if (uRB.x != 0.0 && (uRB.z == 0.0 || c.a < 0.1)) {
    // RADIALBLUR, as the game's ShaderLayer runs it
    vec2 uv = tv;
    vec2 blurVector = (uRBC - uv) * uRB.x;
    float modVal = 1.0 + 4.5 * uRB.y;
    vec4 result = c * modVal;
    for (int i = 1; i < 10; i++) {
      modVal -= uRB.y;
      uv += blurVector;
      result += texture(uTex, uv) * modVal;
    }
    c = result * 0.1;
  }
  // the target holds premultiplied colour; a shader over a sub-range of the
  // layers (\`ShaderLayer\`'s z range) leaves the rest transparent, so the
  // maths runs on straight colour and goes back premultiplied
  float alpha = c.a;
  if (alpha > 0.0) c.rgb /= alpha;
  if (uGray > 0.0) {
    float gray = !uGrayLum ? (c.r + c.g + c.b) * 0.333 : dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = c.rgb * (1.0 - uGray) + vec3(gray) * uGray * uGrayTint;
  }
  if (uSepia > 0.0) {
    vec4 t = c * sepiaMat;
    c.rgb = c.rgb * (1.0 - uSepia) + t.rgb * uSepia;
  }
  if (uInvert.a > 0.0) {
    vec4 t = 1.0 - c;
    c.rgb = c.rgb * (1.0 - uInvert.rgb) + t.rgb * uInvert.rgb;
  }
  if (uHueCos != 0.0) {
    c.rgb = vec3(c.rgb * uHueCos + cross(hueK, c.rgb) * uHueSin + hueK * dot(hueK, c.rgb) * (1.0 - uHueCos));
  }
  if (uChangeC.r > 0.0) c.rgb = c.rgb * uChangeC + uChangeB;
  if (uLensStrength > 0.0) {
    float dist = distance(vUV * vec2(1.0, uAspect), uLensOrigin);
    // smoothstep(end, start, dist) with end > start, written out
    float s = clamp((dist - uLensEnd) / (uLensStart - uLensEnd), 0.0, 1.0);
    float k = uLensStart == uLensEnd ? (dist >= uLensEnd ? uLensStrength : 0.0)
      : uLensStrength * (1.0 - s * s * (3.0 - 2.0 * s));
    if (uLensAdditive) c.rgb = c.rgb + uLensTint * k;
    else c.rgb = c.rgb * (1.0 - k) + uLensTint * k;
  }
  outColor = vec4(c.rgb * alpha, alpha);
}`;

/** the colour-pass uniforms, already in the shader's terms */
export interface PostFx {
  gray: number; grayTint: [number, number, number]; grayLum: boolean;
  sepia: number;
  invert: [number, number, number, number];
  hueDeg: number;
  changeC: [number, number, number]; changeB: [number, number, number];
  /** lens circle, in screen-width units with y scaled by the aspect */
  /** chromatic offset, in texture UV */
  chromatic?: [number, number];
  /** chromatic glitch uniforms (see POST_FRAG): rgb, yOffset, time, strength, height, line width, line strength */
  shockWave?: { time: number; waves: number; strength: number; maxDist: number;
    edges: [number, number, number, number]; center: [number, number]; minSize: number; maxSize: number; invert: boolean };
  shockLine?: { time: number; waves: number; strength: number; maxDist: number;
    edges: [number, number, number, number]; center: number; axis: boolean; dual: boolean; flip: boolean };
  bulge?: { value: number; value2: number; radius: number; origin: [number, number] };
  radialBlur?: { value: number; fade: number; center: [number, number]; onlyEmpty: boolean };
  glitch?: { rgb: number; yOff: number; time: number; strength: number; height: number; line: number; lineStrength: number };
  lens?: { strength: number; start: number; end: number; origin: [number, number]; tint: [number, number, number]; additive: boolean };
}

const FLOATS_PER_VERTEX = 8; // x y u v r g b a
const MAX_QUADS = 16384;

export class Renderer {
  ctx: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private data = new Float32Array(MAX_QUADS * 4 * FLOATS_PER_VERTEX);
  /** quads written into `data` since the last flush, across every batch */
  private quadCount = 0;
  /** where the batch being built starts in `data` */
  private batchStart = 0;
  private batches: { tex: WebGLTexture; camera: Readonly<Camera>; start: number; count: number }[] = [];
  private curTex: WebGLTexture | null = null;
  private currentCamera: Readonly<Camera> = { x: 0, y: 0, scale: 1 };
  get camera(): Readonly<Camera> { return this.currentCamera; }
  set camera(value: Camera) {
    // Finish the old pass before changing its transform, even when the next
    // pass uses the same texture. World shake/mirroring must never reach UI.
    this.closeBatch();
    this.currentCamera = { ...value };
  }
  private uResolution: WebGLUniformLocation;
  private uCamera: WebGLUniformLocation;
  private post: {
    prog: WebGLProgram; vao: WebGLVertexArrayObject; fbo: WebGLFramebuffer; tex: WebGLTexture;
    w: number; h: number; u: Record<string, WebGLUniformLocation | null>;
  } | null = null;
  /** the world is being drawn into the offscreen target for `applyPost` */
  private postActive = false;
  private uRot: WebGLUniformLocation;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("webgl2", { alpha: false, antialias: true });
    if (!ctx) throw new Error("WebGL2 not supported");
    this.ctx = ctx;
    this.prog = makeProgram(ctx, VERT, FRAG);
    ctx.useProgram(this.prog);
    this.uResolution = ctx.getUniformLocation(this.prog, "uResolution")!;
    this.uCamera = ctx.getUniformLocation(this.prog, "uCamera")!;
    this.uRot = ctx.getUniformLocation(this.prog, "uRot")!;

    this.vao = ctx.createVertexArray()!;
    ctx.bindVertexArray(this.vao);
    this.vbo = ctx.createBuffer()!;
    ctx.bindBuffer(ctx.ARRAY_BUFFER, this.vbo);
    ctx.bufferData(ctx.ARRAY_BUFFER, this.data.byteLength, ctx.DYNAMIC_DRAW);

    const ibo = ctx.createBuffer()!;
    ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, ibo);
    const idx = new Uint32Array(MAX_QUADS * 6);
    for (let i = 0; i < MAX_QUADS; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    ctx.bufferData(ctx.ELEMENT_ARRAY_BUFFER, idx, ctx.STATIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    const loc = (n: string) => ctx.getAttribLocation(this.prog, n);
    ctx.enableVertexAttribArray(loc("aPos"));
    ctx.vertexAttribPointer(loc("aPos"), 2, ctx.FLOAT, false, stride, 0);
    ctx.enableVertexAttribArray(loc("aUV"));
    ctx.vertexAttribPointer(loc("aUV"), 2, ctx.FLOAT, false, stride, 8);
    ctx.enableVertexAttribArray(loc("aColor"));
    ctx.vertexAttribPointer(loc("aColor"), 4, ctx.FLOAT, false, stride, 16);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.viewport(0, 0, w, h);
  }

  begin(offscreen = false) {
    const ctx = this.ctx;
    this.postActive = offscreen;
    if (offscreen) this.bindPostTarget();
    else ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
    ctx.clearColor(0, 0, 0, 1);
    ctx.clear(ctx.COLOR_BUFFER_BIT);
    ctx.useProgram(this.prog);
    ctx.bindVertexArray(this.vao);
    ctx.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    this.quadCount = 0;
    this.curTex = null;
    this.batchStart = 0;
    this.batches.length = 0;
  }

  /**
   * Queue a sprite quad.
   * cx/cy: world-space center. w/h: world size. rot: radians CCW.
   * frame: atlas frame; texW/texH: texture pixel size (for UVs).
   * flipX/flipY mirror the sprite.
   */
  draw(
    tex: WebGLTexture, texW: number, texH: number, frame: SpriteFrame,
    cx: number, cy: number, w: number, h: number, rot: number,
    r: number, g: number, b: number, a: number,
    blend: BlendMode = "normal", flipX = false, flipY = false,
  ) {
    if (this.quadCount >= MAX_QUADS) this.flush();
    // the blend mode rides on the vertices (see FRAG), so only a texture
    // change starts a new batch
    if (tex !== this.curTex) {
      this.closeBatch();
      this.curTex = tex;
    }
    const ab = blend === "additive" ? 2 : 0;
    const d = this.data;
    let o = this.quadCount * 4 * FLOATS_PER_VERTEX;

    const cos = Math.cos(rot), sin = Math.sin(rot);
    const hw = w / 2, hh = h / 2;
    // corners: TL, TR, BR, BL (y-up world)
    const corners: [number, number][] = [
      [-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh],
    ];
    // UV rect (texture pixels -> 0..1)
    let u0 = frame.x / texW, v0 = frame.y / texH;
    let u1 = (frame.x + (frame.rotated ? frame.h : frame.w)) / texW;
    let v1 = (frame.y + (frame.rotated ? frame.w : frame.h)) / texH;
    // Rotated frames are packed 90° CW, so displayed TL comes from the stored
    // rect's TR corner, TR from BR, and so on.
    let uvs: [number, number][] = frame.rotated
      ? [[u1, v0], [u1, v1], [u0, v1], [u0, v0]]
      : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    if (flipX) uvs = [uvs[1], uvs[0], uvs[3], uvs[2]];
    if (flipY) uvs = [uvs[3], uvs[2], uvs[1], uvs[0]];

    for (let k = 0; k < 4; k++) {
      const [lx, ly] = corners[k];
      d[o] = cx + lx * cos - ly * sin;
      d[o + 1] = cy + lx * sin + ly * cos;
      d[o + 2] = uvs[k][0];
      d[o + 3] = uvs[k][1];
      d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a + ab;
      o += FLOATS_PER_VERTEX;
    }
    this.quadCount++;
  }

  /**
   * Queue an arbitrary quad: four corners in order (the two triangles are
   * 0-1-2 and 0-2-3), each with its own texture coordinate and alpha, one
   * tint. Ribbons (motion streaks, the wave trail) are made of these, because
   * consecutive segments share edges that are not a rectangle's.
   */
  drawQuadRaw(
    tex: WebGLTexture, blend: BlendMode,
    x0: number, y0: number, u0: number, v0: number, a0: number,
    x1: number, y1: number, u1: number, v1: number, a1: number,
    x2: number, y2: number, u2: number, v2: number, a2: number,
    x3: number, y3: number, u3: number, v3: number, a3: number,
    r: number, g: number, b: number,
  ) {
    if (this.quadCount >= MAX_QUADS) this.flush();
    // the blend mode rides on the vertices (see FRAG), so only a texture
    // change starts a new batch
    if (tex !== this.curTex) {
      this.closeBatch();
      this.curTex = tex;
    }
    const ab = blend === "additive" ? 2 : 0;
    const d = this.data;
    let o = this.quadCount * 4 * FLOATS_PER_VERTEX;
    const put = (x: number, y: number, u: number, v: number, a: number) => {
      d[o] = x; d[o + 1] = y; d[o + 2] = u; d[o + 3] = v;
      d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a + ab;
      o += FLOATS_PER_VERTEX;
    };
    put(x0, y0, u0, v0, a0);
    put(x1, y1, u1, v1, a1);
    put(x2, y2, u2, v2, a2);
    put(x3, y3, u3, v3, a3);
    this.quadCount++;
  }

  /**
   * Queue a quad with a colour per corner (TL, TR, BR, BL order as `draw`),
   * sampling one texel `(u, v)` of `tex` — a gradient layer drawn with a white
   * texture. Colours are straight (not premultiplied) rgba 0..1.
   */
  drawColorQuad(
    tex: WebGLTexture, u: number, v: number, blend: BlendMode,
    corners: readonly { x: number; y: number; r: number; g: number; b: number; a: number }[],
  ) {
    if (this.quadCount >= MAX_QUADS) this.flush();
    if (tex !== this.curTex) {
      this.closeBatch();
      this.curTex = tex;
    }
    const ab = blend === "additive" ? 2 : 0;
    const d = this.data;
    let o = this.quadCount * 4 * FLOATS_PER_VERTEX;
    for (const c of corners) {
      d[o] = c.x; d[o + 1] = c.y; d[o + 2] = u; d[o + 3] = v;
      d[o + 4] = c.r; d[o + 5] = c.g; d[o + 6] = c.b; d[o + 7] = c.a + ab;
      o += FLOATS_PER_VERTEX;
    }
    this.quadCount++;
  }

  private bindPostTarget() {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    if (!this.post) {
      const prog = makeProgram(ctx, POST_VERT, POST_FRAG);
      const vao = ctx.createVertexArray()!;
      ctx.bindVertexArray(vao);
      const buf = ctx.createBuffer();
      ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
      ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
      const loc = ctx.getAttribLocation(prog, "aPos");
      ctx.enableVertexAttribArray(loc);
      ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
      const u: Record<string, WebGLUniformLocation | null> = {};
      for (const n of ["uTex", "uCG", "uCG2", "uRB", "uRBC", "uBG", "uBGO", "uSL", "uSL2", "uSL3", "uSW", "uSW2", "uSW3", "uSWInv", "uGray", "uGrayTint", "uGrayLum", "uSepia", "uInvert", "uHueCos", "uHueSin", "uChangeC", "uChangeB",
        "uLensStrength", "uLensStart", "uLensEnd", "uLensOrigin", "uLensTint", "uLensAdditive", "uAspect", "uChromatic"]) {
        u[n] = ctx.getUniformLocation(prog, n);
      }
      this.post = { prog, vao, fbo: ctx.createFramebuffer()!, tex: ctx.createTexture()!, w: 0, h: 0, u };
    }
    const p = this.post;
    if (p.w !== w || p.h !== h) {
      ctx.bindTexture(ctx.TEXTURE_2D, p.tex);
      ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, w, h, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, null);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.NEAREST);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.NEAREST);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
      ctx.bindFramebuffer(ctx.FRAMEBUFFER, p.fbo);
      ctx.framebufferTexture2D(ctx.FRAMEBUFFER, ctx.COLOR_ATTACHMENT0, ctx.TEXTURE_2D, p.tex, 0);
      p.w = w; p.h = h;
    }
    ctx.bindFramebuffer(ctx.FRAMEBUFFER, p.fbo);
  }

  /**
   * Start drawing into the offscreen target part-way through a frame: what is
   * queued so far goes onto the canvas, and the target starts transparent, so
   * only the layers drawn from here to `applyPost` take the colour pass.
   */
  beginPostLayer() {
    if (this.postActive) return;
    this.flush();
    const ctx = this.ctx;
    this.bindPostTarget();
    ctx.clearColor(0, 0, 0, 0);
    ctx.clear(ctx.COLOR_BUFFER_BIT);
    ctx.useProgram(this.prog);
    ctx.bindVertexArray(this.vao);
    this.postActive = true;
    this.curTex = null;
  }

  /**
   * Finish the world drawn since `begin(true)`: run it through the colour
   * pass onto the canvas, then carry on drawing (the HUD) directly.
   */
  applyPost(fx: PostFx) {
    if (!this.postActive || !this.post) return;
    this.flush();
    const ctx = this.ctx, p = this.post, u = p.u;
    ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
    ctx.enable(ctx.BLEND);
    ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA);
    ctx.useProgram(p.prog);
    ctx.bindVertexArray(p.vao);
    ctx.activeTexture(ctx.TEXTURE0);
    ctx.bindTexture(ctx.TEXTURE_2D, p.tex);
    ctx.uniform1i(u.uTex, 0);
    ctx.uniform1f(u.uGray, fx.gray);
    ctx.uniform3f(u.uGrayTint, ...fx.grayTint);
    ctx.uniform1i(u.uGrayLum, fx.grayLum ? 1 : 0);
    ctx.uniform1f(u.uSepia, fx.sepia);
    ctx.uniform4f(u.uInvert, ...fx.invert);
    const a = (fx.hueDeg * Math.PI) / 180;
    ctx.uniform1f(u.uHueCos, Math.cos(a));
    ctx.uniform1f(u.uHueSin, Math.sin(a));
    ctx.uniform3f(u.uChangeC, ...fx.changeC);
    ctx.uniform3f(u.uChangeB, ...fx.changeB);
    ctx.uniform2f(u.uChromatic, ...(fx.chromatic ?? [0, 0]));
    const SW = fx.shockWave;
    ctx.uniform4f(u.uSW, SW ? Math.max(SW.time, 1e-6) : 0, SW?.waves ?? 0, SW?.strength ?? 0, SW?.maxDist ?? 0);
    ctx.uniform4f(u.uSW2, ...(SW?.edges ?? [0, 0, 0, 0]));
    ctx.uniform4f(u.uSW3, ...(SW?.center ?? [0.5, 0.5]), SW?.minSize ?? 0, SW?.maxSize ?? 0);
    ctx.uniform1f(u.uSWInv, SW?.invert ? 1 : 0);
    const SL = fx.shockLine;
    ctx.uniform4f(u.uSL, SL ? SL.time || 1e-6 : 0, SL?.waves ?? 0, SL?.strength ?? 0, SL?.maxDist ?? 0);
    ctx.uniform4f(u.uSL2, ...(SL?.edges ?? [0, 0, 0, 0]));
    ctx.uniform4f(u.uSL3, SL?.center ?? 0, SL?.axis ? 1 : 0, SL?.dual ? 1 : 0, SL?.flip ? 1 : 0);
    const BG = fx.bulge;
    if (BG || SL || SW) ctx.uniform1f(u.uAspect, this.canvas.height / this.canvas.width);
    ctx.uniform4f(u.uBG, BG ? BG.value : 0, BG?.value2 ?? 0, BG?.radius ?? 0, 0);
    ctx.uniform2f(u.uBGO, ...(BG?.origin ?? [0.5, 0.5]));
    const RB = fx.radialBlur;
    ctx.uniform4f(u.uRB, RB ? RB.value : 0, RB?.fade ?? 0, RB?.onlyEmpty ? 1 : 0, 0);
    ctx.uniform2f(u.uRBC, ...(RB?.center ?? [0.5, 0.5]));
    const G = fx.glitch;
    ctx.uniform4f(u.uCG, G ? G.rgb : 0, G?.yOff ?? 0, G?.time ?? 0, G?.strength ?? 0);
    ctx.uniform3f(u.uCG2, G?.height ?? 0, G?.line ?? 0, G?.lineStrength ?? 0);
    const L = fx.lens;
    ctx.uniform1f(u.uLensStrength, L ? L.strength : 0);
    if (L) {
      ctx.uniform1f(u.uLensStart, L.start); ctx.uniform1f(u.uLensEnd, L.end);
      ctx.uniform2f(u.uLensOrigin, ...L.origin); ctx.uniform3f(u.uLensTint, ...L.tint);
      ctx.uniform1i(u.uLensAdditive, L.additive ? 1 : 0);
      ctx.uniform1f(u.uAspect, this.canvas.height / this.canvas.width);
    }
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
    // back to sprite drawing, straight onto the canvas
    this.postActive = false;
    ctx.useProgram(this.prog);
    ctx.bindVertexArray(this.vao);
    ctx.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    this.curTex = null;
  }

  /** end the current texture/blend/camera run as a recorded batch */
  private closeBatch() {
    const n = this.quadCount - this.batchStart;
    if (n > 0 && this.curTex) {
      this.batches.push({ tex: this.curTex, camera: this.currentCamera, start: this.batchStart, count: n });
    }
    this.batchStart = this.quadCount;
  }

  /**
   * Draw everything queued. Batches (one per texture/blend/camera run) are
   * only *recorded* while a frame is built; here the whole frame's vertices go
   * up in **one** upload and each batch draws from its own offset. Uploading
   * per batch cost ~0.1 ms of driver time each on Metal — Theory of
   * Everything 2 x=27637 breaks ~190 batches a frame and ran at 19 ms (USER-04).
   */
  flush() {
    this.closeBatch();
    if (this.batches.length === 0) { this.quadCount = this.batchStart = 0; return; }
    const ctx = this.ctx;
    ctx.bindBuffer(ctx.ARRAY_BUFFER, this.vbo);
    ctx.bufferData(ctx.ARRAY_BUFFER, this.data.subarray(0, this.quadCount * 4 * FLOATS_PER_VERTEX), ctx.DYNAMIC_DRAW);
    ctx.enable(ctx.BLEND);
    ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA);
    let cam: Readonly<Camera> | null = null, tex: WebGLTexture | null = null;
    for (const b of this.batches) {
      if (b.camera !== cam) {
        cam = b.camera;
        ctx.uniform4f(this.uCamera, cam.x, cam.y, cam.scale, cam.flipScale ?? (cam.mirrorX ? -1 : 1));
        const a = ((cam.rotation ?? 0) * Math.PI) / 180;
        ctx.uniform2f(this.uRot, Math.cos(a), Math.sin(a));
      }
      if (b.tex !== tex) { tex = b.tex; ctx.bindTexture(ctx.TEXTURE_2D, tex); }
      ctx.drawElements(ctx.TRIANGLES, b.count * 6, ctx.UNSIGNED_INT, b.start * 6 * 4);
    }
    this.batches.length = 0;
    this.quadCount = this.batchStart = 0;
  }
}

function makeProgram(ctx: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const s = ctx.createShader(type)!;
    ctx.shaderSource(s, src);
    ctx.compileShader(s);
    if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) {
      throw new Error("shader: " + ctx.getShaderInfoLog(s));
    }
    return s;
  };
  const prog = ctx.createProgram()!;
  ctx.attachShader(prog, compile(ctx.VERTEX_SHADER, vsSrc));
  ctx.attachShader(prog, compile(ctx.FRAGMENT_SHADER, fsSrc));
  ctx.linkProgram(prog);
  if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) {
    throw new Error("link: " + ctx.getProgramInfoLog(prog));
  }
  return prog;
}
