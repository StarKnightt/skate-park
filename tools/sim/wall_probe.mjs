// c-wall (#78) probe: replays the bowl carve inputs (clip22 / rt bowl_carve, Pro keys, no assists) and the drop-in auto
// line through the physics, plus a copy of the drawn-board smoothing (game.ts syncBoard) and skater.followBoard(), and
// reports per wall pass: time with up.y < 0.3, the height profile, and how long the body takes to swing flat -> upright.
//   node tools/sim/build_src.mjs tools/sim/.build-c-wall && node tools/sim/wall_probe.mjs [--rows] [--case name]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
globalThis.location = { search: '' };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const B = path.join(root, process.env.BUILD || 'tools/sim/.build-c-wall');
const imp = (p) => import(pathToFileURL(path.join(B, p)).href);
const { Vector3, Quaternion } = await import('three');
const { buildPark } = await imp('world/park.js');
const { CollisionWorld } = await imp('world/collision.js');
const { SkatePhysics, emptyInput } = await imp('player/physics.js');
const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120, FPS = 60;
const KEY = (k, t0, d) => [{ at: t0, down: [k] }, { at: t0 + d, up: [k] }];
const CARVE = [...KEY('KeyA', 0.2, 0.4), ...KEY('KeyD', 1.3, 0.6), ...KEY('KeyA', 2.6, 0.8)];
const CASES = {
  carve: { tp: [-28, -2.3, -2.0, 90, 7.5], keys: CARVE, dur: 5.0 },
  carve_slow: { tp: [-28, -2.3, -2.0, 90, 6.0], keys: CARVE, dur: 5.0 },
  carve_fast: { tp: [-28, -2.3, -2.0, 90, 8.5], keys: CARVE, dur: 5.0 },
  carve_holdA: { tp: [-28, -2.3, -2.0, 90, 7.5], keys: KEY('KeyA', 0.2, 3.0), dur: 5.0 },
  carve_holdD: { tp: [-28, -2.3, -2.0, 90, 7.5], keys: KEY('KeyD', 0.2, 3.0), dur: 5.0 },
  // rt protocol bowl_carve runs in Easy (keyboard steer x0.8, landing + auto-grind assists)
  rt_easy: { tp: [-28, -2.3, -2.0, 90, 7.5], keys: CARVE, dur: 4.0, easy: true },
  rt_easy_fast: { tp: [-28, -2.3, -2.0, 90, 8.3], keys: CARVE, dur: 4.0, easy: true },
};
const argv = process.argv.slice(2);
const only = argv.includes('--case') ? argv[argv.indexOf('--case') + 1].split(',') : Object.keys(CASES);
const rows = argv.includes('--rows');

