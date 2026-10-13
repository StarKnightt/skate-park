import type { Game } from '../game';
import { settings, setSetting, onSettings, type ControlMode, type QualitySetting } from '../core/settings';
import { PRESETS } from '../render/timeOfDay';
import { TEST } from '../core/util';
import { controlsTable, MODE_DESC, MODE_NAMES, type Device } from './hud';

const MODES: ControlMode[] = ['easy', 'auto', 'pro'];
const QUALITY: [QualitySetting, string][] = [['auto', 'Auto'], [0, 'Low'], [1, 'Medium'], [2, 'High']];
const DEVICES: [Device, string][] = [['kb', 'Keyboard'], ['pad', 'Gamepad'], ['touch', 'Touch']];
const TOD_DOT = ['#ffb46a', '#ff8b6a', '#7c79cf', '#8fd3ea'];

const seg = (key: string, opts: [string, string][]) =>
  `<div class="seg" role="radiogroup" data-key="${key}">${opts.map(([v, l]) => `<button type="button" role="radio" data-v="${v}">${l}</button>`).join('')}</div>`;
const slider = (key: string, min: number, max: number, step: number) =>
  `<div class="sl"><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}"><span class="val"></span></div>`;
const toggle = (key: string) => `<button type="button" class="sw" role="switch" data-key="${key}" aria-checked="false"><i></i></button>`;
const row = (label: string, ctl: string, cls = '') => `<div class="row${cls}" data-nav><span class="lab">${label}</span>${ctl}</div>`;

/**
 * Pause menu. game.ts calls installPauseMenu(this) once at the end of start(); the game opens and closes it through
 * game.onPause (togglePause on Esc, the lock-release Esc, gamepad Start, the touch pause button). Gamepad navigation
 * (D-pad / stick, A, B) is polled here while the menu is open.
 */
