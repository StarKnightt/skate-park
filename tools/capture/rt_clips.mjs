// M2 real-time feature clips (pass 4): no ?fps, no frame stepping, real Playwright keyboard / mouse events in real time,
// 1280x720 emulated viewport in a window on DISPLAY2 only (1930,20). Canvas clips: canvas.captureStream(60) + MediaRecorder
// (true 60 fps) -> constant 60 fps with key / trick captions. Pause menu: page-level CDP screencast (HTML menu included,
// compositor timestamps) -> constant 60 fps. Pointer lock is emulated in the page (the test window never takes focus).
//   bash tools/heavy.sh M2 node tools/capture/rt_clips.mjs [--only f_flips,pause_menu,easy_cruise,bail_bowl]
// -> E:/shots/skate-park/pass-04/clips/rt_feat_*.mp4 + sheets/rt_feat_*.jpg; takes, logs, report.json in realtime/media_feat/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchMedia, installRecorder, saveRecording, startScreencast, encodeScreencast, cfr60, dtext, keyViewer } from '../realtime/media_common.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = opt('only', '') ? opt('only', '').split(',') : null;
const BASE = 'http://127.0.0.1:5188/?test&mute';
const P4 = 'E:/shots/skate-park/pass-04';
const WORK = path.join(P4, 'realtime', 'media_feat'), CLIPS = path.join(P4, 'clips'), SHEETS = path.join(P4, 'sheets');
for (const d of [WORK, CLIPS, SHEETS]) fs.mkdirSync(d, { recursive: true });
const REPORT = path.join(WORK, 'report.json');
const report = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : {};
const saveReport = () => fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SHEET_PY = path.join(HERE, '..', 'realtime', 'media_sheet.py');

