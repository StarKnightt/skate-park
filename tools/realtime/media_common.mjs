// M2 media helpers: launcher with an emulated viewport (window on DISPLAY2 only), page-side canvas recorder (true 60 fps
// captureStream + MediaRecorder), CDP screencast recorder (page level, HTML included), Pointer Lock emulation, cursor overlay.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, CHROME } from './common.mjs';

/**
 * Page-side Pointer Lock emulation. The test window never takes the foreground from the user, so Chrome refuses a real
 * lock (and a real lock would confine the user's cursor to the test window). The game's own code path still runs:
 * canvas.requestPointerLock() -> pointerlockchange -> raw movementX/Y look; Esc while locked is consumed like the
 * browser does and releases the lock (the game then pauses).
 */
export function emulateLock() {
  if (window.__plEmu) return;
  let locked = null;
  const fire = () => setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')), 0);
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { return locked; } });
  Element.prototype.requestPointerLock = function () { if (locked !== this) { locked = this; fire(); } return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { if (locked) { locked = null; fire(); } };
  addEventListener('keydown', (e) => {
    if (!locked || e.code !== 'Escape') return;
    e.stopImmediatePropagation(); e.preventDefault();
    locked = null; fire();
  }, true);
  window.__plEmu = { get locked() { return !!locked; } };
}

/** a drawn mouse arrow (screencasts have no cursor); hidden while the pointer is locked */
export function cursorOverlay() {
  const add = () => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;will-change:transform';
    c.innerHTML = '<svg width="24" height="32" viewBox="0 0 22 30" style="position:absolute;left:-1px;top:-1px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><path d="M1 1 L1 23 L7 17.5 L11 27 L15 25.3 L11 16 L19 16 Z" fill="#fff" stroke="#111" stroke-width="1.4"/></svg>';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { if (document.pointerLockElement) return; c.style.display = ''; c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
    document.addEventListener('pointerlockchange', () => { c.style.display = document.pointerLockElement ? 'none' : ''; });
  };
  if (document.documentElement) add(); else addEventListener('DOMContentLoaded', add);
}

/** every real key event with performance.now(), capture phase before the game (and the lock emulation) sees it */
export function keyLogger() {
  window.__keys = [];
  for (const type of ['keydown', 'keyup']) addEventListener(type, (e) => { if (!e.repeat) window.__keys.push([performance.now(), type === 'keydown' ? 1 : 0, e.code]); }, true);
}

function inertHmr() {
  const Real = window.WebSocket;
  window.WebSocket = function (u, protocols) {
    if (String(protocols).includes('vite-hmr')) return { readyState: 0, send() {}, close() {}, addEventListener() {}, removeEventListener() {} };
    return new Real(u, protocols);
  };
}

export async function launchMedia({ url, viewport = { width: 1280, height: 720 }, winW = 1060, winH = 820, wx = 1930, wy = 20, lock = true, cursor = false }) {
  wx = Math.max(1930, wx); wy = Math.max(0, wy); winW = Math.min(winW, 1060); winH = Math.min(winH, 1840);
  const browser = await chromium.launch({
    executablePath: CHROME, headless: false,
    args: [`--window-position=${wx},${wy}`, `--window-size=${winW},${winH}`, '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', '--no-first-run',
      '--no-default-browser-check', '--disable-features=CalculateNativeWinOcclusion', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(inertHmr);
  await page.addInitScript(keyLogger);
  if (lock) await page.addInitScript(emulateLock);
  if (cursor) await page.addInitScript(cursorOverlay);
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__skate && window.__skate.ready, null, { timeout: 60000 });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      logs.push('[harness] load failed, retrying in 20 s: ' + String(e?.message ?? e).slice(0, 200));
      await page.waitForTimeout(20000);
    }
  }
  await page.waitForTimeout(500);
  return { browser, context, page, logs };
}