export function installPauseMenu(g: Game) {
  const el = document.createElement('div');
  el.className = 'pause';
  el.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="Pause menu">
    <div class="pg main on">
      <div class="phead"><h2>Paused</h2><span class="chip"></span></div>
      <div class="row acts" data-nav>
        <button type="button" class="btn primary" data-act="resume">Resume</button>
        <button type="button" class="btn" data-act="respawn">Respawn</button>
        <button type="button" class="btn" data-act="controls">Controls</button>
      </div>
      <div class="sets">
        ${row('Control mode', seg('controlMode', MODES.map((m) => [m, MODE_NAMES[m]])), ' wide')}
        <p class="desc"></p>
        ${row('Time of day', seg('tod', PRESETS.map((p, i) => {
          const [w0, ...rest] = p.name.replace(/^Bright n/, 'N').split(' ');
          return [String(i), `<i style="background:${TOD_DOT[i] ?? '#fff'}"></i>${w0}${rest.length ? `<span class="lw"> ${rest.join(' ')}</span>` : ''}`];
        })), ' wide')}
        ${row('Music', slider('musicVol', 0, 100, 5))}
        ${row('Sound', slider('sfxVol', 0, 100, 5))}
        ${row('Mouse sensitivity', slider('mouseSens', 20, 300, 5), ' mouse')}
        ${row('Invert Y', toggle('invertY'))}
        ${row('Graphics', seg('quality', QUALITY.map(([v, l]) => [String(v), l])))}
        ${row('Fullscreen', toggle('fullscreen'), ' fs')}
      </div>
      <div class="foot"></div>
    </div>
    <div class="pg ctl">
      <div class="phead"><button type="button" class="btn back" data-act="back" data-nav>‹ Back</button><h2>Controls</h2></div>
      ${row('Device', seg('device', DEVICES))}
      ${row('Mode', seg('cmode', MODES.map((m) => [m, MODE_NAMES[m]])))}
      <div class="ctab"></div>
      <div class="foot"></div>
    </div>
  </div>`;
  document.body.appendChild(el);
  document.body.classList.add('pm');
  const panel = el.querySelector('.panel') as HTMLDivElement;
  const descEl = el.querySelector('.desc') as HTMLParagraphElement;
  const chipEl = el.querySelector('.chip') as HTMLSpanElement;
  const ctab = el.querySelector('.ctab') as HTMLDivElement;
  if (!document.fullscreenEnabled) el.querySelector('.row.fs')?.remove();

  let open = false, page: 'main' | 'ctl' = 'main';
  let relock = false, relocking = false, lastUnlock = -1e9, viaPad = false, lastPointer = false;
  let ctlDevice: Device = 'kb', ctlMode: ControlMode = settings.controlMode;

  // ---------------------------------------------------------------- pause plumbing
  /** force: the test API opens it under the manual clock too (the game refuses to pause frame-stepped captures) */
  function setPaused(on: boolean, force = false) {
    g.setPaused(on, force);
    if (!on) hide(); else if (g.paused) show();
  }
  g.onPause = (p) => (p ? show() : hide());
  g.hud.onMenu = () => setPaused(true);
  g.hud.autoState = () => g.input.autoActive;

  function show() {
    if (open) return;
    open = true;
    // one Esc both unlocks the mouse and pauses: the unlock lands just before the pause
    relock = !!document.pointerLockElement || performance.now() - lastUnlock < 800;
    relocking = false;
    if (document.pointerLockElement) g.input.releaseLock();
    g.hud.hideHelp();
    ctlDevice = g.input.usingTouch ? 'touch' : g.input.usingPad ? 'pad' : 'kb';
    ctlMode = settings.controlMode;
    el.classList.toggle('touchui', g.input.usingTouch);
    el.classList.toggle('kb', !lastPointer);
    showPage('main', false);
    el.classList.add('show');
    document.body.classList.add('paused');
    focusRow(rows()[0]);
    startPad();
  }
  function hide() {
    if (!open) return;
    open = false;
    el.classList.remove('show');
    document.body.classList.remove('paused');
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (!relocking && !document.pointerLockElement) g.hud.lockHint();
  }
  /** a click / Enter is a user gesture: the mouse can be locked again if it was locked when the menu opened */
  function resume(gesture: boolean) {
    if (gesture && relock && !g.input.usingTouch) { relocking = true; g.input.requestLock(); }
    setPaused(false);
  }

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) relocking = false; else lastUnlock = performance.now();
  });
  // Chrome refuses a re-lock within ~1 s of the user's Esc: fall back to the "click to look" hint
  document.addEventListener('pointerlockerror', () => { if (relocking) { relocking = false; g.hud.lockHint(); } });
  addEventListener('pointerdown', () => { lastPointer = true; if (open) el.classList.remove('kb'); }, true);
  document.addEventListener('fullscreenchange', () => { if (open) sync(); });
  onSettings(() => { if (open) sync(); });

  // ---------------------------------------------------------------- state ↔ widgets
  function setSeg(key: string, v: string) {
    el.querySelectorAll<HTMLButtonElement>(`.seg[data-key="${key}"] button`).forEach((b) => {
      const on = b.dataset.v === v;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    });
  }
  function setRange(key: string, v: number, label: string) {
    const inp = el.querySelector<HTMLInputElement>(`input[data-key="${key}"]`); if (!inp) return;
    if (inp.value !== String(v)) inp.value = String(v);
    inp.style.setProperty('--p', `${((v - Number(inp.min)) / (Number(inp.max) - Number(inp.min))) * 100}%`);
    (inp.nextElementSibling as HTMLElement).textContent = label;
  }
  function setToggle(key: string, on: boolean) { el.querySelector(`.sw[data-key="${key}"]`)?.setAttribute('aria-checked', String(on)); }
  function sync() {
    setSeg('controlMode', settings.controlMode);
    setSeg('tod', String(g.tod.index));
    setSeg('quality', String(settings.quality));
    setSeg('device', ctlDevice);
    setSeg('cmode', ctlMode);
    setRange('musicVol', Math.round(settings.musicVol * 100), `${Math.round(settings.musicVol * 100)}%`);
    setRange('sfxVol', Math.round(settings.sfxVol * 100), `${Math.round(settings.sfxVol * 100)}%`);
    setRange('mouseSens', Math.round(settings.mouseSens * 100), `${settings.mouseSens.toFixed(2)}×`);
    setToggle('invertY', settings.invertY);
    setToggle('fullscreen', !!document.fullscreenElement);
    descEl.textContent = MODE_DESC[settings.controlMode];
    chipEl.textContent = `${MODE_NAMES[settings.controlMode]} mode`;
    ctab.innerHTML = controlsTable(ctlDevice, ctlMode);
    const foot = g.input.usingTouch ? ''
      : g.input.usingPad ? 'D-pad move · A select · B back / resume · Start resume'
      : '<kbd>W</kbd><kbd>S</kbd> move · <kbd>A</kbd><kbd>D</kbd> change · <kbd>Enter</kbd> select · <kbd>Esc</kbd> resume';
    el.querySelectorAll('.foot').forEach((f) => { f.innerHTML = foot; });
  }

  function choose(key: string, v: string) {
    if (key === 'controlMode') { const m = v as ControlMode; setSetting('controlMode', m); g.input.setAuto(m === 'auto'); ctlMode = m; }
    else if (key === 'tod') g.setTime(Number(v), true);
    else if (key === 'quality') { const q: QualitySetting = v === 'auto' ? 'auto' : (Number(v) as 0 | 1 | 2); setSetting('quality', q); g.setQuality(q); }
    else if (key === 'device') ctlDevice = v as Device;
    else if (key === 'cmode') ctlMode = v as ControlMode;
    sync();
  }
  function flip(key: string) {
    if (key === 'invertY') setSetting('invertY', !settings.invertY);
    else if (key === 'fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    }
    sync();
  }

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !el.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'resume') resume(!viaPad);
    else if (act === 'respawn') { g.respawn(); resume(!viaPad); }
    else if (act === 'controls') showPage('ctl');
    else if (act === 'back') showPage('main');
    else if (b.closest('.seg')) choose((b.closest('.seg') as HTMLElement).dataset.key!, b.dataset.v!);
    else if (b.classList.contains('sw')) flip(b.dataset.key!);
  });
  el.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.type !== 'range') return;
    const key = inp.dataset.key, v = Number(inp.value) / 100;
    if (key === 'musicVol' || key === 'sfxVol') { setSetting(key, v); g.audio.setVolumes(settings.musicVol, settings.sfxVol); }
    else if (key === 'mouseSens') setSetting('mouseSens', v);
    sync();
  });

  // ---------------------------------------------------------------- keyboard / gamepad navigation
  function showPage(p: 'main' | 'ctl', focus = true) {
    const from = page;
    page = p;
    el.querySelector('.pg.main')!.classList.toggle('on', p === 'main');
    el.querySelector('.pg.ctl')!.classList.toggle('on', p === 'ctl');
    panel.scrollTop = 0;
    sync();
    if (!focus) return;
    if (p === 'main' && from === 'ctl') el.querySelector<HTMLElement>('[data-act="controls"]')!.focus({ preventScroll: true });
    else focusRow(rows()[0]);
  }
  const rows = () => [...el.querySelectorAll<HTMLElement>('.pg.on [data-nav]')].filter((r) => r.offsetParent !== null);
  const curRow = () => {
    const a = document.activeElement as HTMLElement | null;
    return a && el.contains(a) ? a.closest<HTMLElement>('[data-nav]') : null;
  };
  function focusRow(r?: HTMLElement) {
    if (!r) return;
    const t = r.matches('button') ? r
      : r.querySelector<HTMLElement>('.seg button.on') ?? r.querySelector<HTMLElement>('input, button');
    t?.focus({ preventScroll: true });
    r.scrollIntoView({ block: 'nearest' });
  }
  function move(d: number) {
    const rs = rows(); if (!rs.length) return;
    const i = rs.indexOf(curRow()!);
    focusRow(rs[i < 0 ? (d > 0 ? 0 : rs.length - 1) : (i + d + rs.length) % rs.length]);
  }
  function adjust(d: number) {
    const r = curRow(); if (!r) return;
    const s = r.querySelector('.seg');
    if (s) {
      const bs = [...s.querySelectorAll<HTMLButtonElement>('button')];
      const i = bs.findIndex((b) => b.classList.contains('on'));
      const n = Math.min(bs.length - 1, Math.max(0, i + d));
      if (n !== i) { bs[n].click(); bs[n].focus({ preventScroll: true }); }
      return;
    }
    const inp = r.querySelector<HTMLInputElement>('input[type=range]');
    if (inp) { if (d > 0) inp.stepUp(); else inp.stepDown(); inp.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (r.classList.contains('acts')) {
      const bs = [...r.querySelectorAll<HTMLButtonElement>('button')];
      bs[Math.min(bs.length - 1, Math.max(0, bs.indexOf(document.activeElement as HTMLButtonElement) + d))].focus();
      return;
    }
    const sw = r.querySelector<HTMLButtonElement>('.sw');
    if (sw && (sw.getAttribute('aria-checked') === 'true') !== d > 0) sw.click();
  }
  function activate(pad = false) {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !el.contains(a) || a.tagName !== 'BUTTON') return;
    viaPad = pad; a.click(); viaPad = false;
  }
  addEventListener('keydown', (e) => {
    lastPointer = false;
    // Esc stays the game's: the input layer raises the pause event, the game toggles the pause
    if (!open || e.code === 'Escape') return;
    // menu keys never reach the game (no ollie / flip edges waiting on resume); key-ups still do, so nothing sticks
    e.stopImmediatePropagation();
    if (g.audio.ctx?.state === 'suspended') g.audio.ctx.resume();
    const c = e.code;
    const dir = c === 'KeyW' ? -2 : c === 'KeyS' ? 2 : c === 'KeyA' ? -1 : c === 'KeyD' ? 1 : 0;
    const act = c === 'Space' || c === 'Enter' || c === 'NumpadEnter';
    if (!dir && !act) return;
    e.preventDefault();
    el.classList.add('kb');
    if (dir) { if (Math.abs(dir) === 2) move(Math.sign(dir)); else adjust(dir); }
    else if (!e.repeat) activate();
  }, true);

  let padRaf = 0, padPrev: boolean[] = [], dirHeld = 0, dirT = 0, padFirst = true;
  const padArmed = new Set<number>();
  function getPad() {
    for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) return p;
    return null;
  }
  function startPad() {
    padFirst = true; padArmed.clear();
    if (!padRaf) padRaf = requestAnimationFrame(padTick);
  }
  function padTick(now: number) {
    padRaf = open ? requestAnimationFrame(padTick) : 0;
    const gp = getPad();
    if (!gp || !open) return;
    const btn = (i: number) => !!gp.buttons[i]?.pressed;
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    const v = btn(12) || ay < -0.6 ? -1 : btn(13) || ay > 0.6 ? 1 : 0;
    const h = btn(14) || ax < -0.6 ? -1 : btn(15) || ax > 0.6 ? 1 : 0;
    const dir = v ? v * 2 : h;
    const pressed = gp.buttons.map((b) => b.pressed);
    if (padFirst) { padFirst = false; dirHeld = dir; dirT = now + 380; padPrev = pressed; return; }
    const nav = (d: number) => { el.classList.add('kb'); if (Math.abs(d) === 2) move(Math.sign(d)); else adjust(d); };
    if (dir !== dirHeld) { dirHeld = dir; dirT = now + 380; if (dir) nav(dir); }
    else if (dir && now >= dirT) { dirT = now + 120; nav(dir); }
    for (let i = 0; i < pressed.length; i++) if (pressed[i] && !padPrev[i]) padArmed.add(i);
    // A and B act on release, so the game never wakes up with them held (A held + release = ollie)
    const released = (i: number) => padPrev[i] && !pressed[i] && padArmed.delete(i);
    if (released(0)) activate(true);
    if (released(1)) { if (page === 'ctl') showPage('main'); else resume(false); }
    padPrev = pressed;
  }

  if (TEST) {
    (window as any).__pauseMenu = {
      el,
      open: () => setPaused(true, true),
      close: () => setPaused(false),
      get isOpen() { return open; },
      page: (p: 'main' | 'ctl') => showPage(p),
      controls: (d: Device, m: ControlMode) => { ctlDevice = d; ctlMode = m; showPage('ctl'); },
    };
  }
}
