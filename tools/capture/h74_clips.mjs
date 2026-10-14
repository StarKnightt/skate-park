// Pass-5 c-trick (#74) proof: real-time 60 fps canvas recordings of the rolling F quick pop (Pro: F, D+F, S+F, W+F) and
// Easy (tap-Space ollie, F in the air, F rolling), side-on camera as rt_clips f_flips, real Playwright keys.
// Every rendered frame is logged (physics mode, board height, skater hip height, events); a teleport after the recorder
// starts is the sync frame between the log and the video (MediaRecorder's start event comes ~0.2 s after its first frame).
//   bash tools/heavy.sh c-trick node tools/capture/h74_clips.mjs [--only pro,easy]
// -> E:/shots/skate-park/pass-05/clips/h74_*.mp4, dev/c-trick/h74_<take>_log.json (+ raw)
import fs from 'node:fs';
import path from 'node:path';
import { launchMedia, installRecorder, saveRecording, cfr60, dtext, keyViewer } from '../realtime/media_common.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = opt('only', 'pro,easy').split(',');
const P5 = 'E:/shots/skate-park/pass-05';
const DEV = path.join(P5, 'dev', 'c-trick'), CLIPS = path.join(P5, 'clips');
for (const d of [DEV, CLIPS]) fs.mkdirSync(d, { recursive: true });
const BASE = 'http://127.0.0.1:5188/?test&mute';
const wait = (page, ms) => page.waitForTimeout(Math.max(0, ms));

function frameLog() {
  const g = window.__skate.game, L = (window.__h74 = { frames: [], ev: [], sync: null });
  const push = g.eventLog.push.bind(g.eventLog);
  g.eventLog.push = (...a) => { for (const x of a) L.ev.push({ ...x, wall: performance.now(), sim: g.simTime }); return push(...a); };
  const R = g.render.bind(g);
  g.render = (dt) => {
    const r = R(dt);
    const v = g.view, sk = g.skater;
    L.frames.push([+performance.now().toFixed(2), v.mode, +v.pos.x.toFixed(3), +v.pos.y.toFixed(4), +v.pos.z.toFixed(3), +sk.Pout.hipH.toFixed(4), +sk.crouchS.x.toFixed(3), +g.simTime.toFixed(4)]);
    if (L.frames.length > 40000) L.frames.splice(0, 20000);
    return r;
  };
}

async function take(page, name, { mode, z0, v, keys, end, labels }) {
  const lane = { x: 34.5, z: z0 };
  // pre-roll far down the lane, then the recorder, then the sync teleport
  await page.evaluate(([x, v]) => { const s = window.__skate, r = s.game.rig; s.free(); r.idleT = 0; r.userYaw = 0; r.userPitch = 0; r.distOverride = null; s.teleport(x, 0, -22, 180, v); s.snapCam(); s.camYaw(Math.PI / 2, 0); }, [lane.x, v]);
  await wait(page, 600);
  await page.evaluate(() => window.__recStart(16000000));
  await page.evaluate(() => { const L = window.__h74; L.frames.length = 0; L.ev.length = 0; window.__keys.length = 0; L.recStartCall = window.__rec.t0; });
  await wait(page, 450);
  await page.evaluate(([x, z, v, easy]) => {
    const s = window.__skate, L = window.__h74;
    L.sync = performance.now();
    s.teleport(x, 0, z, 180, v); s.snapCam(); s.camYaw(Math.PI / 2, 0);
    if (easy) s.input.armCruise();
  }, [lane.x, z0, v, mode === 'easy']);
  await wait(page, 500);
  const t0 = Date.now();
  for (const [t, d, code] of keys) {
    await wait(page, t0 + t * 1000 - Date.now());
    if (d) await page.keyboard.down(code); else await page.keyboard.up(code);
  }
  await wait(page, t0 + end * 1000 - Date.now());
  const raw = path.join(DEV, `h74_${name}_raw.mp4`);
  const rec = await saveRecording(page, raw);
  const log = await page.evaluate(() => ({ ...window.__h74, keys: window.__keys.slice() }));
  log.recT0 = rec.t0; log.rawFile = rec.file; log.name = name; log.mode = mode;
  fs.writeFileSync(path.join(DEV, `h74_${name}_log.json`), JSON.stringify(log));
  return log;
}

