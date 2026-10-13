// Headed Chrome test/capture harness (second screen, frame-stepped deterministic capture).
// node tools/capture/run.mjs <scenario.mjs> [--url http://127.0.0.1:5188/] [--out E:/shots/skate-park/pass-01] [--w 1280 --h 720] [--mobile]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const scenario = args[0];
const url = opt('url', 'http://127.0.0.1:5188/');
const out = opt('out', 'E:/shots/skate-park/pass-01');
const W = Number(opt('w', 1280)), H = Number(opt('h', 720));
const query = opt('q', 'test&fps=30&mute');
fs.mkdirSync(out, { recursive: true });

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: chrome, headless: false,
  args: ['--window-position=1950,40', `--window-size=1060,${Math.min(1800, H + 160)}`, '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', '--no-first-run',
    '--no-default-browser-check', '--disable-features=CalculateNativeWinOcclusion', '--ignore-gpu-blocklist'],
});
const mobile = flag('mobile');
const context = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 1,
  ...(mobile ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}),
});
const page = await context.newPage();
if (flag('nohmr')) {
  // inert Vite HMR socket: another agent's save can't reload the page mid-capture
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, send() {}, close() {}, addEventListener() {}, removeEventListener() {} };
      return new Real(url, protocols);
    };
  });
}
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(url + (url.includes('?') ? '&' : '?') + query, { waitUntil: 'load' });
await page.waitForFunction(() => window.__skate && window.__skate.ready, null, { timeout: 120000 });
await page.waitForTimeout(400);

const ctx = {
  page, out, logs,
  eval: (fn, a) => page.evaluate(fn, a),
  api: (method, ...a) => page.evaluate(([m, a]) => window.__skate[m](...a), [method, a]),
  async shot(name, opts = {}) {
    const p = path.join(out, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    await page.screenshot({ path: p, type: name.endsWith('.jpg') ? 'jpeg' : 'png', quality: name.endsWith('.jpg') ? (opts.quality ?? 90) : undefined });
    return p;
  },
  wait: (ms) => page.waitForTimeout(ms),
  /** frame-stepped recording: calls step(i) before each frame, saves JPG frames */
  async record(name, frames, step, fps = 30) {
    const dir = path.join(out, 'frames', name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < frames; i++) {
      if (step) await step(i);
      await page.evaluate((dt) => window.__skate.advance(1, dt), 1 / fps);
      await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
    }
    return dir;
  },
};
try {
  const mod = await import(pathToFileURL(path.resolve(scenario)).href);
  await mod.default(ctx);
} catch (e) {
  logs.push('[harness] ' + (e?.stack ?? e));
}
const logPath = opt('log', path.join(out, 'console.log'));
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(logPath, logs.join('\n'));
console.log('console messages:', logs.length);
for (const l of logs.slice(0, 30)) console.log(l);
await browser.close();
