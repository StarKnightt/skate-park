// Shared helpers for the mobile QA scripts (read-only against the game; every output goes under $MQA_OUT).
// Run every browser script through the heavy-job lock, from the repository root:
//   bash tools/heavy.sh mobileqa node tools/mobile-qa/<script>.mjs [--url ...]
// Browsers run headless (new headless = the real Chrome with the hardware GPU, no window, no focus change). Pass
// --headed to see the window: it is placed on the second monitor (DISPLAY2, X 1920..3000, portrait 1080x1920).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../package.json', import.meta.url));
export const { chromium } = require('playwright-core');

export const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// data/ and shots/ go to MQA_OUT; the default keeps the original QA report's data in E:/shots/skate-park/mobile-qa/{data,shots}
export const OUT = process.env.MQA_OUT || 'E:/shots/skate-park/mobile-qa/rerun';
export const SHOTS = path.join(OUT, 'shots');
export const DATA = path.join(OUT, 'data');
export const LIVE = 'https://starknightt.github.io/skate-park/';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INSTRUMENT = fs.readFileSync(path.join(HERE, 'instrument.js'), 'utf8');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(DATA, { recursive: true });

export const argv = process.argv.slice(2);
export const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
export const flag = (k) => argv.includes('--' + k);
export const BASE_URL = opt('url', LIVE);

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';
const ANDROID_SMALL_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';

/** device profiles from the brief; insets = env(safe-area-inset-*) to emulate (CSS px), per orientation */
export const PROFILES = {
  iphone: { key: 'iphone', name: 'iPhone-like 390x844 @3x', w: 390, h: 844, dsf: 3, ua: IOS_UA,
    insets: { portrait: { top: 47, bottom: 34, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 47, right: 47 } } },
  android: { key: 'android', name: 'Android mid-range 412x915 @2.625', w: 412, h: 915, dsf: 2.625, ua: ANDROID_UA,
    insets: { portrait: { top: 0, bottom: 0, left: 0, right: 0 }, landscape: { top: 0, bottom: 0, left: 0, right: 0 } } },
  small: { key: 'small', name: 'small Android 360x800 @3', w: 360, h: 800, dsf: 3, ua: ANDROID_SMALL_UA,
    insets: { portrait: { top: 0, bottom: 0, left: 0, right: 0 }, landscape: { top: 0, bottom: 0, left: 0, right: 0 } } },
  ipad: { key: 'ipad', name: 'iPad-like 820x1180 @2', w: 820, h: 1180, dsf: 2, ua: IPAD_UA,
    insets: { portrait: { top: 0, bottom: 20, left: 0, right: 0 }, landscape: { top: 0, bottom: 20, left: 0, right: 0 } } },
  // what a page really gets inside the browser UI (no scrolling page = the toolbars never collapse)
  iphoneSafari: { key: 'iphoneSafari', name: 'iPhone Safari visible viewport 390x664 @3x (bottom tab bar)', w: 390, h: 664, dsf: 3, ua: IOS_UA,
    insets: { portrait: { top: 0, bottom: 0, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 47, right: 47 } }, landscapeSize: [844, 340] },
  androidChrome: { key: 'androidChrome', name: 'Android Chrome visible viewport 412x780 @2.625 (URL bar + nav bar)', w: 412, h: 780, dsf: 2.625, ua: ANDROID_UA,
    insets: { portrait: { top: 0, bottom: 0, left: 0, right: 0 }, landscape: { top: 0, bottom: 0, left: 0, right: 0 } }, landscapeSize: [915, 360] },
};

/** DevTools "Fast 4G" preset: 9 Mbps x 0.9 down, 1.5 Mbps x 0.9 up, 60 ms x 2.75 RTT */
export const FAST_4G = { offline: false, latency: 165, downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (1.5e6 / 8) * 0.9 };
export const SLOW_4G = { offline: false, latency: 562.5, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (0.75e6 / 8) * 0.9 };

export async function launch({ headed = flag('headed'), args = [] } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: !headed,
    args: ['--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--disable-features=CalculateNativeWinOcclusion',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      // headed runs: second monitor only (DISPLAY2 X 1920..3000)
      '--window-position=1960,40', '--window-size=1000,1800', ...args],
  });
  return browser;
}

export function dims(prof, landscape) {
  if (!landscape) return { width: prof.w, height: prof.h };
  if (prof.landscapeSize) return { width: prof.landscapeSize[0], height: prof.landscapeSize[1] };
  return { width: prof.h, height: prof.w };
}

