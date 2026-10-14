// Cold-load test on a throttled network + CPU, then the first tap (audio unlock + audio download).
// No page.evaluate() runs before the first tap: Playwright evaluates with userGesture=true, which would grant the page a
// user activation and hide audio-unlock problems. Readiness comes from a console marker printed by instrument.js.
// bash tools/heavy.sh mobileqa node tools/mobile-qa/load.mjs [--runs android4g,iphone4g,androidSlow]
import path from 'node:path';
import { launch, mobilePage, PROFILES, BASE_URL, FAST_4G, SLOW_4G, cpu, network, Touch, sleep, bundleName, save, log, SHOTS } from './common.mjs';
import { opt, flag } from './common.mjs';

const RUNS = {
  android4g: { prof: 'android', net: FAST_4G, netName: 'Fast 4G (8.1 Mbps, 165 ms RTT)', cpu: 4 },
  iphone4g: { prof: 'iphone', net: FAST_4G, netName: 'Fast 4G (8.1 Mbps, 165 ms RTT)', cpu: 4 },
  androidSlow: { prof: 'android', net: SLOW_4G, netName: 'Slow 4G (1.44 Mbps, 563 ms RTT)', cpu: 6 },
  // controls: which of network / CPU throttling sets the pace
  android4gCpu1: { prof: 'android', net: FAST_4G, netName: 'Fast 4G (8.1 Mbps, 165 ms RTT)', cpu: 1 },
  androidCpu4NoNet: { prof: 'android', net: null, netName: 'unthrottled network', cpu: 4 },
  androidNoThrottle: { prof: 'android', net: null, netName: 'unthrottled network', cpu: 1 },
};
const which = (opt('runs', 'android4g,iphone4g,androidSlow')).split(',');
// warm the GitHub Pages CDN edge first: a cold edge fetches from the origin at ~150 KB/s, which would swamp the emulated
// network (seen on the first run: 29 s even unthrottled). The browser contexts still start with an empty HTTP cache.
{
  const html = await (await fetch(BASE_URL)).text();
  const list = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((x) => x[1]).filter((u) => !u.startsWith('data:'));
  const more = ['models/skater.glb', 'models/people.glb', 'textures/clouds.json',
    ...['concrete_detail', 'wood_planks', 'mural_koi', 'mural_sunwaves', 'deck_graphic', 'clouds', 'mural_patchwork', 'face_wide', 'face_grin', 'face_neutral', 'face_grimace', 'face_focus'].map((n) => `textures/${n}.webp`),
    ...['music', 'waves', 'roll_concrete', 'seagulls', 'grind_concrete', 'land', 'grind_metal', 'roll_wood', 'clack', 'bail_thud', 'pop'].map((n) => `audio/${n}.mp3`)];
  const t = Date.now();
  await Promise.all([...list, ...more].map((u) => fetch(new URL(u, BASE_URL), { headers: { 'accept-encoding': 'gzip' } }).then((r) => r.arrayBuffer()).catch(() => null)));
  log('CDN warm-up fetch of', list.length + more.length, 'files in', Date.now() - t, 'ms');
}
const browser = await launch();
// one unmeasured browser load as well: the edge caches per Accept-Encoding / connection, and the first browser context of a
// session still met a cold edge after the fetch() warm-up (skater.glb 14.6 s at "Fast 4G" vs 2.1 s on the next context)
if (!flag('nowarm')) {
  const w = await mobilePage(browser, PROFILES.android);
  const t = Date.now();
  const ok = w.page.waitForEvent('console', { predicate: (c) => c.text() === 'QA_READY', timeout: 120000 }).catch(() => null);
  await w.page.goto(BASE_URL, { waitUntil: 'commit' });
  await ok;
  log('browser warm-up load', Date.now() - t, 'ms');
  await w.context.close();
}
const results = {};
for (const key of which) {
  const R = RUNS[key]; const prof = PROFILES[R.prof];
  log('run', key, prof.name, R.netName, 'cpu x' + R.cpu);
  const m = await mobilePage(browser, prof);
  const { page, cdp } = m;
  // ---- network log from CDP (encoded = bytes on the wire)
  const req = new Map();
  cdp.on('Network.requestWillBeSent', (e) => req.set(e.requestId, { url: e.request.url, start: e.timestamp, type: e.type }));
  cdp.on('Network.responseReceived', (e) => { const r = req.get(e.requestId); if (r) { r.status = e.response.status; r.enc = e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'] || ''; r.mime = e.response.mimeType; } });
  cdp.on('Network.loadingFinished', (e) => { const r = req.get(e.requestId); if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength; } });
  cdp.on('Network.loadingFailed', (e) => { const r = req.get(e.requestId); if (r) { r.failed = e.errorText; r.end = e.timestamp; } });
  if (R.net) await network(cdp, R.net);
  else { await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); }
  await cpu(cdp, R.cpu);
  const ready = page.waitForEvent('console', { predicate: (c) => c.text() === 'QA_READY', timeout: 180000 });
  const tNav = Date.now();
  let navTs = null;
  cdp.once('Network.requestWillBeSent', (e) => { navTs = e.timestamp; });
  await page.goto(BASE_URL, { waitUntil: 'commit', timeout: 180000 });
  await sleep(1500);
  await page.screenshot({ path: path.join(SHOTS, `load_${key}_01_loading.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  await sleep(2500);
  await page.screenshot({ path: path.join(SHOTS, `load_${key}_02_loading_4s.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  await ready;
  const readyWall = Date.now() - tNav;
  log('  ready (wall)', readyWall, 'ms');
  await sleep(1200);
  await page.screenshot({ path: path.join(SHOTS, `load_${key}_03_title.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  const preTapReqs = req.size;
  // ---- first tap on the canvas (real touch through CDP; the title card's "tap to ride"); audio progress via console
  const audioLog = [];
  let tTap = Date.now();
  const onConsole = (c) => { if (c.text().startsWith('QA_AUDIO')) audioLog.push([Date.now() - tTap, c.text()]); };
  page.on('console', onConsole);
  const touch = new Touch(cdp);
  tTap = Date.now();
  await touch.tap(prof.w / 2, prof.h * 0.45, 80);
  // wait (no evaluate) until every sound file the page fetched is downloaded + decoded (builds without the fetch marker:
  // the 11 of the original build), and a streamed track (no decode) plays, or 90 s
  const at = (p) => audioLog.find((l) => l[1].startsWith(p))?.[0] ?? null;
  const wantDecodes = () => audioLog.filter((l) => l[1].startsWith('QA_AUDIO fetch ')).length || 11;
  const streamed = () => audioLog.some((l) => l[1].startsWith('QA_AUDIO stream '));
  let tAudio = null, tStream = null;
  for (let i = 0; i < (flag('noaudio') ? 2 : 180) && (tAudio === null || (streamed() && tStream === null)); i++) {
    tAudio = audioLog.find((l) => l[1] === `QA_AUDIO decoded ${wantDecodes()}`)?.[0] ?? null;
    tStream = at('QA_AUDIO stream playing');
    if (tAudio === null || (streamed() && tStream === null)) await sleep(500);
  }
  await sleep(1000);
  const afterFirst = { log: audioLog.slice(), ptr: await page.evaluate(() => window.__qa.ptr.slice(0, 10)), stateAfterDecode: await page.evaluate(() => window.__qa.audio.last?.state ?? null) };
  // a second tap (after the evaluate above the page counts as activated anyway: informative only)
  await touch.tap(prof.w / 2, prof.h * 0.45, 80);
  await sleep(600);
  const q = await page.evaluate(() => {
    const qa = window.__qa;
    return {
      paints: qa.paints, firstDraw: qa.firstDraw, firstCanvasDraw: qa.firstCanvasDraw, loadingDone: qa.marks.loadingDone,
      loadSamples: qa.loadSamples, longtasks: qa.longtasks.filter((l) => l[1] > 100).map((l) => [Math.round(l[0]), Math.round(l[1])]),
      audioDecoded: qa.audio.decoded, audioState: qa.audio.last ? qa.audio.last.state : null, audioCtx: qa.audio.ctx,
      nav: performance.getEntriesByType('navigation')[0]?.toJSON?.(),
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      mem: qa.mem, errors: qa.errors,
    };
  });
  await page.screenshot({ path: path.join(SHOTS, `load_${key}_04_after_tap.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  const reqs = [...req.values()].map((r) => ({
    url: r.url.replace(BASE_URL, ''), type: r.type, status: r.status, enc: r.enc, kb: r.bytes != null ? +(r.bytes / 1024).toFixed(1) : null,
    startS: navTs ? +(r.start - navTs).toFixed(2) : null, endS: navTs && r.end ? +(r.end - navTs).toFixed(2) : null, failed: r.failed,
  }));
  const before = reqs.slice(0, preTapReqs), after = reqs.slice(preTapReqs);
  const sum = (a) => +(a.reduce((s, r) => s + (r.kb || 0), 0) / 1024).toFixed(2);
  results[key] = {
    profile: prof.name, network: R.netName, cpu: R.cpu, bundle: await bundleName(page),
    fcpMs: q.paints.find((p) => p[0] === 'first-contentful-paint')?.[1] ?? null,
    firstWebglDrawMs: q.firstCanvasDraw && Math.round(q.firstCanvasDraw), readyMs: q.loadingDone && Math.round(q.loadingDone), readyWallMs: readyWall,
    progress: q.loadSamples?.filter((s, i, a) => i === 0 || s[1] !== a[i - 1][1] || s[2] !== a[i - 1][2]),
    longTasksOver100ms: q.longtasks,
    transferBeforeReadyMB: sum(before), requestsBeforeReady: before.length,
    biggest: [...before].sort((a, b) => (b.kb || 0) - (a.kb || 0)).slice(0, 10),
    lastToFinish: [...before].filter((r) => r.endS != null).sort((a, b) => b.endS - a.endS).slice(0, 5),
    audioTransferMB: sum(after.filter((r) => /audio\//.test(r.url))), audioRequests: after.filter((r) => /audio\//.test(r.url)).length,
    audioAllDecodedAfterTapMs: tAudio, audioDecoded: q.audioDecoded,
    // decoded = every fetched sound file; a streamed track is not decoded (not in audioDecoded / PCM) and is timed apart
    audioFetched: audioLog.filter((l) => l[1].startsWith('QA_AUDIO fetch ')).length, audioFirstDecodedAfterTapMs: at('QA_AUDIO decoded '),
    audioFirstPlayAfterTapMs: at('QA_AUDIO play '), musicStreamed: streamed(), musicPlayingAfterTapMs: tStream,
    audioAfterFirstTap: afterFirst, audioStateAfterSecondTap: q.audioState, audioCtx: q.audioCtx,
    heapMB: q.heapMB, gpuMemEstimateMB: { tex: +(q.mem.tex / 1048576).toFixed(1), rb: +(q.mem.rb / 1048576).toFixed(1), buf: +(q.mem.buf / 1048576).toFixed(1), maxDim: q.mem.maxDim },
    errors: q.errors, console: m.logs, failed: m.failed, allRequests: reqs,
  };
  log('  FCP', results[key].fcpMs, 'first webgl draw', results[key].firstWebglDrawMs, 'ready', results[key].readyMs, 'MB before ready', results[key].transferBeforeReadyMB, 'audio MB', results[key].audioTransferMB, 'audio decoded after', tAudio, 'first play', results[key].audioFirstPlayAfterTapMs, 'music playing', tStream);
  await m.context.close();
}
save(opt('out', 'load.json'), results);
await browser.close();
