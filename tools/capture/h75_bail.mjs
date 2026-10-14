// Pass 5 #75 proof: real-time bail recoveries (true 60 fps canvas capture, window on DISPLAY2 only), fixed cameras.
// Easy bowl-floor bail (the critic's main bowl E wall case), Easy flat-ground bail with room for the board to roll,
// Pro bowl bail (must be unchanged). Logs the board pose and the rider every frame: riding-again time, frames the board
// stands on its rail, how far the board moves after it came to rest until he steps on.
//   bash tools/heavy.sh c-bail node tools/capture/h75_bail.mjs [--only easy_bowl,easy_flat,pro_bowl]
// -> E:/shots/skate-park/pass-05/clips/h75_*.mp4, sheets/h75_*_strip.jpg, dev/c-bail/h75_report.json
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchMedia, installRecorder, saveRecording, cfr60, dtext } from '../realtime/media_common.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = opt('only', '') ? opt('only', '').split(',') : null;
const BASE = 'http://127.0.0.1:5188/?test&mute';
const OUT = 'E:/shots/skate-park/pass-05';
const WORK = path.join(OUT, 'dev', 'c-bail'), CLIPS = path.join(OUT, 'clips'), SHEETS = path.join(OUT, 'sheets');
for (const d of [WORK, CLIPS, SHEETS]) fs.mkdirSync(d, { recursive: true });
const REPORT = path.join(WORK, 'h75_report.json');
const report = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : {};
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SHEET_PY = path.join(HERE, '..', 'realtime', 'media_sheet.py');
const wait = (page, ms) => page.waitForTimeout(Math.max(0, ms));

const TAKES = {
  // the critic's clip: ride up the main bowl E wall at 6 m/s, bail ('back') once above y -0.7
  easy_bowl: { mode: 'easy', tp: [-21, -2.3, 0.6, 90, 6.0], trig: 'y', y: -0.7, kind: 'back', cam: [-20.6, -0.9, 4.2, -16.6, -1.8, -0.4], label: 'Easy  -  main bowl bail, fast recovery' },
  pro_bowl: { mode: 'pro', tp: [-21, -2.3, 0.6, 90, 6.0], trig: 'y', y: -0.7, kind: 'back', cam: [-20.6, -0.9, 4.2, -16.6, -1.8, -0.4], label: 'Pro  -  main bowl bail, normal recovery' },
  // open plaza west of the funbox, riding east at 5 m/s, a toe-side fall after 0.35 s
  easy_flat: { mode: 'easy', tp: [-15, 0, 5.5, 90, 5.0], trig: 't', t: 0.35, kind: 'face', cam: [-10.5, 3.4, 12.5, -10.5, 0.2, 5.2], label: 'Easy  -  flat ground bail, fast recovery' },
};

