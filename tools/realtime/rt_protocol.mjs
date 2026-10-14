// Real-time motion protocol for the skate park (builder + critic). Uncapped, headed Chrome on the second monitor (DISPLAY2), real
// keyboard / mouse input, per-frame logs (+ per-physics-step and key logs), optional true-60 fps canvas recordings,
// then the jitter metric and the feel metric.
//
//   bash tools/heavy.sh <owner> node tools/realtime/rt_protocol.mjs [--name <run>] [--only flat_side,kickflip] [--record]
//        [--url "http://127.0.0.1:5188/?test&mute"] [--out <dir>] [--fps 60] [--sweep 60[,120,200]] [--noexact] [--nowarm]
//   python tools/realtime/jitter_metric.py <out>/logs/*.json
//   python tools/realtime/feel_metric.py <out>
//   python tools/realtime/strips_from_run.py <out>
//
// Real-time runs never frame-step. --fps 60 runs the page with ?fps=60 (frame_std is N/A there: a 200 Hz rAF grid makes
// 15/20 ms alternation by construction). --sweep R runs the controlled sweep instead: manual clock, simulate + render at
// exactly 1/R s through the real game path, scripted input on the same timeline, every frame logged.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, installDiag } from './common.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const FPS = Number(opt('fps', 0)) || 0;
const SWEEP = opt('sweep', '') ? opt('sweep', '').split(',').map(Number).filter((x) => x > 0) : null;
let url = opt('url', 'http://127.0.0.1:5188/?test&mute');
if (FPS && !SWEEP) url += (url.includes('?') ? '&' : '?') + 'fps=' + FPS;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
const name = opt('name', (SWEEP ? 'sweep' + SWEEP.join('-') : FPS ? 'rt' + FPS : 'rt') + '_' + stamp);
const out = opt('out', 'E:/shots/skate-park/pass-04/realtime/' + name);
const ONLY = opt('only', '') ? opt('only', '').split(',') : null;
const RECORD = flag('record') && !SWEEP;
const LOGS = path.join(out, 'logs'), RAW = path.join(out, 'video', 'raw'), EXACT = path.join(out, 'exact200');
for (const d of [LOGS, ...(RECORD ? [RAW] : [])]) fs.mkdirSync(d, { recursive: true });

// ------------------------------------------------------------------------------------------------ scenarios
// keys: [t (s after the scenario starts), 1 = down / 0 = up, code]; dur: total length (s)
const LANE = [34.5, 0, 22, 180];
const KEY = (code, t, d) => [[t, 1, code], [t + d, 0, code]];
const SCEN = {
  flat_side: { at: [...LANE, 6.0], camYaw: Math.PI / 2, dur: 3.0, keys: [] },
  flat_behind: { at: [...LANE, 6.0], dur: 3.0, keys: [] },
  steer: { at: [12, 0, 10, 180, 5.0], dur: 3.3, keys: [...KEY('KeyA', 0.4, 0.45), ...KEY('KeyD', 1.2, 0.8), ...KEY('KeyA', 2.35, 0.45)] },
  push: { at: [...LANE, 0], dur: 3.9, keys: KEY('KeyW', 0.3, 3.0) },
  brake: { at: [...LANE, 6.0], dur: 2.6, keys: KEY('KeyS', 0.5, 1.2) },
  bowl_carve: { at: [-28, -2.3, -2.0, 90, 7.5], dur: 4.0, keys: [...KEY('KeyA', 0.2, 0.4), ...KEY('KeyD', 1.3, 0.6), ...KEY('KeyA', 2.6, 0.8)] },
  quarter_pipe: { at: [-8, 0, -15.5, 180, 4.8], dur: 3.5, keys: [] },
  halfpipe: { at: [22.5, 0, -9, 90, 9.6], dur: 5.0, keys: KEY('KeyW', 2.6, 0.8) },
  // pass-4 scheme: hold Space ~250 ms, F with no WASD held = kickflip (F while crouching pops now at the current charge)
  kickflip: { at: [...LANE, 5.0], camYaw: Math.PI / 2, dur: 2.2, keys: [[0.4, 1, 'Space'], [0.65, 1, 'KeyF'], [0.69, 0, 'KeyF'], [0.75, 0, 'Space']],
    fallback: [[0.4, 1, 'Space'], [0.65, 1, 'ArrowLeft'], [0.73, 0, 'Space'], [0.85, 0, 'ArrowLeft']] },
  dropin_bowl: { at: [-12.5, 0, 0.6, -90, 4.5], camYaw: Math.PI / 2, dur: 2.6, keys: [] },
  orbit_drag: { at: [...LANE, 4.0], dur: 3.0, mouse: 'orbit' },
  mouselook: { at: [...LANE, 4.0], dur: 2.5, mouse: 'look' },
};
const SWEEP_SKIP = new Set(['orbit_drag', 'mouselook']);

