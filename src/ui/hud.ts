import type { Input } from '../core/input';
import type { FlipDir } from '../player/physics';
import { settings, onSettings, type ControlMode } from '../core/settings';

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
const SOUND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const MUTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
export const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.5"/><rect x="13.5" y="5" width="4" height="14" rx="1.5"/></svg>';
const MOUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="6.5" y="3.5" width="11" height="17" rx="5.5"/><path d="M12 7v3.5"/></svg>';

const HINT_SECONDS = 6;
const LOCK_HINT_SECONDS = 4;
const MODE_LABEL_SECONDS = 2.5;

// ---------------------------------------------------------------- control reference (help panel + pause menu)
export type Device = 'kb' | 'pad' | 'touch';
export const DEVICE_NAMES: Record<Device, string> = { kb: 'Keyboard + mouse', pad: 'Gamepad', touch: 'Touch' };
export const MODE_NAMES: Record<ControlMode, string> = { easy: 'Easy', auto: 'Auto-ride', pro: 'Pro' };
export const MODE_DESC: Record<ControlMode, string> = {
  easy: 'He keeps rolling by himself. Tap to ollie, one button flips, grinds and landings are helped.',
  auto: 'He skates the park on his own. Take over any time with the Easy controls; he carries on about 4 s after you let go.',
  pro: 'Full manual: push, pick flips by direction, grind and manual buttons, real bails.',
};
const k = (...keys: string[]) => keys.map((x) => `<kbd>${x}</kbd>`).join('');
type Rows = [string, string][];
const KB_TAIL: Rows = [
  [k('Shift'), 'manual (<b>W</b> / <b>S</b> to balance)'],
  [k('Q'), 'auto-ride on / off'],
  [k('T', 'R', 'C'), 'time of day · respawn · recenter camera'],
  [k('H', 'Esc'), 'help · pause menu'],
  ['Mouse', 'click the game to look around; <b>Esc</b> frees the mouse and pauses'],
];
const PAD_TAIL: Rows = [
  ['LB / RB', 'manual'],
  ['Y', 'auto-ride on / off'],
  ['Right stick', 'camera · L3 / R3 recenter'],
  ['Start · Back · LT', 'pause · respawn · time of day'],
];
const CONTROLS: Record<Device, Record<'easy' | 'pro', Rows>> = {
  kb: {
    easy: [
      [k('W', 'S'), 'he keeps rolling by himself: <b>W</b> faster, <b>S</b> slow down / stop'],
      [k('A', 'D'), 'steer · spin in the air'],
      [k('Space'), 'tap to ollie · in the air: flip trick'],
      [k('F'), 'flip trick (pops one when rolling), cycles kickflip, heelflip, shove-it, tre flip'],
      [k('E'), 'grinds lock on by themselves; <b>E</b> still works'],
      ...KB_TAIL,
    ],
    pro: [
      [k('W'), 'push · pump transitions'],
      [k('S'), 'brake'],
      [k('A', 'D'), 'steer and carve · spin in the air'],
      [k('Space'), 'hold to crouch, release to ollie (longer = higher)'],
      [k('F'), 'flip trick; the WASD key you hold picks it: none or <b>A</b> kickflip, <b>D</b> heelflip, <b>S</b> pop shove-it, <b>W</b> tre flip'],
      ['', 'rolling: quick pop + flip · crouched on <b>Space</b>: pops now + flip · in the air: late flip'],
      [k('E'), 'grind / slide a rail, ledge or coping'],
      ...KB_TAIL,
    ],
  },
  pad: {
    easy: [
      ['Left stick', 'steer · he keeps rolling: up faster, down slow / stop'],
      ['A', 'tap to ollie · in the air: flip trick'],
      ['X', 'flip trick (pops one when rolling), cycles the flips'],
      ['B', 'grind (grinds also lock on by themselves)'],
      ...PAD_TAIL,
    ],
    pro: [
      ['Left stick', 'steer · up push · down brake'],
      ['A', 'hold to crouch, release to ollie'],
      ['X', 'flip trick; the stick picks it: none or left kickflip, right heelflip, down shove-it, up tre flip'],
      ['D-pad + A', 'hold a direction as you release A: the same flips'],
      ['B', 'grind'],
      ...PAD_TAIL,
    ],
  },
  touch: {
    easy: [
      ['Stick', 'steer · he keeps rolling: up faster, down slow / stop'],
      ['OLLIE', 'tap to pop'],
      ['TRICK', 'flip trick (pops one when rolling), cycles the flips'],
      ['AUTO', 'auto-ride on / off'],
      ['Grinds', 'lock on by themselves near rails and ledges'],
      ['Drag', 'look around · the pause button sits top left'],
    ],
    pro: [
      ['Stick', 'up push · down brake · sideways steer'],
      ['OLLIE', 'hold to crouch, release to pop; swipe as you release: left kickflip, right heelflip, down shove-it, up tre flip'],
      ['GRIND', 'near a rail, ledge or coping'],
      ['MANUAL', 'on flat ground'],
      ['Drag', 'look around · the pause button sits top left'],
    ],
  },
};
const NOTE: Record<ControlMode, string> = {
  easy: 'Landings straighten themselves and bails are short.',
  auto: 'He rides by himself. Any move or trick takes over; about 4 s after you let go he carries on.',
  pro: '',
};
export function controlsTable(device: Device, mode: ControlMode) {
  const rows = CONTROLS[device][mode === 'pro' ? 'pro' : 'easy'];
  const note = NOTE[mode] ? `<p class="note">${NOTE[mode]}</p>` : '';
  const table = `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
  return mode === 'auto' ? note + table : table + note;
}
function hintHTML(touch: boolean, m: ControlMode) {
  if (touch) {
    return m === 'pro'
      ? 'Stick: push / steer &nbsp;·&nbsp; <kbd>OLLIE</kbd> hold + release, swipe for flips<br><kbd>GRIND</kbd> near rails &nbsp;·&nbsp; <kbd>MANUAL</kbd> &nbsp;·&nbsp; drag to look'
      : (m === 'auto' ? 'He rides by himself: use the stick to take over<br>' : 'Stick: steer, he keeps rolling &nbsp;·&nbsp; drag to look<br>')
        + '<kbd>OLLIE</kbd> tap &nbsp;·&nbsp; <kbd>TRICK</kbd> flips &nbsp;·&nbsp; <kbd>AUTO</kbd> auto-ride';
  }
  return m === 'pro'
    ? '<kbd>W</kbd> push &nbsp;<kbd>A</kbd><kbd>D</kbd> steer &nbsp;<kbd>S</kbd> brake &nbsp;<kbd>Space</kbd> hold + release to ollie<br>'
      + '<kbd>F</kbd> + <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> flips &nbsp;<kbd>E</kbd> grind &nbsp;<kbd>Shift</kbd> manual &nbsp;<kbd>Esc</kbd> menu &nbsp;<kbd>H</kbd> help'
    : (m === 'auto' ? 'Auto-ride: he skates by himself, any key takes over<br>' : '')
      + '<kbd>W</kbd><kbd>S</kbd> faster / slower &nbsp;<kbd>A</kbd><kbd>D</kbd> steer &nbsp;<kbd>Space</kbd> ollie &nbsp;<kbd>F</kbd> flip trick<br>'
      + '<kbd>Q</kbd> auto-ride &nbsp;<kbd>Esc</kbd> menu &nbsp;<kbd>H</kbd> help';
}

/** Minimal HUD: trick name + combo pop, fading hints, mode label, mouse-lock hint, title card, top-right pills, help. */
export class Hud {
  root = document.createElement('div');
  private nameEl: HTMLDivElement;
  private comboEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private helpEl: HTMLDivElement;
  private helpBody: HTMLDivElement;
  private topEl: HTMLDivElement;
  private todBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private toastEl: HTMLDivElement;
  private modeEl: HTMLDivElement;
  private lockEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private touch: boolean;
  private lockOK: boolean;
  private trickT = 0;
  private comboT = 0;
  private hintT = 0;
  private lockT = 0;
  private modeT = MODE_LABEL_SECONDS;
  private titled = false;
  private promptOn = false;
  private sleepTimer = 0;
  onTimeOfDay: () => void = () => {};
  onSound: () => void = () => {};
  /** desktop menu pill (the pause menu sets it) */
  onMenu: () => void = () => {};
  /** auto-ride engaged? (set by the pause menu installer): switching it on / off shows a short toast */
  autoState: (() => boolean) | null = null;
  private autoWas: boolean | null = null;

  constructor(touch: boolean) {
    this.touch = touch;
    this.lockOK = !touch && 'exitPointerLock' in document;
    this.root.className = 'hud' + (touch ? ' touchui' : '');
    this.root.innerHTML = `
      <div class="trick"><div class="name"></div><div class="combo"></div></div>
      <div class="hint"></div>
      <div class="modelabel show"></div>
      <div class="lockpill hide">${MOUSE}<span>Click to look around · Esc for menu</span></div>
      <div class="titlecard"><div><div class="tt">Golden Hour Skatepark</div><div class="ts">press any key or tap to ride</div></div></div>
      <div class="topbar">
        <button class="pill tod" title="Time of day (T)">${SUN}<span>Golden hour</span></button>
        <button class="pill icon snd" title="Sound">${SOUND}</button>
        <button class="pill icon hlp" title="Help (H)">?</button>
        <button class="pill icon menu" title="Menu (Esc)">${PAUSE_ICON}</button>
      </div>
      <div class="help"><button class="pill close">Close</button><div class="hbody"></div></div>
      <div class="toast hide"></div>`;
    document.body.appendChild(this.root);
    this.nameEl = this.root.querySelector('.name')!;
    this.comboEl = this.root.querySelector('.combo')!;
    this.hintEl = this.root.querySelector('.hint')!;
    if (touch) this.hintEl.classList.add('mobile');
    this.helpEl = this.root.querySelector('.help')!;
    this.helpBody = this.root.querySelector('.hbody')!;
    this.topEl = this.root.querySelector('.topbar')!;
    this.todBtn = this.root.querySelector('.tod')!;
    this.soundBtn = this.root.querySelector('.snd')!;
    this.toastEl = this.root.querySelector('.toast')!;
    this.modeEl = this.root.querySelector('.modelabel')!;
    this.lockEl = this.root.querySelector('.lockpill')!;
    this.titleEl = this.root.querySelector('.titlecard')!;
    this.todBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onTimeOfDay(); });
    this.soundBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onSound(); });
    this.root.querySelector('.hlp')!.addEventListener('click', (e) => { e.stopPropagation(); this.toggleHelp(); });
    this.root.querySelector('.menu')!.addEventListener('click', (e) => { e.stopPropagation(); this.onMenu(); });
    this.root.querySelector('.close')!.addEventListener('click', (e) => { e.stopPropagation(); this.toggleHelp(false); });
    for (const b of this.root.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.wake(4000); this.dismissPrompt(); });
    // top-right pills: faint while playing, fully visible on pointer movement / hover / tap
    addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.wake(2500); });
    addEventListener('pointerdown', (e) => this.wake(e.pointerType === 'mouse' ? 2500 : 3500));
    // the sound prompt goes away on the first input
    const firstInput = () => this.dismissPrompt();
    addEventListener('keydown', firstInput); addEventListener('pointerdown', firstInput);
    this.renderMode();
    onSettings((_s, key) => { if (key === 'controlMode') { this.renderMode(); this.showModeLabel(); this.showHint(); } });
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement) this.hideLockHint(); });
    this.lockHint();
  }

  private renderMode() {
    const m = settings.controlMode;
    this.hintEl.innerHTML = hintHTML(this.touch, m);
    this.modeEl.innerHTML = `${MODE_NAMES[m]} <span>mode</span>`;
    const order: Device[] = this.touch ? ['touch', 'kb', 'pad'] : ['kb', 'pad', 'touch'];
    this.helpBody.innerHTML = `<h2>How to skate <span class="chip">${MODE_NAMES[m]}</span></h2>
      <p class="sub">${this.touch ? 'The pause button (top left)' : '<b>Esc</b>'} opens the menu: control mode (Easy, Auto-ride, Pro), time of day, sound, camera and graphics.</p>`
      + order.map((d) => `<h3>${DEVICE_NAMES[d]}</h3>${controlsTable(d, m)}`).join('');
  }

  private wake(ms: number) {
    this.topEl.classList.add('awake');
    clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => this.topEl.classList.remove('awake'), ms);
  }

  /** help overlay; closing it brings the short controls hint back for a few seconds */
  toggleHelp(v?: boolean) {
    const open = this.helpEl.classList.toggle('show', v);
    if (open) this.hintEl.classList.add('hide'); else this.showHint();
  }
  /** close the help overlay without bringing the hint back (the pause menu opens over it) */
  hideHelp() { this.helpEl.classList.remove('show'); }
  get helpOpen() { return this.helpEl.classList.contains('show'); }
  setTimeLabel(name: string) {
    const night = name.startsWith('Blue');
    this.todBtn.innerHTML = (night ? MOON : SUN) + `<span>${name}</span>`;
  }
  setMuted(m: boolean) { this.soundBtn.innerHTML = m ? MUTE : SOUND; }

  trick(name: string, pts: number, bail = false) {
    this.nameEl.textContent = pts > 0 ? `${name}  +${pts}` : name;
    this.nameEl.classList.toggle('bail', bail);
    this.nameEl.classList.remove('show');
    void this.nameEl.offsetWidth;
    this.nameEl.classList.add('show');
    this.trickT = bail ? 1.4 : 1.6;
  }
  combo(total: number, mult: number, final = false) {
    if (total <= 0) { this.comboEl.classList.remove('show'); return; }
    this.comboEl.innerHTML = final ? `combo <b>${total.toLocaleString()}</b>` : `${total.toLocaleString()} × ${mult}`;
    this.comboEl.classList.add('show');
    this.comboT = final ? 2.0 : 99;
  }
  toast(msg: string, t = 3) { this.toastEl.textContent = msg; this.toastEl.classList.remove('hide'); this.toastT = t; this.promptOn = false; }
  private toastT = 0;
  /** small "click for sound" prompt: a few seconds, or until the first key / click / tap */
  soundPrompt() { this.toast('Click or press a key for sound', 3.5); this.promptOn = true; }
  private dismissPrompt() {
    if (!this.promptOn) return;
    this.promptOn = false; this.toastT = 0; this.toastEl.classList.add('hide');
  }

  /** desktop "click to look around" pill (bottom right): a few seconds while the mouse is free, gone on lock */
  lockHint() {
    if (!this.lockOK || document.pointerLockElement) return;
    this.lockT = LOCK_HINT_SECONDS; this.lockEl.classList.remove('hide');
  }
  private hideLockHint() { this.lockT = 0; this.lockEl.classList.add('hide'); }
  /** tiny control-mode label (top left), fades after a moment */
  showModeLabel() { this.modeT = MODE_LABEL_SECONDS; this.modeEl.classList.add('show'); }
  /** start title card; hiding it brings the controls hint, mode label and mouse hint in */
  showTitle(on: boolean) {
    const was = this.titled;
    this.titled = on;
    this.titleEl.classList.toggle('show', on);
    this.root.classList.toggle('titled', on);
    if (was && !on) { this.showHint(); this.showModeLabel(); this.lockHint(); }
  }

  update(dt: number) {
    if (this.hintT < HINT_SECONDS) {
      this.hintT += dt;
      if (this.hintT >= HINT_SECONDS) { this.hintEl.classList.add('hide'); document.body.classList.add('hints-off'); }
    }
    if (this.trickT > 0) { this.trickT -= dt; if (this.trickT <= 0) this.nameEl.classList.remove('show'); }
    if (this.comboT > 0 && this.comboT < 90) { this.comboT -= dt; if (this.comboT <= 0) this.comboEl.classList.remove('show'); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) { this.toastEl.classList.add('hide'); this.promptOn = false; } }
    if (this.lockT > 0) { this.lockT -= dt; if (this.lockT <= 0) this.lockEl.classList.add('hide'); }
    if (this.modeT > 0) { this.modeT -= dt; if (this.modeT <= 0) this.modeEl.classList.remove('show'); }
    if (this.autoState) {
      const on = this.autoState();
      if (this.autoWas !== null && on !== this.autoWas && !this.titled) {
        this.toast(on ? `Auto-ride on · ${this.touch ? 'the stick' : 'any key'} takes over` : 'Auto-ride off', 2.2);
      }
      this.autoWas = on;
    }
  }
  showHint() { this.hintT = 0; this.hintEl.classList.remove('hide'); document.body.classList.remove('hints-off'); }
}

/**
 * On-screen touch controls. Pro: left stick, OLLIE (hold / swipe release for flips), GRIND, MANUAL.
 * Easy and Auto-ride: stick, OLLIE, TRICK, AUTO (grinds are automatic). A pause button in every mode; drag to orbit.
 */
export class TouchControls {
  root = document.createElement('div');
  private autoEl: HTMLDivElement;
  private raf = 0;
  constructor(private input: Input, private canvas: HTMLElement) {
    this.root.className = 'touch';
    this.root.innerHTML = `<div class="stick"><div class="knob"></div></div>
      <div class="tbtn ollie">OLLIE</div><div class="tbtn grind">GRIND</div><div class="tbtn manual">MANUAL</div>
      <div class="tbtn flipbtn">TRICK</div><div class="tbtn autobtn"><i></i>AUTO</div>
      <button class="pausebtn" aria-label="Pause">${PAUSE_ICON}</button>
      <div class="swipehint">swipe OLLIE for flips</div>`;
    document.body.appendChild(this.root);
    const stick = this.root.querySelector('.stick') as HTMLDivElement;
    const knob = this.root.querySelector('.knob') as HTMLDivElement;
    const t = input.touch;
    let sid = -1, cx = 0, cy = 0;
    stick.addEventListener('pointerdown', (e) => {
      sid = e.pointerId; stick.setPointerCapture(e.pointerId);
      const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(e);
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== sid) return;
      let dx = (e.clientX - cx) / 55, dy = (e.clientY - cy) / 55;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      t.steer = Math.abs(dx) > 0.12 ? dx : 0;
      t.push = dy < -0.4; t.brake = dy > 0.55;
    };
    stick.addEventListener('pointermove', move);
    const end = (e: PointerEvent) => { if (e.pointerId !== sid) return; sid = -1; knob.style.transform = ''; t.steer = 0; t.push = false; t.brake = false; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);

    const ollie = this.root.querySelector('.ollie') as HTMLDivElement;
    let ox = 0, oy = 0, oid = -1;
    ollie.addEventListener('pointerdown', (e) => {
      oid = e.pointerId; ollie.setPointerCapture(e.pointerId); ox = e.clientX; oy = e.clientY;
      t.ollieHeld = true; ollie.classList.add('active');
    });
    const oend = (e: PointerEvent) => {
      if (e.pointerId !== oid) return;
      oid = -1;
      const dx = e.clientX - ox, dy = e.clientY - oy;
      let f: FlipDir | null = null;
      if (Math.hypot(dx, dy) > 28) f = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy > 0 ? 'down' : 'up');
      t.flip = f; t.ollieHeld = false; t.ollieReleased = true; ollie.classList.remove('active');
    };
    ollie.addEventListener('pointerup', oend); ollie.addEventListener('pointercancel', oend);
    const hold = (sel: string, key: 'grind' | 'manual') => {
      const el = this.root.querySelector(sel) as HTMLDivElement;
      el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); t[key] = true; if (key === 'grind') t.grindPressed = true; el.classList.add('active'); });
      const off = () => { t[key] = false; el.classList.remove('active'); };
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
    };
    hold('.grind', 'grind'); hold('.manual', 'manual');
    // TRICK / AUTO raise one-shot edges that the input layer consumes
    const tap = (sel: string, key: 'trickPressed' | 'autoPressed') => {
      const el = this.root.querySelector(sel) as HTMLDivElement;
      el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); t[key] = true; el.classList.add('active'); });
      const off = () => el.classList.remove('active');
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
      return el;
    };
    tap('.flipbtn', 'trickPressed');
    this.autoEl = tap('.autobtn', 'autoPressed');
    // click (not pointerdown): the finger lifts before the menu opens under it
    this.root.querySelector('.pausebtn')!.addEventListener('click', () => { t.pausePressed = true; });
    // drag on empty space orbits the camera
    const drags = new Map<number, { x: number; y: number }>();
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    canvas.addEventListener('pointermove', (e) => {
      const d = drags.get(e.pointerId); if (!d) return;
      input.addCameraDrag((e.clientX - d.x) * 1.2, (e.clientY - d.y) * 1.2); d.x = e.clientX; d.y = e.clientY;
    });
    const dend = (e: PointerEvent) => drags.delete(e.pointerId);
    canvas.addEventListener('pointerup', dend); canvas.addEventListener('pointercancel', dend);
    this.layout(settings.controlMode);
    onSettings((s, key) => { if (key === 'controlMode') this.layout(s.controlMode); });
  }
  /** Pro keeps the classic layout; Easy and Auto-ride swap GRIND / MANUAL for TRICK / AUTO */
  layout(m: ControlMode) {
    this.root.dataset.mode = m === 'pro' ? 'pro' : 'easy';
    if (m !== 'pro') { this.input.touch.grind = false; this.input.touch.manual = false; }
  }
  show(on: boolean) {
    this.root.classList.toggle('on', on); this.input.usingTouch = on;
    if (on && !this.raf) {
      const tick = () => {
        this.raf = this.root.classList.contains('on') ? requestAnimationFrame(tick) : 0;
        this.autoEl.classList.toggle('on', this.input.autoActive);
        this.autoEl.classList.toggle('held', this.input.autoActive && this.input.autoSuspended);
      };
      tick();
    }
  }
}
