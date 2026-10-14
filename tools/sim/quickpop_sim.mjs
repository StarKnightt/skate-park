// Pass-5 c-trick (#74): headless check of the rolling F quick pop through the REAL src/core/input.ts + physics.
// Measures, per trick and mode: steps of automatic crouch before the pop, pop charge, air time (pop -> land),
// pop -> flip caught (flipDone), landing quality. Also Space-crouch + F (unchanged path), Easy tap ollie, F in the air.
//   node tools/sim/build_src.mjs tools/sim/.build-c-trick && node tools/sim/quickpop_sim.mjs [--build .build-x]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const B = path.join(root, 'tools/sim', args.includes('--build') ? args[args.indexOf('--build') + 1] : '.build-c-trick');
const store = {};
Object.assign(globalThis, {
  location: { search: '' }, addEventListener() {}, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  document: { addEventListener() {}, pointerLockElement: null, activeElement: null },
});
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
const imp = (p) => import(pathToFileURL(path.join(B, p)).href);
const { Vector3 } = await import('three');
const { buildPark } = await imp('world/park.js');
const { CollisionWorld } = await imp('world/collision.js');
const { SkatePhysics } = await imp('player/physics.js');
const { Input } = await imp('core/input.js');
const { setSetting } = await imp('core/settings.js');
const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120;

/** keys: [[t, down(1)/up(0), code]]; returns the event timeline (sim seconds) */
function run(mode, keys, { x = 34.5, z = 23.5, hdg = 180, v = 4.6, dur = 2.4 } = {}) {
  setSetting('controlMode', mode);
  const ph = new SkatePhysics(world);
  ph.reset(new Vector3(x, 0, z), (hdg * Math.PI) / 180);
  ph.vel.copy(ph.fwd).multiplyScalar(v);
  const input = new Input({ addEventListener() {}, setPointerCapture() {} });
  input.attach(ph);
  input.armCruise();
  input.scripted = {};
  const ev = [], crouchSteps = [];
  let k = 0;
  for (let i = 0; i < dur / STEP; i++) {
    const t = i * STEP;
    while (k < keys.length && keys[k][0] <= t + 1e-9) { input.scripted[keys[k][2]] = !!keys[k][1]; k++; }
    const inp = input.sample(ph.mode === 'air', STEP);
    if (inp.crouch) crouchSteps.push(t);
    ph.events.length = 0;
    ph.step(STEP, inp);
    for (const e of ph.events) ev.push({ t: +t.toFixed(4), ...e, y: +ph.pos.y.toFixed(3), spd: +ph.speed.toFixed(2) });
  }
  return { ev, crouchSteps, ph };
}

function summarize(name, r, fT) {
  const pops = r.ev.filter((e) => e.type === 'pop');
  const out = [];
  for (const p of pops) {
    const land = r.ev.find((e) => e.type === 'land' && e.t > p.t);
    const done = r.ev.find((e) => e.type === 'flipDone' && e.t > p.t && (!land || e.t <= land.t));
    const flip = r.ev.find((e) => e.type === 'flip' && e.t >= p.t - 1e-6 && (!land || e.t <= land.t));
    const wu = r.ev.filter((e) => e.type === 'windup' && e.t <= p.t).pop();
    const cr = r.crouchSteps.filter((t) => t < p.t && t > p.t - 1.5);
    let run0 = 0; // contiguous crouch steps right before the pop
    for (let i = cr.length - 1; i >= 0 && Math.abs(cr[i] - (p.t - (cr.length - i) * STEP)) < 1e-3; i--) run0++;
    const peak = Math.max(...r.ev.filter((e) => e.t >= p.t && (!land || e.t <= land.t)).map((e) => e.y));
    out.push({
      case: name, keyF: fT, popAt: p.t, fromF_ms: fT != null ? Math.round((p.t - fT) * 1000) : null, crouchSteps: run0, crouch_ms: Math.round(run0 * STEP * 1000),
      windup: !!wu, charge: +(+p.charge).toFixed(2), predAir: p.airT, air: land ? +(land.t - p.t).toFixed(3) : null,
      popToCatch: done ? +(done.t - p.t).toFixed(3) : null, flip: flip?.kind ?? null, flipDur: flip?.dur ?? null, land: land?.quality ?? null,
    });
  }
  if (!pops.length) out.push({ case: name, note: 'NO POP', events: r.ev.map((e) => e.type).join(' ') });
  const bails = r.ev.filter((e) => e.type === 'bail');
  if (bails.length) out.push({ case: name, bail: bails.map((b) => b.kind + '/' + b.reason).join(',') });
  return out;
}

