import { params, DEBUG } from './util';

/**
 * Player settings, persisted in localStorage under `skate.<key>`.
 *
 * controlMode: 'easy' (default on every device) | 'auto' (auto-ride: the autopilot skates, input takes over) | 'pro'.
 * Under ?test/?debug the default is 'pro' and nothing is written, so scripted captures keep the manual scheme.
 * URL overrides (never persisted): ?mode=easy|auto|pro, ?sens=<multiplier>, ?invertY.
 */
export type ControlMode = 'easy' | 'auto' | 'pro';
export type QualitySetting = 'auto' | 0 | 1 | 2;

export interface Settings {
  controlMode: ControlMode;
  /** mouse-look sensitivity multiplier (x 0.0022 rad per raw mouse count) */
  mouseSens: number;
  invertY: boolean;
  /** 0..1 */
  musicVol: number;
  /** 0..1 */
  sfxVol: number;
  quality: QualitySetting;
  /** while the mouse is locked, ease the camera back behind the skater after a few seconds without mouse movement */
  autoRecenter: boolean;
}

export const DEFAULTS: Settings = {
  controlMode: DEBUG ? 'pro' : 'easy',
  mouseSens: 1,
  invertY: false,
  musicVol: 0.7,
  sfxVol: 1,
  quality: 'auto',
  autoRecenter: true,
};

export const MOUSE_RAD_PER_COUNT = 0.0022;

const KEY = (k: string) => `skate.${k}`;
const persist = !DEBUG;

function load(): Settings {
  const s: Settings = { ...DEFAULTS };
  if (persist) {
    try {
      for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        const raw = localStorage.getItem(KEY(k));
        if (raw !== null) (s as any)[k] = JSON.parse(raw);
      }
    } catch { /* storage blocked: defaults */ }
  }
  const m = params.get('mode');
  if (m === 'easy' || m === 'auto' || m === 'pro') s.controlMode = m;
  if (params.has('sens')) s.mouseSens = Number(params.get('sens')) || s.mouseSens;
  if (params.has('invertY')) s.invertY = true;
  if (!['easy', 'auto', 'pro'].includes(s.controlMode)) s.controlMode = DEFAULTS.controlMode;
  s.mouseSens = Math.min(4, Math.max(0.1, Number(s.mouseSens) || 1));
  s.musicVol = Math.min(1, Math.max(0, Number(s.musicVol)));
  s.sfxVol = Math.min(1, Math.max(0, Number(s.sfxVol)));
  return s;
}

type Listener = (s: Settings, key: keyof Settings) => void;
const listeners = new Set<Listener>();

/** live settings object: read freely, write only through setSetting() */
export const settings: Readonly<Settings> = load();

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  (settings as Settings)[key] = value;
  if (persist) { try { localStorage.setItem(KEY(key), JSON.stringify(value)); } catch { /* ignore */ } }
  listeners.forEach((l) => l(settings, key));
}

/** subscribe to changes; returns an unsubscribe function */
export function onSettings(l: Listener) { listeners.add(l); return () => listeners.delete(l); }