/** installs window.__recStart() / __recStop() (canvas.captureStream(60) + MediaRecorder, hardware H.264 when available) */
export function installRecorder() {
  window.__recStart = (bps) => new Promise((resolve) => {
    const stream = window.__skate.game.renderer.domElement.captureStream(60);
    const mime = ['video/mp4;codecs=avc1.640028', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps || 30000000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    window.__rec = { rec, chunks, t0: 0, mime };
    rec.onstart = () => { window.__rec.t0 = performance.now(); resolve(mime); };
    rec.start(250);
  });
  window.__recStop = () => new Promise((resolve) => {
    const r = window.__rec;
    r.rec.onstop = async () => {
      const buf = new Uint8Array(await new Blob(r.chunks, { type: r.mime }).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      resolve({ b64: btoa(s), t0: r.t0, mime: r.mime });
    };
    r.rec.stop();
  });
}

export async function saveRecording(page, file) {
  const r = await page.evaluate(() => window.__recStop());
  const f = file.replace(/\.\w+$/, r.mime.includes('mp4') ? '.mp4' : '.webm');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(r.b64, 'base64'));
  return { file: f, t0: r.t0, mime: r.mime };
}

/** page-level CDP screencast (composited page: canvas + HTML); frames keep their compositor timestamps */
export async function startScreencast(page, dir, { maxWidth = 1280, maxHeight = 720, quality = 88 } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let on = true;
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!on) return;
    const file = path.join(dir, `s${String(frames.length).padStart(5, '0')}.jpg`);
    frames.push({ file, t: f.metadata.timestamp, perf: null });
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame: 1 });
  return {
    frames,
    async stop() { on = false; await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.detach().catch(() => {}); return frames; },
  };
}

/** ffmpeg runs in the Windows font folder so drawtext can use fontfile=arialbd.ttf (all other paths are absolute) */
const FONT_CWD = 'C:/Windows/Fonts';

/** screencast frames -> constant 60 fps H.264 (each frame held until the next one arrived) */
export function encodeScreencast(frames, out, vf = '') {
  const list = path.join(path.dirname(frames[0].file), 'list.ffconcat');
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 1 / 60;
    lines.push(`file '${path.basename(frames[i].file)}'`, `duration ${d.toFixed(6)}`);
  }
  lines.push(`file '${path.basename(frames[frames.length - 1].file)}'`);
  fs.writeFileSync(list, lines.join('\n') + '\n');
  return spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=60,scale=1280:720:flags=lanczos' + (vf ? ',' + vf : '') + ',format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-threads', '4', '-movflags', '+faststart', out], { stdio: 'inherit', cwd: FONT_CWD }).status;
}

/** variable-rate canvas recording -> constant 60 fps (optional extra -vf filters, e.g. drawtext captions) */
export function cfr60(src, out, vf = '') {
  return spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', 'fps=60' + (vf ? ',' + vf : '') + ',format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-threads', '4', '-movflags', '+faststart', out], { stdio: 'inherit', cwd: FONT_CWD }).status;
}

/** drawtext filter (font from FONT_CWD); a/b: shown between those video times (s), always when a is null */
export function dtext(text, x, y, a = null, b = null, { size = 28, color = 'white', box = 'black@0.55' } = {}) {
  const t = String(text).replace(/[':\\%]/g, ' ');
  const en = a == null ? '' : `:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'`;
  return `drawtext=fontfile=arialbd.ttf:text='${t}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}:box=1:boxcolor=${box}:boxborderw=8${en}`;
}

/** key viewer captions from a key log ([perf ms, 1 down / 0 up, code]) relative to the recording start t0 (perf ms) */
export function keyViewer(keys, t0, end, codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF', 'Escape'], y = 'h-58') {
  const label = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', Space: 'Space', KeyF: 'F', KeyE: 'E', Escape: 'Esc' };
  const f = [];
  let x = 20;
  for (const c of codes) {
    const L = label[c] ?? c;
    f.push(dtext(L, x, y, null, null, { size: 26, color: 'white@0.45', box: 'black@0.35' }));
    let down = null;
    for (const [t, d, code] of keys) {
      if (code !== c) continue;
      if (d && down === null) down = (t - t0) / 1000;
      else if (!d && down !== null) { const u = (t - t0) / 1000; f.push(dtext(L, x, y, down, Math.max(u, down + 0.1), { size: 26, color: '0x1a1a1a', box: '0xFFD34D@0.95' })); down = null; }
    }
    if (down !== null) f.push(dtext(L, x, y, down, end, { size: 26, color: '0x1a1a1a', box: '0xFFD34D@0.95' }));
    x += L.length > 1 ? 30 + 15 * L.length : 46;
  }
  return f;
}
