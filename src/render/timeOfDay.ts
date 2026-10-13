import { Color, Vector3 } from 'three';

export interface EnvState {
  name: string;
  sunDir: Vector3; // direction of the sun disc / sky glow
  lightDir: Vector3; // shadow casting light (sun or moon)
  lightColor: Color; lightIntensity: number;
  /** sky ambient for toon materials: hemiSky = zenith, skySun / skyAnti = horizon towards / away from the sun,
   *  hemiGround = bounce from below; all scaled by hemiIntensity */
  hemiSky: Color; hemiGround: Color; hemiIntensity: number;
  skySun: Color; skyAnti: Color;
  zenith: Color; mid: Color; horizon: Color;
  glow: Color; glowStrength: number;
  cloudLit: Color; cloudShade: Color;
  fog: Color; fogNear: number; fogFar: number;
  deep: Color; shallow: Color;
  lamps: number; stars: number;
  rim: Color; rimStrength: number;
  exposure: number; bloom: number; saturation: number; contrast: number;
  warmth: Color; shadowIntensity: number; windows: number;
  /** PCF radius in texels: long soft shadows in low sun, short crisp ones at noon */
  shadowRadius: number;
}

const dir = (azDeg: number, elDeg: number) => {
  // azimuth measured from -Z (ocean) towards -X (west / left of the start view)
  const a = (azDeg * Math.PI) / 180, e = (elDeg * Math.PI) / 180;
  return new Vector3(-Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
};
const C = (h: string) => new Color(h);

export const PRESETS: EnvState[] = [
  {
    name: 'Golden hour',
    sunDir: dir(34, 9), lightDir: dir(34, 11),
    lightColor: C('#ffe0a0'), lightIntensity: 4.8,
    hemiSky: C('#b8b2e8'), hemiGround: C('#bab4c4'), hemiIntensity: 1.4,
    skySun: C('#ffc49c'), skyAnti: C('#b4b8f0'),
    zenith: C('#7f94d4'), mid: C('#eca9b3'), horizon: C('#ffbf82'),
    glow: C('#ffd08e'), glowStrength: 1.0,
    cloudLit: C('#ffe0b8'), cloudShade: C('#c49cc0'),
    fog: C('#f6c49e'), fogNear: 70, fogFar: 620,
    deep: C('#4a76a6'), shallow: C('#6cc3b8'),
    lamps: 0, stars: 0,
    rim: C('#ffb070'), rimStrength: 1.0,
    exposure: 1.0, bloom: 0.55, saturation: 1.06, contrast: 1.05,
    warmth: C('#fff3e6'), shadowIntensity: 1.0, windows: 0.15,
    shadowRadius: 3.2,
  },
  {
    name: 'Sunset',
    sunDir: dir(30, 1.8), lightDir: dir(30, 4.5),
    lightColor: C('#ffac62'), lightIntensity: 4.8,
    hemiSky: C('#b0a0e0'), hemiGround: C('#c4acb4'), hemiIntensity: 1.25,
    skySun: C('#ffa882'), skyAnti: C('#a09ce8'),
    zenith: C('#5e6cb0'), mid: C('#ee8ea2'), horizon: C('#ff9a62'),
    glow: C('#ffa774'), glowStrength: 1.25,
    cloudLit: C('#ffb994'), cloudShade: C('#a585bf'),
    fog: C('#f3a68d'), fogNear: 60, fogFar: 560,
    deep: C('#3f5f97'), shallow: C('#64a8b0'),
    lamps: 0.45, stars: 0.05,
    rim: C('#ff9a66'), rimStrength: 1.1,
    exposure: 1.02, bloom: 0.7, saturation: 1.08, contrast: 1.05,
    warmth: C('#fff0e6'), shadowIntensity: 0.92, windows: 0.55,
    shadowRadius: 3.8,
  },
  {
    name: 'Blue hour',
    sunDir: dir(26, -5), lightDir: dir(-30, 38),
    lightColor: C('#a4b2ee'), lightIntensity: 0.55,
    // walls turned away from the moon live on the horizon fill + bounce (the ground sees only the zenith): the neutral
    // tone map's toe crushes anything much darker to black, so these keep shaded walls a deep blue-violet
    hemiSky: C('#7480c4'), hemiGround: C('#8086bc'), hemiIntensity: 1.15,
    skySun: C('#a490d0'), skyAnti: C('#7682d2'),
    zenith: C('#101e60'), mid: C('#2546b4'), horizon: C('#7e9ce6'),
    glow: C('#d098c0'), glowStrength: 0.28,
    cloudLit: C('#8a90d6'), cloudShade: C('#29347e'),
    fog: C('#2c3a72'), fogNear: 55, fogFar: 520,
    deep: C('#13245a'), shallow: C('#2b4d86'),
    lamps: 1.0, stars: 1.0,
    rim: C('#c8d0ff'), rimStrength: 0.9,
    exposure: 1.0, bloom: 1.0, saturation: 1.06, contrast: 1.05,
    warmth: C('#f0f2ff'), shadowIntensity: 0.55, windows: 1.0,
    shadowRadius: 2.5,
  },
  {
    name: 'Bright noon',
    sunDir: dir(-25, 62), lightDir: dir(-25, 62),
    lightColor: C('#fff0d8'), lightIntensity: 2.4,
    hemiSky: C('#a8c8f8'), hemiGround: C('#d0c4b0'), hemiIntensity: 1.05,
    skySun: C('#d4e4ff'), skyAnti: C('#a4c0f0'),
    zenith: C('#2f7fe0'), mid: C('#69b0f0'), horizon: C('#c4e2f4'),
    glow: C('#fff6e0'), glowStrength: 0.45,
    cloudLit: C('#ffffff'), cloudShade: C('#aebfe0'),
    fog: C('#cfe5f2'), fogNear: 90, fogFar: 760,
    deep: C('#1b68b4'), shallow: C('#34bcc4'),
    lamps: 0, stars: 0,
    rim: C('#ffffff'), rimStrength: 0.4,
    exposure: 0.9, bloom: 0.3, saturation: 1.12, contrast: 1.12,
    warmth: C('#ffffff'), shadowIntensity: 1.0, windows: 0.0,
    shadowRadius: 1.3,
  },
];

export function cloneEnv(e: EnvState): EnvState {
  const o: any = {};
  for (const [k, v] of Object.entries(e)) o[k] = (v as any)?.clone ? (v as any).clone() : v;
  return o as EnvState;
}

export function lerpEnv(out: EnvState, a: EnvState, b: EnvState, t: number) {
  for (const k of Object.keys(a) as (keyof EnvState)[]) {
    const va: any = a[k], vb: any = b[k];
    if (va instanceof Color) (out[k] as Color).copy(va).lerp(vb, t);
    else if (va instanceof Vector3) (out[k] as Vector3).copy(va).lerp(vb, t).normalize();
    else if (typeof va === 'number') (out as any)[k] = va + (vb - va) * t;
    else (out as any)[k] = t < 0.5 ? va : vb;
  }
  return out;
}

export class TimeOfDay {
  index = 0;
  from = cloneEnv(PRESETS[0]);
  to = cloneEnv(PRESETS[0]);
  cur = cloneEnv(PRESETS[0]);
  t = 1;
  duration = 2.6;
  dirty = true;
  set(i: number, instant = false) {
    this.index = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
    this.from = cloneEnv(this.cur);
    this.to = cloneEnv(PRESETS[this.index]);
    this.t = instant ? 1 : 0;
    if (instant) this.cur = cloneEnv(this.to);
    this.dirty = true;
  }
  next() { this.set(this.index + 1); }
  byName(n: string) { return PRESETS.findIndex((p) => p.name.toLowerCase().startsWith(n.toLowerCase())); }
  update(dt: number) {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / this.duration);
    const e = this.t * this.t * (3 - 2 * this.t);
    lerpEnv(this.cur, this.from, this.to, e);
    this.dirty = true;
    return true;
  }
}
