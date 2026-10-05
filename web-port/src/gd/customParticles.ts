// The custom particle object (2065): its whole look is the level's own key 145,
// a `CCParticleSystem` description, decoded here into a `ParticleConfig`.
//
// From the 2.2081 arm64 binary:
//
// * `GameToolbox::particleStringToStruct` (m1 0x44e1b4) splits key 145 on "a"
//   and, when it has 63 fields (every Dash string does), reads field i into
//   the i-th member of `cocos2d::ParticleStruct` (Geode's
//   `CCParticleSystemQuad.h` names them) — atoi for the int members, atof for
//   the float ones, "!= 0" for the bools — and names the texture
//   `particle_%02d_001.png` after `customParticleIdx`.
// * `GameToolbox::particleFromStruct` (m1 0x44f0d8) hands the members to the
//   stock setters in that order (`setDuration`, `setLife`, …, an explicit
//   `setEmissionRate`), and writes GD's own additions straight into its
//   modified `CCParticleSystem`: fade in/out (+0x1f0), friction (+0x200),
//   respawn (+0x218), the "start = end" flags (+0x220…) and the uniform colour
//   mode (+0x2e4). How those act is in `engine/ccparticles.ts` (`GDParticleExt`).
import type { ParticleConfig } from "../engine/ccparticles.ts";

export const CUSTOM_PARTICLE_ID = 2065;
/** level keys: the particle string; use the object's colours (+0x329); the
 *  same as a uniform colour (`m_hasUniformObjectColor`); quick start */
export const KEY_PARTICLE_DATA = 145;
export const KEY_USE_OBJECT_COLOR = 146;
export const KEY_UNIFORM_OBJECT_COLOR = 147;
export const KEY_QUICK_START = 211;
/** `m_animateOnTrigger`: an Animate trigger (1585) restarts the system */
export const KEY_ANIMATE_ON_TRIGGER = 123;

/** a particle string as `ParticleStruct`, in field order */
export interface ParticleStruct {
  totalParticles: number; duration: number; life: number; lifeVar: number; emissionRate: number;
  angle: number; angleVar: number; speed: number; speedVar: number; posVarX: number; posVarY: number;
  gravityX: number; gravityY: number; radialAccel: number; radialAccelVar: number;
  tangentialAccel: number; tangentialAccelVar: number;
  startSize: number; startSizeVar: number; startSpin: number; startSpinVar: number;
  /** r, rVar, g, gVar, b, bVar, a, aVar */
  start: number[];
  endSize: number; endSizeVar: number; endSpin: number; endSpinVar: number;
  end: number[];
  fadeIn: number; fadeInVar: number; fadeOut: number; fadeOutVar: number;
  startRadius: number; startRadiusVar: number; endRadius: number; endRadiusVar: number;
  rotatePerSecond: number; rotatePerSecondVar: number;
  emitterMode: number; positionType: number;
  additive: boolean; startSpinEqualToEndSpin: boolean; rotationIsDir: boolean; dynamicRotationIsDir: boolean;
  textureIndex: number; uniformColorMode: boolean;
  frictionPos: number; frictionPosVar: number; respawn: number; respawnVar: number;
}

/** `particleStringToStruct`; null when the string is not the 63-field form */
export function parseParticleString(s: string): ParticleStruct | null {
  const f = s.split("a");
  if (f.length < 63) return null;
  const n = (i: number) => {
    const v = parseFloat(f[i]);
    return Number.isFinite(v) ? v : 0;
  };
  // atoi: the int members truncate
  const i = (k: number) => Math.trunc(n(k));
  const b = (k: number) => i(k) !== 0;
  return {
    totalParticles: i(0), duration: n(1), life: n(2), lifeVar: n(3), emissionRate: i(4),
    angle: i(5), angleVar: i(6), speed: i(7), speedVar: i(8), posVarX: i(9), posVarY: i(10),
    gravityX: i(11), gravityY: i(12), radialAccel: i(13), radialAccelVar: i(14),
    tangentialAccel: i(15), tangentialAccelVar: i(16),
    startSize: i(17), startSizeVar: i(18), startSpin: i(19), startSpinVar: i(20),
    start: [n(21), n(22), n(23), n(24), n(25), n(26), n(27), n(28)],
    endSize: i(29), endSizeVar: i(30), endSpin: i(31), endSpinVar: i(32),
    end: [n(33), n(34), n(35), n(36), n(37), n(38), n(39), n(40)],
    fadeIn: n(41), fadeInVar: n(42), fadeOut: n(43), fadeOutVar: n(44),
    startRadius: i(45), startRadiusVar: i(46), endRadius: i(47), endRadiusVar: i(48),
    rotatePerSecond: i(49), rotatePerSecondVar: i(50),
    emitterMode: i(51), positionType: i(52),
    additive: b(53), startSpinEqualToEndSpin: b(54), rotationIsDir: b(55), dynamicRotationIsDir: b(56),
    textureIndex: i(57), uniformColorMode: b(58),
    frictionPos: n(59), frictionPosVar: n(60), respawn: n(61), respawnVar: n(62),
  };
}

