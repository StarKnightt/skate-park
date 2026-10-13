// Load a deployed (or local) build once in headed Chrome on the main monitor and report console errors.
// node tools/capture/live_check.mjs [--url https://starknightt.github.io/skate-park/] [--out E:/shots/skate-park/pass-04/deploy] [--name live]
//   [--checks]  also run pass-4 UI checks (Easy default, pause menu) through window.__skate (needs ?test)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const url = opt('url', 'https://starknightt.github.io/skate-park/');
const out = opt('out', 'E:/shots/skate-park/pass-04/deploy');
const name = opt('name', 'live');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false,
  args: ['--window-position=60,40', '--window-size=1300,860', '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--ignore-gpu-blocklist', '--disable-features=CalculateNativeWinOcclusion'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const logs = [];
const failed = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.url()} HTTP ${r.status()}`); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('.loading.done', { timeout: 120000 }).catch(() => logs.push('[check] loading overlay never finished'));
const loadMs = Date.now() - t0;
await page.waitForTimeout(5000);
await page.screenshot({ path: path.join(out, `${name}_t5s.png`) });
const info = await page.evaluate(() => ({
  canvas: !!document.querySelector('canvas'),
  title: document.title,
  hud: [...document.querySelectorAll('.hud *')].slice(0, 0).length,
}));
const report = { url, loadMs, ...info, consoleErrors: logs, failedRequests: failed };
if (args.includes('--checks')) {
  report.checks = await page.evaluate(() => {
    const s = window.__skate;
    return s?.uiReport ? s.uiReport() : 'no __skate.uiReport (add ?test)';
  });
}
fs.writeFileSync(path.join(out, `${name}_report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
