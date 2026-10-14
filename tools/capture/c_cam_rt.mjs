// Pass 5 c-cam (#76): real-time auto-ride recordings with a per-frame camera / framing log (60 fps canvas recording).
// bash tools/heavy.sh c-cam node tools/capture/run.mjs tools/capture/c_cam_rt.mjs --nohmr --q "test&mute&mode=auto" --out <dir>
// env TAKES=hp,bowl,se (default all). hp: the lap until the 'mini quarter' line (past the half pipe's side wall);
// bowl: the 'main bowl' line + a W/A/D handoff, recorded until well after auto-ride resumes; se: auto-ride switched on
// behind the south-east ledge (15.8, 20.7), recorded until he is back on the lap line.
import fs from 'node:fs';
import path from 'node:path';

const RECORDER = () => {
  window.__rec2 = {
    start(fps = 60, bps = 14e6) {
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

// per displayed frame: rig state + where his cap top and board are on screen (NDC y: +1 top edge, -1 bottom edge)
const LOGGER = () => {
  const g = window.__skate.game;
  const V = g.camera.position.constructor;
  const a = new V(), b = new V();
  const log = (window.__camLog = { rows: [], t0: performance.now(), on: true });
  const ndc = (p) => { const q = p.clone().applyMatrix4(g.camera.matrixWorldInverse); const behind = q.z > -0.05; p.project(g.camera); return [+p.x.toFixed(3), +p.y.toFixed(3), behind]; };
  const tick = () => {
    if (!log.on) return;
    const v = g.view, i = g.rig.info, ap = g.input.auto;
    a.copy(v.pos).addScaledVector(v.up, 1.7); b.copy(v.pos);
    const h = ndc(a), bd = ndc(b);
    let onLine = false;
    if (ap && ap.nodes?.length) {
      const n = ap.nodes, p = n[ap.seg], q = n[(ap.seg + 1) % n.length];
      const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((v.pos.x - p.x) * dx + (v.pos.z - p.z) * dz) / l2));
      onLine = Math.hypot(v.pos.x - p.x - dx * u, v.pos.z - p.z - dz * u) < 1.2;
    }
    log.rows.push([+((performance.now() - log.t0) / 1000).toFixed(3), v.mode, +v.pos.x.toFixed(2), +v.pos.y.toFixed(2), +v.pos.z.toFixed(2),
      +v.speed.toFixed(2), h[1], bd[1], h[0], bd[0], h[2] || bd[2], +i.d.toFixed(2), +i.wantD.toFixed(2), +i.clear.toFixed(2), +(i.fov ?? 0).toFixed(1),
      +i.avoid.toFixed(2), +(i.rise ?? 0).toFixed(2), +i.elev.toFixed(2), ap?.lineName ?? '', onLine, g.input.autoActive, !!g.input.autoSuspended]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const COLS = ['t', 'mode', 'x', 'y', 'z', 'speed', 'headY', 'boardY', 'headX', 'boardX', 'behind', 'd', 'wantD', 'clear', 'fov', 'avoid', 'rise', 'elev', 'line', 'onLine', 'auto', 'suspended'];

async function record(page, file, during) {
  await page.evaluate(() => { window.__camLog.rows.length = 0; window.__camLog.t0 = performance.now(); });
  const mime = await page.evaluate(() => window.__rec2.start());
  fs.writeFileSync(file, Buffer.alloc(0));
  let done = false;
  const pump = (async () => {
    while (!done) {
      await page.waitForTimeout(3000);
      const b = await page.evaluate(() => window.__rec2.pull());
      if (b) fs.appendFileSync(file, Buffer.from(b, 'base64'));
    }
  })();
  const extra = await during();
  done = true;
  await pump;
  await page.evaluate(() => window.__rec2.stop());
  const b = await page.evaluate(() => window.__rec2.pull());
  if (b) fs.appendFileSync(file, Buffer.from(b, 'base64'));
  const rows = await page.evaluate(() => window.__camLog.rows);
  return { mime, rows, extra };
}
const lineIs = (page, name) => page.evaluate((n) => window.__skate.game.input.auto?.lineName === n, name);
async function waitLine(page, name, ms = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && (await lineIs(page, name))) await page.waitForTimeout(100);
  while (Date.now() - t0 < ms && !(await lineIs(page, name))) await page.waitForTimeout(50);
  return Date.now() - t0 < ms;
}
function summarize(rows) {
  const ride = rows.filter((r) => ['ride', 'air', 'grind'].includes(r[1]));
  const headOut = ride.filter((r) => r[10] || r[6] > 1 || Math.abs(r[8]) > 1).length;
  const boardOut = ride.filter((r) => r[10] || r[7] < -1 || Math.abs(r[9]) > 1).length;
  const big = ride.filter((r) => (r[6] - r[7]) / 2 > 0.7).length;
  let maxStep = 0;
  for (let k = 1; k < rows.length; k++) maxStep = Math.max(maxStep, Math.abs(rows[k][11] - rows[k - 1][11]));
  const minD = Math.min(...ride.map((r) => r[11]));
  const dts = rows.slice(1).map((r, k) => r[0] - rows[k][0]).sort((x, y) => x - y);
  return { frames: rows.length, rideFrames: ride.length, headOut, boardOut, big, minBoom: +minD.toFixed(2), maxBoomStepPerFrame: +maxStep.toFixed(3), medianDt: dts[dts.length >> 1] };
}

export default async function (ctx) {
  const { page, out } = ctx;
  fs.mkdirSync(out, { recursive: true });
  const takes = (process.env.TAKES ?? 'hp,bowl,se').split(',');
  await page.evaluate(() => {
    const g = window.__skate.game;
    if (g.physics.assist) Object.assign(g.physics.assist, { landing: true, autoGrind: true, fastRecover: true });
    if (!g.input.autoActive) g.input.setAuto(true);
  });
  await page.evaluate(RECORDER);
  await page.evaluate(LOGGER);
  const res = {};
  const save = (name, r) => {
    fs.writeFileSync(path.join(out, name + '_log.json'), JSON.stringify({ cols: COLS, rows: r.rows }));
    res[name] = { mime: r.mime, ...summarize(r.rows), ...(r.extra ?? {}) };
    console.log(name, JSON.stringify(res[name]));
  };
  if (takes.includes('hp')) {
    // the lap's half pipe -> mini quarter: past the west quarter pipe's side wall (the critic's clip50 f4740 moment)
    const ok = await waitLine(page, 'half pipe airs');
    const r = await record(page, path.join(out, 'hp_raw.mp4'), async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000 && !(await lineIs(page, 'mini quarter'))) await page.waitForTimeout(100);
      await page.waitForTimeout(9000);
      return { foundLine: ok };
    });
    save('hp', r);
  }
  if (takes.includes('bowl')) {
    // the lap's bowl line, then the clip51 handoff: W + A 1.4 s + D 1.4 s, release, auto-ride resumes ~4 s later
    const ok = await waitLine(page, 'main bowl');
    await page.waitForTimeout(1500);
    const r = await record(page, path.join(out, 'bowl_raw.mp4'), async () => {
      await page.waitForTimeout(1500);
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyA'); await page.waitForTimeout(1400); await page.keyboard.up('KeyA');
      await page.keyboard.down('KeyD'); await page.waitForTimeout(1400); await page.keyboard.up('KeyD');
      await page.waitForTimeout(600);
      await page.keyboard.up('KeyW');
      await page.waitForTimeout(11000);
      return { foundLine: ok };
    });
    save('bowl', r);
  }
  if (takes.includes('se')) {
    // auto-ride switched on (as Q does) while he stands behind the south-east ledge
    await page.evaluate(() => { const g = window.__skate.game; g.input.setAuto(false); window.__skate.teleport(15.8, 0, 20.7, 184, 0.3); });
    await page.waitForTimeout(1200);
    const r = await record(page, path.join(out, 'se_raw.mp4'), async () => {
      await page.waitForTimeout(500);
      const tOn = await page.evaluate(() => { window.__skate.game.input.setAuto(true); return (performance.now() - window.__camLog.t0) / 1000; });
      const t0 = Date.now();
      let tLine = null, line = '';
      while (Date.now() - t0 < 60000) {
        const s = await page.evaluate(() => { const rr = window.__camLog.rows; const r = rr[rr.length - 1]; return r ? [r[0], r[19], r[18], r[5]] : null; });
        if (s && s[1] && Date.now() - t0 > 600) { tLine = s[0]; line = s[2]; break; }
        await page.waitForTimeout(50);
      }
      await page.waitForTimeout(3000);
      return { autoOnAt: +tOn.toFixed(2), backOnLineAt: tLine, secsToLine: tLine == null ? null : +(tLine - tOn).toFixed(2), line };
    });
    save('se', r);
  }
  await page.evaluate(() => { window.__camLog.on = false; });
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(res, null, 1));
}
