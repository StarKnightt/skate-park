// Headless desktop check of the audio engine on a running build (no window; --mute-audio keeps the speakers quiet, the Web
// Audio graph still runs and is measured with analysers inside the page):
//  1. Chrome's own decoder: every trimmed slice lines up with the original at lag 0 (decodeAudioData, 48 kHz)
//  2. a real click starts the context; each sound decodes; the roll gain follows speed; pop / land play; the music element
//     plays through the graph; Esc ducks (0.25, music LP ~1 kHz) and resumes; suspend()/resume() (+ held music when paused)
// bash tools/heavy.sh <you> node tools/assets/audio_verify.mjs [--url http://127.0.0.1:5198/skate-park/] [--orig dir] [--out file.json]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { FILES, PAD, XFADE, decode, build } from './audio_trim.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('url', 'http://127.0.0.1:5198/skate-park/'), ORIG = arg('orig', 'E:/shots/skate-park/pass-05/dev/m-audio/orig');
const OUT = arg('out', 'E:/shots/skate-park/pass-05/dev/m-audio/verify.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// regions to compare [origStart, newStart, seconds]: loop start + loop end windows, every one-shot slice
const files = Object.entries(FILES).map(([name, spec]) => {
  const r = build(decode(path.join(ORIG, name + '.mp3')), spec);
  const regions = spec.loop
    ? [[spec.loop[0], r.play.loop[0], 1], [spec.loop[1] - 1 - XFADE - 0.01, r.play.loop[1] - 1 - XFADE - 0.01, 1]].map(([a, b, l]) => [a, b, Math.min(l, spec.loop[1] - spec.loop[0] - XFADE - 0.02)])
    : spec.shots.map(([o, d], i) => [o, r.play.offsets[i], Math.min(d, 1)]);
  return { name, stereo: !!spec.stereo, regions };
});

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--mute-audio', '--ignore-gpu-blocklist', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const out = { url: URL_, when: new Date().toISOString(), checks: {} };
const ok = (k, pass, v) => { out.checks[k] = { pass, v }; console.log(pass ? 'PASS' : 'FAIL', k, JSON.stringify(v)); };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/__orig/*.mp3', (r) => r.fulfill({ path: path.join(ORIG, path.basename(new URL(r.request().url()).pathname)), contentType: 'audio/mpeg' }));
  await page.addInitScript(() => {
    const ma = (window.__ma = { starts: [] });
    const o = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { ma.starts.push({ t: performance.now(), buf: this.buffer, off: a[1] ?? 0, dur: a[2] ?? null }); return o.apply(this, a); };
    const w = () => { if (window.__skate?.ready) console.log('MA_READY'); else setTimeout(w, 100); };
    w();
  });
  const ready = page.waitForEvent('console', { predicate: (c) => c.text() === 'MA_READY', timeout: 120000 });
  await page.goto(URL_ + '?debug', { waitUntil: 'commit' });
  await ready;
  await sleep(1500);

  // ---- 1. Chrome's decoder: trimmed slices vs the originals
  const dec = await page.evaluate(async (files) => {
    const oc = new OfflineAudioContext(1, 1, 48000), SR = 48000;
    const get = async (u) => oc.decodeAudioData(await (await fetch(u)).arrayBuffer());
    const mono = (b) => { const a = new Float32Array(b.length); for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < a.length; i++) a[i] += d[i] / b.numberOfChannels; } return a; };
    const align = (a, as, b, bs, n) => {
      let best = { lag: 0, c: -2 };
      for (let lag = -96; lag <= 96; lag++) {
        let ab = 0, aa = 0, bb = 0;
        for (let i = 0; i < n; i++) { const x = a[as + i + lag] ?? 0, y = b[bs + i] ?? 0; ab += x * y; aa += x * x; bb += y * y; }
        const c = ab / Math.sqrt(aa * bb || 1); if (c > best.c) best = { lag, c: +c.toFixed(4) };
      }
      return best;
    };
    const res = {};
    for (const f of files) {
      const [o, n] = await Promise.all([get('/__orig/' + f.name + '.mp3'), get('audio/' + f.name + '.mp3')]);
      const om = f.stereo ? o.getChannelData(0) : mono(o), nm = n.getChannelData(0);
      res[f.name] = { origS: +o.duration.toFixed(4), newS: +n.duration.toFixed(4), ch: n.numberOfChannels,
        regions: f.regions.map(([os, ns, len]) => align(om, Math.round(os * SR), nm, Math.round(ns * SR), Math.round(len * SR))) };
    }
    return res;
  }, files);
  for (const [k, v] of Object.entries(dec)) ok(`decode.${k}`, v.regions.every((r) => Math.abs(r.lag) <= 1 && r.c > 0.97), v);

  // ---- 2. a real click starts the audio
  await page.mouse.click(640, 400);
  await sleep(300);
  const st0 = await page.evaluate(() => { const a = window.__skate.game.audio; return { started: a.started, state: a.ctx?.state, sr: a.ctx?.sampleRate }; });
  let t = Date.now(), st;
  while (Date.now() - t < 10000) {
    st = await page.evaluate(() => { const a = window.__skate.game.audio; return { state: a.ctx.state, buffers: a.buffers.size, music: !!a.music && !a.music.paused && a.music.currentTime > 0, rolls: Object.keys(a.roll) }; });
    if (st.buffers === 10 && st.music) break;
    await sleep(200);
  }
  ok('start.running', st0.started && st.state === 'running', { st0, st, ms: Date.now() - t });
  ok('start.allDecoded+music', st.buffers === 10 && st.music && st.rolls.length === 2, st);
  // analysers on the master output (after duck) and on the music branch
  await page.evaluate(() => {
    const a = window.__skate.game.audio, c = a.ctx;
    const mk = (node) => { const an = c.createAnalyser(); an.fftSize = 2048; node.connect(an); return an; };
    window.__ma.anOut = mk(a.duckG); window.__ma.anMusic = mk(a.musicG);
    window.__ma.rms = (an) => { const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let q = 0; for (const v of d) q += v * v; return Math.sqrt(q / d.length); };
  });
  const rms = () => page.evaluate(() => ({ out: +window.__ma.rms(window.__ma.anOut).toFixed(5), music: +window.__ma.rms(window.__ma.anMusic).toFixed(5) }));

  // ---- roll gain follows speed (push with W, then let it roll and brake)
  await page.evaluate(() => window.__skate.hold(['KeyW']));
  const samples = [];
  for (let i = 0; i < 30; i++) {
    if (i === 15) await page.evaluate(() => { window.__skate.release(['KeyW']); window.__skate.hold(['KeyS']); });
    samples.push(await page.evaluate(() => {
      const g = window.__skate.game, a = g.audio, v = g.view, r = a.roll.concrete, w = a.roll.wood;
      return { speed: +v.speed.toFixed(2), mode: v.mode, surface: v.surface, gC: +r.gain.gain.value.toFixed(3), gW: +w.gain.gain.value.toFixed(3), rate: +r.src.playbackRate.value.toFixed(3), lp: Math.round(r.filt.frequency.value) };
    }));
    await sleep(150);
  }
  await page.evaluate(() => window.__skate.release());
  const exp = (s) => Math.min(1, s.speed / 1.2) * (0.25 + Math.min(1, s.speed / 9) * 0.9);
  const ride = samples.filter((s) => s.mode === 'ride');
  const err = ride.map((s) => Math.abs((s.surface === 1 ? s.gW : s.gC) - exp(s)));
  const maxSpeed = Math.max(...ride.map((s) => s.speed));
  ok('roll.followsSpeed', ride.length > 10 && maxSpeed > 2 && err.filter((e) => e < 0.12).length >= ride.length * 0.8, { maxSpeed, medianErr: +err.sort((a, b) => a - b)[err.length >> 1]?.toFixed(3), samples: samples.filter((_, i) => i % 3 === 0) });
  ok('out.signal', (await rms()).out > 1e-4, await rms());

  // ---- pop + land from a real ollie
  const n0 = await page.evaluate(() => window.__ma.starts.length);
  await page.evaluate(() => window.__skate.hold(['KeyW']));
  await sleep(800);
  await page.evaluate(() => { window.__skate.release(['KeyW']); window.__skate.hold(['Space']); });
  await sleep(250);
  await page.evaluate(() => window.__skate.release(['Space']));
  await sleep(1800);
  const plays = await page.evaluate((n0) => {
    const a = window.__skate.game.audio, by = new Map([...a.buffers].map(([k, b]) => [b, k]));
    return window.__ma.starts.slice(n0).map((s) => [by.get(s.buf) ?? 'other', +s.off.toFixed(3), s.dur]);
  }, n0);
  ok('oneshots.popLand', plays.some((p) => p[0] === 'pop') && plays.some((p) => p[0] === 'land'), plays);

  // ---- music through the graph (fade-in reached), Esc pause duck, resume
  await sleep(2500);
  const m1 = await page.evaluate(() => { const a = window.__skate.game.audio; return { musicG: +a.musicG.gain.value.toFixed(3), paused: a.music.paused, t: +a.music.currentTime.toFixed(2) }; });
  const r1 = await rms();
  ok('music.throughGraph', !m1.paused && m1.t > 1 && m1.musicG > 0.2 && r1.music > 1e-4, { ...m1, ...r1 });
  // a real Esc with the pointer locked is the browser's lock release (the game pauses on it); headless key events don't
  // release the lock, so: release it, or (unlocked) the scripted Esc of the test hooks (same input -> pause path)
  const how = await page.evaluate(() => { if (document.pointerLockElement) { document.exitPointerLock(); return 'lock-release'; } window.__skate.hold(['Escape']); return 'script-esc'; });
  await sleep(120);
  await page.evaluate(() => window.__skate.release(['Escape']));
  await sleep(700);
  const duck = await page.evaluate(() => { const g = window.__skate.game, a = g.audio; return { paused: g.paused, duck: +a.duckG.gain.value.toFixed(3), lp: Math.round(a.musicLP.frequency.value), motion: +a.motion.gain.value.toFixed(3), musicPaused: a.music.paused }; });
  duck.how = how;
  ok('pause.duck', duck.paused && Math.abs(duck.duck - 0.25) < 0.02 && Math.abs(duck.lp - 1000) < 60 && duck.motion < 0.02 && !duck.musicPaused, duck);
  await page.evaluate(() => window.__skate.pause(false));
  await sleep(900);
  const und = await page.evaluate(() => { const g = window.__skate.game, a = g.audio; return { paused: g.paused, duck: +a.duckG.gain.value.toFixed(3), lp: Math.round(a.musicLP.frequency.value), motion: +a.motion.gain.value.toFixed(3) }; });
  ok('pause.restore', !und.paused && und.duck > 0.98 && und.lp > 15000 && und.motion > 0.98, und);

  // ---- suspend / resume (page hidden / visible), playing and paused
  const sr = await page.evaluate(async () => {
    const g = window.__skate.game, a = g.audio, w = (ms) => new Promise((r) => setTimeout(r, ms)), s = () => ({ state: a.ctx.state, musicPaused: a.music.paused, t: +a.music.currentTime.toFixed(2) });
    const r = {};
    a.suspend(); await w(400); r.suspended = s();
    a.resume(); await w(600); r.resumed = s();
    g.setPaused(true); a.suspend(); await w(400); r.pausedSuspended = s();
    a.resume(); await w(600); r.pausedResumed = s();
    g.setPaused(false); await w(600); r.unpaused = s();
    a.suspend(); await w(300); a.gesture(); await w(600); r.gestureWhileHidden = { ...s(), bg: a.bgSuspended };
    return r;
  });
  ok('suspend.resume', sr.suspended.state === 'suspended' && sr.suspended.musicPaused && sr.resumed.state === 'running' && !sr.resumed.musicPaused
    && sr.pausedResumed.state === 'running' && sr.pausedResumed.musicPaused && !sr.unpaused.musicPaused, sr);
  ok('mute', await page.evaluate(async () => {
    const a = window.__skate.game.audio; a.setMuted(true); await new Promise((r) => setTimeout(r, 600)); const m = a.master.gain.value;
    a.setMuted(false); await new Promise((r) => setTimeout(r, 600)); return m < 0.01 && a.master.gain.value > 0.88 && !a.music.paused;
  }), null);
  ok('noErrors', errors.length === 0, errors);
  await context.close();
} finally {
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
}
const fails = Object.entries(out.checks).filter(([, v]) => !v.pass).map(([k]) => k);
console.log(fails.length ? `FAILED: ${fails.join(', ')}` : 'ALL PASS');
