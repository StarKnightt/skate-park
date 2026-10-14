// Half pipe session exit sweep: start right at the hand-back (on the flat heading for the east wall, any z the session
// allows, fast) and ride the exit carve into the mini quarter. Reports per start: hit / skipped / bail, approach angle,
// speed and x at the quarter. node tools/sim/build_src.mjs tools/sim/.build-e2 && node tools/sim/auto_hpexit.mjs [--pro] [--v 7,7.6,8.2]
globalThis.location = { search: '' };
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes('--' + k);
const B = arg('build', './.build-e2');
const { Vector3 } = await import('three');
const { buildPark } = await import(`${B}/world/park.js`);
const { CollisionWorld } = await import(`${B}/world/collision.js`);
const { SkatePhysics } = await import(`${B}/player/physics.js`);
const { Autopilot } = await import(`${B}/player/autopilot.js`);

const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120;
const one = arg('one', '') ? arg('one').split(',').map(Number) : null; // --one v,z,hdgDeg: trace that start
const speeds = one ? [one[0]] : String(arg('v', '7,7.6,8.2')).split(',').map(Number);
const zs = one ? [one[1]] : [-4.6, -5.2, -5.8, -6.4, -7.0, -7.6, -8.2, -9.0];
const hdgs = (one ? [one[2]] : [-10, 0, 10]).map((d) => Math.PI / 2 + (d * Math.PI) / 180);
let n = 0, hits = 0, skips = 0, bails = 0;
const rows = [];
for (const v of speeds) for (const z of zs) for (const hd of hdgs) {
  const ph = new SkatePhysics(world);
  const on = !flag('pro');
  Object.assign(ph.assist, { landing: on, autoGrind: on, fastRecover: on });
  ph.reset(new Vector3(21.5, 0, z), hd);
  ph.vel.copy(ph.fwd).multiplyScalar(v); ph.speed = v;
  const ap = new Autopilot(ph, { seed: n + 1 });
  const hpNode = ap.nodes.findIndex((nd) => nd.act?.k === 'hpAirs');
  const qpNode = ap.nodes.findIndex((nd, i) => i > hpNode && nd.act?.k === 'wall');
  // the state hpStep leaves behind when it hands back
  Object.assign(ap, { intro: null, reacquire: false, state: 'follow', hp: null, hpEnd: ap.clock, seg: hpNode, s: ap.nodes[hpNode].s });
  ap.fired.add(hpNode); ap.reached.clear(); ap.acquire(false);
  let t = 0, res = 'none', info = '', minX = 99, maxX = -99, wallSeen = false;
  while (t < 14) {
    ph.events.length = 0;
    const inp = ap.sample(STEP, ph.mode === 'air');
    ph.step(STEP, inp);
    t += STEP;
    if (one && Math.round(t * 120) % 12 === 0) console.log(`${t.toFixed(2)} ${ph.mode} ${ph.pos.x.toFixed(2)},${ph.pos.y.toFixed(2)},${ph.pos.z.toFixed(2)} v${ph.speed.toFixed(2)} hdg${(Math.atan2(ph.vel.x, -ph.vel.z) * 180 / Math.PI).toFixed(0)} upY${ph.up.y.toFixed(2)} ${ap.state} seg${ap.seg} st${inp.steer.toFixed(2)}${inp.push ? ' P' : ''}${inp.brake ? ' B' : ''} s${ap.s.toFixed(1)}`);
    if (ph.pos.z < -14.5 && ph.pos.z > -19) { minX = Math.min(minX, ph.pos.x); maxX = Math.max(maxX, ph.pos.x); }
    if (!wallSeen && ap.state === 'wall' && ap.wallNode === qpNode) {
      wallSeen = true;
      const tv = ph.vel, a = Math.atan2(tv.x, -tv.z) * 180 / Math.PI;
      info = `wall@${ph.pos.x.toFixed(1)},${ph.pos.z.toFixed(1)} v${ph.speed.toFixed(1)} hdg${a.toFixed(0)}`;
    }
    for (const e of ph.events) {
      if (e.type === 'bail') { res = `BAIL{${e.reason}}@${ph.pos.x.toFixed(1)},${ph.pos.y.toFixed(1)},${ph.pos.z.toFixed(1)}`; }
      if ((e.type === 'vertAir' || e.type === 'kickturn') && ap.feature === 'qp' && res === 'none') res = `${e.type}@x${ph.pos.x.toFixed(1)}`;
    }
    if (res.startsWith('BAIL')) break;
    if (ap.lineName === 'to the long ledge' || ap.lineName === 'long ledge') break;
  }
  if (res === 'none' && ap.fired.has(qpNode) && !wallSeen) res = 'skipped';
  n++;
  if (res.startsWith('BAIL')) bails++; else if (res === 'skipped' || res === 'none') skips++; else hits++;
  rows.push(`v${v} z${z.toFixed(1)} hdg${((hd * 180) / Math.PI - 90).toFixed(0).padStart(3)}: ${res.padEnd(28)} ${info}  x-range at z -14.5..-19: ${minX.toFixed(1)}..${maxX.toFixed(1)}`);
}
if (!flag('quiet')) for (const r of rows) console.log(r);
console.log(`\nEXIT SWEEP: ${n} starts, ${hits} qp hits, ${skips} skipped/none, ${bails} bails`);
