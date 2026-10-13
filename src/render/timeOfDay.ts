import { Color, Vector3 } from 'three';

export interface EnvState {
  name: string;
  sunDir: Vector3; // direction of the sun disc / sky glow
  lightDir: Vector3; // shadow casting light (sun or moon)
  lightColor: Color; lightIntensity: number;
  hemiSky: Color; hemiGround: Color; hemiIntensity: number;
  zenith: Color; mid: Color; horizon: Color;
  glow: Color; glowStrength: number;
  cloudLit: Color; cloudShade: Color;
  fog: Color; fogNear: number; fogFar: number;
  deep: Color; shallow: Color;
  lamps: number; stars: number;
  rim: Color; rimStrength: number;
  exposure: number; bloom: number; saturation: number; contrast: number;
  warmth: Color; shadowIntensity: number; windows: number;
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
    lightColor: C('#ffc48a'), lightIntensity: 3.2,
    hemiSky: C('#a9b0ee'), hemiGround: C('#f2b48e'), hemiIntensity: 1.02,
    zenith: C('#7f94d4'), mid: C('#eca9b3'), horizon: C('#ffbf82'),
    glow: C('#ffd08e'), glowStrength: 1.0,
    cloudLit: C('#ffe0b8'), cloudShade: C('#c49cc0'),
    fog: C('#f6c49e'), fogNear: 70, fogFar: 620,
    deep: C('#4a76a6'), shallow: C('#6cc3b8'),
    lamps: 0, stars: 0,
    rim: C('#ffc890'), rimStrength: 0.85,
    exposure: 1.0, bloom: 0.55, saturation: 1.12, contrast: 1.04,
    warmth: C('#fff3e6'), shadowIntensity: 1.0, windows: 0.15,
  },
  {
    name: 'Sunset',
    sunDir: dir(30, 1.8), lightDir: dir(30, 4.5),
    lightColor: C('#ff9c6e'), lightIntensity: 2.2,
    hemiSky: C('#a7a6f0'), hemiGround: C('#e49a82'), hemiIntensity: 1.3,
    zenith: C('#5e6cb0'), mid: C('#ee8ea2'), horizon: C('#ff9a62'),
    glow: C('#ffa774'), glowStrength: 1.25,
    cloudLit: C('#ffb994'), cloudShade: C('#a585bf'),
    fog: C('#f3a68d'), fogNear: 60, fogFar: 560,
    deep: C('#3f5f97'), shallow: C('#64a8b0'),
    lamps: 0.45, stars: 0.05,
    rim: C('#ffa27c'), rimStrength: 1.0,
    exposure: 1.02, bloom: 0.7, saturation: 1.15, contrast: 1.05,
    warmth: C('#fff0e6'), shadowIntensity: 0.9, windows: 0.55,
  },
  {
    name: 'Blue hour',
    sunDir: dir(26, -5), lightDir: dir(-30, 38),
    lightColor: C('#a8b8ff'), lightIntensity: 1.05,
    hemiSky: C('#8b95f2'), hemiGround: C('#8a74b2'), hemiIntensity: 1.45,
    zenith: C('#28398a'), mid: C('#5258b6'), horizon: C('#d38ebd'),
    glow: C('#f0a0b0'), glowStrength: 0.75,
    cloudLit: C('#c8a8d8'), cloudShade: C('#5d5fa8'),
    fog: C('#8f84c4'), fogNear: 55, fogFar: 520,
    deep: C('#2b3d80'), shallow: C('#4a78a8'),
    lamps: 1.0, stars: 1.0,
    rim: C('#bfc8ff'), rimStrength: 0.9,
    exposure: 1.12, bloom: 1.0, saturation: 1.1, contrast: 1.02,
    warmth: C('#f4f2ff'), shadowIntensity: 0.6, windows: 1.0,
  },
  {
    name: 'Bright noon',
    sunDir: dir(-25, 62), lightDir: dir(-25, 62),
    lightColor: C('#fff3df'), lightIntensity: 2.6,
    hemiSky: C('#a8d4ff'), hemiGround: C('#e2cfa6'), hemiIntensity: 1.2,
    zenith: C('#4c9fe8'), mid: C('#8ec8f4'), horizon: C('#d6ecf6'),
    glow: C('#fff6e0'), glowStrength: 0.45,
    cloudLit: C('#ffffff'), cloudShade: C('#b5c6e2'),
    fog: C('#d5e8f2'), fogNear: 90, fogFar: 760,
    deep: C('#2a7bbd'), shallow: C('#4cc8c8'),
    lamps: 0, stars: 0,
    rim: C('#ffffff'), rimStrength: 0.45,
    exposure: 0.98, bloom: 0.35, saturation: 1.08, contrast: 1.04,
    warmth: C('#ffffff'), shadowIntensity: 1.0, windows: 0.0,
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
