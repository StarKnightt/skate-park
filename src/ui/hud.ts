import type { Input } from '../core/input';
import type { FlipDir } from '../player/physics';

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
const SOUND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const MUTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

/** Minimal HUD: trick name + combo pop, fading hint, time of day + sound + help buttons. */
export class Hud {
  root = document.createElement('div');
  private nameEl: HTMLDivElement;
  private comboEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private helpEl: HTMLDivElement;
  private todBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private toastEl: HTMLDivElement;
  private trickT = 0;
  private comboT = 0;
  private hintT = 0;
  onTimeOfDay: () => void = () => {};
  onSound: () => void = () => {};

  constructor(touch: boolean) {
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="trick"><div class="name"></div><div class="combo"></div></div>
      <div class="hint">${touch
        ? 'Stick: push / steer &nbsp;·&nbsp; <kbd>OLLIE</kbd> hold + release, swipe for flips<br><kbd>GRIND</kbd> near rails &nbsp;·&nbsp; <kbd>MANUAL</kbd> &nbsp;·&nbsp; drag to look'
        : '<kbd>W</kbd> push &nbsp;<kbd>A</kbd><kbd>D</kbd> steer &nbsp;<kbd>S</kbd> brake &nbsp;<kbd>Space</kbd> hold + release to ollie<br><kbd>←</kbd><kbd>→</kbd><kbd>↓</kbd><kbd>↑</kbd> + <kbd>Space</kbd> flips &nbsp;<kbd>E</kbd> grind &nbsp;<kbd>Shift</kbd> manual &nbsp;<kbd>H</kbd> help'}</div>
      <div class="topbar">
        <button class="pill tod" title="Time of day (T)">${SUN}<span>Golden hour</span></button>
        <button class="pill icon snd" title="Sound">${SOUND}</button>
        <button class="pill icon hlp" title="Help (H)">?</button>
      </div>
      <div class="help">
        <button class="pill close">Close</button>
        <h2>How to skate</h2>
        <h3>Keyboard + mouse</h3>
        <table>
          <tr><td>W</td><td>push (on flat) / pump transitions</td></tr>
          <tr><td>A / D</td><td>steer and carve, spin in the air</td></tr>
          <tr><td>S</td><td>foot brake</td></tr>
          <tr><td>Space</td><td>hold to crouch, release to ollie</td></tr>
          <tr><td>← → ↓ ↑ + Space</td><td>kickflip, heelflip, pop shove-it, tre flip (at the pop or in the air)</td></tr>
          <tr><td>E</td><td>grind / slide a rail, ledge or coping</td></tr>
          <tr><td>Shift</td><td>manual (W / S to balance)</td></tr>
          <tr><td>W at the lip</td><td>air out of a bowl onto the deck</td></tr>
          <tr><td>Mouse drag</td><td>orbit the camera, C recenters</td></tr>
          <tr><td>T</td><td>time of day &nbsp; · &nbsp; R respawn</td></tr>
        </table>
        <h3>Gamepad</h3>
        <table>
          <tr><td>Left stick</td><td>push / brake / steer</td></tr>
          <tr><td>A</td><td>hold + release to ollie; D-pad + A for flips</td></tr>
          <tr><td>X &nbsp; B / RB</td><td>grind &nbsp; manual</td></tr>
          <tr><td>Right stick &nbsp; Y</td><td>camera &nbsp; time of day</td></tr>
        </table>
        <h3>Touch</h3>
        <table>
          <tr><td>Left stick</td><td>push (up), brake (down), steer</td></tr>
          <tr><td>OLLIE</td><td>hold to crouch, release to pop. Swipe ← → ↓ ↑ while releasing for flips</td></tr>
          <tr><td>GRIND / MANUAL</td><td>near a rail or ledge / on flat ground</td></tr>
          <tr><td>Drag anywhere</td><td>look around</td></tr>
        </table>
      </div>
      <div class="toast hide"></div>`;
    document.body.appendChild(this.root);
    this.nameEl = this.root.querySelector('.name')!;
    this.comboEl = this.root.querySelector('.combo')!;
    this.hintEl = this.root.querySelector('.hint')!;
    this.helpEl = this.root.querySelector('.help')!;
    this.todBtn = this.root.querySelector('.tod')!;
    this.soundBtn = this.root.querySelector('.snd')!;
    this.toastEl = this.root.querySelector('.toast')!;
    this.todBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onTimeOfDay(); });
    this.soundBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onSound(); });
    this.root.querySelector('.hlp')!.addEventListener('click', (e) => { e.stopPropagation(); this.toggleHelp(); });
    this.root.querySelector('.close')!.addEventListener('click', (e) => { e.stopPropagation(); this.toggleHelp(false); });
    for (const b of this.root.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  toggleHelp(v?: boolean) { this.helpEl.classList.toggle('show', v); }
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
  toast(msg: string, t = 3) { this.toastEl.textContent = msg; this.toastEl.classList.remove('hide'); this.toastT = t; }
  private toastT = 0;

  update(dt: number) {
    this.hintT += dt;
    if (this.hintT > 9) this.hintEl.classList.add('hide');
    if (this.trickT > 0) { this.trickT -= dt; if (this.trickT <= 0) this.nameEl.classList.remove('show'); }
    if (this.comboT > 0 && this.comboT < 90) { this.comboT -= dt; if (this.comboT <= 0) this.comboEl.classList.remove('show'); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.add('hide'); }
  }
  showHint() { this.hintT = 0; this.hintEl.classList.remove('hide'); }
}

/** On-screen touch controls: left stick, OLLIE (hold / swipe release for flips), GRIND, MANUAL, drag to orbit. */
export class TouchControls {
  root = document.createElement('div');
  constructor(private input: Input, private canvas: HTMLElement) {
    this.root.className = 'touch';
    this.root.innerHTML = `<div class="stick"><div class="knob"></div></div>
      <div class="tbtn ollie">OLLIE</div><div class="tbtn grind">GRIND</div><div class="tbtn manual">MANUAL</div>
      <div class="swipehint">swipe OLLIE ← → ↓ ↑ for flips</div>`;
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
    // drag on empty space orbits the camera
    const drags = new Map<number, { x: number; y: number }>();
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    canvas.addEventListener('pointermove', (e) => {
      const d = drags.get(e.pointerId); if (!d) return;
      input.addCameraDrag((e.clientX - d.x) * 1.2, (e.clientY - d.y) * 1.2); d.x = e.clientX; d.y = e.clientY;
    });
    const dend = (e: PointerEvent) => drags.delete(e.pointerId);
    canvas.addEventListener('pointerup', dend); canvas.addEventListener('pointercancel', dend);
  }
  show(on: boolean) { this.root.classList.toggle('on', on); this.input.usingTouch = on; }
}
