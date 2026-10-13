// Headless feel check of the ride physics on the real park collision (light: no browser, no lock).
//   node tools/sim/build_src.mjs tools/sim/.build-A2 && node tools/realtime/feel_sim.mjs [--copings]
// Prints steering response, push latency / peak / steps, brake ramp and the drop-in phase timeline (bowl + half pipe).
globalThis.location = { search: '' };
const B = '../sim/.build-A2';
const { Vector3 } = await import('three');
const { buildPark } = await import(`${B}/world/park.js`);
const { CollisionWorld } = await import(`${B}/world/collision.js`);
const { SkatePhysics, emptyInput } = await import(`${B}/player/physics.js`);

const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120;
const mk = (x, y, z, hdg, v) => {
  const ph = new SkatePhysics(world);
  ph.reset(new Vector3(x, y, z), (hdg * Math.PI) / 180);
  ph.vel.copy(ph.fwd).multiplyScalar(v);
  return ph;
};
if (process.argv.includes('--copings')) {
  for (const l of park.grindLines.filter((l) => l.kind === 'coping')) {
    const xs = l.pts.map((p) => p.x), zs = l.pts.map((p) => p.z);
    console.log(l.name, 'y', l.pts[0].y.toFixed(2), 'x', Math.min(...xs).toFixed(1), Math.max(...xs).toFixed(1), 'z', Math.min(...zs).toFixed(1), Math.max(...zs).toFixed(1),
      'inward', l.inward ? `${l.inward[0].x.toFixed(2)},${l.inward[0].z.toFixed(2)}` : '-', 'closed', !!l.closed, 'n', l.pts.length);
  }
}
const yawRate = (f0, f1, up) => { const c = new Vector3().crossVectors(f0, f1); return -Math.atan2(c.dot(up), f0.dot(f1)) / STEP; };

