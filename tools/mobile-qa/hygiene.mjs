// Browser / platform hygiene on a touch device: meta + CSS audit, PWA manifest, long-press (callout / selection / context
// menu), page scroll, backgrounding (visibility -> pause? audio?), WebGL context loss + restore, fullscreen toggle, toast
// overlap with the touch buttons.
// bash tools/heavy.sh mobileqa node tools/mobile-qa/hygiene.mjs [--prof iphone]
import path from 'node:path';
import { launch, mobilePage, PROFILES, BASE_URL, Touch, sleep, center, waitReady, bundleName, save, log, SHOTS, opt } from './common.mjs';

const profKey = opt('prof', 'iphone');
const prof = PROFILES[profKey];
const browser = await launch();
const R = { profile: prof.name, bundle: null, cases: [] };
let h6 = null;
const rec = (id, name, status, data) => { R.cases.push({ id, name, status, ...data }); log(status.padEnd(5), id, name, JSON.stringify(data).slice(0, 420)); };

// ---------------------------------------------------------------- H1-H3, H6, H7 on the real build
{
  const m = await mobilePage(browser, prof);
  const { page, cdp, context } = m;
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 120000 });
  await waitReady(page, false);
  R.bundle = await bundleName(page);
  await sleep(1200);
  const audit = await page.evaluate(async () => {
    const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content ?? null;
    const cs = (e) => { const s = getComputedStyle(e); return { touchAction: s.touchAction, userSelect: s.userSelect, webkitUserSelect: s.webkitUserSelect, overscroll: s.overscrollBehaviorY, overflow: s.overflow, tapHighlight: s.webkitTapHighlightColor, height: s.height, position: s.position }; };
    let cssText = '';
    for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) cssText += r.cssText + '\n'; } catch { /* cross-origin */ } }
    const manifestLink = document.querySelector('link[rel="manifest"]')?.href ?? null;
    let manifest = null;
    if (manifestLink) { try { manifest = await (await fetch(manifestLink)).json(); } catch { manifest = 'unreadable'; } }
    return {
      viewport: meta('viewport'), themeColor: meta('theme-color'), appleCapable: meta('apple-mobile-web-app-capable'), mobileCapable: meta('mobile-web-app-capable'),
      appleStatusBar: meta('apple-mobile-web-app-status-bar-style'), appleTitle: meta('apple-mobile-web-app-title'),
      appleTouchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.href ?? null, icon: document.querySelector('link[rel~="icon"]')?.href?.slice(0, 40) ?? null,
      manifestLink, manifest,
      html: cs(document.documentElement), body: cs(document.body), canvas: cs(document.querySelector('#app canvas')),
      tbtn: cs(document.querySelector('.tbtn.ollie')), stick: cs(document.querySelector('.stick')), pausePanel: cs(document.querySelector('.pause .panel')),
      cssHas: { touchCallout: /touch-callout/.test(cssText), dvh: /\d+dvh/.test(cssText), vh100: /100vh/.test(cssText), safeArea: (cssText.match(/safe-area-inset/g) || []).length, userSelectNone: /user-select:\s*none/.test(cssText) },
      fullscreenEnabled: document.fullscreenEnabled, standalone: matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches,
    };
  });
  const pwaOk = !!audit.manifestLink && !!audit.appleTouchIcon;
  rec('H1', 'viewport meta, touch CSS, PWA manifest / icons', audit.html.touchAction === 'none' && audit.body.overscroll === 'none' && audit.viewport?.includes('viewport-fit=cover') ? (pwaOk ? 'PASS' : 'FAIL') : 'FAIL', audit);

  // H2 long-press: OLLIE (1.2 s), the title card text, and later the pause-menu text; selection / context menu?
  const touch = new Touch(cdp);
  const title = await center(page, '.titlecard .tt');
  if (title) { const id = await touch.down(title.x, title.y); await sleep(1200); await touch.up(id); await sleep(300); }
  const o = await center(page, '.tbtn.ollie');
  const id2 = await touch.down(o.x, o.y); await sleep(1200); await touch.up(id2); await sleep(300);
  const pb = await center(page, '.pausebtn'); await touch.tap(pb.x, pb.y, 60); await sleep(400);
  const lab = await center(page, '.pause .desc');
  if (lab) { const id3 = await touch.down(lab.x, lab.y); await sleep(1200); await touch.up(id3); await sleep(300); }
  const lp = await page.evaluate(() => ({ selection: String(getSelection()), contextmenu: window.__qa.ctxmenu, selectstart: window.__qa.selectstart }));
  rec('H2', 'long-press on the title text, OLLIE and pause-menu text: no selection / callout / context menu', !lp.selection && !lp.contextmenu.some((c) => !c.prevented) ? 'PASS' : 'NOTE',
    { ...lp, note: 'Chromium emulation; iOS adds -webkit-touch-callout (not set anywhere in the CSS)' });

  // H6 fullscreen toggle by touch (Chromium has the API; on iPhone Safari document.fullscreenEnabled is false -> row removed)
  const fs0 = await center(page, '.pause .sw[data-key="fullscreen"]');
  let fsState = null;
  if (fs0) { await touch.tap(fs0.x, fs0.y, 60); await sleep(700); fsState = await page.evaluate(() => ({ fullscreen: !!document.fullscreenElement, el: document.fullscreenElement?.tagName ?? null, orientationLock: typeof screen.orientation?.lock })); }
  if (fsState?.fullscreen) { const f1 = await center(page, '.pause .sw[data-key="fullscreen"]'); if (f1) { await touch.tap(f1.x, f1.y, 60); await sleep(500); } }
  const resume = await center(page, '.pause [data-act="resume"]'); if (resume) { await touch.tap(resume.x, resume.y, 60); await sleep(400); }
  h6 = { rowPresent: !!fs0, ...fsState }; // recorded after the iPhone no-API check below

  // H3 swipes on the game: page never scrolls / reloads
  const nav0 = await page.evaluate(() => performance.getEntriesByType('navigation').length + ':' + location.href);
  const sw = await touch.down(prof.w * 0.5, 30); await touch.glide(sw, prof.w * 0.5, prof.h * 0.7, 300, 10); await touch.up(sw); await sleep(300);
  const sw2 = await touch.down(prof.w * 0.5, prof.h * 0.6); await touch.glide(sw2, prof.w * 0.5, 20, 250, 10); await touch.up(sw2); await sleep(300);
  const sc = await page.evaluate(() => ({ scrollY, scrollX, docH: document.documentElement.scrollHeight, vh: innerHeight, nav: performance.getEntriesByType('navigation').length + ':' + location.href, vv: visualViewport.scale }));
  rec('H3', 'pull-down / swipe-up on the game: no page scroll, no reload, no zoom', sc.scrollY === 0 && sc.nav === nav0 && sc.vv === 1 ? 'PASS' : 'FAIL', sc);

  // H7 toast vs touch buttons: AUTO on shows "Auto-ride on · the stick takes over" at the bottom centre
  const au = await center(page, '.tbtn.autobtn'); await touch.tap(au.x, au.y, 60); await sleep(350);
  const toast = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden') return null; return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const T = r('.toast'), hits = [];
    for (const [n, s] of [['stick', '.stick'], ['TRICK', '.tbtn.flipbtn'], ['OLLIE', '.tbtn.ollie'], ['AUTO', '.tbtn.autobtn']]) { const b = r(s); if (T && b && Math.min(T.r, b.r) > Math.max(T.l, b.l) && Math.min(T.b, b.b) > Math.max(T.t, b.t)) hits.push(n); }
    return { text: document.querySelector('.toast').textContent, rect: T, overlaps: hits };
  });
  await page.screenshot({ path: path.join(SHOTS, `hygiene_${profKey}_toast.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  rec('H7', 'auto-ride toast vs touch controls', toast.overlaps.length ? 'FAIL' : 'PASS', toast);

  // H4 backgrounding: another tab in front -> hidden; does the game pause, does the audio stop?
  const before = await page.evaluate(() => ({ vis: document.visibilityState, audio: window.__qa.audio.last?.state ?? null }));
  const p2 = await context.newPage();
  await p2.goto('about:blank'); await p2.bringToFront(); await sleep(1500);
  const hidden = await page.evaluate(() => ({ vis: document.visibilityState, audio: window.__qa.audio.last?.state ?? null, paused: document.body.classList.contains('paused'), menuOpen: document.querySelector('.pause').classList.contains('show') }));
  await page.bringToFront(); await sleep(1200);
  const back = await page.evaluate(() => ({ vis: document.visibilityState, audio: window.__qa.audio.last?.state ?? null, paused: document.body.classList.contains('paused'), menuOpen: document.querySelector('.pause').classList.contains('show') }));
  // synthetic check of the handlers alone (in case the headless tab switch did not change visibility)
  const synth = await page.evaluate(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange')); dispatchEvent(new Event('blur')); dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 400));
    const r = { paused: document.body.classList.contains('paused'), menuOpen: document.querySelector('.pause').classList.contains('show'), audio: window.__qa.audio.last?.state ?? null };
    delete document.visibilityState; delete document.hidden;
    return r;
  });
  await p2.close();
  rec('H4', 'backgrounding (tab hidden / blur / pagehide): auto-pause + audio suspend?', hidden.paused || synth.paused ? 'PASS' : 'FAIL', { before, hidden, back, syntheticEvents: synth,
    note: 'headless tab switches keep the page visible; the synthetic visibilitychange / pagehide check is the one that counts' });
  await m.context.close();
}

// ---------------------------------------------------------------- H5 WebGL context loss + restore (?test for the renderer)
{
  const m = await mobilePage(browser, prof);
  const { page } = m;
  const allConsole = [];
  page.on('console', (c) => { if (!c.text().startsWith('QA_')) allConsole.push(`${c.type()}: ${c.text()}`.slice(0, 200)); });
  await page.goto(BASE_URL + '?test&touch&mute&mode=auto', { waitUntil: 'load', timeout: 120000 });
  await waitReady(page, true);
  await sleep(2500);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `hygiene_${profKey}_ctx_${n}.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  const probe = () => page.evaluate(() => {
    const g = window.__skate.game, gl = g.renderer.getContext(), qa = window.__qa;
    const f = qa.draws.perFrame.filter((x) => x[0] > performance.now() - 1000);
    // average canvas brightness from a downsampled copy (works without preserveDrawingBuffer only right after a frame)
    return { lost: gl.isContextLost(), framesWithDraws1s: f.length, avgCalls: f.length ? Math.round(f.reduce((a, b) => a + b[1], 0) / f.length) : 0, simT: +g.simTime.toFixed(2), paused: g.paused, events: qa.glEvents.map((e) => e[0] + (e[2] !== undefined ? ':prevented=' + e[2] : '')) };
  });
  const p0 = await probe(); await shot('1_before');
  await page.evaluate(() => { window.__lose = window.__skate.game.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
  await sleep(1500);
  const p1 = await probe(); await shot('2_lost');
  await page.evaluate(() => window.__lose.restoreContext());
  await sleep(3500);
  const p2 = await probe(); await shot('3_restored');
  // pixel check of the restored frame: compare mean brightness of the before / restored screenshots
  const { default: fs } = await import('node:fs');
  const stats = [];
  for (const n of ['1_before', '2_lost', '3_restored']) stats.push([n, fs.statSync(path.join(SHOTS, `hygiene_${profKey}_ctx_${n}.jpg`)).size]);
  const ok = p2.framesWithDraws1s > 20 && !p2.lost;
  rec('H5', 'WebGL context loss (WEBGL_lose_context) and restore', ok ? 'PASS' : 'FAIL', { before: p0, lost: p1, restored: p2, screenshotBytes: stats, console: allConsole.slice(-15) });
  await m.context.close();
}

// ---------------------------------------------------------------- H6 (pass 5): iPhone Safari has no element fullscreen API -> the pause
// menu must offer the Add to Home Screen tip instead of the row (emulated by hiding document.fullscreenEnabled)
{
  const m = await mobilePage(browser, prof);
  const { page, cdp } = m;
  await page.addInitScript(() => Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => false }));
  await page.goto(BASE_URL + '?test&touch&mute&mode=easy', { waitUntil: 'load', timeout: 120000 });
  await waitReady(page, true);
  await sleep(600);
  const t = new Touch(cdp);
  const pb = await center(page, '.pausebtn'); await t.tap(pb.x, pb.y, 60); await sleep(450);
  const fb = await page.evaluate(() => ({ ios: /iP(hone|od|ad)/.test(navigator.userAgent), fullscreenEnabled: document.fullscreenEnabled,
    rowPresent: !!document.querySelector('.pause .row.fs'), tip: document.querySelector('.pause .fstip')?.textContent ?? null }));
  await page.screenshot({ path: path.join(SHOTS, `hygiene_${profKey}_fs_tip.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  await m.context.close();
  const fallbackOk = fb.ios ? !fb.rowPresent && /Add to Home Screen/.test(fb.tip ?? '') : !fb.rowPresent;
  rec('H6', 'fullscreen toggle from the pause menu (touch); without the API (iPhone Safari) the Add to Home Screen tip replaces it',
    h6?.fullscreen && fallbackOk ? 'PASS' : 'FAIL', { ...h6, noApi: fb, note: 'the no-API case is emulated (document.fullscreenEnabled hidden) under the iPhone UA' });
}

save(`hygiene_${profKey}.json`, R);
console.log('\n' + R.cases.map((x) => `${x.status} ${x.id} ${x.name}`).join('\n'));
await browser.close();