// drawn board (game.ts syncBoard: slerp 40/s) and the body (skater.followBoard: 35 ms rate filter, 120 ms pull, 0.1 rad soft limit)
function makeBody() {
  const s = { q: new Quaternion(), prev: new Quaternion(), w: new Vector3(), wB: new Vector3(), d: new Quaternion(), init: false, bq: new Quaternion(), upPrev: new Vector3(0, 1, 0), mode: 'ride' };
  const _q = new Quaternion(), _v = new Vector3();
  return (q, dt, mode) => {
    if (!s.init) { s.bq.copy(q); s.q.copy(q); s.prev.copy(q); s.init = true; return { board: s.bq, body: s.q }; }
    s.bq.slerp(q, 1 - Math.exp(-40 * dt));
    // game.ts syncBoard: the drawn deck's up axis turns at most 6 rad/s in the air
    const bUp = new Vector3(0, 1, 0).applyQuaternion(s.bq);
    if (!process.env.NOCAP && mode === 'air' && s.mode === 'air') {
      const a = s.upPrev.angleTo(bUp), m = Number(process.env.CAP || 6) * dt, ax = new Vector3().crossVectors(s.upPrev, bUp);
      if (a > m && ax.lengthSq() > 1e-12) {
        ax.normalize();
        s.bq.premultiply(new Quaternion().setFromUnitVectors(bUp, s.upPrev.clone().applyAxisAngle(ax, m)));
        bUp.set(0, 1, 0).applyQuaternion(s.bq);
      }
    }
    s.upPrev.copy(bUp); s.mode = mode;
    const rq = s.bq, FB = !process.env.NOFB;
    const d = s.d.copy(rq).multiply(_q.copy(s.prev).invert());
    if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
    const sh = Math.hypot(d.x, d.y, d.z), ang = 2 * Math.atan2(sh, d.w);
    s.wB.set(d.x, d.y, d.z).multiplyScalar(sh > 1e-9 ? ang / (sh * dt) : 0);
    // skater.followBoard(): tilt rate <= 6 rad/s, up to ~0.45 rad of extra trail while the deck tips fast
    const bu = new Vector3(0, 1, 0).applyQuaternion(rq);
    const tB = s.wB.clone().addScaledVector(bu, -s.wB.dot(bu)).length();
    s.fast = FB ? Math.max((s.fast ?? 0) * Math.exp(-dt / 0.15), 0.35 * Math.min(1, Math.max(0, (tB - 6) / 6))) : 0;
    if (s.q.angleTo(rq) > 0.5 + 1.5 * s.fast) { s.q.copy(rq); s.prev.copy(rq); s.w.set(0, 0, 0); s.fast = 0; return { board: s.bq, body: s.q }; }
    s.prev.copy(rq);
    s.w.lerp(s.wB, 1 - Math.exp(-dt / 0.035));
    const wy = s.w.dot(bu), tilt = s.w.clone().addScaledVector(bu, -wy), tl = tilt.length();
    if (FB && tl > 6) s.w.copy(bu).multiplyScalar(wy).addScaledVector(tilt, 6 / tl);
    const wl = s.w.length();
    if (wl > 1e-9) s.q.premultiply(_q.setFromAxisAngle(_v.copy(s.w).divideScalar(wl), wl * dt));
    s.q.slerp(rq, 1 - Math.exp(-dt / (0.12 + s.fast))).normalize();
    const e = s.q.angleTo(rq), lim = 0.1 + s.fast;
    if (e > lim) s.q.slerp(rq, 1 - (lim + 0.06 * Math.tanh((e - lim) / 0.06)) / e);
    return { board: s.bq, body: s.q };
  };
}
const upY = (q) => new Vector3(0, 1, 0).applyQuaternion(q).y;
const deg = (x) => (x * 180) / Math.PI;

export function run(c, { log = false } = {}) {
  const ph = new SkatePhysics(world);
  ph.assist = { landing: !!c.easy, autoGrind: !!c.easy, fastRecover: !!c.easy };
  ph.reset(new Vector3(c.tp[0], c.tp[1], c.tp[2]), (c.tp[3] * Math.PI) / 180);
  ph.vel.copy(ph.fwd).multiplyScalar(c.tp[4]); ph.speed = c.tp[4];
  const steps = [...c.keys].sort((a, b) => a.at - b.at), held = new Set();
  const body = makeBody();
  const fr = [];
  const n = Math.round(c.dur / STEP);
  for (let i = 0; i < n; i++) {
    const t = i * STEP;
    while (steps.length && steps[0].at <= t + 1e-9) { const s = steps.shift(); s.down?.forEach((k) => held.add(k)); s.up?.forEach((k) => held.delete(k)); }
    const inp = emptyInput();
    inp.steer = ((held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0)) * (c.easy ? 0.8 : 1);
    ph.events.length = 0;
    ph.step(STEP, inp);
    const q = ph.mode === 'air' ? ph.boardQ.clone() : ph.basisQuat(ph.fwd, ph.up);
    // the render runs at 60 fps: feed the body filter every other physics step (interpolation ignored)
    if (i % 2 === 1) {
      const { board, body: bq } = body(q, 1 / FPS, ph.mode);
      fr.push({ t: +(t + STEP).toFixed(4), mode: ph.mode, y: ph.pos.y, upY: ph.mode === 'air' ? upY(ph.boardQ) : ph.up.y, s: ph.speed, steer: ph.steerS,
        vy: ph.vel.y, bodyUp: upY(bq), boardUp: upY(board), lag: deg(board.angleTo(q)), ev: ph.events.map((e) => e.type).join(',') });
    }
    if (ph.mode === 'bail') break;
  }
  return fr;
}

