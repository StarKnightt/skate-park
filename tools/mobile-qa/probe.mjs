// Environment probe: is headless Chrome on the hardware GPU, does touch emulation flip (pointer: coarse), are safe-area
// insets / timer queries available, what rAF rate does a page get, which bundle is live.
// bash tools/heavy.sh mobileqa node tools/mobile-qa/probe.mjs
import { launch, mobilePage, PROFILES, BASE_URL, waitReady, bundleName, glInfo, save, log, sleep } from './common.mjs';

const browser = await launch();
const m = await mobilePage(browser, PROFILES.android);
const { page } = m;
const t0 = Date.now();
await page.goto(BASE_URL + '?test&touch&mute&mode=easy', { waitUntil: 'load', timeout: 120000 });
await waitReady(page, true);
log('ready in', Date.now() - t0, 'ms');
await sleep(2000);
const env = await page.evaluate(async () => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(d);
  const cs = getComputedStyle(d);
  const gl = window.__qa.gl;
  const t = performance.now(); const n0 = window.__qa.frames.length;
  await new Promise((r) => setTimeout(r, 2000));
  const n1 = window.__qa.frames.length;
  const ac = new AudioContext(); const acState = ac.state; ac.close();
  return {
    coarse: matchMedia('(pointer: coarse)').matches, hoverNone: matchMedia('(hover: none)').matches, anyFine: matchMedia('(any-pointer: fine)').matches,
    maxTouchPoints: navigator.maxTouchPoints, dpr: devicePixelRatio, inner: [innerWidth, innerHeight], screen: [screen.width, screen.height],
    orientation: screen.orientation?.type, insets: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
    rafHz: +((n1 - n0) / ((performance.now() - t) / 1000)).toFixed(1),
    timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    exts: gl.getSupportedExtensions(),
    fullscreenEnabled: document.fullscreenEnabled, standalone: matchMedia('(display-mode: standalone)').matches,
    audioNoGesture: acState, ua: navigator.userAgent, visibility: document.visibilityState, hasFocus: document.hasFocus(),
    quality: window.__skate.state().quality, canvas: [window.__qa.canvas.width, window.__qa.canvas.height, window.__qa.canvas.clientWidth],
  };
});
const out = { bundle: await bundleName(page), gl: await glInfo(page), env, logs: m.logs };
save('probe.json', out);
console.log(JSON.stringify(out, null, 1));
await browser.close();
