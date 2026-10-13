import { settings, onSettings, DEFAULTS } from '../core/settings';

const DUCK_GAIN = 0.25, DUCK_LP = 1000;

/**
 * Web Audio engine: wheel roll loops per surface, pops, landings, grinds, ambience and music.
 * Graph: roll/grind loops → motion → sfx (+ one-shots); sfx + amb → soundBus (sfxVol);
 * musicG (fade-in) → musicBus (musicVol) → musicLP; soundBus + musicLP → master (mute) → duckG (pause) → destination.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  buffers = new Map<string, AudioBuffer>();
  master!: GainNode; sfx!: GainNode; amb!: GainNode; musicG!: GainNode;
  private soundBus!: GainNode; private musicBus!: GainNode; private musicLP!: BiquadFilterNode;
  private motion!: GainNode; private duckG!: GainNode; private lpOpen = 20000;
  private roll: Record<string, { src: AudioBufferSourceNode; gain: GainNode; filt: BiquadFilterNode }> = {};
  private grindLoop: { src: AudioBufferSourceNode; gain: GainNode; key: string } | null = null;
  private gullTimer = 6;
  private vol = { music: settings.musicVol, sfx: settings.sfxVol };
  private ducked = false;
  muted = false;
  started = false;
  constructor(private base: string) {
    onSettings((s, k) => { if (k === 'musicVol' || k === 'sfxVol') this.setVolumes(s.musicVol, s.sfxVol); });
  }

  async start() {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx();
    const c = this.ctx;
    // a context created on a non-activating key (Esc) starts suspended: resume it on the next real gesture
    if (c.state === 'suspended') {
      const wake = () => { if (c.state !== 'suspended') { removeEventListener('pointerdown', wake, true); removeEventListener('keydown', wake, true); } else c.resume(); };
      addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);
    }
    this.lpOpen = Math.min(20000, c.sampleRate / 2 - 100);
    this.duckG = c.createGain(); this.duckG.gain.value = this.ducked ? DUCK_GAIN : 1; this.duckG.connect(c.destination);
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(this.duckG);
    this.soundBus = c.createGain(); this.soundBus.gain.value = this.sfxGain(); this.soundBus.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.soundBus);
    this.motion = c.createGain(); this.motion.gain.value = this.ducked ? 0 : 1; this.motion.connect(this.sfx);
    this.amb = c.createGain(); this.amb.gain.value = 0.55; this.amb.connect(this.soundBus);
    this.musicLP = c.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.Q.value = 0;
    this.musicLP.frequency.value = this.ducked ? DUCK_LP : this.lpOpen; this.musicLP.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.musicGain(); this.musicBus.connect(this.musicLP);
    this.musicG = c.createGain(); this.musicG.gain.value = 0.0; this.musicG.connect(this.musicBus);
    const names = ['roll_concrete', 'roll_wood', 'grind_metal', 'grind_concrete', 'pop', 'land', 'clack', 'waves', 'seagulls', 'music', 'bail_thud'];
    await Promise.all(names.map(async (n) => {
      try {
        const r = await fetch(this.base + 'audio/' + n + '.mp3');
        const ab = await r.arrayBuffer();
        this.buffers.set(n, await c.decodeAudioData(ab));
      } catch { /* missing sound: skipped */ }
    }));
    // loops
    const loop = (key: string, out: AudioNode, gain: number, loopStart = 0, loopEnd = 0, rate = 1) => {
      const b = this.buffers.get(key); if (!b) return null;
      const src = c.createBufferSource(); src.buffer = b; src.loop = true;
      if (loopEnd > 0) { src.loopStart = loopStart; src.loopEnd = Math.min(loopEnd, b.duration); }
      src.playbackRate.value = rate;
      const g = c.createGain(); g.gain.value = gain;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
      src.connect(f).connect(g).connect(out);
      src.start(0, loopStart);
      return { src, gain: g, filt: f };
    };
    const rc = loop('roll_concrete', this.motion, 0, 1.1, 5.1);
    const rw = loop('roll_wood', this.motion, 0, 0.05, 3.1);
    if (rc) this.roll.concrete = rc;
    if (rw) this.roll.wood = rw;
    const w = loop('waves', this.amb, 1.8, 0.5, 44);
    if (w) w.filt.frequency.value = 2400;
    const m = loop('music', this.musicG, 1, 0, 0);
    if (m) m.filt.frequency.value = 9000;
    this.musicG.gain.setTargetAtTime(0.32, c.currentTime + 0.5, 2.0);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.1);
  }

  /** pause: everything down to ~25 % with a soft low-pass on the music, the rolling/grind loops silent (the world is frozen) */
  duck(on: boolean) {
    this.ducked = on;
    const c = this.ctx; if (!c || !this.duckG) return;
    const t = c.currentTime;
    this.duckG.gain.setTargetAtTime(on ? DUCK_GAIN : 1, t, 0.07);
    this.motion.gain.setTargetAtTime(on ? 0 : 1, t, 0.05);
    this.musicLP.frequency.setTargetAtTime(on ? DUCK_LP : this.lpOpen, t, on ? 0.07 : 0.12);
  }
  /** music and sound volumes 0..1 (settings.musicVol / sfxVol); the defaults keep the tuned mix */
  setVolumes(music: number, sfx: number) {
    this.vol.music = Math.min(1, Math.max(0, music)); this.vol.sfx = Math.min(1, Math.max(0, sfx));
    const c = this.ctx; if (!c || !this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(this.musicGain(), c.currentTime, 0.05);
    this.soundBus.gain.setTargetAtTime(this.sfxGain(), c.currentTime, 0.05);
  }
  private musicGain() { return this.vol.music / (DEFAULTS.musicVol || 1); }
  private sfxGain() { return this.vol.sfx / (DEFAULTS.sfxVol || 1); }

  one(key: string, gain = 1, rate = 1, offset = 0, dur?: number) {
    const c = this.ctx; const b = this.buffers.get(key);
    if (!c || !b) return;
    const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.sfx);
    src.start(0, offset, dur);
  }

  pop(charge = 0.5) { this.one('pop', 0.9 + charge * 0.3, 1.0 + (Math.random() - 0.5) * 0.1, 0.1, 0.35); }
  land(hard: number) {
    const offs = [2.45, 7.8];
    this.one('land', 0.55 + hard * 0.6, 1.0, offs[Math.floor(Math.random() * 2)], 0.45);
    if (hard > 0.6) this.one('clack', 0.35 * hard, 0.9, 0.86, 0.3);
  }
  clack(v: number) { this.one('clack', Math.min(1, 0.3 + v * 0.12), 1.05, 0.86, 0.35); }
  thud() { this.one('bail_thud', 0.9, 1, 0.4, 0.6); }

  grind(on: boolean, metal = true) {
    const c = this.ctx; if (!c) return;
    if (on) {
      const key = metal ? 'grind_metal' : 'grind_concrete';
      if (this.grindLoop?.key === key) return;
      this.grind(false);
      const b = this.buffers.get(key); if (!b) return;
      const src = c.createBufferSource(); src.buffer = b; src.loop = true;
      if (metal) { src.loopStart = 0.15; src.loopEnd = 1.55; } else { src.loopStart = 19.6; src.loopEnd = 21.6; }
      const g = c.createGain(); g.gain.value = 0;
      g.gain.setTargetAtTime(metal ? 0.75 : 0.9, c.currentTime, 0.03);
      src.connect(g).connect(this.motion);
      src.start(0, src.loopStart);
      this.grindLoop = { src, gain: g, key };
    } else if (this.grindLoop) {
      const gl = this.grindLoop; this.grindLoop = null;
      gl.gain.gain.setTargetAtTime(0, c.currentTime, 0.04);
      gl.src.stop(c.currentTime + 0.3);
    }
  }

  /** per frame: speed (m/s), surface, grounded */
  update(dt: number, speed: number, surface: number, grounded: boolean, grindSpeed: number) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const s = Math.min(1, speed / 9);
    for (const [k, r] of Object.entries(this.roll)) {
      const active = grounded && ((k === 'wood') === (surface === 1));
      const target = active ? Math.min(1, speed / 1.2) * (0.25 + s * 0.9) : 0;
      r.gain.gain.setTargetAtTime(target, t, 0.06);
      r.src.playbackRate.setTargetAtTime(0.7 + s * 0.6, t, 0.08);
      r.filt.frequency.setTargetAtTime(500 + s * 4200, t, 0.08);
    }
    if (this.grindLoop) this.grindLoop.src.playbackRate.setTargetAtTime(0.85 + Math.min(1, grindSpeed / 8) * 0.35, t, 0.05);
    this.gullTimer -= dt;
    if (this.gullTimer <= 0) {
      this.gullTimer = 9 + Math.random() * 14;
      const b = this.buffers.get('seagulls');
      if (b) {
        const offs = [0.45, 9.0, 19.45];
        const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = 0.95 + Math.random() * 0.1;
        const g = c.createGain(); g.gain.value = 0.22 + Math.random() * 0.12;
        const p = c.createStereoPanner ? c.createStereoPanner() : null;
        if (p) { p.pan.value = (Math.random() - 0.5) * 1.4; src.connect(g).connect(p).connect(this.amb); } else src.connect(g).connect(this.amb);
        src.start(0, offs[Math.floor(Math.random() * offs.length)], 5.5);
      }
    }
  }
}