const { browser, page, logs } = await launch({ url });
const summary = { url, name, mode: SWEEP ? 'sweep' : FPS ? 'fps' + FPS : 'realtime', when: new Date().toISOString(), scenarios: {}, notes: [] };
const wait = (ms) => page.waitForTimeout(ms);
const writeLog = (scen, extra) => page.evaluate(() => {
  const D = window.__diag; return { rows: D.rows, steps: D.steps, keys: D.keys };
}).then(async (d) => {
  const events = await page.evaluate(() => window.__skate.events());
  const cal = await page.evaluate(() => ({ dpr: devicePixelRatio }));
  const header = await page.evaluate(() => window.__diag.header);
  const stepHeader = await page.evaluate(() => window.__diag.stepHeader);
  fs.writeFileSync(path.join(LOGS, scen + '.json'), JSON.stringify({ name: scen, header, stepHeader, ...d, events, cal, fpsCap: SWEEP ? 0 : FPS, ...extra }));
  const dts = d.rows.map((x) => x[1] * 1000).sort((a, b) => a - b);
  summary.scenarios[scen] = { ...(summary.scenarios[scen] ?? {}), frames: d.rows.length, steps: d.steps.length, medianDt: dts[dts.length >> 1], events: events.map((e) => e.type) };
  console.log(scen, d.rows.length, 'frames, median dt', dts[dts.length >> 1]?.toFixed(2), 'ms |', events.map((e) => e.type).join(','));
  return events;
});