function frameLog() {
  const g = window.__skate.game, L = (window.__h75 = { f: [], on: false });
  const tick = (now) => {
    if (L.on) {
      const b = g.board.root, r = g.skater.root, q = b.quaternion;
      // board up vector y (deck normal): 1 wheels down, -1 upside down, ~0 standing on its rail
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      const bb = g.physics.bail?.board;
      L.f.push([now, g.skater.phase, g.physics.mode, +b.position.x.toFixed(3), +b.position.y.toFixed(3), +b.position.z.toFixed(3), +upY.toFixed(3),
        +r.position.x.toFixed(3), +r.position.z.toFixed(3), bb ? (bb.gliding ? 2 : bb.asleep ? 1 : 0) : -1]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function analyse(f, t0) {
  const T = (i) => (f[i][0] - t0) / 1000;
  const iB = f.findIndex((x) => x[2] === 'bail');
  if (iB < 0) return { bailed: false };
  const iR = f.findIndex((x, i) => i > iB && x[1] === 'ride' && x[2] === 'ride');
  const iS = f.findIndex((x, i) => i > iB && x[1] === 'stepon');
  const iW = f.findIndex((x, i) => i > iB && x[1] === 'walk');
  // board speed from frame to frame; rest = the last time it moved faster than 4 cm/s before the step-on
  const end = iS > 0 ? iS : f.length - 1;
  let railFrames = 0, railRun = 0, railMax = 0, lastMove = iB, glideFrames = 0;
  for (let i = iB + 1; i <= end; i++) {
    const dt = (f[i][0] - f[i - 1][0]) / 1000 || 1 / 60;
    const v = Math.hypot(f[i][3] - f[i - 1][3], f[i][4] - f[i - 1][4], f[i][5] - f[i - 1][5]) / dt;
    if (v > 0.04) lastMove = i;
    if (f[i][9] === 2) glideFrames++;
    const rail = Math.abs(f[i][6]) < 0.42 && v < 0.25 && T(i) > T(iB) + 0.15;
    railRun = rail ? railRun + dt : 0; railMax = Math.max(railMax, railRun); if (rail) railFrames++;
  }
  const rest = f[lastMove];
  const moveAfterWalk = iW > 0 ? Math.hypot(f[end][3] - f[iW][3], f[end][5] - f[iW][5]) : null;
  // after it came to rest, did the board get closer to him by itself? (distance board -> rider, rest .. step-on start)
  const dRest = Math.hypot(rest[3] - rest[7], rest[5] - rest[8]);
  const restToStep = Math.hypot(f[end][3] - rest[3], f[end][5] - rest[5]);
  const ride = iR > 0 ? f[iR] : null;
  return {
    bailed: true, ridingAgain: iR > 0 ? +(T(iR) - T(iB)).toFixed(2) : null, onBoard: iS > 0 ? +(T(iS) - T(iB)).toFixed(2) : null,
    boardRestAt: +(T(lastMove) - T(iB)).toFixed(2), boardRestUpY: rest[6], boardRestDistToRider: +dRest.toFixed(2),
    boardMovedAfterRestUntilStepOn: +restToStep.toFixed(3), boardMovedDuringWalk: moveAfterWalk == null ? null : +moveAfterWalk.toFixed(3),
    boardGlideFrames: glideFrames, railFrames, railMaxS: +railMax.toFixed(2),
    walkStart: iW > 0 ? +(T(iW) - T(iB)).toFixed(2) : null, stepOnStart: iS > 0 ? +(T(iS) - T(iB)).toFixed(2) : null,
    rideBoardPos: ride ? [ride[3], ride[4], ride[5]] : null, restBoardPos: [rest[3], rest[4], rest[5]],
    tBail: +T(iB).toFixed(3), tRide: iR > 0 ? +T(iR).toFixed(3) : null,
    phases: f.filter((x, i) => i === 0 || x[1] !== f[i - 1][1]).map((x) => `${x[1]}@${((x[0] - f[iB][0]) / 1000).toFixed(2)}`).join(' '),
  };
}

const s = await launchMedia({ url: BASE + '&mode=easy' });
try {
  for (const [name, tk] of Object.entries(TAKES)) {
    if (ONLY && !ONLY.includes(name)) continue;
    const { page } = s;
    await page.goto(BASE + '&mode=' + tk.mode, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__skate && window.__skate.ready, null, { timeout: 60000 });
    await wait(page, 600);
    await page.evaluate(installRecorder);
    await page.evaluate(frameLog);
    // the first recording of a page drops frames while the encoder starts: record and discard 1.5 s first
    await page.evaluate(() => window.__recStart(16000000)); await wait(page, 1500); await page.evaluate(() => window.__recStop());
    const assist = await page.evaluate(() => ({ ...window.__skate.game.physics.assist }));
    await page.evaluate((tk) => {
      const g = window.__skate.game, ph = g.physics, step = ph.step.bind(ph);
      window.__arm = false; window.__armT = 0;
      ph.step = (dt, inp) => {
        step(dt, inp);
        if (!window.__arm || ph.mode !== 'ride') return;
        window.__armT += dt;
        if (tk.trig === 'y' ? ph.pos.y > tk.y : window.__armT >= tk.t) { window.__arm = false; ph.toBail(tk.kind, 'test'); }
      };
      window.__skate.hud(false);
    }, tk);
    await page.evaluate((tk) => { const s = window.__skate; s.free(); s.teleport(tk.tp[0], tk.tp[1], tk.tp[2], tk.tp[3], 0); s.view(...tk.cam); }, tk);
    await wait(page, 900);
    await page.evaluate(() => window.__skate.events());
    await page.evaluate(() => window.__recStart(16000000));
    const t0 = await page.evaluate(() => window.__rec.t0);
    await page.evaluate((tk) => { const s = window.__skate; window.__h75.f.length = 0; window.__h75.on = true; s.teleport(tk.tp[0], tk.tp[1], tk.tp[2], tk.tp[3], tk.tp[4]); s.view(...tk.cam); window.__armT = 0; window.__arm = true; }, tk);
    const deadline = Date.now() + (tk.mode === 'pro' ? 20000 : 12000);
    let back = false, seenBail = false;
    while (Date.now() < deadline) {
      const st = await page.evaluate(() => ({ m: window.__skate.game.physics.mode, p: window.__skate.game.skater.phase }));
      if (st.m === 'bail') seenBail = true;
      if (seenBail && st.m === 'ride' && st.p === 'ride') { back = true; break; }
      await wait(page, 10);
    }
    await wait(page, 1000);
    const rec = await saveRecording(page, path.join(WORK, `h75_${name}_raw.mp4`));
    const f = await page.evaluate(() => { window.__h75.on = false; return window.__h75.f; });
    const a = analyse(f, rec.t0);
    a.assist = assist; a.recovered = back; a.raw = rec.file;
    fs.writeFileSync(path.join(WORK, `h75_${name}_frames.json`), JSON.stringify(f));
    console.log(name, JSON.stringify(a));
    report[name] = a;
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
    // constant 60 fps clip with captions: label, phase, riding-again time
    const dur = (f[f.length - 1][0] - rec.t0) / 1000;
    const ph = f.filter((x, i) => i === 0 || x[1] !== f[i - 1][1]).map((x) => [(x[0] - rec.t0) / 1000, x[1]]);
    const caps = ph.map(([t, p], i) => dtext(p === 'ride' && t > (a.tBail ?? 0) ? 'riding again' : p, 20, 62, t, i + 1 < ph.length ? ph[i + 1][0] : dur + 1, { size: 26, color: '0xFFD34D' }));
    const vf = [dtext(tk.label + '  |  real time, 60 fps canvas capture, fixed camera', 20, 16, null, null, { size: 26 }), ...caps,
      ...(a.ridingAgain != null ? [dtext(`riding again ${a.ridingAgain.toFixed(2)} s after the bail`, 20, 102, a.tRide, dur + 1, { size: 26 })] : [])].join(',');
    const clip = path.join(CLIPS, `h75_${name}.mp4`);
    cfr60(rec.file, clip, vf);
    // strip: every 0.1 s from the bail to 0.4 s after riding again
    if (a.tBail != null) {
      const tEnd = Math.min(dur - 0.05, (a.tRide ?? dur) + 0.4), times = [];
      for (let t = a.tBail - 0.1; t <= tEnd + 1e-6; t += 0.1) {
        const k = f.findIndex((x) => (x[0] - rec.t0) / 1000 >= t);
        times.push([+t.toFixed(3), `+${(t - a.tBail).toFixed(1)}s ${k >= 0 ? f[k][1] : ''}`]);
      }
      const tj = path.join(WORK, `h75_${name}_times.json`);
      fs.writeFileSync(tj, JSON.stringify(times));
      spawnSync('python', [SHEET_PY, clip, path.join(SHEETS, `h75_${name}_strip.jpg`), tj, '10', `h75 ${name}: ${tk.label} | every 0.1 s from the bail | riding again ${a.ridingAgain ?? '-'} s`], { stdio: 'inherit' });
    }
  }
} finally { await s.browser.close(); }
