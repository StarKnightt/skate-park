import { settings, onSettings, DEFAULTS } from '../core/settings';

const DUCK_GAIN = 0.25, DUCK_LP = 1000;
/** decoded sounds in fetch order; the music streams from an <audio> element, requested after them */
const SOUNDS = ['pop', 'land', 'roll_concrete', 'roll_wood', 'waves', 'grind_metal', 'grind_concrete', 'clack', 'bail_thud', 'seagulls'];
/** [loopStart, loopEnd] in the trimmed files: each loop body has 50 ms of itself on both sides (tools/assets/audio_trim.mjs) */
const LOOPS: Record<string, [number, number]> = {
  roll_concrete: [0.05, 4.05], roll_wood: [0.05, 3.1], waves: [0.05, 43.55], grind_metal: [0.05, 1.45], grind_concrete: [0.05, 2.05],
};
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

/**
 * Web Audio engine: wheel roll loops per surface, pops, landings, grinds, ambience and music.
 * Graph: roll/grind loops → motion → sfx (+ one-shots); sfx + amb → soundBus (sfxVol);
 * music <audio> → musicG (fade-in) → musicBus (musicVol) → musicLP; soundBus + musicLP → master (mute) → duckG (pause) → destination.
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
  private music: HTMLAudioElement | null = null;
  /** page hidden; `held`: the music stays paused after a background return until the game resumes */
  private bgSuspended = false; private held = false;
  private waking = false;
  muted = false;
  started = false;
  constructor(private base: string) {
    onSettings((s, k) => { if (k === 'musicVol' || k === 'sfxVol') this.setVolumes(s.musicVol, s.sfxVol); });
  }

  /** call from every user gesture (pointerup / touchend / click / keydown): iOS starts or resumes audio and media only inside one */
  gesture() {
    const c = this.ctx; if (!c) return;
    if (this.bgSuspended) { if (!document.hidden) this.resume(); return; }
    if (c.state !== 'running') { this.kick(c); c.resume().catch(() => {}); }
    this.playMusic();
  }
  /** a 1-sample silent buffer played inside the gesture: older iOS unlocks the output only this way */
  private kick(c: AudioContext) {
    const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, c.sampleRate); s.connect(c.destination); s.start(0);
  }
  /** page hidden: the context and the music stop until resume() */
  suspend() {
    this.bgSuspended = true; this.held = true;
    this.ctx?.suspend().catch(() => {});
    this.music?.pause();
  }
  /** page visible: the context runs again; the music restarts unless muted or paused (then on unmute / duck(false)) */
  resume() {
    this.bgSuspended = false;
    if (!this.muted && !this.ducked) this.held = false;
    const c = this.ctx; if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    this.listen(c.state !== 'running');
    this.playMusic();
  }
  private onWake = () => this.gesture();
  /** while the context is not running (created on a non-activating key, iOS 'interrupted' by a call or Siri) every gesture retries */
  private listen(on: boolean) {
    if (on === this.waking) return;
    this.waking = on;
    for (const e of GESTURES) {
      if (on) addEventListener(e, this.onWake, { capture: true, passive: true });
      else removeEventListener(e, this.onWake, true);
    }
  }

  /** synchronous, from inside a user gesture: context + a silent sample now (iOS unlock), then each sound starts once decoded */
  start() {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const c: AudioContext = new Ctx();
    this.ctx = c;
    this.kick(c);
    if (c.state !== 'running') c.resume().catch(() => {});
    c.addEventListener('statechange', () => this.listen(c.state !== 'running' && !this.bgSuspended));
    this.listen(c.state !== 'running');
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
    for (const n of SOUNDS) void this.load(n);
    this.startMusic();
  }

  private async load(n: string) {
    const c = this.ctx!;
    try {
      const r = await fetch(this.base + 'audio/' + n + '.mp3');
      if (!r.ok) return;
      this.buffers.set(n, await c.decodeAudioData(await r.arrayBuffer()));
    } catch { return; /* missing sound: skipped */ }
    if (n === 'roll_concrete' || n === 'roll_wood') {
      const r = this.loop(n, this.motion, 0);
      if (r) this.roll[n === 'roll_wood' ? 'wood' : 'concrete'] = r;
    } else if (n === 'waves') {
      const w = this.loop('waves', this.amb, 1.8);
      if (w) w.filt.frequency.value = 2400;
    }
  }
  private loop(key: string, out: AudioNode, gain: number) {
    const c = this.ctx!, b = this.buffers.get(key); if (!b) return null;
    const [loopStart, loopEnd] = LOOPS[key];
    const src = c.createBufferSource(); src.buffer = b; src.loop = true;
    src.loopStart = loopStart; src.loopEnd = Math.min(loopEnd, b.duration);
    const g = c.createGain(); g.gain.value = gain;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    src.connect(f).connect(g).connect(out);
    src.start(0, loopStart);
    return { src, gain: g, filt: f };
  }

  /** streamed (no 36 MB decode): <audio> → 9 kHz low-pass → musicG, faded in once it really plays */
  private startMusic() {
    const c = this.ctx!;
    try {
      const el = new Audio();
      el.loop = true; el.preload = 'auto'; el.src = this.base + 'audio/music.mp3';
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 9000;
      c.createMediaElementSource(el).connect(f).connect(this.musicG);
      el.addEventListener('playing', () => {
        const t = c.currentTime, g = this.musicG.gain;
        g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.setTargetAtTime(0.32, t + 0.5, 2.0);
      }, { once: true });
      this.music = el;
      this.playMusic();
    } catch { this.music = null; }
  }
  private playMusic() {
    const el = this.music;
    if (!el || this.held || this.bgSuspended || !el.paused || el.error) return;
    el.play().catch(() => { /* not allowed outside a gesture: the next gesture() retries */ });
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.1);
    if (!m && !this.ducked) { this.held = false; this.playMusic(); }
  }

  /** pause: everything down to ~25 % with a soft low-pass on the music, the rolling/grind loops silent (the world is frozen) */
  duck(on: boolean) {
    this.ducked = on;
    if (!on && !this.muted) { this.held = false; this.playMusic(); }
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

  /** a slice of a decoded sound; skipped silently while it is still loading */
  one(key: string, gain = 1, rate = 1, offset = 0, dur?: number) {
    const c = this.ctx; const b = this.buffers.get(key);
    if (!c || !b) return;
    const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.sfx);
    src.start(0, offset, dur);
  }

  pop(charge = 0.5) { this.one('pop', 0.9 + charge * 0.3, 1.0 + (Math.random() - 0.5) * 0.1, 0.05, 0.35); }
  land(hard: number) {
    const offs = [0.05, 0.65];
    this.one('land', 0.55 + hard * 0.6, 1.0, offs[Math.floor(Math.random() * 2)], 0.45);
    if (hard > 0.6) this.one('clack', 0.35 * hard, 0.9, 0.05, 0.3);
  }
  clack(v: number) { this.one('clack', Math.min(1, 0.3 + v * 0.12), 1.05, 0.05, 0.35); }
  thud() { this.one('bail_thud', 0.9, 1, 0.05, 0.6); }

  grind(on: boolean, metal = true) {
    const c = this.ctx; if (!c) return;
    if (on) {
      const key = metal ? 'grind_metal' : 'grind_concrete';
      if (this.grindLoop?.key === key) return;
      this.grind(false);
      const b = this.buffers.get(key); if (!b) return;
      const src = c.createBufferSource(); src.buffer = b; src.loop = true;
      [src.loopStart, src.loopEnd] = LOOPS[key];
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
        const offs = [0.05, 5.95, 11.85];
        const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = 0.95 + Math.random() * 0.1;
        const g = c.createGain(); g.gain.value = 0.22 + Math.random() * 0.12;
        const p = c.createStereoPanner ? c.createStereoPanner() : null;
        if (p) { p.pan.value = (Math.random() - 0.5) * 1.4; src.connect(g).connect(p).connect(this.amb); } else src.connect(g).connect(this.amb);
        src.start(0, offs[Math.floor(Math.random() * offs.length)], 5.5);
      }
    }
  }
}