export function particleTextureName(index: number): string {
  return `particle_${String(Math.max(0, index)).padStart(2, "0")}_001.png`;
}

/** `particleFromStruct`: the struct as the emitter's configuration */
export function particleConfigFromStruct(p: ParticleStruct): ParticleConfig {
  const c4 = (v: number[], o: number): [number, number, number, number] => [v[0 + o], v[2 + o], v[4 + o], v[6 + o]];
  return {
    texture: particleTextureName(p.textureIndex),
    mode: p.emitterMode === 1 ? "radius" : "gravity",
    maxParticles: Math.max(0, p.totalParticles),
    duration: p.duration,
    life: p.life,
    lifeVar: p.lifeVar,
    angle: p.angle,
    angleVar: p.angleVar,
    posVarX: p.posVarX,
    posVarY: p.posVarY,
    sourceX: 0,
    sourceY: 0,
    startSize: p.startSize,
    startSizeVar: p.startSizeVar,
    endSize: p.endSize,
    endSizeVar: p.endSizeVar,
    startColor: c4(p.start, 0),
    startColorVar: c4(p.start, 1),
    endColor: c4(p.end, 0),
    endColorVar: c4(p.end, 1),
    startSpin: p.startSpin,
    startSpinVar: p.startSpinVar,
    endSpin: p.endSpin,
    endSpinVar: p.endSpinVar,
    gravityX: p.gravityX,
    gravityY: p.gravityY,
    speed: p.speed,
    speedVar: p.speedVar,
    radialAccel: p.radialAccel,
    radialAccelVar: p.radialAccelVar,
    tangentialAccel: p.tangentialAccel,
    tangentialAccelVar: p.tangentialAccelVar,
    rotationIsDir: p.rotationIsDir,
    startRadius: p.startRadius,
    startRadiusVar: p.startRadiusVar,
    endRadius: p.endRadius,
    endRadiusVar: p.endRadiusVar,
    rotatePerSecond: p.rotatePerSecond,
    rotatePerSecondVar: p.rotatePerSecondVar,
    additive: p.additive,
    gd: {
      emissionRate: p.emissionRate,
      fadeIn: p.fadeIn, fadeInVar: p.fadeInVar, fadeOut: p.fadeOut, fadeOutVar: p.fadeOutVar,
      // a 63-field string carries one friction pair (position); the size and
      // rotation pairs are members the old format never reaches, so stay 0
      frictionPos: p.frictionPos, frictionPosVar: p.frictionPosVar,
      frictionSize: 0, frictionSizeVar: 0, frictionRot: 0, frictionRotVar: 0,
      startSpinEqualToEndSpin: p.startSpinEqualToEndSpin,
      startSizeEqualToEndSize: false,
      uniformColor: null,
    },
  };
}

/** `GameObject::customObjectSetup` for 2065: null when the string is unusable */
export function customParticleConfig(data: string | undefined): { cfg: ParticleConfig; grouped: boolean; struct: ParticleStruct } | null {
  if (!data) return null;
  const s = parseParticleString(data);
  if (!s || s.totalParticles <= 0) return null;
  // `setPositionType`: 0 free, 1 relative, 2 grouped
  return { cfg: particleConfigFromStruct(s), grouped: s.positionType === 2, struct: s };
}