export function analyse(fr, thr = 0.3) {
  // wall passes: contiguous spans with the board's up.y < thr (ride or air)
  const spans = [];
  let cur = null;
  for (const f of fr) {
    if (f.upY < thr) { if (!cur) cur = { t0: f.t, t1: f.t, y0: f.y, yMax: f.y, yMin: f.y, ys: [] }; cur.t1 = f.t; cur.yMax = Math.max(cur.yMax, f.y); cur.yMin = Math.min(cur.yMin, f.y); cur.ys.push(f.y); }
    else if (cur) { spans.push(cur); cur = null; }
  }
  if (cur) spans.push(cur);
  // level stretch: the longest run where the height stays within 0.15 m while up.y < 0.5
  let lvl = 0;
  for (let i = 0; i < fr.length; i++) {
    if (fr[i].upY >= 0.5) continue;
    let lo = fr[i].y, hi = fr[i].y, j = i;
    while (j + 1 < fr.length && fr[j + 1].upY < 0.5) { const y = fr[j + 1].y; lo = Math.min(lo, y); hi = Math.max(hi, y); if (hi - lo > 0.15) break; j++; }
    lvl = Math.max(lvl, fr[j].t - fr[i].t);
  }
  // body swing flat -> upright: from the last frame with body up.y < 0.3 to the first after it with body up.y > 0.9
  const swings = [];
  for (let i = 1; i < fr.length; i++) {
    if (fr[i - 1].bodyUp < 0.3 && fr[i].bodyUp >= 0.3) {
      const k = fr.findIndex((f, j) => j >= i && f.bodyUp > 0.9);
      const back = fr.findIndex((f, j) => j >= i && f.bodyUp < 0.3);
      if (k > 0 && (back < 0 || back > k)) swings.push({ t: fr[i].t, dur: fr[k].t - fr[i - 1].t, mode: fr[k].mode, y: fr[k].y });
    }
  }
  // peak body angular rate (deg/frame at 60 fps)
  let maxRate = 0;
  for (let i = 1; i < fr.length; i++) maxRate = Math.max(maxRate, Math.abs(deg(Math.acos(Math.min(1, fr[i].bodyUp)) - Math.acos(Math.min(1, fr[i - 1].bodyUp)))));
  return { spans, lvl, swings, maxRate };
}

const main = (process.argv[1] ?? '').endsWith('wall_probe.mjs');
for (const name of main ? only : []) {
  const fr = run(CASES[name]);
  const a = analyse(fr), a4 = analyse(fr, 0.4);
  const tot = (x) => x.spans.reduce((q, s) => q + s.t1 - s.t0 + 1 / FPS, 0).toFixed(2);
  const sp = a.spans.map((s) => `${s.t0.toFixed(2)}-${s.t1.toFixed(2)}s (${(s.t1 - s.t0 + 1 / FPS).toFixed(2)} s, y ${s.y0.toFixed(2)}->max ${s.yMax.toFixed(2)})`).join('; ');
  const sw = a.swings.map((s) => `${s.t.toFixed(2)}s ${s.dur.toFixed(2)} s -> ${s.mode} y ${s.y.toFixed(2)}`).join('; ');
  console.log(`${name}: total up.y<0.3 ${tot(a)} s, up.y<0.4 ${tot(a4)} s; up.y<0.3 spans: ${sp || '-'} | level stretch (<0.15 m, up.y<0.5) ${a.lvl.toFixed(2)} s | body flat->upright swings: ${sw || '-'} | max body rate ${a.maxRate.toFixed(1)} deg/frame | end ${fr.at(-1).mode} y ${fr.at(-1).y.toFixed(2)} s ${fr.at(-1).s.toFixed(2)}`);
  if (rows) for (const [i, f] of fr.entries()) if (i % 3 === 0 || f.ev) console.log(`  ${f.t.toFixed(2)} ${f.mode.padEnd(5)} y ${f.y.toFixed(2)} up ${f.upY.toFixed(2)} body ${f.bodyUp.toFixed(2)} s ${f.s.toFixed(2)} vy ${f.vy.toFixed(2)} steer ${f.steer.toFixed(2)} ${f.ev}`);
}
