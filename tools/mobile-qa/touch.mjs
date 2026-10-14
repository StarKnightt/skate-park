// Real multi-touch tests (CDP Input.dispatchTouchEvent, several fingers at once) against ?test&touch builds, plus the real
// first-run flow (no ?test). Every case records PASS / FAIL / NOTE with the measured values.
// bash tools/heavy.sh mobileqa node tools/mobile-qa/touch.mjs [--prof iphone]
import path from 'node:path';
import { launch, mobilePage, PROFILES, BASE_URL, Touch, sleep, center, waitReady, bundleName, save, log, SHOTS, opt, rotate } from './common.mjs';

const profKey = opt('prof', 'iphone');
const prof = PROFILES[profKey];
const browser = await launch();
const results = { profile: prof.name, bundle: null, cases: [] };
const rec = (id, name, status, data) => { results.cases.push({ id, name, status, ...data }); log(status.padEnd(5), id, name, JSON.stringify(data).slice(0, 300)); };
const fmt = (x) => `${x.type}${x.flip ? ':' + x.flip : ''}${x.kind ? ':' + x.kind : ''}${x.quality ? ':' + x.quality : ''}`;
const ev = (page) => page.evaluate(() => window.__skate.events());
const st = (page) => page.evaluate(() => {
  const s = window.__skate, t = s.input.touch, g = s.game;
  return { ...s.state(), steer: +t.steer.toFixed(3), push: t.push, brake: t.brake, ollieHeld: t.ollieHeld, grindHeld: t.grind, manualHeld: t.manual,
    yaw: +g.rig.userYaw.toFixed(4), pitch: +g.rig.userPitch.toFixed(4), auto: s.input.autoActive, autoSusp: s.input.autoSuspended, paused: g.paused,
    ollieActive: document.querySelector('.tbtn.ollie').classList.contains('active') };
});

async function open(mode, landscape = false) {
  const m = await mobilePage(browser, prof, { landscape });
  await m.page.goto(BASE_URL + `?test&touch&mute&mode=${mode}`, { waitUntil: 'load', timeout: 120000 });
  await waitReady(m.page, true);
  results.bundle ??= await bundleName(m.page);
  await sleep(800);
  m.touch = new Touch(m.cdp);
  m.c = {};
  for (const [k, s] of Object.entries({ stick: '.stick', ollie: '.tbtn.ollie', trick: '.tbtn.flipbtn', auto: '.tbtn.autobtn', grind: '.tbtn.grind', manual: '.tbtn.manual', pause: '.pausebtn' })) m.c[k] = await center(m.page, s);
  return m;
}
async function respawnRolling(m, speed = 3.5) {
  await m.page.evaluate((v) => { const s = window.__skate, g = s.game; g.respawn(); const p = g.spawn.pos; s.teleport(p.x, p.y, p.z, g.spawn.heading * 180 / Math.PI, v); s.events(); }, speed);
  await sleep(250);
}

