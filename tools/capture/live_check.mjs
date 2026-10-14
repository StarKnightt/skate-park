// Load a deployed (or local production) build in headed Chrome on the second monitor (DISPLAY2), play a few seconds with real input
// and report console errors, failed requests, the default control mode and whether the pause menu opens and closes.
// node tools/capture/live_check.mjs [--url https://starknightt.github.io/skate-park/] [--out E:/shots/skate-park/pass-04/deploy] [--name live]
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
  // second monitor only (DISPLAY2, x >= 1920); the 1280x720 viewport is emulated inside the smaller window
  args: ['--window-position=1930,20', '--window-size=1060,900', '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--ignore-gpu-blocklist', '--disable-features=CalculateNativeWinOcclusion'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const logs = [];
const failed = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.url()} HTTP ${r.status()}`); });
const shot = (n) => page.screenshot({ path: path.join(out, `${name}_${n}.png`) });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
const loaded = await page.waitForFunction(() => { const l = document.querySelector('.loading'); return !l || l.classList.contains('done'); },
  null, { timeout: 120000 }).then(() => true, () => false);
const report = { url, loaded, loadMs: Date.now() - t0 };
await page.waitForTimeout(3000);
await shot('01_t3s');
report.storedMode = await page.evaluate(() => localStorage.getItem('skate.controlMode'));
report.hudText = await page.evaluate(() => (document.querySelector('.hud')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 400));
const menuShown = () => page.evaluate(() => { const m = document.querySelector('.pause'); return !!m && getComputedStyle(m).display !== 'none' && m.classList.contains('show'); });
// ride a little with real keys
await page.mouse.move(640, 400);
await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
await page.keyboard.down('KeyD'); await page.waitForTimeout(600); await page.keyboard.up('KeyD');
await page.waitForTimeout(1500);
await shot('02_riding');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
report.menuOpenAfterEsc = await menuShown();
await shot('03_pause_menu');
const resume = page.locator('.pause button', { hasText: /resume/i }).first();
if (await resume.count()) { await resume.click(); await page.waitForTimeout(600); }
report.menuOpenAfterResume = await menuShown();
await page.waitForTimeout(1500);
await shot('04_resumed');
report.consoleErrors = logs;
report.failedRequests = failed;
fs.writeFileSync(path.join(out, `${name}_report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
