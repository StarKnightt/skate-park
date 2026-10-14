// Real-time auto-ride check in the browser (run through the capture harness):
// bash tools/heavy.sh E2 node tools/capture/run.mjs tools/sim/auto_browser.mjs --nohmr --q "test&mute&mode=auto" --out E:/shots/skate-park/pass-04/autoride
// env: AUTO_SECS (screenshot pass length, default 75), AUTO_CLIP (60 fps canvas clip seconds, default 20, 0 = off)
import fs from 'node:fs';
import path from 'node:path';

export default async function (ctx) {
  const { page, out, wait } = ctx;
  const secs = Number(process.env.AUTO_SECS ?? 75), clip = Number(process.env.AUTO_CLIP ?? 20);
  const info = await page.evaluate(async () => {
    const g = window.__skate.game;
    let wired = !!g.input.auto;
    if (!wired) {
      // integration not in yet: drive the physics from the autopilot directly
      const m = await import('/src/player/autopilot.ts');
      const a = m.createAutopilot(g);
      g.input.auto = a;
      g.input.sample = (air) => a.sample(1 / 120, air);
    }
    if (g.physics.assist) Object.assign(g.physics.assist, { landing: true, autoGrind: true, fastRecover: true });
    if (!g.input.autoActive) g.input.setAuto?.(true);
    const ph = g.physics, log = (window.__autoLog = { ev: [], rows: [], t0: performance.now() });
    const emit = ph.emit.bind(ph);
    ph.emit = (type, data = {}) => {
      if (['pop', 'grindStart', 'land', 'bail', 'manualStart', 'kickturn', 'vertAir', 'dropIn', 'flip'].includes(type)) {
        log.ev.push([+((performance.now() - log.t0) / 1000).toFixed(2), type, data.name ?? data.kind ?? data.quality ?? data.reason ?? '', +ph.pos.x.toFixed(1), +ph.pos.z.toFixed(1)]);
      }
      return emit(type, data);
    };
    setInterval(() => {
      const a = g.input.auto;
      log.rows.push([+((performance.now() - log.t0) / 1000).toFixed(2), ph.mode, +ph.pos.x.toFixed(2), +ph.pos.y.toFixed(2), +ph.pos.z.toFixed(2), +ph.speed.toFixed(2), a?.lineName ?? '', a?.lap ?? -1, g.input.autoActive]);
    }, 100);
    return { wired, autoActive: g.input.autoActive, mode: new URLSearchParams(location.search).get('mode') };
  });
  console.log('auto-ride wiring:', JSON.stringify(info));
  const shots = path.join(out, 'lap');
  fs.mkdirSync(shots, { recursive: true });
  const t0 = Date.now();
  let i = 0;
  while ((Date.now() - t0) / 1000 < secs) {
    const due = t0 + i * 500;
    if (Date.now() < due) await wait(due - Date.now());
    await page.screenshot({ path: path.join(shots, `a${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 80 });
    i++;
  }
  const log = await page.evaluate(() => window.__autoLog);
  if (clip > 0) {
    await page.evaluate(() => {
      window.__recStart = () => new Promise((resolve) => {
        const stream = window.__skate.game.renderer.domElement.captureStream(60);
        const mime = ['video/mp4;codecs=avc1.640028', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16000000 });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        window.__rec = { rec, chunks, mime };
        rec.onstart = () => resolve(mime);
        rec.start(250);
      });
      window.__recStop = () => new Promise((resolve) => {
        const r = window.__rec;
        r.rec.onstop = async () => {
          const buf = new Uint8Array(await new Blob(r.chunks, { type: r.mime }).arrayBuffer());
          let s = '';
          for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
          resolve({ b64: btoa(s), mime: r.mime });
        };
        r.rec.stop();
      });
    });
    const mime = await page.evaluate(() => window.__recStart());
    await wait(clip * 1000);
    const r = await page.evaluate(() => window.__recStop());
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    fs.writeFileSync(path.join(out, `autoride_clip.${ext}`), Buffer.from(r.b64, 'base64'));
    console.log('clip:', path.join(out, `autoride_clip.${ext}`), mime);
  }
  const log2 = await page.evaluate(() => window.__autoLog);
  fs.writeFileSync(path.join(out, 'autoride_log.json'), JSON.stringify({ info, shots: i, ev: log2.ev, rows: log2.rows }, null, 0));
  const bails = log.ev.filter((e) => e[1] === 'bail');
  const laps = Math.max(...log.rows.map((r) => r[7]));
  const slow = log.rows.filter((r) => r[1] === 'ride' && r[5] < 0.3).length / 10;
  console.log(`screenshots ${i}, events ${log.ev.length}, bails ${bails.length} ${JSON.stringify(bails)}, lap counter ${laps}, ride time below 0.3 m/s ${slow.toFixed(1)} s`);
  console.log('lines visited:', [...new Set(log.rows.map((r) => r[6]))].join(' > '));
  console.log('tricks:', log.ev.filter((e) => e[1] !== 'land').map((e) => `${e[0]}s ${e[1]}${e[2] ? '(' + e[2] + ')' : ''}`).join(', '));
}
