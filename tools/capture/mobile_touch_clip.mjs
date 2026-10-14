// Pass-5 real-time touch clip in mobile emulation. Headless Chrome (new headless: the real Chrome with the hardware GPU, no
// window, no focus change), iPhone-like 390x844 @3 portrait (--land: 844x390), iOS UA, isMobile + hasTouch (5 points),
// emulated env(safe-area-inset-*), and NO ?test: the real game (attract title "Tap to ride", Easy by default). Real CDP touch
// input; the touch UI is HTML, so the PAGE is recorded (CDP Page.startScreencast, compositor timestamps) and made constant
// 60 fps, with a caption band under the screen and touch markers drawn in the page. Flags, profile, insets and the touch
// helper follow E:/shots/skate-park/mobile-qa/tools/common.mjs. iPhone Safari has no element fullscreen: like mobile-qa
// hygiene.mjs, document.fullscreenEnabled is hidden so the pause menu shows its Add to Home Screen tip.
//   bash tools/heavy.sh media node tools/capture/mobile_touch_clip.mjs [--url http://127.0.0.1:5189/skate-park/] [--land]
//        [--out E:/shots/skate-park/pass-05] [--name touch_iphone_portrait] [--takes 2] [--keep]
// -> <out>/clips/mobile/<name>.mp4, <out>/sheets/mobile/<name>.jpg, <out>/clips/mobile/<name>.json (steps, DOM checks, rates)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, CHROME } from '../realtime/common.mjs';
import { dtext } from '../realtime/media_common.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const LAND = flag('land');
const URL0 = opt('url', 'http://127.0.0.1:5188/');
const OUT = opt('out', 'E:/shots/skate-park/pass-05');
const NAME = opt('name', LAND ? 'touch_iphone_landscape' : 'touch_iphone_portrait');
const TAKES = Number(opt('takes', 2));
const CLIPS = path.join(OUT, 'clips', 'mobile'), SHEETS = path.join(OUT, 'sheets', 'mobile'), WORK = path.join(OUT, 'dev', 'media', 'mobile');
for (const d of [CLIPS, SHEETS, WORK]) fs.mkdirSync(d, { recursive: true });
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SHEET_PY = path.join(HERE, '..', 'realtime', 'media_sheet.py');

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const VP = LAND ? { width: 844, height: 390 } : { width: 390, height: 844 };
const INSETS = LAND ? { top: 0, bottom: 21, left: 47, right: 47 } : { top: 47, bottom: 34, left: 0, right: 0 };
const SW = LAND ? 1280 : 720, SH = Math.round((SW * VP.height) / VP.width / 2) * 2, BAND = LAND ? 128 : 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** CDP touchEnd releases the listed points (Chrome 155), so every call lists only the finger it changes */
class Touch {
  constructor(cdp) { this.cdp = cdp; this.pts = new Map(); this.id = 1; }
  send(type, pts = [...this.pts.values()]) {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 9, radiusY: 9, force: 1 })) });
  }
  async down(x, y) { const id = this.id++; const p = { x, y, id }; this.pts.set(id, p); await this.send('touchStart', [p]); return id; }
  async move(id, x, y) { const p = this.pts.get(id); if (!p) return; p.x = x; p.y = y; await this.send('touchMove'); }
  async glide(id, x, y, ms = 200) {
    const p = this.pts.get(id); if (!p) return;
    const x0 = p.x, y0 = p.y, n = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= n; i++) { const k = i / n, e = k * k * (3 - 2 * k); await this.move(id, x0 + (x - x0) * e, y0 + (y - y0) * e); await sleep(ms / n); }
  }
  async up(id) { const p = this.pts.get(id); if (!p) return; this.pts.delete(id); await this.send('touchEnd', [p]); }
  async tap(x, y, hold = 110) { const id = await this.down(x, y); await sleep(hold); await this.up(id); }
  async releaseAll() { for (const id of [...this.pts.keys()]) await this.up(id); }
}

