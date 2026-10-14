// Autopilot state-change log (hand-backs, wall hits, skips) for diagnosing a line: one line per transition.
// node tools/sim/build_src.mjs tools/sim/.build-e2 && node tools/sim/auto_diag.mjs [--seeds 1,2] [--secs 260] [--pro] [--attract] [--only wall]
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
const STEP = 1 / 120, secs = +arg('secs', 260), only = arg('only', '');
const seeds = String(arg('seeds', '1,2,3')).split(',').map(Number);
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const deg = (r) => ((r * 180) / Math.PI).toFixed(0);
for (const seed of seeds) {
  Math.random = mulberry(seed * 7919 + 1);
  const ph = new SkatePhysics(world);
  const on = !flag('pro');
  Object.assign(ph.assist, { landing: on, autoGrind: on, fastRecover: on });
  ph.reset(park.spawn.pos.clone(), park.spawn.heading);
  const ap = new Autopilot(ph, { seed, attract: flag('attract') });
  let t = 0, prevState = ap.state, prevAct = '', prevLap = 0;
  const where = () => `@${ph.pos.x.toFixed(2)},${ph.pos.y.toFixed(2)},${ph.pos.z.toFixed(2)} v${ph.speed.toFixed(2)} hdg${deg(Math.atan2(ph.vel.x, -ph.vel.z))}`;
  while (t < secs) {
    ph.events.length = 0;
    const inp = ap.sample(STEP, ph.mode === 'air');
    ph.step(STEP, inp);
    t += STEP;
    if (ph.mode === 'bail' && ph.bail && ph.bail.t > 2.0 && (ph.bail.board.asleep || ph.bail.t > 6)) {
      const p = new Vector3(), f = new Vector3(), u = new Vector3();
      ph.bail.board.ridePose(p, f, u);
      ph.finishRecover(p, f);
    }
    const out = [];
    if (ap.lap !== prevLap) { out.push(`LAP ${ap.lap}`); prevLap = ap.lap; }
    if (ap.state !== prevState) { out.push(`${prevState}->${ap.state} [${ap.lineName}] act=${ap.lastAct}`); prevState = ap.state; }
    else if (ap.lastAct !== prevAct) out.push(`act ${ap.lastAct} [${ap.lineName}]`);
    prevAct = ap.lastAct;
    for (const e of ph.events) if (['bail', 'vertAir', 'kickturn', 'land'].includes(e.type) && (e.type !== 'land' || e.quality !== 'clean')) out.push(`${e.type}${e.reason ? '{' + e.reason + '}' : ''}${e.quality ? ':' + e.quality : ''}`);
    if (out.length && (!only || out.some((o) => o.includes(only)))) console.log(`s${seed} ${t.toFixed(2)} ${out.join(' | ')} ${where()}`);
  }
}
