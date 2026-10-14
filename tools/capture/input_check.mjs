// Pass-4 input checks with real Playwright keyboard / mouse events (real-time loop, no fps cap):
// pointer lock + mouse look + Esc pause, Pro F flips, no arrow keys, gamepad (mocked navigator.getGamepads),
// Easy cruise / S stop / tap ollie / cycled flips, auto-ride takeover and resume with a dummy AutoSource.
//   bash tools/heavy.sh B node tools/capture/run.mjs tools/capture/input_check.mjs --nohmr --out E:/shots/skate-park/pass-04/input --url http://127.0.0.1:5188/ --q "test&mute"
import fs from 'node:fs';
import path from 'node:path';

export default async function (ctx) {
  const { page, api, wait, shot, out } = ctx;
  const R = {};
  const G = (fn, a) => page.evaluate(fn, a);
  const ev = () => api('events');
  const st = () => api('state');
  const flips = (e) => e.filter((x) => x.type === 'flip').map((x) => `${x.kind}${x.delay === 0 ? '(air)' : ''}`);
  const pops = (e) => e.filter((x) => x.type === 'pop').map((x) => +(+x.charge).toFixed(2));
  const log = (k, v) => { R[k] = v; console.log(k, JSON.stringify(v)); };
  const unpause = () => G(() => { const g = window.__skate.game; if (g.paused) g.setPaused(false, true); });
  const roll = async (x, y, z, h, s) => { await unpause(); await api('teleport', x, y, z, h, s); await wait(250); await ev(); };
  const hookLook = () => G(() => {
    const i = window.__skate.game.input; window.__look = [];
    if (!i.__hooked) { const o = i.consumeLook.bind(i); i.consumeLook = (dt) => { const r = o(dt); if (r.yaw || r.pitch) window.__look.push([r.yaw, r.pitch]); return r; }; i.__hooked = true; }
  });
  const lookSum = () => G(() => { const a = window.__look.splice(0); return { n: a.length, yaw: +a.reduce((s, v) => s + v[0], 0).toFixed(4), pitch: +a.reduce((s, v) => s + v[1], 0).toFixed(4) }; });

  // ------------------------------------------------------------ 1. pointer lock, mouse look, Esc
  // (no bringToFront: test windows must never take focus from the user)
  await hookLook();
  const box = await page.locator('canvas').first().boundingBox();
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  log('wiring', await G(([x, y]) => { const g = window.__skate.game, i = g.input; return { atCenter: document.elementFromPoint(x, y)?.tagName, poll: typeof i.poll, look: typeof g.rig.look, setPaused: typeof g.setPaused, frameInput: typeof g.frameInput }; }, [cx, cy]));
  await roll(9, 0, 3, 180, 0);
  // drag (> 4 px) orbits without locking
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(cx + i * 12, cy); await wait(12); }
  await page.mouse.up(); await wait(150);
  log('drag', { look: await lookSum(), locked: await G(() => !!document.pointerLockElement) });
  await page.mouse.move(cx, cy);
  // click locks
  await page.mouse.down(); await page.mouse.up(); await wait(500);
  const lockState = () => G(() => { const g = window.__skate.game; return { pointerLockElementIsCanvas: document.pointerLockElement === g.renderer.domElement, locked: g.input.locked, paused: g.paused, userYaw: +g.rig.userYaw.toFixed(4), userPitch: +g.rig.userPitch.toFixed(4) }; });
  log('click_lock', await lockState());
  await lookSum();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(cx + i * 10, cy); await wait(16); }
  await wait(120);
  const right = await lookSum();
  for (let i = 1; i <= 5; i++) { await page.mouse.move(cx + 100, cy + i * 10); await wait(16); }
  await wait(120);
  const down = await lookSum();
  let synthetic = null;
  if (!right.n) {
    // CDP mouse moves may carry no movementX under pointer lock: drive the same handler with movement events
    await G(() => { for (let i = 0; i < 10; i++) document.dispatchEvent(new MouseEvent('mousemove', { movementX: 10, movementY: 0 })); });
    await wait(80);
    synthetic = await lookSum();
  }
  log('mouse_look_locked', { right100: right, down50: down, syntheticRight100: synthetic, expectYaw: -100 * 0.0022, expectPitch: 50 * 0.0022 * 0.8, state: await lockState() });
  await shot('01_locked_after_look.jpg');
  await page.keyboard.press('Escape'); await wait(500);
  let esc = await lockState();
  let escVia = 'keyboard Escape';
  if (esc.pointerLockElementIsCanvas) {
    // the synthetic Escape did not reach the browser's lock handling: user-style release without releaseLock()
    await G(() => document.exitPointerLock()); await wait(400);
    esc = await lockState(); escVia = 'document.exitPointerLock() (synthetic Esc did not unlock)';
  }
  log('esc_unlock_pause', { via: escVia, ...esc });
  await page.keyboard.press('Escape'); await wait(300);
  log('esc_again_resumes', await lockState());
  // releaseLock() (menu-driven) must not raise a pause
  await page.mouse.down(); await page.mouse.up(); await wait(500);
  const relock = await lockState();
  await G(() => window.__skate.game.input.releaseLock()); await wait(60);
  const rel60 = { ...(await lockState()), unlockByUser: await G(() => window.__skate.game.input.unlockByUser) };
  await wait(400);
  log('releaseLock_no_pause', { relocked: relock.pointerLockElementIsCanvas, after60ms: rel60, after460ms_withMenuFallback: await lockState() });
  await G(() => window.__skate.game.setPaused(true, true)); await wait(300);
  await page.mouse.down(); await page.mouse.up(); await wait(400);
  const pausedClick = await lockState();
  await unpause(); await api('touch', true); await wait(100);
  await page.mouse.down(); await page.mouse.up(); await wait(400);
  const touchClick = await lockState();
  await api('touch', false);
  if (touchClick.pointerLockElementIsCanvas || pausedClick.pointerLockElementIsCanvas) await G(() => window.__skate.game.input.releaseLock());
  log('click_does_not_lock_when', { paused: !pausedClick.pointerLockElementIsCanvas, touchMode: !touchClick.pointerLockElementIsCanvas });
  await unpause();

  // ------------------------------------------------------------ 2. Pro F flips (?test defaults to pro)
  const LANE = [9, 0, 3, 180, 5];
  await roll(...LANE); await page.keyboard.press('KeyF'); await wait(1300);
  let e = await ev(); log('pro_F_rolling', { flips: flips(e), pops: pops(e), want: 'kickflip, charge 0.35' });
  const dirs = [];
  for (const [k, want] of [['KeyD', 'heelflip'], ['KeyW', 'treflip'], ['KeyS', 'shuvit'], ['KeyA', 'kickflip']]) {
    await roll(...LANE); await page.keyboard.down(k); await wait(60); await page.keyboard.press('KeyF'); await wait(60); await page.keyboard.up(k); await wait(1250);
    e = await ev(); dirs.push({ key: k, want, flips: flips(e), pops: pops(e) });
  }
  log('pro_F_wasd', dirs);
  await roll(...LANE); await page.keyboard.down('Space'); await wait(250); await page.keyboard.press('KeyF'); await wait(950); await page.keyboard.up('Space'); await wait(700);
  e = await ev(); log('pro_crouch_F', { flips: flips(e), pops: pops(e), lands: e.filter((x) => x.type === 'land').map((x) => x.quality), want: 'one pop (charge ~0.8) + kickflip, no second pop on the late Space release' });
  await roll(...LANE); await page.keyboard.down('Space'); await wait(300); await page.keyboard.up('Space'); await wait(130); await page.keyboard.press('KeyF'); await wait(1200);
  e = await ev(); log('pro_air_F', { flips: flips(e), pops: pops(e), lands: e.filter((x) => x.type === 'land').map((x) => x.quality), want: 'ollie then kickflip(air)' });
  await roll(...LANE); await page.keyboard.down('Space'); await wait(250); await page.keyboard.down('ArrowLeft'); await wait(60); await page.keyboard.up('Space'); await wait(150); await page.keyboard.press('ArrowRight'); await wait(60); await page.keyboard.up('ArrowLeft'); await wait(1000);
  e = await ev(); log('arrow_keys_inert', { flips: flips(e), pops: pops(e), want: 'plain ollie, no flips' });
  await roll(9, 0, 3, 180, 0); await page.keyboard.down('ArrowUp'); await wait(800); await page.keyboard.up('ArrowUp');
  log('arrow_up_no_push', { speed: (await st()).speed });
  // ledge (route_batch 'ledgeslide'): ollie, hold E to catch the grind, F pops off with a flip
  await unpause(); await api('teleport', 3.2, 0, -12.95, -90, 5.5); await ev();
  await page.keyboard.down('Space'); await wait(250); await page.keyboard.up('Space'); await page.keyboard.down('KeyE');
  let gm = null; const tg = Date.now();
  while (Date.now() - tg < 1500) { const s = await st(); if (s.mode === 'grind') { gm = s.grind; break; } await wait(25); }
  await wait(120); await page.keyboard.press('KeyF'); await page.keyboard.up('KeyE'); await wait(1200);
  e = await ev();
  log('pro_grind_F', { grind: gm, ends: e.filter((x) => x.type === 'grindEnd').map((x) => x.name), pops: e.filter((x) => x.type === 'pop').map((x) => ({ charge: x.charge, fromGrind: !!x.fromGrind, flip: x.flip ?? null })), flips: flips(e) });

  // ------------------------------------------------------------ 3. gamepad (mocked standard pad)
  await G(() => {
    window.__pad = { id: 'mock pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  });
  const pad = (o) => G((o) => {
    const p = window.__pad;
    if (o.axes) p.axes = o.axes;
    for (const [i, v] of Object.entries(o.btn || {})) p.buttons[i] = { pressed: v >= 0.5, touched: v > 0, value: v };
  }, o);
  await roll(9, 0, 3, 180, 0); await lookSum();
  await pad({ axes: [0, 0, 1, 0] }); await wait(150);
  const ramp = await lookSum();
  await wait(1000);
  const full = await lookSum();
  await pad({ axes: [0, 0, 0, 0] }); await wait(200);
  const stop = await lookSum();
  await pad({ axes: [0, 0, 0, 1] }); await wait(1000);
  const pitch = await lookSum();
  await pad({ axes: [0, 0, 0.08, 0.08] }); await wait(300);
  const dz = await lookSum();
  await pad({ axes: [0, 0, 0, 0] }); await wait(150); await lookSum();
  log('pad_right_stick', { first150ms: ramp, next1000ms: full, yawRate: +(full.yaw / 1.0).toFixed(3), expect: -Math.PI, after_release200ms: stop, pitch1000ms: pitch, insideDeadzone: dz });
  const li = () => G(() => { const l = window.__skate.game.lastInput; return { steer: +l.steer.toFixed(3), push: l.push, brake: l.brake, lean: +l.lean.toFixed(2) }; });
  const hy = {};
  for (const [name, ly] of [['raw-0.50', -0.5], ['raw-0.38', -0.38], ['raw-0.30', -0.3], ['raw-0.38b', -0.38], ['raw+0.60', 0.6], ['raw+0.47', 0.47], ['raw+0.40', 0.4]]) {
    await pad({ axes: [0, ly, 0, 0] }); await wait(60); hy[name] = await li();
  }
  await pad({ axes: [0.5, 0, 0, 0] }); await wait(60); hy.steer_raw050 = await li();
  await pad({ axes: [0.1, 0, 0, 0] }); await wait(60); hy.steer_raw010 = await li();
  await pad({ axes: [0, 0, 0, 0] });
  log('pad_left_stick', hy);
  await roll(...LANE); await pad({ axes: [0.9, 0, 0, 0] }); await wait(40); await pad({ btn: { 2: 1 } }); await wait(50); await pad({ btn: { 2: 0 }, axes: [0, 0, 0, 0] }); await wait(1250);
  e = await ev(); const xRight = { flips: flips(e), pops: pops(e) };
  await roll(...LANE); await pad({ axes: [0, -0.9, 0, 0] }); await wait(40); await pad({ btn: { 2: 1 } }); await wait(50); await pad({ btn: { 2: 0 }, axes: [0, 0, 0, 0] }); await wait(1250);
  e = await ev(); const xUp = { flips: flips(e), pops: pops(e) };
  await roll(...LANE); await pad({ btn: { 0: 1 } }); await wait(250); await pad({ btn: { 0: 0 } }); await wait(1100);
  e = await ev(); const aOllie = { flips: flips(e), pops: pops(e) };
  await roll(...LANE); await pad({ btn: { 0: 1 } }); await wait(220); await pad({ btn: { 13: 1 } }); await wait(60); await pad({ btn: { 0: 0 } }); await wait(60); await pad({ btn: { 13: 0 } }); await wait(1100);
  e = await ev(); const dpadAlt = { flips: flips(e), pops: pops(e) };
  log('pad_buttons', { X_stickRight: xRight, X_stickUp: xUp, A_hold_release: aOllie, A_release_with_dpad_down: dpadAlt });
  const t0 = (await st()).time;
  await pad({ btn: { 6: 1 } }); await wait(80); await pad({ btn: { 6: 0 } }); await wait(80);
  const t1 = (await st()).time;
  await pad({ btn: { 9: 1 } }); await wait(80); await pad({ btn: { 9: 0 } }); await wait(80);
  const pausedByStart = await G(() => window.__skate.game.paused);
  await pad({ btn: { 9: 1 } }); await wait(80); await pad({ btn: { 9: 0 } }); await wait(80);
  const resumedByStart = !(await G(() => window.__skate.game.paused));
  const a0 = await G(() => window.__skate.game.input.autoActive);
  await pad({ btn: { 3: 1 } }); await wait(80); await pad({ btn: { 3: 0 } }); await wait(80);
  const a1 = await G(() => window.__skate.game.input.autoActive);
  if (a1 !== a0) { await pad({ btn: { 3: 1 } }); await wait(80); await pad({ btn: { 3: 0 } }); await wait(80); }
  log('pad_events', { LT_timeOfDay: [t0, t1], start_pauses: pausedByStart, start_resumes: resumedByStart, Y_toggles_auto: [a0, a1], back_to: await G(() => window.__skate.game.input.autoActive) });
  await G(() => { delete navigator.getGamepads; });
  await unpause();

  // ------------------------------------------------------------ 4. Easy mode (&mode=easy)
  const base = page.url().split('?')[0];
  await page.goto(base + '?test&mute&mode=easy', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__skate && window.__skate.ready, null, { timeout: 120000 });
  await wait(600);
  const EZ = [-20, 0, 10.5, 90];
  await roll(...EZ, 0); await wait(1500);
  log('easy_idle_at_rest', { speed: (await st()).speed, want: '~0 (cruise waits for the first W / A / D)' });
  await page.keyboard.down('KeyD'); await wait(40); await page.keyboard.up('KeyD');
  const sp = [];
  // 25 m of clear lane along +x (an obstacle sits near x = 5)
  for (let i = 0; i < 32; i++) { await wait(250); const s = await st(); sp.push([+s.t.toFixed(2), +s.speed.toFixed(2), s.pos[0], s.pos[2], s.up[1], s.mode]); if (s.pos[0] > 2.5) break; }
  e = await ev();
  const tail = sp.slice(10).map((v) => v[1]);
  log('easy_cruise', { pushes: e.filter((x) => x.type === 'push').length, tailMin: Math.min(...tail), tailMax: Math.max(...tail), tailMean: +(tail.reduce((a, b) => a + b, 0) / tail.length).toFixed(2), samples: sp });
  await shot('02_easy_cruise.jpg');
  await roll(...EZ, 4.3);
  await page.keyboard.down('KeyS');
  let s = await st(); const tS = Date.now();
  while (s.speed > 0.3 && Date.now() - tS < 4000) { await wait(100); s = await st(); }
  await page.keyboard.up('KeyS');
  const stopT = Date.now() - tS;
  await wait(2500);
  const stillStopped = (await st()).speed;
  await page.keyboard.down('KeyW'); await wait(60); await page.keyboard.up('KeyW'); await wait(2500);
  const resumed = await st();
  log('easy_S_stop', { msToStop: stopT, speed2_5sAfterRelease: stillStopped, speed2_5sAfterTapW: resumed.speed, pos: resumed.pos, pushes: (await ev()).filter((x) => x.type === 'push').length });
  await roll(...EZ, 4.5); await page.keyboard.down('Space'); await wait(30); await page.keyboard.up('Space'); await wait(1100);
  e = await ev(); log('easy_tap_ollie', { pops: pops(e), flips: flips(e), lands: e.filter((x) => x.type === 'land').map((x) => x.quality), want: 'one pop, charge 0.7' });
  await roll(...EZ, 4.5); await page.keyboard.down('Space'); await wait(400); await page.keyboard.up('Space'); await wait(1100);
  e = await ev(); log('easy_hold_ollie', { pops: pops(e), want: 'charge 1.0 (held 0.4 s)' });
  const cyc = [];
  await roll(...EZ, 4.5);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('KeyF'); await wait(1300); e = await ev(); cyc.push({ flips: flips(e), pops: pops(e), lands: e.filter((x) => x.type === 'land').map((x) => x.quality) }); }
  log('easy_F_cycle', { got: cyc, want: 'kickflip, heelflip, shuvit, treflip (charge 0.5)' });
  await roll(...EZ, 4.5); await page.keyboard.down('Space'); await wait(30); await page.keyboard.up('Space'); await wait(260);
  await page.keyboard.down('Space'); await wait(30); await page.keyboard.up('Space'); await wait(1300);
  e = await ev(); log('easy_space_in_air', { pops: pops(e), flips: flips(e), want: 'one pop, kickflip(air), no pop after landing' });
  await roll(...EZ, 3); await page.keyboard.down('KeyD'); await wait(100);
  log('easy_keyboard_steer', { steer: await G(() => window.__skate.game.lastInput.steer), want: 0.8 });
  await page.keyboard.up('KeyD');
  // touch flags as the HUD sets them (OLLIE tap, TRICK, AUTO, pause)
  await api('touch', true);
  const T = (o) => G((o) => { Object.assign(window.__skate.game.input.touch, o); }, o);
  await roll(...EZ, 4.5);
  await T({ ollieHeld: true }); await wait(30); await T({ ollieHeld: false, ollieReleased: true, flip: null }); await wait(1100);
  e = await ev(); const tTap = { pops: pops(e), flips: flips(e) };
  await roll(...EZ, 4.5); await T({ trickPressed: true }); await wait(1300);
  e = await ev(); const tTrick = { pops: pops(e), flips: flips(e), want: 'heelflip (cycle index 5)' };
  const au0 = await G(() => window.__skate.game.input.autoActive);
  await T({ autoPressed: true }); await wait(150);
  const au1 = await G(() => window.__skate.game.input.autoActive);
  await T({ autoPressed: true }); await wait(150);
  await T({ pausePressed: true }); await wait(150);
  const tp1 = await G(() => window.__skate.game.paused);
  await T({ pausePressed: true }); await wait(150);
  const tp2 = await G(() => window.__skate.game.paused);
  await api('touch', false); await unpause();
  log('touch_easy', { OLLIE_tap: tTap, TRICK: tTrick, AUTO_toggles: [au0, au1], pause_then_resume: [tp1, tp2] });
  log('settings_auto_mode', await G(async () => {
    const m = await import('/src/core/settings.ts');
    const i = window.__skate.game.input;
    const r = { start: [m.settings.controlMode, i.autoActive] };
    m.setSetting('controlMode', 'auto'); r.toAuto = i.autoActive;
    m.setSetting('controlMode', 'easy'); r.backToEasy = i.autoActive;
    return r;
  }));

  // ------------------------------------------------------------ 5. auto-ride takeover / resume (dummy AutoSource)
  await G(() => {
    const i = window.__skate.game.input; window.__origAuto = i.auto;
    window.__al = { n: 0, resets: 0, dt: 0 };
    i.auto = { sample(dt) { window.__al.n++; window.__al.dt = dt; return { steer: 0.25, push: false, brake: false, crouch: false, ollie: false, flip: null, airTrick: null, grind: false, grindPressed: false, manual: false, lean: 0 }; }, reset() { window.__al.resets++; } };
    i.setAuto(true);
  });
  await roll(...EZ, 3);
  const aS = () => G(() => { const g = window.__skate.game, i = g.input; return { n: window.__al.n, resets: window.__al.resets, dt: +window.__al.dt.toFixed(5), active: i.autoActive, suspended: i.autoSuspended, userActive: i.userActive, resumeIn: +i.autoResumeIn.toFixed(2), steer: +g.lastInput.steer.toFixed(2), push: g.lastInput.push }; });
  await wait(500); const r0 = await aS();
  await page.keyboard.down('KeyW'); await wait(150); const r1 = await aS();
  await wait(150); await page.keyboard.up('KeyW'); await wait(50); const r2 = await aS();
  await wait(2000); const r3 = await aS();
  await wait(2600); const r4 = await aS();
  // camera look / time of day are not a takeover
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(cx - i * 12, cy); await wait(12); }
  await page.mouse.up(); await page.keyboard.press('KeyT'); await wait(300); const r5 = await aS();
  await page.keyboard.press('KeyQ'); await wait(200); const r6 = await aS();
  await page.keyboard.press('KeyQ'); await wait(200); const r7 = await aS();
  log('auto_ride', { engaged: r0, holdingW: r1, released: r2, after2s: r3, after4_6s: r4, afterLookAndT: r5, afterQ: r6, afterQagain: r7 });
  await G(() => { const i = window.__skate.game.input; i.setAuto(false); i.auto = window.__origAuto; });
  await G(() => { const i = window.__skate.game.input; i.setAuto(true); });
  await wait(300);
  log('auto_ride_real_autopilot', await G(() => { const g = window.__skate.game, i = g.input; return { active: i.autoActive, suspended: i.autoSuspended, state: window.__skate.state() }; }));
  await G(() => window.__skate.game.input.setAuto(false));

  fs.writeFileSync(path.join(out, 'input_check.json'), JSON.stringify(R, null, 2));
}
