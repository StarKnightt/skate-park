import type { FlipDir, Mode, SkateInput, SkatePhysics } from '../player/physics';
import { emptyInput } from '../player/physics';
import { MOUSE_RAD_PER_COUNT, onSettings, settings } from './settings';

/** what the input layer may read from the physics (never write) */
export type SkateState = Pick<SkatePhysics, 'mode' | 'speed' | 'vel' | 'fwd' | 'up' | 'pos' | 'grind' | 'manual' | 'flip' | 'airTime'>;

/** an input producer that rides by itself (auto-ride autopilot) */
export interface AutoSource {
  /** called once per physics step instead of the player's input while auto-ride is engaged */
  sample(dt: number, airborne: boolean): SkateInput;
  /** forget plans (after a respawn, a takeover or re-engaging) */
  reset(): void;
}

export type InputEvent = 'timeOfDay' | 'respawn' | 'recenter' | 'help' | 'pause' | 'autoToggle';

const STEP = 1 / 120;
/** radial stick deadzone, rescaled to 0..1 beyond it */
const DZ = 0.12;
/** look gains: drag in rad/px (mouse x mouseSens, touch as is), locked mouse MOUSE_RAD_PER_COUNT per count (pitch x0.8) */
const DRAG_YAW = 0.006, DRAG_PITCH = 0.004, LOCK_PITCH = 0.8, SPIKE = 500;
/** right stick: rate caps (rad/s), time to full rate and to stop (s) */
const STICK_YAW = Math.PI, STICK_PITCH = (100 * Math.PI) / 180, STICK_RAMP = 0.15, STICK_STOP = 0.06;
/** pop charge floors: F quick pop, Easy ollie, Easy rolling F */
const QUICK_POP = 0.35, EASY_POP = 0.7, EASY_F_POP = 0.5;
/** Easy: shortest crouch before a tapped ollie pops (s), cruise band (m/s), keyboard steer scale */
const TAP_T = 0.1, CRUISE = 4.3, CRUISE_LOW = 3.8, EASY_STEER = 0.8;
/** auto-ride takes over again after this long without player input while rolling (s) */
const AUTO_RESUME = 4;
/** an air flip request is repeated this long: the physics ignores it during the first 0.04 s of air */
const AIR_LATCH = 0.08;
const FLIP_CYCLE: FlipDir[] = ['left', 'right', 'down', 'up'];
const WASD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const DPAD: [number, FlipDir][] = [[14, 'left'], [15, 'right'], [13, 'down'], [12, 'up']];
/** gamepad buttons that count as player input (auto-ride takeover): A B X LB RB D-pad */
const PAD_ACTIVE = [0, 1, 2, 4, 5, 12, 13, 14, 15];
const KEY_EVENTS: [string, InputEvent][] = [['KeyT', 'timeOfDay'], ['KeyR', 'respawn'], ['KeyC', 'recenter'], ['KeyH', 'help'], ['F1', 'help'], ['KeyQ', 'autoToggle']];
const GAME_KEYS = new Set([...WASD, 'Space', 'KeyF', 'KeyE', 'KeyQ', 'KeyT', 'KeyR', 'KeyC', 'KeyH', 'ShiftLeft', 'ShiftRight']);

function radial(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DZ) return [0, 0];
  const k = Math.min(1, (m - DZ) / (1 - DZ)) / m;
  return [x * k, y * k];
}
const expo = (v: number) => v * Math.pow(Math.abs(v), 0.6);
/** flip picked by a stick direction: up tre flip, down shove-it, right heelflip, left / neutral kickflip */
function stickDir(x: number, y: number): FlipDir {
  if (Math.hypot(x, y) < 0.5) return 'left';
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y < 0 ? 'up' : 'down';
}
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' ||
  (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit|reset)$/.test((t as HTMLInputElement).type)));

/**
 * Unified input: keyboard, mouse (pointer lock or drag), gamepad, touch and scripted (test) sources.
 * controlMode 'easy' / 'auto': cruise auto-push, tap ollie, cycled flips. 'pro': the full manual scheme.
 */