/** a context emulating the device (viewport, DPR, isMobile, hasTouch, UA) + a page with the QA instrumentation */
export async function mobilePage(browser, prof, { landscape = false, cfg = null, insets = true } = {}) {
  const vp = dims(prof, landscape);
  const context = await browser.newContext({
    viewport: vp, screen: vp, deviceScaleFactor: prof.dsf, isMobile: true, hasTouch: true, userAgent: prof.ua,
  });
  const page = await context.newPage();
  if (cfg) await page.addInitScript((c) => { window.__QA_CFG = c; }, cfg);
  await page.addInitScript(INSTRUMENT);
  const cdp = await context.newCDPSession(page);
  // Playwright's hasTouch reports maxTouchPoints 1; phones report 5 (iOS) / 10 (Android) and the tests use 3 fingers
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const logs = [], failed = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  if (insets) await setInsets(cdp, prof.insets[landscape ? 'landscape' : 'portrait']);
  return { context, page, cdp, logs, failed, vp, prof, landscape };
}

/** env(safe-area-inset-*) emulation (CDP Emulation.setSafeAreaInsetsOverride); returns false when unsupported */
export async function setInsets(cdp, i) {
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: i.top, topMax: i.top, left: i.left, leftMax: i.left, bottom: i.bottom, bottomMax: i.bottom, right: i.right, rightMax: i.right } });
    return true;
  } catch { return false; }
}

export async function rotate(m, landscape) {
  const vp = dims(m.prof, landscape);
  await m.page.setViewportSize(vp);
  await setInsets(m.cdp, m.prof.insets[landscape ? 'landscape' : 'portrait']);
  m.vp = vp; m.landscape = landscape;
  return vp;
}

export const cpu = (cdp, rate) => cdp.send('Emulation.setCPUThrottlingRate', { rate });
export async function network(cdp, cond) {
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', cond);
}

/**
 * Real multi-touch through CDP Input.dispatchTouchEvent (trusted touch + pointer events, several fingers at once).
 * Chrome 155 semantics (verified with debug_multitouch.mjs): touchStart presses the listed points, touchMove moves the
 * listed points, touchEnd RELEASES the listed points (listing the fingers that stay down lifts those instead), and
 * touchCancel takes no points and cancels every active one.
 */
export class Touch {
  constructor(cdp) { this.cdp = cdp; this.pts = new Map(); this.id = 1; }
  send(type, pts = [...this.pts.values()]) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 9, radiusY: 9, force: 1 })),
    });
  }
  async down(x, y) { const id = this.id++; const p = { x, y, id }; this.pts.set(id, p); await this.send('touchStart', [p]); return id; }
  async move(id, x, y) { const p = this.pts.get(id); if (!p) return; p.x = x; p.y = y; await this.send('touchMove'); }
  /** move in n steps over ms */
  async glide(id, x, y, ms = 120, n = 6) {
    const p = this.pts.get(id); if (!p) return;
    const x0 = p.x, y0 = p.y;
    for (let i = 1; i <= n; i++) { await this.move(id, x0 + (x - x0) * i / n, y0 + (y - y0) * i / n); await sleep(ms / n); }
  }
  async up(id) { const p = this.pts.get(id); if (!p) return; this.pts.delete(id); await this.send('touchEnd', [p]); }
  /** CDP: a touchCancel carries no touch points (every active point is cancelled) */
  async cancel() { this.pts.clear(); await this.send('touchCancel'); }
  async tap(x, y, hold = 60) { const id = await this.down(x, y); await sleep(hold); await this.up(id); }
  async releaseAll() { for (const id of [...this.pts.keys()]) await this.up(id); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** centre of the first element matching sel (CSS px), or null */
export async function center(page, sel) {
  return page.evaluate((s) => {
    const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top };
  }, sel);
}

export async function waitReady(page, test, timeout = 120000) {
  if (test) await page.waitForFunction(() => window.__skate && window.__skate.ready, null, { timeout });
  else await page.waitForFunction(() => { const l = document.querySelector('.loading'); return !l || l.classList.contains('done'); }, null, { timeout });
}

/** main JS bundle file name (index-<hash>.js) the page loaded */
export async function bundleName(page) {
  return page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => /assets\/index-.*\.js/.test(s))?.split('/').pop() ?? null);
}

export async function glInfo(page) {
  return page.evaluate(() => {
    const gl = window.__qa?.gl; if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      attrs: gl.getContextAttributes(),
    };
  });
}

export function save(name, obj) {
  const f = path.join(DATA, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  return f;
}
export function log(...a) { console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a); }
