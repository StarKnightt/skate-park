// Trace every pointer / touch event while a second finger taps OLLIE with the stick held (T3 diagnosis).
// bash tools/heavy.sh mobileqa node tools/mobile-qa/debug_multitouch.mjs
import { launch, mobilePage, PROFILES, BASE_URL, Touch, sleep, center, waitReady, save, log } from './common.mjs';

const browser = await launch();
const out = {};
for (const variant of ['easy', 'easy_slowtap']) {
  const m = await mobilePage(browser, PROFILES.iphone);
  const { page, cdp } = m;
  await page.goto(BASE_URL + '?test&touch&mute&mode=easy', { waitUntil: 'load', timeout: 120000 });
  await waitReady(page, true);
  await sleep(600);
  await page.evaluate(() => {
    window.__trace = [];
    const T0 = performance.now();
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'touchstart', 'touchend', 'touchcancel']) {
      addEventListener(type, (e) => {
        if (type === 'pointermove' && window.__trace.length && window.__trace.at(-1).type === 'pointermove' && window.__trace.at(-1).id === e.pointerId) return;
        const tg = e.target instanceof Element ? (typeof e.target.className === 'string' && e.target.className ? e.target.className : e.target.tagName) : String(e.target);
        window.__trace.push({ t: +(performance.now() - T0).toFixed(1), type, id: e.pointerId ?? null, touches: e.touches ? e.touches.length : undefined, changed: e.changedTouches ? [...e.changedTouches].map((x) => x.identifier) : undefined, x: e.clientX != null ? Math.round(e.clientX) : undefined, tg, steer: +window.__skate.input.touch.steer.toFixed(2) });
      }, true);
    }
  });
  const touch = new Touch(cdp);
  const S = await center(page, '.stick'), O = await center(page, '.tbtn.ollie');
  const a = await touch.down(S.x, S.y); await sleep(40);
  await touch.move(a, S.x + 40, S.y); await sleep(250);
  const b = await touch.down(O.x, O.y); await sleep(variant === 'easy' ? 120 : 400);
  const mid = await page.evaluate(() => window.__skate.input.touch.steer);
  await touch.up(b); await sleep(300);
  const after = await page.evaluate(() => ({ steer: window.__skate.input.touch.steer, ev: window.__skate.events().map((x) => x.type) }));
  await touch.up(a); await sleep(100);
  out[variant] = { midSteer: mid, after, trace: await page.evaluate(() => window.__trace) };
  log(variant, 'mid steer', mid, 'after', JSON.stringify(after));
  for (const e of out[variant].trace) console.log(JSON.stringify(e));
  await m.context.close();
}
save('debug_multitouch.json', out);
await browser.close();
