// c-wall (#78) real-time proof: the bowl carve (rt protocol bowl_carve keys, Easy) in the follow view and side-on to the
// wall, plus one auto-ride bowl pass; real time at 60 fps (?fps=60), canvas captureStream(60) + MediaRecorder, per-frame
// diag logs (board up.y, body root quaternion) for the strips. Headed Chrome on DISPLAY2 only (common.mjs launch).
//   bash tools/heavy.sh c-wall node tools/realtime/wall_capture.mjs [--only follow,side,auto] [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { launch, installDiag } from './common.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = opt('only', 'follow,side,auto').split(',');
const OUT = opt('out', 'E:/shots/skate-park/pass-05/dev/c-wall/rt');
fs.mkdirSync(OUT, { recursive: true });
const KEY = (code, t, d) => [[t, 1, code], [t + d, 0, code]];
const CARVE = { at: [-28, -2.3, -2.0, 90, 7.5], dur: 4.6, keys: [...KEY('KeyA', 0.2, 0.4), ...KEY('KeyD', 1.3, 0.6), ...KEY('KeyA', 2.6, 0.8)] };
const SCEN = {
  follow: { ...CARVE },
  side: { ...CARVE, view: [-20.4, -0.5, -1.3, -15.6, -1.1, -3.1] },
};

async function session(url, fn) {
  const { browser, page, logs } = await launch({ url });
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
    await fn(page);
  } finally {
    if (logs.length) fs.writeFileSync(path.join(OUT, 'console.txt'), logs.join('\n'));
    await browser.close();
  }
}
const save = async (page, name) => {
  const r = await page.evaluate(() => window.__recStop());
  const video = `${name}.${r.mime.includes('mp4') ? 'mp4' : 'webm'}`;
  fs.writeFileSync(path.join(OUT, video), Buffer.from(r.b64, 'base64'));
  const d = await page.evaluate(() => { const D = window.__diag; return { header: D.header, rows: D.rows, keys: D.keys }; });
  const events = await page.evaluate(() => window.__skate.events());
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify({ name, ...d, events, recT0: r.t0, video }));
  console.log(name, d.rows.length, 'frames |', events.map((e) => e.type).join(','));
};

if (ONLY.some((k) => SCEN[k])) {
  await session('http://127.0.0.1:5188/?test&mute&fps=60', async (page) => {
    const wait = (ms) => page.waitForTimeout(ms);
    const setup = (o) => page.evaluate((o) => {
      const s = window.__skate, r = s.game.rig;
      s.free(); r.idleT = 0; r.userYaw = 0; r.userPitch = 0; r.distOverride = null;
      s.teleport(...o.at); s.snapCam();
      if (o.view) s.view(...o.view);
    }, o);
    const runKeys = async (keys) => {
      const t0 = Date.now();
      for (const [t, d, code] of keys) {
        const w = t0 + t * 1000 - Date.now();
        if (w > 0) await wait(w);
        if (d) await page.keyboard.down(code); else await page.keyboard.up(code);
      }
    };
    let warm = false;
    for (const [name, s] of Object.entries(SCEN)) {
      if (!ONLY.includes(name)) continue;
      if (!warm) { await setup(s); await wait(1500); warm = true; }
      await setup(s); await wait(150); await runKeys(s.keys); await wait(s.dur * 1000 - 3400);
      await page.evaluate(() => window.__skate.events());
      await setup(s); await wait(200);
      await page.evaluate(() => window.__recStart());
      await page.evaluate(() => { const D = window.__diag; D.rows = []; D.steps = []; D.keys = []; D.on = true; });
      const t0 = Date.now();
      await runKeys(s.keys);
      const rest = t0 + s.dur * 1000 - Date.now();
      if (rest > 0) await wait(rest);
      await page.evaluate(() => { window.__diag.on = false; });
      await save(page, 'h78_' + name);
    }
  });
}
if (ONLY.includes('auto')) {
  // auto-ride from the spawn: the intro reaches the bowl drop-in at ~19.5 s; log the drop-in, the bowl lines and the exit
  await session('http://127.0.0.1:5188/?test&mute&mode=auto&fps=60', async (page) => {
    await page.waitForTimeout(16500);
    await page.evaluate(() => window.__skate.events());
    await page.evaluate(() => window.__recStart());
    await page.evaluate(() => { const D = window.__diag; D.rows = []; D.steps = []; D.keys = []; D.on = true; });
    await page.waitForTimeout(24000);
    await page.evaluate(() => { window.__diag.on = false; });
    await save(page, 'h78_auto');
  });
}