export class Input {
  keys = new Set<string>();
  private pressedEdge = new Set<string>();
  /** deadzoned right stick (legacy readers; consumeLook applies the curve and rate cap) */
  camStick = { x: 0, y: 0 };
  touch = {
    steer: 0, push: false, brake: false, ollieHeld: false, ollieReleased: false, flip: null as FlipDir | null, grind: false, grindPressed: false, manual: false,
    /** pass-4 touch buttons (edges, cleared by the input layer): TRICK (easy), AUTO toggle, pause */
    trickPressed: false, autoPressed: false, pausePressed: false,
  };
  events: Record<InputEvent, boolean> = { timeOfDay: false, respawn: false, recenter: false, help: false, pause: false, autoToggle: false };
  scripted: Partial<Record<string, boolean>> | null = null;
  usingTouch = false;
  usingPad = false;
  /** pointer lock is active on the canvas (mirrors document.pointerLockElement === canvas) */
  locked = false;
  /** optional veto for click-to-lock, e.g. () => !game.paused */
  lockGuard: (() => boolean) | null = null;
  /** the last lock loss was the user's (Esc, focus loss), not releaseLock(); set before other pointerlockchange listeners run */
  unlockByUser = false;
  /** auto-ride source (the autopilot); when autoActive and the player gives no movement/trick input, sample() returns its input */
  auto: AutoSource | null = null;
  /** auto-ride is engaged but the player has taken over; it re-engages after AUTO_RESUME s without input while rolling */
  autoSuspended = false;
  /** true when the last sample() contained player movement/trick input (auto-ride takeover) */
  userActive = false;
  /** read-only physics state for mode logic (auto-push speed, grounded): set once by the game */
  ph: SkateState | null = null;

