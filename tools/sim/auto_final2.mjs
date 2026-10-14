// Real-time auto-ride capture: full lap clip, player handoff clip, start-screen attract clip (60 fps canvas recordings).
// bash tools/heavy.sh E2 node tools/capture/run.mjs tools/sim/auto_final2.mjs --nohmr --q "test&mute&mode=auto" --out E:/shots/skate-park/pass-04/autoride/final2
// env: LAP_SECS (default 80), HANDOFF (1/0), ATTRACT_SECS (default 22, 0 = skip)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RECORDER = () => {
  window.__rec2 = {
    start(fps = 60, bps = 12e6) {
      const stream = window.__skate.game.renderer.domElement.captureStream(fps);
      const mime = ['video/mp4;codecs=avc1.640028', 'video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps });
      this.chunks = []; this.mime = mime; this.rec = rec;
      rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      return new Promise((res) => { rec.onstart = () => res(mime); rec.start(1000); });
    },
    async pull() {
      const c = this.chunks.splice(0);
      if (!c.length) return '';
      const buf = new Uint8Array(await new Blob(c).arrayBuffer());
      let s = '';
      for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
      return btoa(s);
    },
    stop() { return new Promise((res) => { this.rec.onstop = () => res(); this.rec.stop(); }); },
  };
};

const LOGGER = () => {
  const g = window.__skate.game, ph = g.physics, log = (window.__autoLog = { ev: [], rows: [], t0: performance.now() });
  const emit = ph.emit.bind(ph);
  ph.emit = (type, data = {}) => {
    if (['pop', 'grindStart', 'land', 'bail', 'manualStart', 'kickturn', 'vertAir', 'dropIn', 'flip'].includes(type)) {
      log.ev.push([+((performance.now() - log.t0) / 1000).toFixed(2), type, data.name ?? data.kind ?? data.quality ?? data.reason ?? '', +ph.pos.x.toFixed(1), +ph.pos.z.toFixed(1)]);
    }
    return emit(type, data);
  };
  setInterval(() => {
    const a = g.input.auto, i = g.input;
    log.rows.push([+((performance.now() - log.t0) / 1000).toFixed(2), ph.mode, +ph.pos.x.toFixed(2), +ph.pos.y.toFixed(2), +ph.pos.z.toFixed(2),
      +ph.speed.toFixed(2), a?.lineName ?? '', a?.lap ?? -1, i.autoActive, !!i.autoSuspended, !!i.userActive, a?.hp ? `${a.hp.passes}p${a.hp.airs}a` : '']);
  }, 100);
};

async function record(page, file, secs, during) {
  const mime = await page.evaluate(() => window.__rec2.start());
  fs.writeFileSync(file, Buffer.alloc(0));
  const t0 = Date.now();
  let done = false;
  const pump = (async () => {
    while (!done) {
      await page.waitForTimeout(4000);
      const b = await page.evaluate(() => window.__rec2.pull());
      if (b) fs.appendFileSync(file, Buffer.from(b, 'base64'));
    }
  })();
  if (during) await during(t0);
  const left = secs * 1000 - (Date.now() - t0);
  if (left > 0) await page.waitForTimeout(left);
  done = true;
  await pump;
  await page.evaluate(() => window.__rec2.stop());
  const b = await page.evaluate(() => window.__rec2.pull());
  if (b) fs.appendFileSync(file, Buffer.from(b, 'base64'));
  return mime;
}

function probe(file) {
  try {
    const o = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height:format=duration', '-of', 'json', file]).toString();
    const j = JSON.parse(o), s = j.streams?.[0] ?? {}, d = +j.format?.duration;
    return { frames: +s.nb_read_frames, secs: +d.toFixed(2), fps: +(s.nb_read_frames / d).toFixed(1), size: `${s.width}x${s.height}` };
  } catch (e) { return { error: String(e).slice(0, 200) }; }
}
function sheet(file, out, every) {
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vf', `fps=1/${every},scale=480:-1,tile=4x4`, '-frames:v', '1', out]);
    return out;
  } catch (e) { return 'sheet failed: ' + String(e).slice(0, 160); }
}

