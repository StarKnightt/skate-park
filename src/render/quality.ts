import { MOBILE } from '../core/device';
import { params } from '../core/util';
import { settings } from '../core/settings';
import { MAX_LAMPS } from './materials';

/** people.ts setProfile(): people shown and updated, LOD switch distance multiplier, animation rate (0 = every frame),
 *  sun shadow casting */
export interface PeopleProfile { count: number; lodScale: number; mixerHz: number; castShadow: boolean }

/** everything one quality level sets; the render scale adapts on its own between dprMin and dprMax */
export interface Tier {
  name: 'M-low' | 'M' | 'high';
  dprMax: number;
  dprMin: number;
  /** sun cascade map size (each of the 2 cascades), shadow far plane (m), cascades re-rendered every n-th frame */
  sunMap: number;
  sunFar: number;
  sunEvery: number;
  /** shadow map of the spot light in the nearest street lamp (0 = no spot light: that lamp joins the shader pools) */
  lampShadow: number;
  /** street lamps in the shader light-pool loop (the nearest ones, sorted every 0.5 s) */
  lampPools: number;
  /** the skater's own shadow map (0 = off) */
  hero: number;
  bloom: boolean;
  msaa: number;
  fxaa: boolean;
  /** TOON_MOBILE material path: 4-tap PCF, one cascade per pixel, no fine / rim taps, B-spline hero shadow only */
  mobileShader: boolean;
  /** sky / ocean fbm octaves and ocean wave count */
  noiseOct: number;
  oceanWaves: number;
  people: PeopleProfile;
  /** share of the leaf clumps per bush (build time) */
  foliage: number;
}

/** today's people (all of them, mixers at 30 Hz, LODs tuned for 1080p, shadows) */
export const PEOPLE_FULL: PeopleProfile = { count: Infinity, lodScale: 1, mixerHz: 30, castShadow: true };
const PEOPLE_M: PeopleProfile = { count: 10, lodScale: 0.5, mixerHz: 30, castShadow: false };
const PEOPLE_LOW: PeopleProfile = { count: 6, lodScale: 0.35, mixerHz: 20, castShadow: false };

/** index = quality level: 0 = M-low (automatic fallback), 1 = M (mobile default), 2 = high (desktop default) */
export const TIERS: readonly Tier[] = [
  {
    name: 'M-low', dprMax: 1, dprMin: MOBILE ? 1 : 0.85, sunMap: 1024, sunFar: 30, sunEvery: 3, lampShadow: 0, lampPools: 4,
    hero: 256, bloom: false, msaa: 0, fxaa: false, mobileShader: true, noiseOct: 2, oceanWaves: 2, people: PEOPLE_LOW, foliage: 0.3,
  },
  {
    name: 'M', dprMax: 1.25, dprMin: MOBILE ? 1 : 0.85, sunMap: 1024, sunFar: 45, sunEvery: 2, lampShadow: 0, lampPools: 8,
    hero: 512, bloom: false, msaa: 0, fxaa: true, mobileShader: true, noiseOct: 3, oceanWaves: 4, people: PEOPLE_M, foliage: 0.5,
  },
  {
    name: 'high', dprMax: 1.75, dprMin: MOBILE ? 1 : 0.85, sunMap: 2048, sunFar: 95, sunEvery: 1, lampShadow: 1024, lampPools: MAX_LAMPS,
    hero: 1024, bloom: true, msaa: 4, fxaa: false, mobileShader: false, noiseOct: 5, oceanWaves: 9, people: PEOPLE_FULL, foliage: 1,
  },
];

/** level at load: ?quality=N, else the saved setting, else mobile -> M, desktop -> high */
export function startQuality(): number {
  const q = params.has('quality') ? Number(params.get('quality')) : settings.quality !== 'auto' ? settings.quality : MOBILE ? 1 : 2;
  return Math.max(0, Math.min(2, Math.round(q) || 0));
}

/**
 * Adaptive ladder from a start level, best first: features go before the render scale (bloom, then the sun shadow
 * refresh rate, then people / LOD, then the lower tiers). Each entry is a complete profile.
 */
export function ladder(q: number): Tier[] {
  const base = TIERS[q], out: Tier[] = [base];
  const push = (t: Partial<Tier>) => out.push({ ...out[out.length - 1], ...t });
  if (base.bloom) push({ bloom: false });
  push({ sunEvery: base.sunEvery + 1 });
  if (base.people.count > (q >= 2 ? PEOPLE_M : PEOPLE_LOW).count) push({ people: q >= 2 ? PEOPLE_M : PEOPLE_LOW });
  for (let k = q - 1; k >= 0; k--) out.push(TIERS[k]);
  return out;
}

/** p-th percentile of a list (copied, sorted) */
export function percentile(a: ArrayLike<number>, p: number) {
  if (!a.length) return 0;
  const s = Array.from(a).sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** leaf clumps per bush at load (the world is built once) */
export const FOLIAGE_DENSITY = TIERS[startQuality()].foliage;