  private lockDX = 0; private lockDY = 0; private dragDX = 0; private dragDY = 0; private touchDX = 0; private touchDY = 0;
  private stickVX = 0; private stickVY = 0;
  private dragging = false; private lastX = 0; private lastY = 0; private downX = 0; private downY = 0; private downBtn = -1; private dragMax = 0;
  private releaseAsked = false; private unlockT = -1e9;
  /** gamepad state of the last poll; press edges wait for the next sample() */
  private pad = { on: false, lx: 0, ly: 0, rx: 0, ry: 0, btn: [] as boolean[] };
  private padDown = new Set<number>();
  private padPush = false; private padBrake = false;
  private lastPollT = -1e9; private lastSampleT = -1e9; private pollsSinceSample = 0;
  private scriptPrev: Partial<Record<string, boolean>> = {};
  private keyOrder: Record<string, number> = {}; private order = 0;
  private wasCrouch = false; private touchOllieWas = false; private swallow = false; private tapT = -1;
  /** touch swipe direction of the last OLLIE release, kept until the (possibly delayed) pop */
  private relFlip: FlipDir | null = null;
  private airLatch: FlipDir | null = null; private airLatchT = 0; private cycle = 0;
  /** Easy cruise waits for W / A / D after a stop (S to standstill, respawn, start, blocked) */
  private cruiseOff = true; private cruising = false; private stuckT = 0;
  private autoOn = false; private autoIdle = 0;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (typing(e.target)) return;
      if (GAME_KEYS.has(e.code) && !this.idle) {
        // a HUD / menu button that kept focus must not also catch Space while playing
        const ae = document.activeElement as HTMLElement | null;
        if (ae && ae !== document.body && ae !== el && /^(BUTTON|SELECT|INPUT|A)$/.test(ae.tagName)) ae.blur();
        if (e.code === 'Space') e.preventDefault();
      }
      if (e.code === 'F1') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code); this.pressedEdge.add(e.code);
      if (WASD.includes(e.code)) this.keyOrder[e.code] = ++this.order;
      for (const [c, ev] of KEY_EVENTS) if (e.code === c) this.raise(ev);
      // with the lock, Esc is the browser's: the unlock raises the pause (a late keydown must not toggle it back)
      if (e.code === 'Escape' && !this.locked && performance.now() - this.unlockT > 250) this.raise('pause');
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' && !this.idle && !typing(e.target)) e.preventDefault();
    });
    // focus lost: the key-ups never arrive, and a crouch cut short this way is not an ollie
    addEventListener('blur', () => { this.keys.clear(); this.wasCrouch = false; this.tapT = -1; });

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || this.locked) return; // touch camera handled by the touch layer
      this.dragging = true; this.lastX = this.downX = e.clientX; this.lastY = this.downY = e.clientY; this.downBtn = e.button; this.dragMax = 0;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.locked) return;
      this.dragDX += e.clientX - this.lastX; this.dragDY += e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.dragMax = Math.max(this.dragMax, Math.hypot(e.clientX - this.downX, e.clientY - this.downY));
    });
    el.addEventListener('pointerup', (e) => {
      const moved = Math.max(this.dragMax, Math.hypot(e.clientX - this.downX, e.clientY - this.downY));
      const click = this.dragging && e.pointerType === 'mouse' && this.downBtn === 0 && moved < 4;
      this.dragging = false;
      // paused: the menu's Resume locks explicitly, a stray click on the canvas must not hide the cursor
      if (click && !this.usingTouch && !this.idle && (this.lockGuard?.() ?? true)) this.requestLock();
    });
    el.addEventListener('pointercancel', () => { this.dragging = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (Math.abs(e.movementX) > SPIKE || Math.abs(e.movementY) > SPIKE) return; // Chrome spikes on lock / unlock
      this.lockDX += e.movementX; this.lockDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      const now = document.pointerLockElement === el;
      if (this.locked && !now) {
        this.unlockByUser = !this.releaseAsked;
        if (this.unlockByUser) { this.raise('pause'); this.unlockT = performance.now(); }
        this.lockDX = this.lockDY = 0;
      }
      if (!now) this.releaseAsked = false;
      this.locked = now;
    });
    document.addEventListener('pointerlockerror', () => { this.locked = document.pointerLockElement === el; });

    let lastMode = settings.controlMode;
    onSettings((s, key) => {
      if (key !== 'controlMode' || s.controlMode === lastMode) return;
      if (s.controlMode === 'auto') this.setAuto(true); else if (lastMode === 'auto') this.setAuto(false);
      lastMode = s.controlMode;
    });
  }

  attach(ph: SkateState) {
    this.ph = ph;
    if (settings.controlMode === 'auto') this.setAuto(true);
  }

  /** auto-ride engaged (stays false until an AutoSource is set) */
  get autoActive() { return this.autoOn && !!this.auto; }
  set autoActive(on: boolean) { this.setAuto(on); }
  setAuto(on: boolean) { this.autoOn = on; this.autoSuspended = false; this.autoIdle = 0; this.auto?.reset(); }
  /** seconds until a suspended auto-ride takes over again (0 when not suspended) */
  get autoResumeIn() { return this.autoSuspended ? Math.max(0, AUTO_RESUME - this.autoIdle) : 0; }

  requestLock() {
    const el = this.el;
    if (this.usingTouch || document.pointerLockElement === el || !el.requestPointerLock) return;
    const plain = () => { try { (el.requestPointerLock() as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* refused */ } };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
      r?.catch?.((err: DOMException) => { if (err?.name === 'NotSupportedError') plain(); });
    } catch (err) {
      if ((err as DOMException)?.name === 'NotSupportedError') plain();
    }
  }
  releaseLock() {
    if (document.pointerLockElement !== this.el) return;
    this.releaseAsked = true;
    document.exitPointerLock();
  }

  addCameraDrag(dx: number, dy: number) { this.touchDX += dx; this.touchDY += dy; }

  /** camera look since the last call in radians, added to rig.userYaw / userPitch (right = yaw < 0, down = pitch > 0) */
  consumeLook(dt: number): { yaw: number; pitch: number } {
    const sens = settings.mouseSens, mk = MOUSE_RAD_PER_COUNT * sens;
    let yaw = -this.lockDX * mk - this.dragDX * DRAG_YAW * sens - this.touchDX * DRAG_YAW;
    let pitch = this.lockDY * mk * LOCK_PITCH + this.dragDY * DRAG_PITCH * sens + this.touchDY * DRAG_PITCH;
    this.lockDX = this.lockDY = this.dragDX = this.dragDY = this.touchDX = this.touchDY = 0;
    const ramp = (v: number, target: number, max: number) => {
      const k = (max / (Math.abs(target) > Math.abs(v) && target * v >= 0 ? STICK_RAMP : STICK_STOP)) * dt;
      return v + Math.max(-k, Math.min(k, target - v));
    };
    this.stickVX = ramp(this.stickVX, expo(this.pad.rx) * STICK_YAW, STICK_YAW);
    this.stickVY = ramp(this.stickVY, expo(this.pad.ry) * STICK_PITCH, STICK_PITCH);
    yaw -= this.stickVX * dt; pitch += this.stickVY * dt;
    return { yaw, pitch: settings.invertY ? -pitch : pitch };
  }

  /** several displayed frames without a physics step: the game is paused */
  private get idle() { return this.pollsSinceSample >= 3 && performance.now() - this.lastSampleT > 60; }

  /** call once per displayed frame, even while paused: polls the gamepad and raises button edges/events */
  poll(_dt: number) {
    this.lastPollT = performance.now();
    this.pollsSinceSample++;
    if (this.idle) {
      // nothing samples while paused: presses made in the menu must not fire on resume
      this.pressedEdge.clear(); this.padDown.clear();
      this.touch.ollieReleased = this.touch.grindPressed = this.touch.trickPressed = false;
      this.wasCrouch = false; this.tapT = -1; this.airLatch = null;
    }
    this.readPad();
    const t = this.touch;
    if (t.pausePressed) { t.pausePressed = false; this.raise('pause'); }
    if (t.autoPressed) { t.autoPressed = false; this.raise('autoToggle'); }
  }

  private readPad() {
    let pads: (Gamepad | null)[] = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch { /* blocked by a permissions policy */ }
    let gp: Gamepad | null = null;
    for (const p of pads) if (p && p.connected && (!gp || (p.mapping === 'standard' && gp.mapping !== 'standard'))) gp = p;
    const P = this.pad;
    if (!gp) {
      if (P.on) { P.on = false; P.lx = P.ly = P.rx = P.ry = 0; P.btn = []; this.camStick.x = this.camStick.y = 0; }
      return;
    }
    P.on = true;
    [P.lx, P.ly] = radial(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
    [P.rx, P.ry] = radial(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
    this.camStick.x = P.rx; this.camStick.y = P.ry;
    const prev = P.btn, btn: boolean[] = [];
    for (let i = 0; i < gp.buttons.length; i++) {
      const b = gp.buttons[i];
      btn[i] = i === 6 || i === 7 ? b.value > (prev[i] ? 0.3 : 0.55) : b.pressed; // analog triggers: hysteresis
      if (btn[i] && !prev[i]) {
        this.padDown.add(i);
        if (i === 9) this.raise('pause'); else if (i === 3) this.raise('autoToggle'); else if (i === 8) this.raise('respawn');
        else if (i === 6) this.raise('timeOfDay'); else if (i === 10 || i === 11) this.raise('recenter');
      }
    }
    P.btn = btn;
    if (P.lx || P.ly || P.rx || P.ry || btn.some(Boolean)) this.usingPad = true;
  }

  private raise(ev: InputEvent) {
    this.events[ev] = true;
    if (ev === 'respawn') this.cruiseOff = true;
  }

  private down(code: string) { return this.keys.has(code) || !!this.scripted?.[code]; }
  private pressed(code: string) { return this.pressedEdge.has(code) || (!!this.scripted?.[code] && !this.scriptPrev[code]); }
  /** the most recently pressed of the held W/A/S/D keys picks the flip: W tre, S shove-it, D heel, A / none kick */
  private wasdDir(): FlipDir {
    let best = '';
    for (const c of WASD) if (this.down(c) && (!best || (this.keyOrder[c] ?? 0) > (this.keyOrder[best] ?? 0))) best = c;
    return best === 'KeyW' ? 'up' : best === 'KeyS' ? 'down' : best === 'KeyD' ? 'right' : 'left';
  }

  /** Build the skate input for one physics step (dt = the fixed step). Edge events are consumed. */
  sample(airborne: boolean, dt = STEP): SkateInput {
    const now = performance.now();
    if (now - this.lastPollT > 250) this.poll(dt); // nobody polls (manual clock): keep gamepad and touch edges alive
    this.lastSampleT = now; this.pollsSinceSample = 0;
    const mode: Mode = this.ph ? this.ph.mode : airborne ? 'air' : 'ride';
    const p = this.player(dt, mode, settings.controlMode !== 'pro');
    if (this.autoActive) {
      if (this.userActive) { this.autoSuspended = true; this.autoIdle = 0; return p; }
      if (this.autoSuspended) {
        this.autoIdle += dt;
        if (this.autoIdle < AUTO_RESUME || mode !== 'ride') return p;
        this.autoSuspended = false; this.auto!.reset();
      }
      return this.auto!.sample(dt, airborne);
    }
    this.autoSuspended = false;
    return p;
  }

  private player(dt: number, mode: Mode, easy: boolean): SkateInput {
    const inp = emptyInput();
    const air = mode === 'air', ground = mode === 'ride', sc = this.scripted;
    if (sc) {
      for (const c of WASD) if (sc[c] && !this.scriptPrev[c]) this.keyOrder[c] = ++this.order;
      for (const [c, ev] of KEY_EVENTS) if (sc[c] && !this.scriptPrev[c]) this.raise(ev);
      if (sc.Escape && !this.scriptPrev.Escape) this.raise('pause');
    }
    // ---- keyboard
    const W = this.down('KeyW'), A = this.down('KeyA'), S = this.down('KeyS'), D = this.down('KeyD');
    let steer = ((D ? 1 : 0) - (A ? 1 : 0)) * (easy ? EASY_STEER : 1);
    let push = W, brake = S, lean = (W ? 1 : 0) - (S ? 1 : 0);
    let crouch = this.down('Space'), crouchPress = this.pressed('Space');
    let grind = this.down('KeyE'), grindPressed = this.pressed('KeyE');
    let manual = this.down('ShiftLeft') || this.down('ShiftRight');
    const fKey = this.pressed('KeyF');
    let flip: FlipDir | 'cycle' | null = fKey ? (easy ? 'cycle' : this.wasdDir()) : null;
    let releaseFlip: FlipDir | null = null, airPick: FlipDir | null = null;
    let active = W || A || S || D || crouch || crouchPress || fKey || this.down('KeyF') || grind || grindPressed || manual;
    let steerIn = A || D;

    // ---- gamepad (state of the last poll)
    const P = this.pad;
    if (P.on) {
      const b = P.btn, e = this.padDown;
      const ps = expo(P.lx);
      if (Math.abs(ps) > Math.abs(steer)) steer = ps;
      this.padPush = P.ly < (this.padPush ? -0.25 : -0.35);
      this.padBrake = P.ly > (this.padBrake ? 0.35 : 0.45);
      push ||= this.padPush; brake ||= this.padBrake;
      if (Math.abs(P.ly) > Math.abs(lean)) lean = -P.ly;
      if (b[0]) crouch = true;
      if (e.has(0)) crouchPress = true;
      if (b[1]) grind = true;
      if (e.has(1)) grindPressed = true;
      if (b[4] || b[5]) manual = true;
      if (e.has(2)) flip = easy ? 'cycle' : stickDir(P.lx, P.ly);
      const dp = DPAD.find(([i]) => b[i])?.[1] ?? null;
      if (dp) releaseFlip = dp;
      if (air) {
        if (e.has(0) && dp) airPick = dp;
        for (const [i, d] of DPAD) if (e.has(i) && b[0]) airPick = d;
      }
      if (P.lx || P.ly) active = true;
      if (P.lx) steerIn = true;
      for (const i of PAD_ACTIVE) if (b[i] || e.has(i)) active = true;
    }

    // ---- touch
    const t = this.touch;
    if (this.usingTouch) {
      if (Math.abs(t.steer) > Math.abs(steer)) steer = t.steer;
      push ||= t.push; brake ||= t.brake;
      if (t.push) lean = 1; else if (t.brake) lean = -1;
      if (t.ollieHeld) { crouch = true; if (!this.touchOllieWas) crouchPress = true; }
      grind ||= t.grind; grindPressed ||= t.grindPressed; manual ||= t.manual;
      if (t.trickPressed) flip = easy ? 'cycle' : stickDir(t.steer, t.push ? -1 : t.brake ? 1 : 0);
      if (t.ollieReleased && t.flip) { if (air) airPick = t.flip; else this.relFlip = t.flip; }
      if (t.steer) steerIn = true;
      if (t.steer || t.push || t.brake || t.ollieHeld || t.ollieReleased || t.trickPressed || t.grind || t.grindPressed || t.manual) active = true;
    }

    // ---- crouch / ollie
    // a crouch used up by an F pop (or an Easy air press) stays off until every crouch button is released
    const swallowing = this.swallow;
    if (this.swallow) { if (crouch) crouch = crouchPress = false; else this.swallow = false; }
    if (easy && crouchPress) {
      if (air) { flip ??= 'cycle'; this.swallow = true; crouch = false; }
      else if (mode === 'grind') { inp.ollie = true; this.swallow = true; crouch = false; }
      else if (ground) this.tapT = 0;
    }
    // Easy tap: crouch at least TAP_T, then pop (holding longer charges as usual)
    if (this.tapT >= 0) {
      if (!ground) this.tapT = -1;
      else {
        this.tapT += dt;
        if (crouch) { if (this.tapT >= TAP_T) this.tapT = -1; } else if (this.tapT < TAP_T) crouch = true; else this.tapT = -1;
      }
    }
    // ---- flip button (F / pad X / touch TRICK)
    if (flip && (ground || air || mode === 'grind')) {
      const dir = flip === 'cycle' ? FLIP_CYCLE[this.cycle % FLIP_CYCLE.length] : flip;
      let used = true;
      if (air) {
        if (this.ph?.flip) used = false; else { this.airLatch = dir; this.airLatchT = AIR_LATCH; }
      } else {
        inp.ollie = true; inp.flip = dir;
        if (ground) {
          if (crouch || this.wasCrouch) {
            // crouching: pop now at the current charge, the later release must not pop again
            if (easy) inp.popCharge = EASY_POP;
            if (crouch) this.swallow = true;
            crouch = false; this.tapT = -1;
          } else inp.popCharge = easy ? EASY_F_POP : QUICK_POP;
        }
      }
      if (used && flip === 'cycle') this.cycle++;
    }
    inp.crouch = crouch;
    if (!inp.ollie && !air) {
      if (this.wasCrouch && !crouch) { inp.ollie = true; inp.flip = releaseFlip ?? this.relFlip; if (easy) inp.popCharge = EASY_POP; }
      else if (this.usingTouch && t.ollieReleased && !this.wasCrouch && !crouch && !swallowing) {
        inp.ollie = true; inp.flip = t.flip; if (easy) inp.popCharge = EASY_POP;
      }
    }
    if (inp.ollie || crouchPress || air) this.relFlip = null;
    if (air) {
      if (airPick && !this.ph?.flip) { this.airLatch = airPick; this.airLatchT = AIR_LATCH; }
      if (this.airLatch) {
        if (this.ph?.flip) this.airLatch = null;
        else { inp.airTrick = this.airLatch; if ((this.airLatchT -= dt) <= 0) this.airLatch = null; }
      }
    } else this.airLatch = null;

    // ---- Easy cruise: keep rolling on flat ground (the physics owns the push animation and acceleration)
    if (easy) {
      const ph = this.ph;
      if (brake) { if (!ph || ph.speed < 0.5) this.cruiseOff = true; }
      else if (this.cruiseOff && (push || steerIn)) this.cruiseOff = false;
      const want = !!ph && ground && !push && !brake && !manual && !crouch && !this.cruiseOff && !ph.manual.active && ph.up.y > 0.97 &&
        ph.speed < (this.cruising ? CRUISE : CRUISE_LOW);
      this.cruising = want;
      if (want) {
        push = true;
        // pushing against something: give up until the player steers or pushes
        this.stuckT = ph!.speed < 0.6 ? this.stuckT + dt : 0;
        if (this.stuckT > 2) { this.cruiseOff = true; this.stuckT = 0; }
      } else this.stuckT = 0;
    }

    inp.steer = Math.max(-1, Math.min(1, steer)); inp.push = push; inp.brake = brake; inp.lean = lean;
    inp.grind = grind; inp.grindPressed = grindPressed; inp.manual = manual;
    this.wasCrouch = crouch; this.touchOllieWas = t.ollieHeld;
    t.ollieReleased = t.grindPressed = t.trickPressed = false;
    this.pressedEdge.clear(); this.padDown.clear();
    this.scriptPrev = sc ? { ...sc } : {};
    this.userActive = active;
    return inp;
  }

  consumeEvents() {
    const e = { ...this.events };
    for (const k of Object.keys(this.events) as InputEvent[]) this.events[k] = false;
    return e;
  }
}