const rows = [];
const F = (t, extra = []) => [...extra, [t, 1, 'KeyF'], [t + 0.05, 0, 'KeyF']];
for (const mode of ['pro', 'easy']) {
  for (const v of [4.0, 5.0, 6.0]) {
    if (mode === 'pro') {
      for (const [key, nm] of [[null, 'kickflip'], ['KeyD', 'heelflip'], ['KeyS', 'shuvit'], ['KeyW', 'treflip']]) {
        const keys = key ? [[0.3, 1, key], ...F(0.36), [0.43, 0, key]] : F(0.3);
        rows.push(...summarize(`${mode} F-rolling ${nm} @${v}`, run(mode, keys.sort((a, b) => a[0] - b[0]), { v }), key ? 0.36 : 0.3));
      }
    } else {
      // Easy: F cycles kick -> heel -> shove -> tre; press 4x with time to land between
      const keys = [...F(0.3), ...F(1.3), ...F(2.3), ...F(3.3)];
      rows.push(...summarize(`${mode} F-rolling x4 @${v}`, run(mode, keys, { v, dur: 4.4, z: 23.5 }), null));
    }
  }
}
// unchanged paths
rows.push(...summarize('pro Space250+F (protocol kickflip)', run('pro', [[0.4, 1, 'Space'], [0.65, 1, 'KeyF'], [0.69, 0, 'KeyF'], [0.75, 0, 'Space']], { v: 5 }), 0.65));
rows.push(...summarize('pro Space450 release (ollie)', run('pro', [[0.4, 1, 'Space'], [0.85, 0, 'Space']], { v: 5 }), null));
rows.push(...summarize('pro ollie then F in air', run('pro', [[0.3, 1, 'Space'], [0.75, 0, 'Space'], ...F(0.87)], { v: 5 }), null));
rows.push(...summarize('easy tap Space (ollie)', run('easy', [[0.3, 1, 'Space'], [0.34, 0, 'Space']], { v: 4.5 }), 0.3));
rows.push(...summarize('easy tap Space then F in air', run('easy', [[0.3, 1, 'Space'], [0.34, 0, 'Space'], ...F(0.55)], { v: 4.5 }), 0.3));
rows.push(...summarize('easy hold Space 0.4', run('easy', [[0.3, 1, 'Space'], [0.7, 0, 'Space']], { v: 4.5 }), null));
// F pressed, then Space pressed during the wind-up: one pop only
rows.push(...summarize('pro F then Space during windup', run('pro', [[0.3, 1, 'KeyF'], [0.33, 1, 'Space'], [0.35, 0, 'KeyF'], [0.6, 0, 'Space']], { v: 5 }), 0.3));
// double F within the wind-up: one pop, the first flip
rows.push(...summarize('pro F F (double, 40 ms)', run('pro', [[0.3, 1, 'KeyF'], [0.32, 0, 'KeyF'], [0.34, 1, 'KeyD'], [0.35, 1, 'KeyF'], [0.37, 0, 'KeyF'], [0.4, 0, 'KeyD']], { v: 5 }), 0.3));
for (const r of rows) console.log(JSON.stringify(r));
