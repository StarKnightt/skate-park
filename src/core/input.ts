import type { FlipDir, SkateInput, SkatePhysics } from '../player/physics';
import { emptyInput } from '../player/physics';

/** what the input layer may read from the physics (never write) */
export type SkateState = Pick<SkatePhysics, 'mode' | 'speed' | 'vel' | 'fwd' | 'up' | 'pos' | 'grind' | 'manual' | 'flip' | 'airTime'>;

/** an input producer that rides by itself (auto-ride autopilot) */
export interface AutoSource {
  /** called once per physics step instead of the player's input while auto-ride is engaged */
  sample(dt: number, airborne: boolean): SkateInput;
  /** forget plans (after a respawn, a takeover or re-engaging) */
  reset(): void;
}

/** Unified input: keyboard, gamepad, touch and scripted (test) sources. */
export class Input {
  keys = new Set<string>();
  private pressedEdge = new Set<string>();
  private releasedEdge = new Set<string>();
  camDX = 0; camDY = 0; camStick = { x: 0, y: 0 };
  private dragging = false;
  private lastX = 0; private lastY = 0;
  private padPrev: boolean[] = [];
  touch = {
    steer: 0, push: false, brake: false, ollieHeld: false, ollieReleased: false, flip: null as FlipDir | null, grind: false, grindPressed: false, manual: false,
    /** pass-4 touch buttons (edges, cleared by the input layer): TRICK (easy), AUTO toggle, pause */
    trickPressed: false, autoPressed: false, pausePressed: false,
  };
  events = { timeOfDay: false, respawn: false, recenter: false, help: false, pause: false, autoToggle: false };
  scripted: Partial<Record<string, boolean>> | null = null;
  usingTouch = false;
  usingPad = false;
  private wasCrouch = false;
  private airFlipLatch: FlipDir | null = null;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.pressedEdge.add(e.code);
      if (e.code === 'KeyT') this.events.timeOfDay = true;
      if (e.code === 'KeyR') this.events.respawn = true;
      if (e.code === 'KeyC') this.events.recenter = true;
      if (e.code === 'KeyH' || e.code === 'F1') { this.events.help = true; e.preventDefault(); }
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.releasedEdge.add(e.code); });
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return; // touch camera handled by the touch layer
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.camDX += e.clientX - this.lastX; this.camDY += e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    const up = () => { this.dragging = false; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  addCameraDrag(dx: number, dy: number) { this.camDX += dx; this.camDY += dy; }

  // ---------------------------------------------------------------- pass-4 contract (stubs; the input helper fills them)
  /** pointer lock is active on the canvas */
  locked = false;
  /** auto-ride source (the autopilot); when autoActive and the player gives no movement/trick input, sample() returns its input */
  auto: AutoSource | null = null;
  autoActive = false;
  /** true when the last sample() contained player movement/trick input (auto-ride takeover) */
  userActive = false;
  /** read-only physics state for mode logic (auto-push speed, grounded): set once by the game */
  ph: SkateState | null = null;
  attach(ph: SkateState) { this.ph = ph; }
  /** call once per displayed frame, even while paused: polls the gamepad and raises button edges/events */
  poll(_dt: number) { /* TODO pass 4 */ }
  /** camera look since the last call in radians, already scaled (sensitivity, invert-Y, curves, stick rate cap) */
  consumeLook(_dt: number): { yaw: number; pitch: number } {
    const d = this.consumeCamera();
    return { yaw: -d.dx * 0.006, pitch: d.dy * 0.006 };
  }
  requestLock() { /* TODO pass 4 */ }
  releaseLock() { /* TODO pass 4 */ }
  setAuto(on: boolean) { this.autoActive = on && !!this.auto; this.auto?.reset(); }

  private down(code: string) { return this.keys.has(code) || !!this.scripted?.[code]; }

  /** Build the per-frame skate input. Edge events are consumed. */
  sample(airborne: boolean): SkateInput {
    const inp = emptyInput();
    // ---- keyboard
    const kbSteer = (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0);
    inp.steer = kbSteer;
    inp.push = this.down('KeyW');
    inp.brake = this.down('KeyS');
    inp.lean = (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0);
    let crouch = this.down('Space');
    inp.grind = this.down('KeyE');
    inp.grindPressed = this.pressedEdge.has('KeyE') || (!!this.scripted?.['KeyE'] && !this.scriptPrevE);
    this.scriptPrevE = !!this.scripted?.['KeyE'];
    inp.manual = this.down('ShiftLeft') || this.down('ShiftRight');
    const arrow = (): FlipDir | null =>
      this.down('ArrowLeft') ? 'left' : this.down('ArrowRight') ? 'right' : this.down('ArrowDown') ? 'down' : this.down('ArrowUp') ? 'up' : null;
    let flip = arrow();
    let spacePressed = this.pressedEdge.has('Space') || (!!this.scripted?.['Space'] && !this.scriptPrevSpace);
    this.scriptPrevSpace = !!this.scripted?.['Space'];
    // arrow pressed while airborne + space held/pressed -> air flip
    for (const [code, dir] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowDown', 'down'], ['ArrowUp', 'up']] as [string, FlipDir][]) {
      if (this.pressedEdge.has(code) && airborne && this.down('Space')) this.airFlipLatch = dir;
    }

    // ---- gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const btn = (i: number) => !!gp.buttons[i]?.pressed;
      const edge = (i: number) => btn(i) && !this.padPrev[i];
      const lx = dz(gp.axes[0] ?? 0), ly = dz(gp.axes[1] ?? 0);
      if (lx || ly || gp.buttons.some((b) => b.pressed)) this.usingPad = true;
      if (Math.abs(lx) > Math.abs(inp.steer)) inp.steer = lx;
      if (ly < -0.35) { inp.push = true; }
      if (ly > 0.45) inp.brake = true;
      if (Math.abs(ly) > Math.abs(inp.lean)) inp.lean = -ly;
      this.camStick.x = dz(gp.axes[2] ?? 0); this.camStick.y = dz(gp.axes[3] ?? 0);
      if (btn(0)) crouch = true;
      if (edge(0)) spacePressed = true;
      if (btn(2)) inp.grind = true;
      if (edge(2)) inp.grindPressed = true;
      if (btn(1) || btn(5)) inp.manual = true;
      const pf: FlipDir | null = btn(14) ? 'left' : btn(15) ? 'right' : btn(13) ? 'down' : btn(12) ? 'up' : null;
      if (pf) flip = pf;
      for (const [i, dir] of [[14, 'left'], [15, 'right'], [13, 'down'], [12, 'up']] as [number, FlipDir][]) {
        if (edge(i) && airborne && btn(0)) this.airFlipLatch = dir;
      }
      if (edge(3)) this.events.timeOfDay = true;
      if (edge(9)) this.events.help = true;
      if (edge(8)) this.events.respawn = true;
      if (edge(10) || edge(11)) this.events.recenter = true;
      this.padPrev = gp.buttons.map((b) => b.pressed);
    } else this.camStick.x = this.camStick.y = 0;

    // ---- touch
    const t = this.touch;
    if (this.usingTouch) {
      if (Math.abs(t.steer) > Math.abs(inp.steer)) inp.steer = t.steer;
      inp.push ||= t.push; inp.brake ||= t.brake;
      if (t.push) inp.lean = 1; else if (t.brake) inp.lean = -1;
      if (t.ollieHeld) crouch = true;
      inp.grind ||= t.grind; inp.grindPressed ||= t.grindPressed; inp.manual ||= t.manual;
      if (t.ollieReleased && t.flip && airborne) this.airFlipLatch = t.flip;
    }

    // ---- ollie: release of the crouch button (ground); air flips via latch or tap
    inp.crouch = crouch;
    const released = this.wasCrouch && !crouch;
    if (!airborne) {
      if (released) { inp.ollie = true; inp.flip = flip ?? (this.usingTouch && t.ollieReleased ? t.flip : null); }
      if (this.usingTouch && t.ollieReleased && !this.wasCrouch) { inp.ollie = true; inp.flip = t.flip; }
    } else {
      if (spacePressed && flip) this.airFlipLatch = flip;
      if (this.usingTouch && t.ollieReleased && t.flip) this.airFlipLatch = t.flip;
      if (this.airFlipLatch) { inp.airTrick = this.airFlipLatch; this.airFlipLatch = null; }
    }
    this.wasCrouch = crouch;
    t.ollieReleased = false; t.grindPressed = false;
    this.pressedEdge.clear(); this.releasedEdge.clear();
    return inp;
  }
  private scriptPrevE = false;
  private scriptPrevSpace = false;

  consumeCamera() {
    const d = { dx: this.camDX, dy: this.camDY };
    this.camDX = 0; this.camDY = 0;
    return d;
  }
  consumeEvents() {
    const e = { ...this.events };
    this.events.timeOfDay = this.events.respawn = this.events.recenter = this.events.help = false;
    this.events.pause = this.events.autoToggle = false;
    return e;
  }
}