async function main() {
  const out = {};
  if (ONLY.includes('pro')) {
    const s = await launchMedia({ url: BASE + '&mode=pro' });
    try {
      await s.page.evaluate(installRecorder); await s.page.evaluate(frameLog);
      // warm the recorder (its first run drops frames)
      await s.page.evaluate(() => window.__recStart(16000000)); await wait(s.page, 1500); await s.page.evaluate(() => window.__recStop());
      const keys = [
        [0.5, 1, 'KeyF'], [0.55, 0, 'KeyF'],
        [2.2, 1, 'KeyD'], [2.26, 1, 'KeyF'], [2.31, 0, 'KeyF'], [2.36, 0, 'KeyD'],
        [3.9, 1, 'KeyS'], [3.96, 1, 'KeyF'], [4.01, 0, 'KeyF'], [4.06, 0, 'KeyS'],
        [5.6, 1, 'KeyW'], [5.66, 1, 'KeyF'], [5.71, 0, 'KeyF'], [5.76, 0, 'KeyW'],
      ];
      const labels = [[0.5, 'F while rolling  ->  kickflip'], [2.2, 'D + F  ->  heelflip'], [3.9, 'S + F  ->  pop shove-it'], [5.6, 'W + F  ->  tre flip']];
      out.pro = await take(s.page, 'pro', { mode: 'pro', z0: 23.5, v: 4.6, keys, end: 7.4, labels });
      out.pro.labels = labels; out.pro.logs = s.logs;
    } finally { await s.browser.close(); }
  }
  if (ONLY.includes('easy')) {
    const s = await launchMedia({ url: BASE + '&mode=easy' });
    try {
      await s.page.evaluate(installRecorder); await s.page.evaluate(frameLog);
      await s.page.evaluate(() => window.__recStart(16000000)); await wait(s.page, 1500); await s.page.evaluate(() => window.__recStop());
      const keys = [
        [0.5, 1, 'Space'], [0.56, 0, 'Space'],
        [2.2, 1, 'Space'], [2.26, 0, 'Space'], [2.45, 1, 'KeyF'], [2.5, 0, 'KeyF'],
        [4.0, 1, 'KeyF'], [4.05, 0, 'KeyF'],
        [5.6, 1, 'KeyF'], [5.65, 0, 'KeyF'],
      ];
      const labels = [[0.5, 'EASY  tap Space  ->  ollie'], [2.2, 'EASY  tap Space, F in the air  ->  flip'], [4.0, 'EASY  F while rolling  ->  quick pop + flip'], [5.6, 'EASY  F while rolling  ->  next flip']];
      out.easy = await take(s.page, 'easy', { mode: 'easy', z0: 23.5, v: 4.3, keys, end: 7.4, labels });
      out.easy.labels = labels; out.easy.logs = s.logs;
    } finally { await s.browser.close(); }
  }
  // encode: captions placed with the sync offset (video t of a perf time = (perf - recT0)/1000 + off, off fitted in post)
  for (const [k, log] of Object.entries(out)) {
    fs.writeFileSync(path.join(DEV, `h74_${k}_log.json`), JSON.stringify(log));
    console.log(k, 'frames', log.frames.length, 'events', log.ev.filter((e) => ['windup', 'pop', 'flip', 'flipDone', 'land', 'bail'].includes(e.type)).map((e) => `${e.type}${e.kind ? ':' + e.kind : ''}${e.quality ? ':' + e.quality : ''}@${((e.wall - log.recT0) / 1000).toFixed(3)}`).join(' '));
    if (log.logs?.length) console.log(k, 'console:', log.logs.slice(0, 5).join(' | '));
  }
}
await main();