export default async function (ctx) {
  const { page, out } = ctx;
  const lapSecs = Number(process.env.LAP_SECS ?? 80), attractSecs = Number(process.env.ATTRACT_SECS ?? 22), handoff = process.env.HANDOFF !== '0';
  fs.mkdirSync(out, { recursive: true });
  const info = await page.evaluate(() => {
    const g = window.__skate.game;
    if (g.physics.assist) Object.assign(g.physics.assist, { landing: true, autoGrind: true, fastRecover: true });
    if (!g.input.autoActive) g.input.setAuto(true);
    return { autoActive: g.input.autoActive, pos: g.physics.pos.toArray().map((v) => +v.toFixed(2)) };
  });
  await page.evaluate(RECORDER);
  await page.evaluate(LOGGER);
  console.log('start:', JSON.stringify(info));
  const summary = { info };

  // ---- 1. full lap (spawn intro + one lap)
  const lapFile = path.join(out, 'autoride_lap.mp4');
  summary.lapMime = await record(page, lapFile, lapSecs);
  summary.lap = probe(lapFile);
  summary.lapSheet = sheet(lapFile, path.join(out, 'lap_sheet.jpg'), Math.max(1, Math.round(lapSecs / 16)));
  const log1 = await page.evaluate(() => window.__autoLog);

  // ---- 2. handoff: the player steers with W/A/D for a few seconds, then idles until auto-ride takes over again
  if (handoff) {
    const hoFile = path.join(out, 'autoride_handoff.mp4');
    const tHand = await page.evaluate(() => (performance.now() - window.__autoLog.t0) / 1000);
    summary.handoffMime = await record(page, hoFile, 17, async () => {
      await page.waitForTimeout(2000);
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyA'); await page.waitForTimeout(1400); await page.keyboard.up('KeyA');
      await page.keyboard.down('KeyD'); await page.waitForTimeout(1400); await page.keyboard.up('KeyD');
      await page.waitForTimeout(600);
      await page.keyboard.up('KeyW');
    });
    summary.handoff = probe(hoFile);
    const rows = (await page.evaluate(() => window.__autoLog.rows)).filter((r) => r[0] >= tHand);
    const first = (f) => rows.find(f)?.[0];
    const tUser = first((r) => r[9]), tBack = tUser ? rows.find((r) => r[0] > tUser && r[8] && !r[9])?.[0] : undefined;
    summary.handoffTimes = { recordStart: +tHand.toFixed(2), playerTookOver: tUser, autoResumed: tBack, idleToResume: tBack && tUser ? +(tBack - tUser - 4.2).toFixed(2) : null };
  }
  const log2 = await page.evaluate(() => window.__autoLog);
  fs.writeFileSync(path.join(out, 'autoride_log.json'), JSON.stringify({ ev: log2.ev, rows: log2.rows }));

  // ---- 3. start screen: fresh load in attract mode (title card up, calm lap from the spawn)
  if (attractSecs > 0) {
    await page.goto(page.url().replace(/\?.*$/, '') + '?test&attract&mute', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__skate && window.__skate.ready, null, { timeout: 120000 });
    await page.evaluate(RECORDER);
    await page.evaluate(LOGGER);
    const a = await page.evaluate(() => ({ attract: window.__skate.game.attract, autoActive: window.__skate.game.input.autoActive }));
    const atFile = path.join(out, 'attract.mp4');
    summary.attractState = a;
    summary.attractMime = await record(page, atFile, attractSecs);
    summary.attract = probe(atFile);
    summary.attractSheet = sheet(atFile, path.join(out, 'attract_sheet.jpg'), Math.max(1, Math.round(attractSecs / 16)));
    const la = await page.evaluate(() => window.__autoLog);
    summary.attractEvents = la.ev.filter((e) => e[1] !== 'land').map((e) => `${e[0]}s ${e[1]}${e[2] ? '(' + e[2] + ')' : ''}`);
    summary.attractFirstMove = la.rows.find((r) => r[5] > 0.5)?.[0];
    summary.attractBails = la.ev.filter((e) => e[1] === 'bail').length;
    fs.writeFileSync(path.join(out, 'attract_log.json'), JSON.stringify({ ev: la.ev, rows: la.rows }));
  }

  const ev = log1.ev, bails = log2.ev.filter((e) => e[1] === 'bail');
  summary.lapEvents = ev.filter((e) => e[1] !== 'land').map((e) => `${e[0]}s ${e[1]}${e[2] ? '(' + e[2] + ')' : ''}`);
  summary.bails = bails;
  summary.lines = [...new Set(log1.rows.map((r) => r[6]))];
  summary.slowSecs = log1.rows.filter((r) => r[1] === 'ride' && r[5] < 0.3).length / 10;
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1).slice(0, 6000));
}