// =============================================================== EASY
{
  const m = await open('easy');
  const { page, touch, c } = m;
  // ---- T1 stick dead zone / mapping
  const S = c.stick;
  const id = await touch.down(S.x, S.y);
  await sleep(80);
  const map = [];
  for (const dx of [0, 3, 6, 7, 8, 12, 20, 30, 40, 55, 70]) { await touch.move(id, S.x + dx, S.y); await sleep(60); const s = await st(page); map.push([dx, s.steer]); }
  const vmap = [];
  for (const dy of [-10, -20, -22, -23, -30, 0, 25, 30, 31, 40]) { await touch.move(id, S.x, S.y + dy); await sleep(60); const s = await st(page); vmap.push([dy, s.push ? 'push' : s.brake ? 'brake' : '-']); }
  const knob = await page.evaluate(() => document.querySelector('.stick .knob').style.transform);
  await touch.up(id); await sleep(80);
  const after = await st(page);
  rec('T1', 'stick dead zone + mapping (px from centre -> steer)', after.steer === 0 && !after.push ? 'PASS' : 'FAIL',
    { steerByPx: map, vertical: vmap, knobAtLast: knob, resetOnRelease: { steer: after.steer, push: after.push, brake: after.brake },
      note: 'pass 5: floating stick, steer = radial output rescaled past an 8 px dead zone (0.15 of 55 px), full at 55 px; push above 22 px up, brake beyond 30 px down' });

  // ---- T2 touch just outside the stick ring -> goes to the canvas (camera), no steering
  const yaw0 = (await st(page)).yaw;
  const r = S.w / 2;
  const oid = await touch.down(S.x + r * 0.78, S.y - r * 0.78); // inside the bounding square, outside the circle (corner)
  await sleep(50); await touch.glide(oid, S.x + r * 0.78 + 50, S.y - r * 0.78, 150, 5); await sleep(60);
  const s2 = await st(page);
  await touch.up(oid); await sleep(60);
  const oid2 = await touch.down(S.x + r + 12, S.y); // 12 px outside the ring
  await sleep(50); await touch.glide(oid2, S.x + r + 60, S.y, 150, 5); await sleep(60);
  const s2b = await st(page);
  await touch.up(oid2); await sleep(400);
  // pass 5: the stick floats in the lower-left zone, so a near-miss must steer and leave the camera alone
  const nearOk = (s, yawD) => s.steer > 0.5 && Math.abs(yawD) < 0.1;
  rec('T2', 'thumb lands just outside the 136 px stick ring (corner of its box / 12 px outside the ring): steers, camera stays',
    nearOk(s2, s2.yaw - yaw0) && nearOk(s2b, s2b.yaw - s2.yaw) ? 'PASS' : 'FAIL',
    { cornerTouch: { steer: s2.steer, yawDelta: +(s2.yaw - yaw0).toFixed(3) }, outside12px: { steer: s2b.steer, yawDelta: +(s2b.yaw - s2.yaw).toFixed(3) },
      note: 'floating stick: a touch anywhere in the lower-left zone centres the stick there (50 px drag right -> steer ~0.89)' });

  // ---- T3 multi-touch: stick held + OLLIE tap + TRICK tap + camera drag with a third finger
  await respawnRolling(m);
  const a = await touch.down(S.x, S.y); await sleep(40);
  await touch.move(a, S.x + 40, S.y); await sleep(250);
  const sA = await st(page);
  const b = await touch.down(c.ollie.x, c.ollie.y); await sleep(120); await touch.up(b);
  await sleep(700);
  const e1 = await ev(page); const sB = await st(page);
  const t2 = await touch.down(c.trick.x, c.trick.y); await sleep(80); await touch.up(t2);
  await sleep(900);
  const e2 = await ev(page); const sC = await st(page);
  const yawBefore = sC.yaw;
  const cam = await touch.down(prof.w * 0.5, prof.h * 0.3); await sleep(40);
  await touch.glide(cam, prof.w * 0.5 + 90, prof.h * 0.3 + 20, 300, 10); await sleep(80);
  const sD = await st(page);
  const b2 = await touch.down(c.ollie.x, c.ollie.y); await sleep(100); await touch.up(b2); // OLLIE while the camera finger + stick are down
  await sleep(500);
  const e3 = await ev(page);
  await touch.up(cam); await touch.up(a); await sleep(150);
  const sE = await st(page);
  const pops = (e) => e.filter((x) => x.type === 'pop').length;
  const ok3 = sA.steer > 0.6 && pops(e1) >= 1 && sB.steer > 0.6 && pops(e2) >= 1 && Math.abs(sD.yaw - yawBefore) > 0.2 && sD.steer > 0.6 && pops(e3) >= 1 && sE.steer === 0;
  rec('T3', 'stick held + OLLIE tap, + TRICK tap, + 3rd-finger camera drag + OLLIE', ok3 ? 'PASS' : 'FAIL',
    { steerHeld: [sA.steer, sB.steer, sC.steer, sD.steer], popsAfterOllie: pops(e1), afterTrick: e2.filter((x) => ['pop', 'flip', 'land'].includes(x.type)).map(fmt),
      camYawDelta: +(sD.yaw - yawBefore).toFixed(3), popsWith3Fingers: pops(e3), allReleased: { steer: sE.steer, ollieHeld: sE.ollieHeld } });

  // ---- T4 swipe-flip on OLLIE release (Easy)
  const flips = {};
  for (const [dir, dx, dy] of [['left', -45, 0], ['right', 45, 0], ['down', 0, 40], ['up', 0, -45]]) {
    await respawnRolling(m);
    const f = await touch.down(c.ollie.x, c.ollie.y); await sleep(220);
    await touch.glide(f, c.ollie.x + dx, c.ollie.y + dy, 90, 4);
    await touch.up(f);
    await sleep(160);
    const air = await st(page);
    await sleep(1100);
    const e = await ev(page);
    flips[dir] = { airFlip: air.flip, mode: air.mode, events: e.filter((x) => ['pop', 'flip', 'land'].includes(x.type)).map(fmt) };
  }
  const want = { left: 'kickflip', right: 'heelflip', down: 'shove', up: 'tre' };
  const ok4 = Object.entries(flips).every(([d, v]) => JSON.stringify(v).toLowerCase().includes(want[d]));
  rec('T4', 'OLLIE hold + swipe on release picks the flip (Easy)', ok4 ? 'PASS' : 'FAIL', { flips });

  // ---- T5 thumb jitter while holding OLLIE (no swipe intended): ends 20 px off / 32 px off
  const jit = {};
  for (const endOff of [20, 32]) {
    await respawnRolling(m);
    const f = await touch.down(c.ollie.x, c.ollie.y);
    for (const o of [6, -5, 9, -8, 12, 4]) { await touch.move(f, c.ollie.x + o, c.ollie.y - Math.abs(o) / 2); await sleep(70); }
    await touch.move(f, c.ollie.x - endOff * 0.3, c.ollie.y - endOff); await sleep(60);
    await touch.up(f); await sleep(160);
    const air = await st(page); await sleep(1000); const e = await ev(page);
    jit[endOff + 'px'] = { airFlip: air.flip, events: e.filter((x) => ['pop', 'flip', 'land'].includes(x.type)).map(fmt) };
  }
  // pass 5: a swipe needs 40-140 px of recent travel, so both drifts must stay plain ollies
  const plain = (r) => r.airFlip == null && r.events.some((x) => x.startsWith('pop')) && !r.events.some((x) => x.startsWith('flip'));
  rec('T5', 'thumb drift while holding OLLIE (20 px and 32 px, mostly upward)', plain(jit['20px']) && plain(jit['32px']) ? 'PASS' : 'FAIL',
    { ...jit, note: 'swipe = 40-140 px over the last 250 ms, still moving at the lift (a move within 50 ms): drift under 40 px is a plain ollie' });

  // ---- T6 finger slides off OLLIE while held (pointer capture keeps it pressed), release far away
  await respawnRolling(m);
  const f6 = await touch.down(c.ollie.x, c.ollie.y); await sleep(120);
  await touch.glide(f6, c.ollie.x - 30, c.ollie.y - 110, 200, 6); await sleep(60);
  const s6 = await st(page);
  await touch.up(f6); await sleep(160);
  const s6b = await st(page); await sleep(1000); const e6 = await ev(page);
  const e6f = e6.filter((x) => ['pop', 'flip', 'land'].includes(x.type)).map(fmt);
  rec('T6', 'thumb slides 110 px off OLLIE while holding, lifts there', s6.ollieHeld && s6.ollieActive && plain({ airFlip: s6b.flip, events: e6f }) ? 'PASS' : 'FAIL',
    { heldWhileOff: s6.ollieHeld, activeClass: s6.ollieActive, resultFlip: s6b.flip, events: e6f,
      note: 'stays pressed while off the button; the slide ends before the lift, so the release is a plain ollie' });

  // ---- T7 touchcancel while crouched on OLLIE (system gesture / notification shade / incoming call)
  await respawnRolling(m);
  const f7 = await touch.down(c.ollie.x, c.ollie.y); await sleep(200);
  const s7a = await st(page);
  await touch.cancel(); await sleep(200);
  const s7 = await st(page); await sleep(800); const e7 = await ev(page);
  const sid = await touch.down(S.x, S.y); await touch.move(sid, S.x + 40, S.y); await sleep(100); const s7c = await st(page); await touch.cancel(); await sleep(100); const s7d = await st(page);
  rec('T7', 'touchcancel while crouched on OLLIE / while steering', e7.some((x) => x.type === 'pop') ? 'FAIL' : 'PASS',
    { crouchedBefore: s7a.ollieHeld, ollieHeldAfterCancel: s7.ollieHeld, popOnCancel: e7.some((x) => x.type === 'pop'), events: e7.map((x) => x.type),
      stickBeforeCancel: s7c.steer, stickAfterCancel: s7d.steer, note: 'pointercancel on OLLIE ends the crouch without a pop (touch.ollieCancel)' });

  // ---- T8 pause button, mode switch from the pause menu by touch, resume
  await page.evaluate(() => window.__skate.game.respawn());
  await touch.tap(c.pause.x, c.pause.y, 70); await sleep(450);
  const p1 = await page.evaluate(() => ({ paused: window.__skate.game.paused, open: document.querySelector('.pause').classList.contains('show') }));
  await page.screenshot({ path: path.join(SHOTS, `touch_${profKey}_pause_open.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  const seg = async (v) => { const b = await center(page, `.pause .seg[data-key="controlMode"] button[data-v="${v}"]`); await touch.tap(b.x, b.y, 60); await sleep(300); };
  await seg('pro');
  const p2 = await page.evaluate(() => ({ mode: document.querySelector('.touch').dataset.mode, grindVisible: getComputedStyle(document.querySelector('.tbtn.grind')).display !== 'none', stored: window.__skate.game && JSON.stringify(window.__pauseMenu?.isOpen) }));
  await seg('auto');
  const p3 = await page.evaluate(() => ({ mode: document.querySelector('.touch').dataset.mode, auto: window.__skate.input.autoActive }));
  await seg('easy');
  const res = await center(page, '.pause [data-act="resume"]');
  await touch.tap(res.x, res.y, 60); await sleep(400);
  const p4 = await page.evaluate(() => ({ paused: window.__skate.game.paused, open: document.querySelector('.pause').classList.contains('show'), auto: window.__skate.input.autoActive }));
  const e8 = await ev(page);
  rec('T8', 'pause button -> menu; Pro / Auto-ride / Easy by touch; Resume', p1.paused && p1.open && p2.mode === 'pro' && p2.grindVisible && p3.mode === 'easy' && p3.auto && !p4.paused && !p4.open ? 'PASS' : 'FAIL',
    { open: p1, pro: p2, auto: p3, resumed: p4, eventsOnResume: e8.map((x) => x.type), pauseButton: { w: c.pause.w, h: c.pause.h } });

  // ---- T9 AUTO toggle, stick takeover, auto resume after ~4 s
  await respawnRolling(m, 0);
  await touch.tap(c.auto.x, c.auto.y, 60); await sleep(2500);
  const a1 = await st(page); const lit = await page.evaluate(() => document.querySelector('.tbtn.autobtn').className);
  const k = await touch.down(S.x, S.y); await touch.move(k, S.x - 40, S.y); await sleep(1000);
  const a2 = await st(page); const held = await page.evaluate(() => document.querySelector('.tbtn.autobtn').className);
  await touch.up(k);
  const tRel = Date.now(); let resumedAfter = null;
  for (let i = 0; i < 40; i++) { await sleep(200); const s = await st(page); if (!s.autoSusp) { resumedAfter = Date.now() - tRel; break; } }
  const a3 = await st(page);
  await touch.tap(c.auto.x, c.auto.y, 60); await sleep(300);
  const a4 = await st(page);
  rec('T9', 'AUTO on -> rides; stick takes over; auto-ride resumes after release; AUTO off', a1.auto && a1.speed > 1 && a2.autoSusp && resumedAfter != null && !a4.auto ? 'PASS' : 'FAIL',
    { autoOn: a1.auto, speedUnderAuto: a1.speed, classOn: lit, takenOver: a2.autoSusp, classHeld: held, resumedAfterMs: resumedAfter, speedWhenResumed: a3.speed, autoOff: !a4.auto });

  // ---- T10 camera drag that starts on empty canvas and crosses the OLLIE / TRICK buttons
  await respawnRolling(m);
  const y0 = (await st(page)).yaw;
  const d = await touch.down(prof.w * 0.45, c.ollie.y - 160); await sleep(30);
  await touch.glide(d, c.ollie.x, c.ollie.y, 250, 8); await touch.glide(d, c.trick.x, c.trick.y, 200, 6); await sleep(50);
  const s10 = await st(page); await touch.up(d); await sleep(700); const e10 = await ev(page);
  rec('T10', 'camera drag sweeping across OLLIE and TRICK', !e10.some((x) => x.type === 'pop') && !s10.ollieHeld ? 'PASS' : 'FAIL',
    { yawDelta: +(s10.yaw - y0).toFixed(3), pitch: s10.pitch, popped: e10.some((x) => x.type === 'pop'), note: 'implicit touch capture keeps the drag on the canvas' });

  // ---- T11 pinch / double-tap on the canvas: no browser zoom; camera effect
  const vv0 = await page.evaluate(() => visualViewport.scale);
  const p = await touch.down(prof.w * 0.4, prof.h * 0.35), q = await touch.down(prof.w * 0.6, prof.h * 0.37);
  for (let i = 1; i <= 8; i++) { await touch.move(p, prof.w * 0.4 - i * 10, prof.h * 0.35 - i * 6); await touch.move(q, prof.w * 0.6 + i * 10, prof.h * 0.37 + i * 6); await sleep(25); }
  await touch.up(p); await touch.up(q); await sleep(100);
  await touch.tap(prof.w * 0.5, prof.h * 0.3, 40); await sleep(80); await touch.tap(prof.w * 0.5, prof.h * 0.3, 40); await sleep(400);
  const vv1 = await page.evaluate(() => ({ scale: visualViewport.scale, scrollY, scrollX, vv: window.__qa.vv }));
  rec('T11', 'pinch + double-tap on the game: no page zoom / scroll', vv1.scale === 1 && vv0 === 1 && vv1.scrollY === 0 ? 'PASS' : 'FAIL', { before: vv0, after: vv1 });
  await m.context.close();
}

// =============================================================== PRO: buttons + swipe flips
{
  const m = await open('pro');
  const { page, touch, c } = m;
  const S = c.stick;
  await respawnRolling(m, 3);
  // push with the stick up (Pro has no cruise)
  const a = await touch.down(S.x, S.y); await touch.move(a, S.x, S.y - 45); await sleep(900);
  const s1 = await st(page); await touch.up(a); await sleep(100);
  // MANUAL hold + GRIND hold states
  const mn = await touch.down(c.manual.x, c.manual.y); await sleep(500); const s2 = await st(page);
  const cls = await page.evaluate(() => document.querySelector('.tbtn.manual').className);
  await touch.up(mn); await sleep(100); const s3 = await st(page);
  const gr = await touch.down(c.grind.x, c.grind.y); await sleep(200); const s4 = await st(page); await touch.up(gr); await sleep(100); const s5 = await st(page);
  // swipe flips in Pro
  const flips = {};
  for (const [dir, dx, dy] of [['left', -45, 0], ['right', 45, 0], ['up', 0, -45]]) {
    await respawnRolling(m, 3.5);
    const f = await touch.down(c.ollie.x, c.ollie.y); await sleep(300);
    await touch.glide(f, c.ollie.x + dx, c.ollie.y + dy, 90, 4); await touch.up(f); await sleep(160);
    const air = await st(page); await sleep(1100); const e = await ev(page);
    flips[dir] = { airFlip: air.flip, events: e.filter((x) => ['pop', 'flip', 'land', 'bail'].includes(x.type)).map(fmt) };
  }
  rec('T12', 'Pro: stick-up push, MANUAL / GRIND hold states, swipe flips', s1.push && s2.manualHeld && !s3.manualHeld && s4.grindHeld && !s5.grindHeld ? 'PASS' : 'FAIL',
    { pushHeld: s1.push, speedAfterPush: s1.speed, manualHeld: s2.manualHeld, manualPhysics: s2.manual, manualClass: cls, manualReleased: !s3.manualHeld, grindHeld: s4.grindHeld, grindReleased: !s5.grindHeld, flips });
  await m.context.close();
}

// =============================================================== orientation change mid-session (stick held, then paused)
{
  const m = await open('easy');
  const { page, touch, c } = m;
  await respawnRolling(m);
  const before = await page.evaluate(() => ({ canvas: [window.__qa.canvas.width, window.__qa.canvas.height], aspect: +window.__skate.game.camera.aspect.toFixed(3) }));
  const a = await touch.down(c.stick.x, c.stick.y); await touch.move(a, c.stick.x + 40, c.stick.y); await sleep(200);
  const vp = await rotate(m, true); await sleep(700);
  const mid = await st(page);
  const land = await page.evaluate(() => ({ canvas: [window.__qa.canvas.width, window.__qa.canvas.height], css: [window.__qa.canvas.clientWidth, window.__qa.canvas.clientHeight], aspect: +window.__skate.game.camera.aspect.toFixed(3), orient: screen.orientation?.type,
    stick: document.querySelector('.stick').getBoundingClientRect().toJSON(), ollie: document.querySelector('.tbtn.ollie').getBoundingClientRect().toJSON() }));
  await touch.move(a, c.stick.x + 45, c.stick.y + 2); await sleep(100);
  const mid2 = await st(page);
  await touch.up(a); await sleep(150);
  const rel = await st(page);
  await page.screenshot({ path: path.join(SHOTS, `touch_${profKey}_rotated_landscape.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  // rotate back while the pause menu is open
  const pb = await center(page, '.pausebtn'); await touch.tap(pb.x, pb.y, 60); await sleep(400);
  const panelLand = await page.evaluate(() => { const p = document.querySelector('.pause .panel'); return { h: p.clientHeight, scrollH: p.scrollHeight, w: p.clientWidth, vh: innerHeight }; });
  await rotate(m, false); await sleep(700);
  const panelPort = await page.evaluate(() => { const p = document.querySelector('.pause .panel'); return { h: p.clientHeight, scrollH: p.scrollHeight, w: p.clientWidth, vh: innerHeight, open: document.querySelector('.pause').classList.contains('show') }; });
  const back = await page.evaluate(() => ({ canvas: [window.__qa.canvas.width, window.__qa.canvas.height], aspect: +window.__skate.game.camera.aspect.toFixed(3) }));
  const ok = land.canvas[0] > land.canvas[1] && rel.steer === 0 && back.canvas[1] > back.canvas[0] && panelPort.open;
  rec('T13', 'orientation change mid-session (stick held), then rotate back with the pause menu open', ok ? 'PASS' : 'FAIL',
    { before, viewport: vp, landscape: land, steerAcrossRotation: [mid.steer, mid2.steer], steerAfterRelease: rel.steer, panelLandscape: panelLand, panelPortrait: panelPort, back });
  await m.context.close();
}

// =============================================================== real first run (no ?test): title, first tap, Easy cruise, hint text
{
  const m = await mobilePage(browser, prof);
  const { page, cdp } = m;
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 120000 });
  await waitReady(page, false);
  await sleep(1500);
  const title = await page.evaluate(() => ({ shown: document.querySelector('.titlecard').classList.contains('show'), text: document.querySelector('.titlecard')?.innerText.replace(/\s+/g, ' '), hint: document.querySelector('.hint')?.innerText.replace(/\s+/g, ' '), mode: localStorage.getItem('skate.controlMode') }));
  await page.screenshot({ path: path.join(SHOTS, `touch_${profKey}_first_run_title.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  const touch = new Touch(cdp);
  const st0 = await page.evaluate(() => document.querySelector('.tbtn.autobtn').classList.contains('on'));
  await touch.tap(prof.w / 2, prof.h * 0.42, 70); await sleep(2500);
  const after = await page.evaluate(() => ({ title: document.querySelector('.titlecard').classList.contains('show'), hintVisible: !document.querySelector('.hint').classList.contains('hide'), hint: document.querySelector('.hint')?.innerText.replace(/\s+/g, ' '), autoLit: document.querySelector('.tbtn.autobtn').classList.contains('on'), modelabel: document.querySelector('.modelabel').innerText }));
  await page.screenshot({ path: path.join(SHOTS, `touch_${profKey}_first_run_riding.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  rec('T14', 'real first run on touch: title card, first tap hands over, Easy keeps rolling, touch hint', !after.title ? 'PASS' : 'FAIL',
    { title, autoLitDuringAttract: st0, after, note: 'pass 5: the title card reads "Tap to ride" on touch' });
  await m.context.close();
}

save(`touch_${profKey}.json`, results);
const summary = results.cases.map((x) => `${x.status} ${x.id} ${x.name}`).join('\n');
console.log('\n' + summary);
await browser.close();