// ------------------------------------------------------------------------------------------------ page side
function clipLog() {
  const g = window.__skate.game, C = (window.__clip = { ev: [], phases: [], frames: [] });
  const push = g.eventLog.push.bind(g.eventLog);
  g.eventLog.push = (...a) => { for (const x of a) C.ev.push({ ...x, wall: performance.now() }); return push(...a); };
  let last = '';
  C.cur = () => ({ wall: performance.now(), phase: g.skater.phase, mode: g.physics.mode, pos: g.physics.pos.toArray().map((v) => +v.toFixed(2)) });
  const tick = (now) => {
    C.frames.push(now);
    if (C.frames.length > 30000) C.frames.splice(0, 15000);
    const k = g.skater.phase + '/' + g.physics.mode;
    if (k !== last) { last = k; C.phases.push(C.cur()); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------------------------------------ driver helpers
const wait = (page, ms) => page.waitForTimeout(Math.max(0, ms));
async function runKeys(page, keys, t0) {
  for (const [t, d, code] of keys) {
    await wait(page, t0 + t * 1000 - Date.now());
    if (d) await page.keyboard.down(code); else await page.keyboard.up(code);
  }
}
const state = (page) => page.evaluate(() => {
  const g = window.__skate.game, p = g.physics;
  return { x: p.pos.x, y: p.pos.y, z: p.pos.z, mode: p.mode, speed: p.speed, phase: g.skater.phase, grind: p.grind?.name ?? null, line: p.grind?.line?.name ?? null, paused: g.paused, locked: !!document.pointerLockElement };
});
async function until(page, pred, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const s = await state(page);
    if (pred(s)) return s;
    if (Date.now() > end) return null;
    await wait(page, 6);
  }
}
async function tap(page, code, ms) { await page.keyboard.down(code); await wait(page, ms); await page.keyboard.up(code); }

// the first MediaRecorder of a page drops ~0.8 s of frames while the encoder starts: record and discard 1.5 s first
async function warmRecorder(page) {
  await page.evaluate(() => window.__recStart(16000000));
  await wait(page, 1500);
  await page.evaluate(() => window.__recStop());
}
async function open(q, extra = {}) {
  const s = await launchMedia({ url: BASE + q, ...extra });
  await s.page.evaluate(installRecorder);
  await s.page.evaluate(clipLog);
  if (!extra.cursor) await warmRecorder(s.page);
  return s;
}
async function reload(s, q) {
  await s.page.goto(BASE + q, { waitUntil: 'load' });
  await s.page.waitForFunction(() => window.__skate && window.__skate.ready, null, { timeout: 60000 });
  await wait(s.page, 500);
  await s.page.evaluate(installRecorder);
  await s.page.evaluate(clipLog);
  await warmRecorder(s.page);
}
function resetLog(page) {
  return page.evaluate(() => { const C = window.__clip; window.__keys.length = 0; C.ev.length = 0; C.frames.length = 0; C.phases = [C.cur()]; });
}
async function recStart(page) {
  await page.evaluate(() => window.__recStart(16000000));
  await resetLog(page);
  return page.evaluate(() => window.__rec.t0);
}
function probe(file) {
  const o = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  try {
    const j = JSON.parse(o.stdout), st = j.streams[0], dur = +j.format.duration;
    return { frames: +st.nb_read_packets, dur: +dur.toFixed(3), fps: +(st.nb_read_packets / dur).toFixed(1), w: st.width, h: st.height };
  } catch { return null; }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(2) : null; };
async function recStop(page, name) {
  const r = await saveRecording(page, path.join(WORK, name + '_raw.mp4'));
  const log = await page.evaluate(() => ({ keys: window.__keys.slice(), ev: window.__clip.ev.slice(), phases: window.__clip.phases.slice(), frames: window.__clip.frames.slice() }));
  const fr = log.frames.slice(1).map((t, i) => t - log.frames[i]);
  const v = (w) => +((w - r.t0) / 1000).toFixed(3);
  return { ...r, ...log, v, medianFrameMs: median(fr), longFrames: fr.filter((x) => x > 12).length, rawProbe: probe(r.file) };
}
function sheet(video, name, items, title) {
  const tj = path.join(WORK, name + '_sheet.json');
  fs.writeFileSync(tj, JSON.stringify(items));
  spawnSync('python', [SHEET_PY, video, path.join(SHEETS, name + '.jpg'), tj, '4', title], { stdio: 'inherit' });
}
const evSummary = (r) => r.ev.filter((e) => !['boardClack', 'push'].includes(e.type)).map((e) => ({ t: r.v(e.wall), type: e.type, ...(e.kind ? { kind: e.kind } : {}), ...(e.quality ? { quality: e.quality } : {}),
  ...(e.style ? { style: e.style } : {}), ...(e.name ? { name: e.name } : {}), ...(e.reason ? { reason: e.reason } : {}), ...(e.flip ? { flip: e.flip } : {}), ...(e.charge != null ? { charge: +(+e.charge).toFixed(2) } : {}) }));
const tag = (text) => dtext(text, 'w-tw-18', 16, null, null, { size: 19, color: 'white@0.85', box: 'black@0.45' });

// ------------------------------------------------------------------------------------------------ 1. F flips (Pro, side-on)
async function fFlips() {
  const s = await open('&mode=pro');
  const { page } = s;
  const res = { url: BASE + '&mode=pro', method: 'canvas.captureStream(60) + MediaRecorder (H.264 16 Mb/s), real time; ffmpeg fps=60 + captions', takes: [] };
  try {
    const setup = (z, v) => page.evaluate(([z, v]) => {
      const s = window.__skate, r = s.game.rig;
      s.free(); r.idleT = 0; r.userYaw = 0; r.userPitch = 0; r.distOverride = null;
      s.teleport(34.5, 0, z, 180, v); s.snapCam(); s.camYaw(Math.PI / 2, 0);
    }, [z, v]);
    for (const z of [23.5, 12, 0, -12, -22]) { await setup(z, 4.6); await wait(page, 350); }
    // take 1 (only if take 0 missed a flip or bailed): a higher ollie and an earlier late F
    const keysFor = (take) => [
      [0.5, 1, 'KeyF'], [0.55, 0, 'KeyF'],
      [2.2, 1, 'Space'], [2.5, 1, 'KeyD'], [2.56, 1, 'KeyF'], [2.61, 0, 'KeyF'], [2.63, 0, 'KeyD'], [2.75, 0, 'Space'],
      [4.2, 1, 'KeyS'], [4.26, 1, 'KeyF'], [4.31, 0, 'KeyF'], [4.33, 0, 'KeyS'],
      [6.0, 1, 'KeyW'], [6.06, 1, 'KeyF'], [6.11, 0, 'KeyF'], [6.13, 0, 'KeyW'],
      ...(take ? [[7.8, 1, 'Space'], [8.4, 0, 'Space'], [8.5, 1, 'KeyF'], [8.55, 0, 'KeyF']] : [[7.8, 1, 'Space'], [8.25, 0, 'Space'], [8.37, 1, 'KeyF'], [8.42, 0, 'KeyF']]),
    ];
    const LABELS = [[0.5, 'F while rolling  ->  quick-pop kickflip'], [2.2, 'Space crouch + D + F  ->  heelflip'], [4.2, 'S + F  ->  pop shove-it'],
      [6.0, 'W + F  ->  tre flip'], [7.8, 'Space ollie, then F in the air  ->  late flip']];
    const END = 9.8;
    let best = null;
    for (let take = 0; take < 2 && !best?.ok; take++) {
      await page.evaluate(() => window.__skate.events());
      await setup(23.5, 4.6); await wait(page, 450);
      await recStart(page);
      await wait(page, 300);
      const t0 = Date.now(), tp0 = await page.evaluate(() => performance.now());
      await runKeys(page, keysFor(take), t0);
      await wait(page, t0 + END * 1000 - Date.now());
      const r = await recStop(page, `f_flips_take${take}`);
      const flips = r.ev.filter((e) => e.type === 'flip').map((e) => e.kind);
      const bails = r.ev.filter((e) => e.type === 'bail');
      const tk = { take, ok: flips.length >= 5 && !bails.length, flips, lands: r.ev.filter((e) => e.type === 'land').map((e) => e.quality), bails: bails.map((e) => `${e.kind}/${e.reason}`),
        events: evSummary(r), medianFrameMs: r.medianFrameMs, longFrames: r.longFrames, raw: r.file, rawProbe: r.rawProbe, inputT0: r.v(tp0) };
      res.takes.push(tk);
      console.log('f_flips take', take, JSON.stringify({ ok: tk.ok, flips, lands: tk.lands, bails: tk.bails, frameMs: tk.medianFrameMs, raw: tk.rawProbe }));
      if (!best || flips.length - 3 * bails.length > best.flips.length - 3 * best.bails.length) best = { ...tk, r };
    }
    const r = best.r, end = r.rawProbe?.dur ?? END + 0.3;
    const vf = [tag('Pro  |  real time, true 60 fps canvas capture  |  side-on camera'),
      ...LABELS.map(([t, l]) => dtext(l, 20, 16, best.inputT0 + t - 0.15, best.inputT0 + t + 1.5, { size: 30 })),
      ...r.ev.filter((e) => e.type === 'flip').map((e) => dtext(`(game) ${e.kind}`, 20, 62, r.v(e.wall), r.v(e.wall) + 1.3, { size: 26, color: '0xFFD34D' })),
      ...r.ev.filter((e) => e.type === 'land').map((e) => dtext(`(game) land ${e.quality ?? ''}`, 20, 102, r.v(e.wall), r.v(e.wall) + 0.9, { size: 24 })),
      ...r.ev.filter((e) => e.type === 'bail').map((e) => dtext('BAIL', 20, 102, r.v(e.wall), r.v(e.wall) + 1.5, { size: 30, color: '0xFF5050' })),
      ...keyViewer(r.keys, r.t0, end, ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF'])].join(',');
    const out = path.join(CLIPS, 'rt_feat_f_flips.mp4');
    cfr60(r.file, out, vf);
    const items = [[0.2, 'rolling']];
    for (const e of r.ev.filter((x) => x.type === 'flip').slice(0, 5)) { const t = r.v(e.wall); items.push([t + 0.06, e.kind], [t + 0.2, e.kind + ' mid']); }
    const lastLand = r.ev.filter((x) => x.type === 'land').pop();
    items.push([lastLand ? r.v(lastLand.wall) + 0.25 : end - 0.3, 'landed']);
    sheet(out, 'rt_feat_f_flips', items.slice(0, 12), 'rt_feat_f_flips  |  Pro, real time 60 fps canvas capture, real F / WASD / Space key events');
    delete best.r;
    res.best = best; res.out = out; res.outProbe = probe(out);
  } finally { await s.browser.close(); }
  report.f_flips = res; saveReport();
}

// ------------------------------------------------------------------------------------------------ 2. pause menu (page level)
async function pauseMenu() {
  const s = await open('', { cursor: true });
  const { page } = s;
  const res = { url: BASE, method: 'CDP Page.startScreencast (JPEG q88, compositor frame timestamps) -> ffmpeg concat with real durations -> constant 60 fps; drawn cursor overlay; pointer lock emulated', steps: [] };
  try {
    await page.evaluate(() => { const s = window.__skate, r = s.game.rig; s.free(); r.idleT = 0; r.userYaw = 0; r.userPitch = 0; s.teleport(34.5, 0, 21, 180, 2.2); s.snapCam(); });
    await wait(page, 700);
    let mx = 380, my = 470;
    await page.mouse.move(mx, my);
    const glide = async (x, y, ms = 420) => {
      const n = Math.max(2, Math.round(ms / 16)), x0 = mx, y0 = my;
      for (let i = 1; i <= n; i++) { const k = i / n, e = k * k * (3 - 2 * k); mx = x0 + (x - x0) * e; my = y0 + (y - y0) * e; await page.mouse.move(mx, my); await wait(page, 16); }
    };
    const look = async (dx, dy, n) => { for (let i = 0; i < n; i++) { mx += dx; my += dy; await page.mouse.move(mx, my); await wait(page, 16); } };
    const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const click = async () => { await page.mouse.down(); await wait(page, 70); await page.mouse.up(); };
    const step = async (what) => {
      const st = await state(page);
      const o = await page.evaluate(() => ({ wall: performance.now() + performance.timeOrigin, menu: window.__pauseMenu?.isOpen ?? null, page: document.querySelector('.pause .pg.ctl.on') ? 'controls' : 'main',
        tod: window.__skate.game.tod.index, userYaw: +window.__skate.game.rig.userYaw.toFixed(3) }));
      res.steps.push({ what, paused: st.paused, locked: st.locked, ...o });
    };
    const sc = await startScreencast(page, path.join(WORK, 'pause_frames'));
    await wait(page, 600);
    await step('start');
    await glide(640, 360, 600); await wait(page, 200);
    await click(); await wait(page, 350); await step('click canvas -> pointer lock');
    await look(9, 0, 40); await look(-5, 3, 30); await wait(page, 400); await step('mouse moved -> camera turned');
    const lockAt = [mx, my];
    await page.keyboard.press('Escape'); await wait(page, 120);
    mx = 640; my = 360; await page.mouse.move(mx, my);
    await wait(page, 700); await step('Esc -> unlock + pause menu');
    await glide(...(await center('.pause [data-act="controls"]'))); await wait(page, 150); await click(); await wait(page, 1300); await step('Controls page');
    await glide(...(await center('.pause .pg.ctl .seg[data-key="device"] button[data-v="pad"]'))); await wait(page, 150); await click(); await wait(page, 1300); await step('Controls: Gamepad');
    await glide(...(await center('.pause .pg.ctl [data-act="back"]'))); await wait(page, 150); await click(); await wait(page, 800); await step('Back');
    const tod0 = await page.evaluate(() => window.__skate.game.tod.index);
    const nTod = await page.evaluate(() => document.querySelectorAll('.pause .seg[data-key="tod"] button').length);
    const tod1 = (tod0 + 2) % nTod;
    await glide(...(await center(`.pause .seg[data-key="tod"] button[data-v="${tod1}"]`))); await wait(page, 150); await click(); await wait(page, 1500); await step('time of day changed');
    await glide(...(await center('.pause [data-act="resume"]'))); await wait(page, 200); await click(); await wait(page, 350); await step('Resume -> re-lock');
    await look(8, 0, 35); await wait(page, 500); await step('mouse moved -> camera turned');
    await page.keyboard.press('Escape'); await wait(page, 120);
    mx = 640; my = 360; await page.mouse.move(mx, my);
    await wait(page, 1100); await step('Esc -> menu again');
    await glide(...(await center('.pause [data-act="resume"]'))); await wait(page, 200); await click(); await wait(page, 350); await step('Resume');
    await wait(page, 1100);
    const frames = await sc.stop();
    const f0 = frames[0].t, dur = frames[frames.length - 1].t - f0;
    res.screencast = { frames: frames.length, seconds: +dur.toFixed(2), avgFps: +(frames.length / dur).toFixed(1),
      medianFrameMs: median(frames.slice(1).map((f, i) => (f.t - frames[i].t) * 1000)) };
    res.todFrom = tod0; res.todTo = tod1; res.lockAt = lockAt;
    const T = (w) => w / 1000 - f0;
    const st = res.steps, at = (i) => T(st[i].wall);
    const caps = [[1, 'click the canvas  ->  pointer lock (cursor hidden)'], [2, 'mouse moves  ->  camera turns'], [3, 'Esc (one press)  ->  unlock + pause menu'],
      [4, 'Controls page'], [5, 'Controls  -  Gamepad'], [6, 'Back'], [7, 'Time of day  ->  instant change while paused'], [8, 'Resume  ->  re-locks the mouse'],
      [9, 'mouse moves  ->  camera turns'], [10, 'Esc  ->  pause menu'], [11, 'Resume']];
    const vf = [tag('page-level screencast  |  real time  |  Pro'),
      ...caps.map(([i, l], k) => dtext(l, 20, 'h-62', Math.max(0, at(i) - 0.45), k + 1 < caps.length ? at(caps[k + 1][0]) - 0.45 : at(i) + 1.5, { size: 28 }))].join(',');
    const out = path.join(CLIPS, 'rt_feat_pause_menu.mp4');
    encodeScreencast(frames, out, vf);
    const items = [[0.3, 'start'], [at(1), 'locked'], [at(2) - 0.3, 'looking'], [at(3), 'Esc: menu'], [at(4), 'Controls'], [at(5), 'Gamepad'], [at(6), 'Back'],
      [at(7), 'time of day'], [at(8) + 0.2, 'Resume: locked'], [at(9), 'looking'], [at(10), 'Esc: menu'], [at(11) + 0.4, 'Resume']];
    sheet(out, 'rt_feat_pause_menu', items, 'rt_feat_pause_menu  |  page-level CDP screencast, real time, cursor drawn by the harness, pointer lock emulated');
    res.out = out; res.outProbe = probe(out);
    console.log('pause_menu', JSON.stringify(res.screencast), JSON.stringify(res.steps.map((x) => [x.what, x.paused, x.locked, x.menu, x.page, x.tod])));
  } finally { await s.browser.close(); }
  report.pause_menu = res; saveReport();
}

// ------------------------------------------------------------------------------------------------ 3. Easy cruise + auto-grind
async function easyCruise() {
  const s = await open('&mode=easy');
  const { page } = s;
  const res = { url: BASE + '&mode=easy', method: 'canvas.captureStream(60) + MediaRecorder, real time; ffmpeg fps=60 + captions', takes: [] };
  try {
    res.assist = await page.evaluate(() => ({ ...window.__skate.game.physics.assist }));
    const setup = (x, z, hd, v) => page.evaluate(([x, z, hd, v]) => {
      const s = window.__skate, r = s.game.rig;
      s.free(); r.idleT = 0; r.userYaw = 0; r.userPitch = 0; r.distOverride = null;
      s.teleport(x, 0, z, hd, v); s.snapCam();
    }, [x, z, hd, v]);
    for (const [x, z] of [[15.5, -12.85], [8, -12.85], [0, -12.85], [-8, -12.85], [-15, -13.8]]) { await setup(x, z, 270, 4); await wait(page, 300); }
    let best = null;
    for (let take = 0; take < 3 && !best?.ok; take++) {
      const wiggle = take < 2;
      await setup(15.5, -12.85, 270, 0); await wait(page, 800);
      await page.evaluate(() => window.__skate.events());
      await recStart(page);
      await wait(page, 700);
      const tp = {};
      const mark = async (k) => { tp[k] = await page.evaluate(() => performance.now()); };
      await mark('firstKey'); await tap(page, 'KeyW', 120);
      if (wiggle) {
        await until(page, (q) => q.x <= 10.5, 6000);
        await mark('steer');
        await tap(page, 'KeyA', 260); await tap(page, 'KeyD', 520); await tap(page, 'KeyA', 260);
      }
      const pre = await until(page, (q) => q.x <= 1.9, 9000);
      await mark('ollie'); await tap(page, 'Space', 120);
      const g1 = await until(page, (q) => q.mode === 'grind', 1600);
      if (g1) await mark('grind');
      const g2 = g1 ? await until(page, (q) => q.mode !== 'grind', 5000) : null;
      if (g2) await mark('grindEnd');
      await wait(page, 250);
      await mark('carve'); await tap(page, 'KeyD', 450); await tap(page, 'KeyA', 450);
      await wait(page, 900);
      const r = await recStop(page, `easy_take${take}`);
      const gs = r.ev.filter((e) => e.type === 'grindStart'), bails = r.ev.filter((e) => e.type === 'bail');
      const ePressed = r.keys.some((k) => k[2] === 'KeyE');
      const tk = { take, wiggle, ok: gs.length > 0 && /long ledge/.test(g1?.line ?? '') && !bails.length && !ePressed, grinds: gs.map((e) => `${e.style} (${e.name}) on ${g1?.line ?? '?'}`), ePressed,
        bails: bails.map((e) => `${e.kind}/${e.reason}`), speedAtPop: pre ? +pre.speed.toFixed(2) : null, zAtPop: pre ? +pre.z.toFixed(3) : null,
        events: evSummary(r), medianFrameMs: r.medianFrameMs, longFrames: r.longFrames, raw: r.file, rawProbe: r.rawProbe, marks: Object.fromEntries(Object.entries(tp).map(([k, w]) => [k, r.v(w)])) };
      res.takes.push(tk);
      console.log('easy take', take, JSON.stringify({ ok: tk.ok, grinds: tk.grinds, bails: tk.bails, speedAtPop: tk.speedAtPop, zAtPop: tk.zAtPop, frameMs: tk.medianFrameMs, raw: tk.rawProbe }));
      if (!best || (tk.ok && !best.ok) || (!best.ok && tk.grinds.length > best.grinds.length)) best = { ...tk, r };
    }
    const r = best.r, M = best.marks, end = r.rawProbe?.dur ?? 10;
    const caps = [[M.firstKey, (M.steer ?? M.ollie) - 0.1, 'first key (W tap)  ->  Easy auto-push cruise'], ...(M.steer != null ? [[M.steer, M.ollie - 0.1, 'A / D steering']] : []),
      [M.ollie, M.grind ?? M.ollie + 0.8, 'tap Space  ->  ollie along the long ledge'], ...(M.grind != null ? [[M.grind, M.grindEnd ?? M.grind + 2, 'auto-grind locks (no E pressed)']] : []),
      [M.carve, end, 'A / D carve away']];
    const vf = [tag('Easy  |  real time, true 60 fps canvas capture'),
      ...caps.map(([a, b, l]) => dtext(l, 20, 16, a, b, { size: 30 })),
      ...r.ev.filter((e) => e.type === 'grindStart').map((e) => dtext(`(game) grindStart ${e.style ?? ''} (${e.name ?? ''})`, 20, 62, r.v(e.wall), r.v(e.wall) + 1.6, { size: 26, color: '0xFFD34D' })),
      ...r.ev.filter((e) => e.type === 'bail').map((e) => dtext('BAIL', 20, 102, r.v(e.wall), r.v(e.wall) + 1.5, { size: 30, color: '0xFF5050' })),
      ...keyViewer(r.keys, r.t0, end, ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF', 'KeyE'])].join(',');
    const out = path.join(CLIPS, 'rt_feat_easy_cruise_autogrind.mp4');
    cfr60(r.file, out, vf);
    const evenT = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 0.5)) / n);
    const items = [...evenT(0.1, M.ollie, 5).map((t) => [t, t < (M.steer ?? 99) ? 'cruise' : 'steer']), [M.ollie + 0.12, 'ollie'], [M.ollie + 0.3, 'air']];
    if (M.grind != null) items.push(...evenT(M.grind, M.grindEnd ?? M.grind + 2, 3).map((t) => [t, 'grind']));
    items.push([M.carve + 0.3, 'carve'], [end - 0.2, 'end']);
    sheet(out, 'rt_feat_easy_cruise_autogrind', items.slice(0, 12), 'rt_feat_easy_cruise_autogrind  |  Easy, real time 60 fps canvas capture, no E key');
    delete best.r;
    res.best = best; res.out = out; res.outProbe = probe(out);
  } finally { await s.browser.close(); }
  report.easy_cruise = res; saveReport();
}

// ------------------------------------------------------------------------------------------------ 4. bail + recovery in the main bowl
async function bailBowl() {
  const s = await open('&mode=pro');
  const res = { method: 'canvas.captureStream(60) + MediaRecorder, real time (bail forced by a per-step hook at y > -0.7 m on the E wall, as in tools/sim/recovery_browser.mjs); fixed side camera', takes: [] };
  const segs = [];
  let offset = 0;
  const items = [];
  try {
    for (const [mode, label] of [['pro', 'Pro  -  normal recovery'], ['easy', 'Easy  -  fast recovery']]) {
      if (mode !== 'pro') await reload(s, '&mode=' + mode);
      const { page } = s;
      const assist = await page.evaluate(() => ({ ...window.__skate.game.physics.assist }));
      await page.evaluate(() => {
        const g = window.__skate.game, ph = g.physics, step = ph.step.bind(ph);
        window.__bailArm = false;
        ph.step = (dt, inp) => { step(dt, inp); if (window.__bailArm && ph.mode === 'ride' && ph.pos.y > -0.7) { window.__bailArm = false; ph.toBail('back', 'test'); } };
        window.__skate.hud(false);
      });
      const cam = [-20.6, -0.9, 4.2, -16.6, -1.8, -0.4];
      await page.evaluate((c) => { const s = window.__skate; s.free(); s.teleport(-21, -2.3, 0.6, 90, 0); s.view(...c); }, cam);
      await wait(page, 900);
      await page.evaluate(() => window.__skate.events());
      await page.evaluate((c) => { const s = window.__skate; s.teleport(-21, -2.3, 0.6, 90, 6.0); s.view(...c); window.__bailArm = true; }, cam);
      await recStart(page);
      const bailed = await until(page, (q) => q.mode === 'bail', 3000);
      const back = bailed ? await until(page, (q) => q.mode === 'ride' && q.phase === 'ride', mode === 'pro' ? 18000 : 9000) : null;
      await wait(page, 1300);
      const r = await recStop(page, `bail_${mode}`);
      const bailEv = r.ev.find((e) => e.type === 'bail');
      const tB = bailEv ? r.v(bailEv.wall) : null;
      const ph = r.phases.map((p) => ({ t: r.v(p.wall), phase: p.phase, mode: p.mode, pos: p.pos }));
      const rideAgain = ph.find((p, i) => i > 0 && tB != null && p.t > tB && p.phase === 'ride' && p.mode === 'ride');
      const tk = { mode, assist, bailed: !!bailed, recovered: !!back, bailT: tB, ridingAfter: rideAgain && tB != null ? +(rideAgain.t - tB).toFixed(2) : null, phases: ph,
        restPos: ph.filter((p) => ['getup', 'walk', 'stepon'].includes(p.phase)).map((p) => p.pos), events: evSummary(r), medianFrameMs: r.medianFrameMs, longFrames: r.longFrames, raw: r.file, rawProbe: r.rawProbe };
      res.takes.push(tk);
      console.log('bail', mode, JSON.stringify({ bailed: tk.bailed, recovered: tk.recovered, ridingAfter: tk.ridingAfter, phases: ph.map((p) => `${p.phase}/${p.mode}@${p.t}`).join(' '), frameMs: tk.medianFrameMs, raw: tk.rawProbe }));
      const end = r.rawProbe?.dur ?? 10;
      const pcap = ph.filter((p, i) => i > 0 && p.t > 0).map((p, i, a) => dtext(`${p.phase}${p.mode !== 'ride' || p.phase !== 'ride' ? '' : ' (riding again)'}`, 20, 62, p.t, i + 1 < a.length ? a[i + 1].t : end, { size: 26, color: '0xFFD34D' }));
      const vf = [tag(`${mode === 'pro' ? 'Pro' : 'Easy'}  |  real time, true 60 fps canvas capture  |  fixed side camera`), dtext(label, 20, 16, null, null, { size: 30 }), ...pcap,
        ...(tk.ridingAfter != null ? [dtext(`riding again ${tk.ridingAfter.toFixed(2)} s after the bail`, 20, 102, rideAgain.t, end, { size: 26 })] : [])].join(',');
      const seg = path.join(WORK, `bail_${mode}_cfr.mp4`);
      cfr60(r.file, seg, vf);
      segs.push(seg);
      const pick = (name, dt = 0.15) => { const p = ph.find((q) => q.phase === name && (tB == null || q.t >= tB)); return p ? p.t + dt : null; };
      const want = mode === 'pro' ? [['bail', 0.12], ['bail', 0.6], ['lie', 0.3], ['getup', 0.4], ['walk', 0.5], ['stepon', 0.2]] : [['bail', 0.12], ['bail', 0.45], ['getup', 0.2], ['walk', 0.2], ['stepon', 0.15], ['ride', 0.4]];
      for (const [n, d] of want) { const t = pick(n, d); if (t != null) items.push([offset + Math.min(t, end - 0.05), `${mode} ${n}`]); }
      offset += probe(seg)?.dur ?? end;
    }
    const list = path.join(WORK, 'bail_concat.txt');
    fs.writeFileSync(list, segs.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n') + '\n');
    const out = path.join(CLIPS, 'rt_feat_bail_recovery_bowl.mp4');
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
    sheet(out, 'rt_feat_bail_recovery_bowl', items.slice(0, 12), 'rt_feat_bail_recovery_bowl  |  main bowl E wall bail, Pro then Easy, real time 60 fps canvas capture');
    res.out = out; res.outProbe = probe(out);
  } finally { await s.browser.close(); }
  report.bail_bowl = res; saveReport();
}

const JOBS = { f_flips: fFlips, pause_menu: pauseMenu, easy_cruise: easyCruise, bail_bowl: bailBowl };
for (const [k, fn] of Object.entries(JOBS)) {
  if (ONLY && !ONLY.includes(k)) continue;
  const t = Date.now();
  try { await fn(); } catch (e) { console.log('ERROR', k, e?.stack ?? e); report[k] = { ...(report[k] ?? {}), error: String(e?.stack ?? e) }; saveReport(); }
  console.log(k, 'done in', ((Date.now() - t) / 1000).toFixed(1), 's');
}