// ---- steering: 5 m/s on the flat, A held 0.45 s
{
  const ph = mk(12, 0, 10, 180, 5.0);
  const inp = emptyInput();
  const rows = [];
  for (let i = 0; i < 120 * 1.2; i++) {
    const t = i * STEP;
    inp.steer = t >= 0.1 && t < 0.55 ? -1 : 0;
    const f0 = ph.fwd.clone();
    ph.step(STEP, inp);
    rows.push({ t, r: -yawRate(f0, ph.fwd, ph.up), s: ph.speed, steerS: ph.steerS });
  }
  const hold = rows.filter((r) => r.t >= 0.1 && r.t < 0.55);
  const peak = Math.max(...hold.map((r) => r.r));
  const steady = hold.filter((r) => r.t > 0.4).reduce((a, r) => a + r.r, 0) / hold.filter((r) => r.t > 0.4).length;
  const t90 = hold.find((r) => r.r >= 0.9 * peak).t - 0.1 + STEP;
  const sp = hold[hold.length - 1].s;
  const after = rows.filter((r) => r.t >= 0.55);
  const t10 = (after.find((r) => r.r <= 0.1 * steady)?.t ?? NaN) - 0.55 + STEP;
  console.log(`steer @5 m/s: t90 ${(t90 * 1000).toFixed(0)} ms (from the first step with the key), peak ${peak.toFixed(3)} steady ${steady.toFixed(3)} rad/s, overshoot ${(peak / steady - 1).toFixed(4)}, radius ${(sp / steady).toFixed(2)} m @ ${sp.toFixed(2)} m/s, release to 10 % ${(t10 * 1000).toFixed(0)} ms`);
  // reversal A -> D
  const ph2 = mk(12, 0, 10, 180, 5.0);
  let tz = null, tFull = null;
  for (let i = 0; i < 120 * 1.2; i++) {
    const t = i * STEP;
    inp.steer = t < 0.4 ? -1 : 1;
    ph2.step(STEP, inp);
    if (t >= 0.4 && tz === null && ph2.steerS >= 0) tz = t - 0.4 + STEP;
    if (t >= 0.4 && tFull === null && ph2.steerS >= 0.999) tFull = t - 0.4 + STEP;
  }
  console.log(`steer reversal: through zero ${(tz * 1000).toFixed(0)} ms, full ${(tFull * 1000).toFixed(0)} ms`);
  for (const v of [2, 3, 5, 8]) {
    const p = mk(12, 0, 10, 180, v);
    const inp2 = emptyInput(); inp2.steer = 1;
    let r = 0;
    for (let i = 0; i < 60; i++) { const f0 = p.fwd.clone(); p.step(STEP, inp2); r = yawRate(f0, p.fwd, p.up); }
    console.log(`  turn @${v} m/s: ${r.toFixed(3)} rad/s, radius ${(p.speed / r).toFixed(2)} m`);
  }
}
// ---- push from standstill, W held 3 s
{
  const ph = mk(34.5, 0, 22, 180, 0);
  const inp = emptyInput();
  let prevV = 0, prevA = 0, first = null, peak = 0, maxStep = 0, pushes = 0;
  for (let i = 0; i < 120 * 3; i++) {
    const t = i * STEP;
    inp.push = true;
    const pt0 = ph.pushT;
    ph.step(STEP, inp);
    if (ph.pushT >= 0 && pt0 < 0) pushes++;
    const v = Math.abs(ph.vel.dot(ph.fwd)), a = (v - prevV) / STEP;
    if (first === null && a > 0.25) first = t + STEP;
    if (i > 0) { peak = Math.max(peak, a); maxStep = Math.max(maxStep, Math.abs(a - prevA)); }
    prevV = v; prevA = a;
  }
  console.log(`push from standstill: first accel ${(first * 1000).toFixed(0)} ms after the first step with W, peak ${peak.toFixed(2)} m/s^2, max accel step ${maxStep.toFixed(2)} m/s^2, ${pushes} pushes in 3 s, speed ${ph.speed.toFixed(2)} m/s`);
}
// ---- brake from 6 m/s
{
  const ph = mk(34.5, 0, 22, 180, 6);
  const inp = emptyInput();
  let prevV = 6, prevA = 0, maxStep = 0, t90 = null, base = 0;
  for (let i = 0; i < 120 * 1.5; i++) {
    const t = i * STEP;
    inp.brake = t >= 0.2 && t < 1.0;
    ph.step(STEP, inp);
    const v = ph.speed, a = (v - prevV) / STEP;
    if (i === 20) base = a;
    if (inp.brake && t90 === null && -(a - base) >= 0.9 * 3.4) t90 = t - 0.2 + STEP;
    if (i > 1) maxStep = Math.max(maxStep, Math.abs(a - prevA));
    prevV = v; prevA = a;
  }
  console.log(`brake: 90 % of 3.4 m/s^2 after ${(t90 * 1000).toFixed(0)} ms, max accel step ${maxStep.toFixed(2)} m/s^2`);
}
// ---- air spin: full crouch, ollie, D held in the air
{
  const ph = mk(34.5, 0, 22, 180, 4);
  const inp = emptyInput();
  let maxYaw = 0;
  for (let i = 0; i < 120 * 1.6; i++) {
    const t = i * STEP;
    inp.crouch = t < 0.35; inp.ollie = Math.abs(t - 0.35) < STEP / 2; inp.steer = t > 0.38 ? 1 : 0;
    ph.step(STEP, inp);
    if (ph.mode === 'air') maxYaw = Math.max(maxYaw, Math.abs(ph.airYaw));
  }
  console.log(`air spin (D held after the pop): ${(maxYaw * 57.3).toFixed(0)} deg of yaw in the air`);
}
// ---- drop-ins
const dropin = (name, at) => {
  const ph = mk(...at);
  const inp = emptyInput();
  const ev = [];
  let last = null, t0 = null, minAng = 0, maxAng = 0, lastT = 0;
  for (let i = 0; i < 120 * 3; i++) {
    const t = i * STEP;
    ph.events.length = 0;
    ph.step(STEP, inp);
    const d = ph.dropin;
    for (const e of ph.events) if (/drop/i.test(e.type)) ev.push(`${e.type}@${t.toFixed(3)}${e.wall ? ' wall ' + e.wall : ''}`);
    if (d) {
      if (t0 === null) t0 = t;
      minAng = Math.min(minAng, d.ang); maxAng = Math.max(maxAng, d.ang);
      if (d.phase !== last) { ev.push(`${d.phase}@${t.toFixed(3)} ang ${(d.ang * 57.3).toFixed(1)}`); last = d.phase; }
      lastT = t;
    }
    if (ph.mode !== 'ride') { ev.push(`mode ${ph.mode}@${t.toFixed(3)}`); break; }
  }
  console.log(`drop-in ${name}: ${ev.join(' | ')} | nose-up max ${(-minAng * 57.3).toFixed(1)} deg, wall ${(maxAng * 57.3).toFixed(1)} deg, total ${((lastT - (t0 ?? 0)) * 1000).toFixed(0)} ms, end mode ${ph.mode} speed ${ph.speed.toFixed(2)}`);
};
dropin('bowl east deck 4.5', [-12.5, 0, 0.6, -90, 4.5]);
dropin('bowl east deck 2.0', [-12.5, 0, 0.6, -90, 2.0]);
if (process.env.HP) dropin('half pipe', JSON.parse(process.env.HP));