try {
  await page.evaluate(installDiag);
  await page.evaluate(() => {
    window.__skate.hud(false);
    window.__recStart = () => new Promise((resolve) => {
      const stream = window.__skate.game.renderer.domElement.captureStream(60);
      const mime = ['video/mp4;codecs=avc1.640028', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 30000000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      window.__rec = { rec, chunks, t0: 0, mime };
      rec.onstart = () => { window.__rec.t0 = performance.now(); resolve(mime); };
      rec.start(250);
    });
    window.__recStop = () => new Promise((resolve) => {
      const r = window.__rec;
      r.rec.onstop = async () => {
        const buf = new Uint8Array(await new Blob(r.chunks, { type: r.mime }).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        resolve({ b64: btoa(s), t0: r.t0, mime: r.mime });
      };
      r.rec.stop();
    });
  });
  const setup = (o) => page.evaluate((o) => {
    const s = window.__skate, r = s.game.rig;
    s.free(); r.idleT = 0; r.userYaw = 0; r.userPitch = 0; r.distOverride = null;
    s.teleport(...o.at); s.snapCam();
    if (o.camYaw != null) s.camYaw(o.camYaw, 0);
  }, o);

  if (!SWEEP) {
    // native frame interval (must be the display rate: ~5.0 ms on this machine; ~16.7 ms with --fps 60)
    await page.evaluate(() => { const D = window.__diag; D.rows = []; D.steps = []; D.keys = []; D.on = true; });
    await wait(1500);
    const idle = await page.evaluate(() => { const D = window.__diag; D.on = false; return D.rows.map((r) => r[1] * 1000); });
    idle.sort((a, b) => a - b);
    summary.nativeFrameMs = idle[idle.length >> 1];
    const want = FPS ? 1000 / FPS : 5.0;
    const bad = Math.abs(summary.nativeFrameMs - want) > (FPS ? 2.5 : 0.6);
    console.log('frame interval (median ms):', summary.nativeFrameMs?.toFixed(2), bad ? `  WARNING: expected ~${want.toFixed(1)} ms` : '');
    if (bad) summary.notes.push(`frame interval ${summary.nativeFrameMs?.toFixed(2)} ms, expected ~${want.toFixed(1)}`);

    const canvasCenter = () => page.evaluate(() => { const r = window.__skate.game.renderer.domElement.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const runKeys = async (keys) => {
      const t0 = Date.now();
      for (const [t, d, code] of keys) {
        const w = t0 + t * 1000 - Date.now();
        if (w > 0) await wait(w);
        if (d) await page.keyboard.down(code); else await page.keyboard.up(code);
      }
    };
    const MOUSE = {
      orbit: async () => {
        const [cx, cy] = await canvasCenter();
        await wait(300); await page.mouse.move(cx, cy); await page.mouse.down();
        for (let i = 1; i <= 15; i++) { await page.mouse.move(cx + i * 20, cy); await wait(20); }
        await wait(500);
        for (let i = 14; i >= 0; i--) { await page.mouse.move(cx + i * 20, cy); await wait(20); }
        for (let i = 1; i <= 10; i++) { await page.mouse.move(cx, cy + i * 15); await wait(20); }
        await page.mouse.up(); await wait(1200);
      },
      look: async () => {
        const [cx, cy] = await canvasCenter();
        await page.mouse.move(cx, cy); await page.mouse.click(cx, cy); await wait(300);
        summary.pointerLockAfterClick = await page.evaluate(() => document.pointerLockElement === window.__skate.game.renderer.domElement);
        for (let i = 1; i <= 30; i++) { await page.mouse.move(cx + i * 10, cy + (i % 2)); await wait(8); }
        for (let i = 1; i <= 20; i++) { await page.mouse.move(cx + 300, cy + i * 6); await wait(8); }
        await wait(800);
        await page.keyboard.press('Escape'); await wait(300);
        summary.pointerLockAfterEscape = await page.evaluate(() => document.pointerLockElement !== null);
        // Esc may have opened the pause menu: close it so the next scenario runs
        await page.evaluate(() => { const g = window.__skate.game; if (g.paused && g.setPaused) g.setPaused(false); });
        if (!summary.pointerLockAfterClick) summary.notes.push('mouselook: click did not lock the pointer (pointer lock not implemented yet?)');
      },
    };
    let warm = false;
    for (const [scen, s] of Object.entries(SCEN)) {
      if (ONLY && !ONLY.includes(scen)) continue;
      // the first view after load compiles shaders / uploads textures (one ~100 ms frame): warm it up unlogged;
      // and every scenario is dry-run once first (views that only come into sight later in a scenario stall the same way)
      if (!warm) { await setup(s); await wait(900); warm = true; }
      if (!flag('nowarm')) {
        await setup(s); await wait(150);
        const tw = Date.now();
        if (s.mouse) await MOUSE[s.mouse](); else await runKeys(s.keys);
        const rw = tw + s.dur * 1000 - Date.now();
        if (rw > 0) await wait(rw);
      }
      await page.evaluate(() => window.__skate.events());
      await setup(s);
      await wait(150);
      if (RECORD) await page.evaluate(() => window.__recStart());
      await page.evaluate(() => { const D = window.__diag; D.rows = []; D.steps = []; D.keys = []; D.setBar(0); D.on = true; });
      const t0 = Date.now();
      if (s.mouse) await MOUSE[s.mouse](); else await runKeys(s.keys);
      const rest = t0 + s.dur * 1000 - Date.now();
      if (rest > 0) await wait(rest);
      await page.evaluate(() => { window.__diag.on = false; });
      let video = null;
      if (RECORD) {
        const r = await page.evaluate(() => window.__recStop());
        video = `${scen}.${r.mime.includes('mp4') ? 'mp4' : 'webm'}`;
        fs.writeFileSync(path.join(RAW, video), Buffer.from(r.b64, 'base64'));
        summary.scenarios[scen] = { recT0: r.t0 };
      }
      const events = await writeLog(scen, { video, recT0: summary.scenarios[scen]?.recT0 ?? null, input: 'keys' });
      if (scen === 'kickflip' && !events.some((e) => e.type === 'flip')) {
        // the F key is not wired yet: repeat with the legacy arrow-key flip so the scenario still measures a flip
        summary.notes.push('kickflip: F produced no flip, re-ran with the legacy Space + ArrowLeft input');
        console.log('kickflip: no flip from F, retrying with the legacy ArrowLeft input');
        await page.evaluate(() => window.__skate.events());
        await setup(s); await wait(150);
        await page.evaluate(() => { const D = window.__diag; D.rows = []; D.steps = []; D.keys = []; D.setBar(0); D.on = true; });
        const t1 = Date.now();
        await runKeys(s.fallback);
        const r2 = t1 + s.dur * 1000 - Date.now();
        if (r2 > 0) await wait(r2);
        await page.evaluate(() => { window.__diag.on = false; });
        await writeLog(scen, { video: null, input: 'legacy-arrow' });
      }
    }
    // exact displayed frames at 200 Hz for strips (deterministic: the same simulate() the real loop runs, dt = 1/200)
    if (!flag('noexact') && (!ONLY || ONLY.includes('exact200'))) {
      fs.mkdirSync(EXACT, { recursive: true });
      const pos = await page.evaluate(() => {
        const s = window.__skate, g = s.game, D = window.__diag;
        s.manual(true); s.free(); g.rig.idleT = 0; g.rig.userYaw = 0; g.rig.userPitch = 0;
        s.teleport(34.5, 0, 22, 180, 6.0); s.snapCam(); s.camYaw(Math.PI / 2, 0);
        for (let k = 0; k < 100; k++) g.simulate(1 / 200);
        D.rows = []; D.on = true; g.simulate(1 / 200); g.render(1 / 200); D.on = false;
        const r = D.rows[0], h = D.header;
        return [r[h.indexOf('hsx')], r[h.indexOf('hsy')], r[h.indexOf('bsx')], r[h.indexOf('bsy')]];
      });
      const cx = Math.round((pos[0] + pos[2]) / 2), cy = Math.round((pos[1] + pos[3]) / 2);
      const clip = { x: Math.max(0, cx - 110), y: Math.max(0, cy - 170), width: 220, height: 290 };
      await page.evaluate(() => { const D = window.__diag; D.rows = []; D.steps = []; D.on = true; });
      for (let i = 0; i < 24; i++) {
        await page.evaluate(() => { const g = window.__skate.game; g.simulate(1 / 200); g.render(1 / 200); });
        await page.screenshot({ path: path.join(EXACT, `f${String(i).padStart(2, '0')}.png`), clip });
      }
      const rows = await page.evaluate(() => { const D = window.__diag; D.on = false; return D.rows; });
      const header = await page.evaluate(() => window.__diag.header);
      fs.writeFileSync(path.join(EXACT, 'log.json'), JSON.stringify({ header, rows, clip }));
      await page.evaluate(() => { const s = window.__skate; s.game.rig.idleT = 0; s.game.rig.userYaw = 0; s.free(); s.manual(false); });
    }
  } else {
    // controlled sweep: manual clock, simulate + render at exactly 1/rate through the real game path, scripted input
    for (const rate of SWEEP) {
      for (const [scen, s] of Object.entries(SCEN)) {
        if (SWEEP_SKIP.has(scen) || (ONLY && !ONLY.includes(scen))) continue;
        const run = async (keys, label) => {
          await page.evaluate(() => { window.__skate.manual(true); window.__skate.release(); window.__skate.script([]); window.__skate.events(); });
          await setup(s);
          const steps = keys.map(([t, d, code]) => (d ? { at: t, down: [code] } : { at: t, up: [code] }));
          await page.evaluate(({ steps, rate, dur }) => {
            const s = window.__skate, g = s.game, D = window.__diag;
            g.simulate(1 / rate); g.render(1 / rate); // settle the teleport
            s.script(steps);
            D.rows = []; D.steps = []; D.keys = []; D.on = true;
            const n = Math.round(dur * rate);
            for (let i = 0; i < n; i++) { g.simulate(1 / rate); g.render(1 / rate); }
            D.on = false;
            s.script([]); s.release();
          }, { steps, rate, dur: s.dur });
          return writeLog(`${scen}@${rate}`, { input: label, sweepRate: rate, scriptKeys: keys });
        };
        const ev = await run(s.keys, 'scripted');
        if (scen === 'kickflip' && !ev.some((e) => e.type === 'flip')) {
          summary.notes.push(`kickflip@${rate}: F produced no flip, re-ran with the legacy Space + ArrowLeft input`);
          await run(s.fallback, 'scripted-legacy-arrow');
        }
      }
    }
    await page.evaluate(() => window.__skate.manual(false));
  }
} catch (e) {
  summary.error = String(e?.stack ?? e);
  console.log('ERROR', summary.error);
} finally {
  summary.logs = logs;
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  await browser.close();
}
// CFR 60 fps copies of the canvas recordings
if (RECORD) for (const f of fs.readdirSync(RAW)) {
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(RAW, f), '-vf', 'fps=60', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-threads', '4', path.join(out, 'video', f.replace(/\.\w+$/, '.mp4'))], { stdio: 'inherit' });
}
const logsList = fs.readdirSync(LOGS).filter((f) => f.endsWith('.json')).map((f) => path.join(LOGS, f));
const metric = spawnSync('python', [path.join(HERE, 'jitter_metric.py'), ...logsList, '--json', path.join(out, 'metrics.json')], { encoding: 'utf8' });
console.log(metric.stdout || metric.stderr);
const feel = spawnSync('python', [path.join(HERE, 'feel_metric.py'), out], { encoding: 'utf8' });
console.log(feel.stdout || feel.stderr);
console.log('out:', out);