// ------------------------------------------------------------------------------------------------ page side (init scripts)
function inertHmr() {
  const Real = window.WebSocket;
  window.WebSocket = function (u, protocols) {
    if (String(protocols).includes('vite-hmr')) return { readyState: 0, send() {}, close() {}, addEventListener() {}, removeEventListener() {} };
    return new Real(u, protocols);
  };
}
function noElementFullscreen() {
  Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => false });
}
/** a ring at every active touch point (fades after the lift); pointer-events none, so hit testing never sees it */
function touchMarks() {
  const add = () => {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;overflow:hidden';
    document.documentElement.appendChild(layer);
    const dots = new Map();
    const put = (e) => {
      if (e.pointerType !== 'touch') return;
      let d = dots.get(e.pointerId);
      if (!d) {
        d = document.createElement('div');
        d.style.cssText = 'position:absolute;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.42);border:3px solid rgba(25,25,30,.8);box-shadow:0 0 0 2px rgba(255,255,255,.75);transition:opacity .4s';
        layer.appendChild(d); dots.set(e.pointerId, d);
      }
      d.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
    };
    const off = (e) => { const d = dots.get(e.pointerId); if (!d) return; dots.delete(e.pointerId); d.style.opacity = '0'; setTimeout(() => d.remove(), 450); };
    for (const t of ['pointerdown', 'pointermove']) addEventListener(t, put, true);
    for (const t of ['pointerup', 'pointercancel']) addEventListener(t, off, true);
  };
  if (document.documentElement) add(); else addEventListener('DOMContentLoaded', add);
}
/** HUD state changes with wall times (title, trick popup, bail, toast, AUTO lit, pause menu, Add to Home tip) */
function domLog() {
  const q = (s) => document.querySelector(s);
  const L = (window.__dl = { rows: [], last: '' });
  const snap = () => ({
    title: !!q('.titlecard.show'), touch: !!q('.touch.on'), mode: q('.touch')?.dataset.mode ?? null,
    trick: q('.hud .trick .name.show')?.textContent ?? '', bail: !!q('.hud .trick .name.bail.show'),
    toast: q('.toast') && !q('.toast').classList.contains('hide') ? q('.toast').textContent : '',
    auto: !!q('.touch .autobtn.on'), paused: !!q('.pause.show'), tip: q('.pause .fstip')?.textContent ?? '', fsRow: !!q('.pause .row.fs'),
  });
  L.snap = snap;
  const tick = () => {
    const s = snap(), k = JSON.stringify(s);
    if (k !== L.last) { L.last = k; L.rows.push({ wall: performance.timeOrigin + performance.now(), ...s }); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------------------------------------ helpers
function probe(file) {
  const o = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets,width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  try {
    const j = JSON.parse(o.stdout), st = j.streams[0], dur = +j.format.duration;
    return { frames: +st.nb_read_packets, dur: +dur.toFixed(3), fps: +(st.nb_read_packets / dur).toFixed(2), w: st.width, h: st.height, rate: st.r_frame_rate };
  } catch { return null; }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(2) : null; };

async function take(browser, k) {
  const context = await browser.newContext({ viewport: VP, screen: VP, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  for (const f of [inertHmr, noElementFullscreen, touchMarks]) await page.addInitScript(f);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  let insets = true;
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: INSETS.top, topMax: INSETS.top, left: INSETS.left, leftMax: INSETS.left, bottom: INSETS.bottom, bottomMax: INSETS.bottom, right: INSETS.right, rightMax: INSETS.right } });
  } catch { insets = false; }
  const tLoad = Date.now();
  await page.goto(URL0, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => { const l = document.querySelector('.loading'); return !l || l.classList.contains('done'); }, null, { timeout: 120000 });
  const loadS = (Date.now() - tLoad) / 1000;
  await page.waitForSelector('.titlecard.show', { timeout: 15000 }).catch(() => {});
  await page.evaluate(domLog);
  await sleep(1200); // the attract lap gets going under the title card
  const touch = new Touch(cdp);
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, w: r.width, h: r.height, b: r.bottom, r: r.right } : null; }, sel);
  const steps = [];
  const step = async (what) => { const o = await page.evaluate(() => ({ wall: performance.timeOrigin + performance.now(), ...window.__dl.snap() })); steps.push({ what, ...o }); return o; };

  // screencast: compositor frames of the whole page (canvas + HTML), timestamps kept
  const dir = path.join(WORK, `${NAME}_frames_take${k}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const sc = await context.newCDPSession(page);
  const frames = [];
  let on = true;
  sc.on('Page.screencastFrame', (f) => {
    sc.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!on) return;
    const file = path.join(dir, `s${String(frames.length).padStart(5, '0')}.jpg`);
    frames.push({ file, t: f.metadata.timestamp });
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  });
  await sc.send('Page.startScreencast', { format: 'jpeg', quality: 86, maxWidth: SW, maxHeight: SH, everyNthFrame: 1 });
  await sleep(1400);
  await step('title card: Tap to ride');

  // 1. tap the screen: the title goes, Easy takes over (he keeps rolling)
  await touch.tap(VP.width * 0.5, VP.height * (LAND ? 0.45 : 0.42), 120);
  await sleep(250); await step('tap -> ride (Easy)');
  await sleep(450);

  // 2. floating stick in the lower left (thumb 1). Released, he rolls straight on and the spawn line runs into a ledge, so
  //    the stick turns right at once and stays in a right-hand circle on the open flat while thumb 2 taps OLLIE / TRICK
  const z = await rect('.touch .stickzone');
  const sx = z ? z.l + Math.min(z.w * 0.5, 90) : 90, sy = z ? z.t + z.h * 0.62 : VP.height - 150;
  const sid = await touch.down(sx, sy);
  await step('stick down');
  await touch.glide(sid, sx + 50, sy - 4, 220); await sleep(1200);
  await touch.glide(sid, sx + 18, sy - 4, 320); await sleep(800);
  await touch.glide(sid, sx + 42, sy - 4, 260); await sleep(500);

  // 3. OLLIE, then TRICK, the stick still held (the circle drifts towards the quarter pipe: no third trick)
  const tapEl = async (sel, what, after) => { const r = await rect(sel); if (r) await touch.tap(r.x, r.y, 120); await sleep(180); const o = await step(what + (r ? '' : ' (not found)')); await sleep(after); return o; };
  await tapEl('.touch .ollie', 'OLLIE', 1500);
  await tapEl('.touch .flipbtn', 'TRICK', 1700);
  await touch.glide(sid, sx + 10, sy - 2, 160);
  await touch.up(sid);
  await step('stick released');
  await sleep(120);

  // 4. AUTO: auto-ride on, its toast at the top
  await tapEl('.touch .autobtn', 'AUTO', 3000);

  // 5. pause button -> pause menu; scroll to the Add to Home Screen tip if it is below the fold; Resume
  await tapEl('.touch .pausebtn', 'pause button', 1300);
  const vis = () => page.evaluate(() => {
    const p = document.querySelector('.pause .panel'), t = document.querySelector('.pause .fstip');
    if (!p || !t) return { panel: !!p, tip: !!t };
    const a = p.getBoundingClientRect(), b = t.getBoundingClientRect();
    return { panel: true, tip: true, inView: b.top >= a.top && b.bottom <= a.bottom, scrollTop: p.scrollTop, scrollable: p.scrollHeight > p.clientHeight + 2, panelRect: [a.left, a.top, a.width, a.height].map(Math.round) };
  });
  const v0 = await vis();
  let swiped = false;
  if (v0.tip && !v0.inView) {
    const [pl, pt, , ph] = v0.panelRect;
    const id = await touch.down(pl + 40, pt + ph * 0.8);
    await touch.glide(id, pl + 40, pt + ph * 0.25, 450); await sleep(120); await touch.up(id);
    swiped = true;
    await sleep(700);
  }
  const v1 = await vis();
  steps.push({ what: 'Add to Home Screen tip', wall: (await page.evaluate(() => performance.timeOrigin + performance.now())), ...v1, ...(await page.evaluate(() => window.__dl.snap())) });
  await sleep(1800);
  if (swiped) {
    const [pl, pt, , ph] = v0.panelRect;
    const id = await touch.down(pl + 40, pt + ph * 0.3);
    await touch.glide(id, pl + 40, pt + ph * 0.9, 400); await sleep(120); await touch.up(id);
    await sleep(600);
  }
  await tapEl('.pause [data-act="resume"]', 'Resume', 2200);
  await touch.releaseAll();
  on = false;
  await sc.send('Page.stopScreencast').catch(() => {});
  const dl = await page.evaluate(() => window.__dl.rows);
  await context.close();
  return { k, loadS, insets, steps, dl, frames, dir, logs, tipCheck: { before: v0, after: v1, swiped } };
}

function encode(r, out) {
  const { frames, steps, dl } = r;
  const f0 = frames[0].t;
  const T = (wall) => wall / 1000 - f0;
  const list = path.join(r.dir, 'list.ffconcat');
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 1 / 60;
    lines.push(`file '${path.basename(frames[i].file)}'`, `duration ${d.toFixed(6)}`);
  }
  lines.push(`file '${path.basename(frames[frames.length - 1].file)}'`);
  fs.writeFileSync(list, lines.join('\n') + '\n');
  const end = frames[frames.length - 1].t - f0;
  const at = (what) => { const s = steps.find((x) => x.what.startsWith(what)); return s ? T(s.wall) : null; };
  const caps = [
    [0, 'title card  -  Tap to ride'],     [at('tap'), 'tap  ->  ride (Easy mode)'], [at('stick down'), 'floating stick: drag to steer'],
    [at('OLLIE'), 'stick held + OLLIE tap'], [at('TRICK'), 'TRICK tap  ->  flip trick'],
    [at('AUTO'), 'AUTO  ->  auto-ride on'], [at('pause button'), 'pause button  ->  pause menu'],
    [at('Add to Home'), 'iPhone: Add to Home Screen tip'], [at('Resume'), 'Resume'],
  ].filter((c) => c[0] != null);
  const ys = SH + (LAND ? 40 : 46), yg = SH + (LAND ? 86 : 100);
  const vf = [`fps=60`, `scale=${SW}:${SH}:flags=lanczos`, `pad=${SW}:${SH + BAND}:0:0:color=0x16161a`,
    dtext(`iPhone-like ${VP.width}x${VP.height} @3x ${LAND ? 'landscape' : 'portrait'}  |  real time  |  CDP touch  |  page screencast`, 14, SH + 10, null, null, { size: LAND ? 20 : 17, color: 'white@0.7', box: '0x16161a@1' }),
    ...caps.map(([t, l], i) => dtext(l, 14, ys, Math.max(0, t - 0.25), i + 1 < caps.length ? caps[i + 1][0] - 0.25 : end + 1, { size: LAND ? 34 : 31, box: '0x16161a@1' }))];
  // game feedback read from the page: trick popups, bails, toasts, menu
  const fb = [];
  let prev = {};
  for (const row of dl) {
    const t = T(row.wall);
    if (row.trick && row.trick !== prev.trick) fb.push([t, `(game) ${row.bail ? 'BAIL' : row.trick}`]);
    if (row.toast && row.toast !== prev.toast) fb.push([t, `(game) toast: ${row.toast}`]);
    if (row.paused && !prev.paused) fb.push([t, '(game) paused, menu open']);
    if (!row.paused && prev.paused) fb.push([t, '(game) resumed']);
    if (!row.title && prev.title) fb.push([t, '(game) title gone, riding']);
    prev = row;
  }
  for (let i = 0; i < fb.length; i++) {
    const [t, l] = fb[i], b = Math.min(t + 1.8, i + 1 < fb.length ? fb[i + 1][0] : end + 1);
    vf.push(dtext(l, 14, yg, t, b, { size: LAND ? 28 : 26, color: '0xFFD34D', box: '0x16161a@1' }));
  }
  vf.push('format=yuv420p');
  const st = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', vf.join(','),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-threads', '4', '-movflags', '+faststart', out], { stdio: 'inherit', cwd: 'C:/Windows/Fonts' }).status;
  return { status: st, caps: caps.map(([t, l]) => [+t.toFixed(2), l]), feedback: fb.map(([t, l]) => [+t.toFixed(2), l]), end: +end.toFixed(2) };
}

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--disable-features=CalculateNativeWinOcclusion',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio'],
});
const report = { url: URL0, profile: { viewport: VP, dsf: 3, ua: IOS_UA, insets: INSETS, landscape: LAND }, takes: [] };
let best = null;
try {
  for (let k = 0; k < TAKES && !best?.clean; k++) {
    const r = await take(browser, k);
    const bails = r.dl.filter((x) => x.bail).length > 0;
    const gaps = r.frames.slice(1).map((f, i) => (f.t - r.frames[i].t) * 1000);
    const dur = r.frames.length ? r.frames[r.frames.length - 1].t - r.frames[0].t : 0;
    const sum = { take: k, loadS: +r.loadS.toFixed(1), insetsEmulated: r.insets, frames: r.frames.length, seconds: +dur.toFixed(2), avgFps: +(r.frames.length / Math.max(dur, 0.001)).toFixed(1),
      medianFrameMs: median(gaps), framesOver50ms: gaps.filter((g) => g > 50).length, bails, tipCheck: r.tipCheck, logs: r.logs,
      steps: r.steps.map((s) => ({ what: s.what, t: r.frames.length ? +(s.wall / 1000 - r.frames[0].t).toFixed(2) : null, title: s.title, mode: s.mode, trick: s.trick, toast: s.toast, auto: s.auto, paused: s.paused, tip: s.tip, fsRow: s.fsRow })) };
    report.takes.push(sum);
    console.log('take', k, JSON.stringify({ load: sum.loadS, frames: sum.frames, s: sum.seconds, fps: sum.avgFps, med: sum.medianFrameMs, bails, tip: r.tipCheck.after }));
    console.log(sum.steps.map((s) => `${s.t}s ${s.what}: title=${s.title} mode=${s.mode} trick=${s.trick} toast=${s.toast} auto=${s.auto} paused=${s.paused} tip=${!!s.tip} fsRow=${s.fsRow}`).join('\n'));
    if (!best || (!bails && best.bails)) { if (best && !flag('keep')) fs.rmSync(best.r.dir, { recursive: true, force: true }); best = { r, bails, clean: !bails && r.frames.length > 100 }; }
    else if (!flag('keep')) fs.rmSync(r.dir, { recursive: true, force: true });
  }
  const out = path.join(CLIPS, NAME + '.mp4');
  const enc = encode(best.r, out);
  report.best = best.r.k; report.encode = enc; report.out = out; report.outProbe = probe(out);
  const f0 = best.r.frames[0].t, T = (w) => w / 1000 - f0, s = best.r.steps;
  const at = (what, d = 0) => { const x = s.find((y) => y.what.startsWith(what)); return x ? T(x.wall) + d : null; };
  const items = [[0.5, 'title: Tap to ride'], [at('tap', 0.3), 'riding (Easy)'], [at('stick down', 0.9), 'stick: hard right'], [at('stick down', 2.0), 'stick: gentle right'],
    [at('stick down', 2.8), 'stick: right'], [at('OLLIE', 0.15), 'OLLIE (stick held)'], [at('TRICK', 0.25), 'TRICK flip'], [at('TRICK', 0.6), 'TRICK flip, landing'],
    [at('AUTO', 0.4), 'AUTO: toast at the top'], [at('pause button', 0.6), 'pause menu'], [at('Add to Home', 0.5), 'Add to Home Screen tip'], [at('Resume', 0.8), 'resumed']]
    .filter((x) => x[0] != null);
  const tj = path.join(WORK, NAME + '_sheet.json');
  fs.writeFileSync(tj, JSON.stringify(items));
  spawnSync('python', [SHEET_PY, out, path.join(SHEETS, NAME + '.jpg'), tj, LAND ? '4' : '6', `${NAME}  |  real time, iPhone-like ${VP.width}x${VP.height} @3x, CDP touch, page screencast -> 60 fps CFR`], { stdio: 'inherit' });
  report.sheet = path.join(SHEETS, NAME + '.jpg');
  if (!flag('keep')) fs.rmSync(best.r.dir, { recursive: true, force: true });
  console.log('out', out, JSON.stringify(report.outProbe));
} catch (e) {
  report.error = String(e?.stack ?? e);
  console.log('ERROR', report.error);
} finally {
  fs.writeFileSync(path.join(CLIPS, NAME + '.json'), JSON.stringify(report, null, 1));
  await browser.close();
}
