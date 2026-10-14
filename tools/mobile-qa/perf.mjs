// Performance under CPU throttling with an emulated 60 Hz phone panel (instrument.js __QA_CFG.vsync: page rAF callbacks
// are delivered on a 60 Hz grid; headless Chrome itself ticks at the host monitor's ~200 Hz).
//  --suite adaptive : the REAL build (adaptive quality on): tap to start, AUTO on (the autopilot rides = steady
//                     gameplay with tricks, grinds, camera moves, audio), CPU throttle, then N s of samples:
//                     game fps, frame-interval distribution, main-thread ms per frame, long tasks, quality level
//                     (canvas px / CSS px = the DPR cap of the tier: 1.75 / 1.25 / 0.85), JS heap.
//                     Plan entries profile:P|L:cpuRate[:gl] (":gl" = with the WebGL call hooks: draw stats + GPU memory
//                     estimate, but ~6 ms/frame of hook overhead at 4x, so fps/CPU numbers come from runs without).
//  --suite tiers    : ?test&quality=0|1|2 (fixed tier). Phase A (CPU x4, no GPU queries): main-thread ms per subsystem,
//                     frame stats, renderer.info per pass (shadow maps / hero shadow / scene / post). Phase B (CPU x1):
//                     GPU timer queries per pass on the desktop GPU (upper bounds, submission-gated; relative only) and
//                     the shadow-map update cost (shadowMap.autoUpdate off). Then a deterministic screenshot per tier.
// bash tools/heavy.sh mobileqa node tools/mobile-qa/perf.mjs --suite adaptive [--plan ...] [--secs 30]
// bash tools/heavy.sh mobileqa node tools/mobile-qa/perf.mjs --suite tiers [--prof android] [--q 0,1,2]
import path from 'node:path';
import { launch, mobilePage, PROFILES, BASE_URL, cpu, Touch, sleep, center, waitReady, bundleName, glInfo, save, log, SHOTS, opt, flag } from './common.mjs';

const suite = opt('suite', 'adaptive');
const SECS = Number(opt('secs', 30));
const browser = await launch();
const out = { suite, bundle: null, runs: [] };

async function startRiding(m) {
  const { page, cdp, vp } = m;
  const touch = new Touch(cdp);
  await touch.tap(vp.width / 2, vp.height * 0.42, 70); // ends the attract / title card (and unlocks audio)
  await sleep(900);
  const a = await center(page, '.tbtn.autobtn');
  if (a) await touch.tap(a.x, a.y, 70); // auto-ride on: the autopilot rides the park
  await sleep(700);
  return page.evaluate(() => document.querySelector('.tbtn.autobtn')?.classList.contains('on') ?? null);
}

async function adaptiveRun(profKey, landscape, rate, secs = SECS, withGL = false) {
  const prof = PROFILES[profKey];
  const m = await mobilePage(browser, prof, { landscape, cfg: { vsync: 60, noGL: !withGL } });
  const { page, cdp } = m;
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 120000 });
  await waitReady(page, false);
  out.bundle ??= await bundleName(page);
  await sleep(1500);
  const autoOn = await startRiding(m);
  await cpu(cdp, rate);
  const t0 = await page.evaluate(() => performance.now());
  const samples = [];
  for (let s = 1; s <= secs; s++) {
    await sleep(1000);
    samples.push(await page.evaluate((s0) => {
      const qa = window.__qa, now = performance.now(), c = qa.canvas;
      const st = qa.gameFrameStats(now - 1000, now);
      return { t: +((now - s0) / 1000).toFixed(1), fps: st?.fps ?? 0, cpuMs: st?.cpuMean ?? null, dpr: +(c.width / c.clientWidth).toFixed(3),
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        auto: document.querySelector('.tbtn.autobtn')?.classList.contains('on') ?? null };
    }, t0));
  }
  if (flag('shot')) await page.screenshot({ path: path.join(SHOTS, `perf_${profKey}_${landscape ? 'land' : 'port'}_cpu${rate}.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  const res = await page.evaluate((s0) => {
    const qa = window.__qa, now = performance.now();
    return {
      frames: qa.gameFrameStats(s0, now), steady: qa.gameFrameStats(now - 10000, now), draws: qa.drawStats(s0, now),
      longTasks: qa.longtasks.filter((l) => l[0] >= s0).map((l) => Math.round(l[1])),
      mem: { texMB: +(qa.mem.tex / 1048576).toFixed(1), rbMB: +(qa.mem.rb / 1048576).toFixed(1), bufMB: +(qa.mem.buf / 1048576).toFixed(1), maxDim: qa.mem.maxDim, big: qa.mem.big.slice(0, 12) },
      canvas: [qa.canvas.width, qa.canvas.height, qa.canvas.clientWidth, qa.canvas.clientHeight],
    };
  }, t0);
  const qualitySeq = samples.map((s) => (s.dpr >= 1.7 ? 2 : s.dpr >= 1.2 ? 1 : 0));
  const drops = []; for (let i = 1; i < qualitySeq.length; i++) if (qualitySeq[i] !== qualitySeq[i - 1]) drops.push(`${qualitySeq[i - 1]}->${qualitySeq[i]} @${samples[i].t}s`);
  const run = { profile: prof.name, orientation: landscape ? 'landscape' : 'portrait', cpu: rate, glHooks: withGL, autoOn, gl: await glInfo(page), qualityStart: qualitySeq[0], qualityEnd: qualitySeq.at(-1), qualityChanges: drops, samples, ...res, console: m.logs };
  log(profKey, landscape ? 'L' : 'P', 'cpu x' + rate, withGL ? '(GL hooks)' : '', 'fps all', res.frames?.fps, 'median', res.frames?.medianFps, 'steady fps', res.steady?.fps, 'cpu ms p50/p95', res.frames?.cpuMs.p50, res.frames?.cpuMs.p95,
    '>20ms', res.frames?.over20ms + '%', 'quality', qualitySeq.join(''), 'draws', res.draws?.calls, 'tris', res.draws?.tris, 'canvas', res.canvas.join('x'), 'heap', samples.at(-1)?.heapMB);
  out.runs.push(run);
  await m.context.close();
}

// ---------------------------------------------------------------- fixed tiers
async function tierRun(profKey, q, rate = 4) {
  const prof = PROFILES[profKey];
  const m = await mobilePage(browser, prof, { cfg: { vsync: 60, noGL: true } });
  const { page, cdp } = m;
  await page.goto(BASE_URL + `?test&touch&mute&mode=auto&quality=${q}`, { waitUntil: 'load', timeout: 120000 });
  await waitReady(page, true);
  out.bundle ??= await bundleName(page);
  await sleep(1500);
  await page.evaluate(() => {
    const g = window.__skate.game, r = g.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const T = (window.__tier = { info: [], pass: {}, gpu: { hero: [], scene: [], post: [] }, pending: [], ext: !!ext, gpuOn: false, cpu: {}, cpuFrames: 0 });
    r.info.autoReset = false;
    const I = r.info.render;
    // per-pass draw stats (renderer.info deltas) + optional GPU timer query (sequential, never nested)
    const wrapPass = (label, obj, name) => {
      const fn = obj[name];
      obj[name] = function (...a) {
        const c0 = I.calls, t0 = I.triangles;
        let qq = null;
        if (T.gpuOn && ext && label !== 'shadowMaps') { qq = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qq); }
        try { return fn.apply(this, a); } finally {
          if (qq) { gl.endQuery(ext.TIME_ELAPSED_EXT); T.pending.push([label, qq]); }
          const p = (T.pass[label] ??= { calls: 0, tris: 0, n: 0 }); p.calls += I.calls - c0; p.tris += I.triangles - t0; p.n++;
        }
      };
    };
    wrapPass('hero', g.hero, 'update');
    wrapPass('scene', g.post.composer.passes[0], 'render'); // RenderPass: includes the sun cascades + lamp spot shadow maps
    wrapPass('post', g.post.composer.passes[1], 'render'); // EffectPass: bloom luminance + mip blur, FXAA, tone, grade
    wrapPass('shadowMaps', r.shadowMap, 'render'); // inside 'scene'
    const time = (obj, name, label) => {
      const f = obj[name]; if (typeof f !== 'function') return;
      obj[name] = function (...a) { const s = performance.now(); try { return f.apply(this, a); } finally { T.cpu[label] = (T.cpu[label] || 0) + performance.now() - s; } };
    };
    time(g.physics, 'step', 'physics.step (all steps)');
    time(g.input, 'sample', 'input+autopilot');
    time(g.skater, 'update', 'skater.update');
    time(g.rig, 'update', 'cameraRig.update');
    time(g.scenery, 'update', 'scenery+people');
    time(g, 'simulate', 'simulate (total)');
    time(g.hero, 'update', 'heroShadow submit');
    time(r.shadowMap, 'render', 'shadowMaps submit');
    time(g.post, 'render', 'post.render submit (shadows+scene+post)');
    const origSim = g.simulate;
    g.simulate = function (...a) { T.cpuFrames++; return origSim.apply(this, a); };
    const orig = g.render.bind(g);
    g.render = (dt) => {
      r.info.reset();
      orig(dt);
      T.info.push([I.calls, I.triangles]);
      if (T.info.length > 900) T.info.shift();
      if (!T.pending.length) return;
      while (T.pending.length && gl.getQueryParameter(T.pending[0][1], gl.QUERY_RESULT_AVAILABLE)) {
        const [label, qq] = T.pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) T.gpu[label].push(gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(qq);
      }
    };
  });
  // ---- phase A: CPU x rate, no GPU queries
  await cpu(cdp, rate);
  await sleep(3000);
  const t0 = await page.evaluate(() => { const T = window.__tier; T.cpu = {}; T.cpuFrames = 0; T.info = []; T.pass = {}; return performance.now(); });
  await sleep(12000);
  const A = await page.evaluate((s0) => {
    const g = window.__skate.game, r = g.renderer, T = window.__tier, qa = window.__qa, n = Math.max(1, T.cpuFrames);
    const avg = (i) => Math.round(T.info.reduce((a, b) => a + b[i], 0) / Math.max(1, T.info.length));
    return {
      quality: g.quality, dprCap: +(qa.canvas.width / qa.canvas.clientWidth).toFixed(3), canvas: [qa.canvas.width, qa.canvas.height],
      info: { calls: avg(0), callsMax: Math.max(...T.info.map((x) => x[0])), triangles: avg(1), trianglesMax: Math.max(...T.info.map((x) => x[1])),
        geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null },
      perPass: Object.fromEntries(Object.entries(T.pass).map(([k, v]) => [k, { calls: Math.round(v.calls / Math.max(1, v.n)), tris: Math.round(v.tris / Math.max(1, v.n)) }])),
      cpuMsPerFrame: Object.fromEntries(Object.entries(T.cpu).map(([k, v]) => [k, +(v / n).toFixed(2)])),
      shadow: { sunMap: [g.sun.shadow.mapSize.x, g.sun.shadow.mapSize.y], sunFar: g.sun.shadow.camera.far, lampCasts: g.lampSpot.castShadow, heroSize: g.hero.size },
      msaa: g.post.composer.multisampling ?? null, bloomIntensity: +g.post.bloom.intensity.toFixed(3),
      frames: qa.gameFrameStats(s0, performance.now()),
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  }, t0);
  // ---- phase B: CPU x1, GPU timer queries (shadow maps live, then frozen)
  await cpu(cdp, 1);
  await page.evaluate(() => { const T = window.__tier; T.gpuOn = true; T.gpu = { hero: [], scene: [], post: [] }; });
  await sleep(6000);
  const gpuLive = await page.evaluate(() => JSON.parse(JSON.stringify(window.__tier.gpu)));
  await page.evaluate(() => { window.__tier.gpu.scene = []; window.__skate.game.renderer.shadowMap.autoUpdate = false; });
  await sleep(5000);
  const sceneFrozen = await page.evaluate(() => { const s = window.__tier.gpu.scene.slice(); const T = window.__tier; T.gpuOn = false; window.__skate.game.renderer.shadowMap.autoUpdate = true; return s; });
  const med = (a) => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(3); };
  const gpuMs = { hero: med(gpuLive.hero), scene: med(gpuLive.scene), post: med(gpuLive.post), sceneShadowsFrozen: med(sceneFrozen) };
  gpuMs.shadowUpdate = gpuMs.scene != null && gpuMs.sceneShadowsFrozen != null ? +(gpuMs.scene - gpuMs.sceneShadowsFrozen).toFixed(3) : null;
  // ---- deterministic view for the visual comparison: manual clock, same spot, same camera
  await page.evaluate(() => { const s = window.__skate; s.manual(true); s.input.setAuto(false); s.teleport(9, 0, 3, 200, 3); s.advance(45, 1 / 30); });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, `tier_q${q}_${profKey}.jpg`), type: 'jpeg', quality: 88 });
  const run = { profile: prof.name, cpu: rate, ...A, gpuMsAt1x: gpuMs, gl: await glInfo(page), console: m.logs };
  log(profKey, 'q' + q, 'calls', A.info.calls, 'tris', A.info.triangles, 'programs', A.info.programs, 'fps', A.frames?.fps, 'cpu ms p50/p95', A.frames?.cpuMs.p50, A.frames?.cpuMs.p95, 'canvas', A.canvas.join('x'));
  log('   per pass', JSON.stringify(A.perPass));
  log('   cpu ms/frame', JSON.stringify(A.cpuMsPerFrame));
  log('   gpu ms @1x', JSON.stringify(gpuMs));
  out.runs.push(run);
  await m.context.close();
}

if (suite === 'adaptive') {
  const plan = opt('plan', 'android:P:1,android:P:4,android:P:6,iphone:P:4,iphone:L:4,small:P:4,ipad:P:4,ipad:L:4').split(',');
  for (const p of plan) { const [k, o, r, x] = p.split(':'); await adaptiveRun(k, o === 'L', Number(r), SECS, x === 'gl'); }
} else if (suite === 'tiers') {
  const prof = opt('prof', 'android');
  for (const q of opt('q', '0,1,2').split(',').map(Number)) await tierRun(prof, q, Number(opt('cpu', 4)));
}
save(opt('out', `perf_${suite}.json`), out);
await browser.close();
