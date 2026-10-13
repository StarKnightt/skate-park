// Auto-ride takeover / respawn check: start at random flat spots with random heading and speed, reset() the autopilot
// and let it find its way back onto the lap.  node tools/sim/auto_reacquire.mjs [--n 40] [--secs 45] [--seed 1] [--pro]
globalThis.location = { search: '' };
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const B = arg('build', './.build-e2');
const { Vector3 } = await import('three');
const { buildPark } = await import(`${B}/world/park.js`);
const { CollisionWorld } = await import(`${B}/world/collision.js`);
const { SkatePhysics } = await import(`${B}/player/physics.js`);
const { Autopilot } = await import(`${B}/player/autopilot.js`);

const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120, N = +arg('n', 40), secs = +arg('secs', 45);
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = mulberry(+arg('seed', 1));
Math.random = mulberry(99);
// open flat plaza spots: ground at y 0 and nothing within 1.2 m above it
function spot() {
  for (;;) {
    const p = new Vector3(-36 + R() * 72, 3, -22 + R() * 46);
    const h = world.raycast(p, new Vector3(0, -1, 0), 6);
    if (!h || Math.abs(h.point.y) > 0.01 || h.normal.y < 0.99) continue;
    if (world.closestPoint(h.point.clone().add(new Vector3(0, 1.0, 0)), 0.95)) continue;
    return h.point;
  }
}
let ok = 0, bailsT = 0, stuckT = 0, backT = [];
for (let k = 0; k < N; k++) {
  const ph = new SkatePhysics(world);
  if (ph.assist && !args.includes('--pro')) Object.assign(ph.assist, { landing: true, autoGrind: true, fastRecover: true });
  const p = spot(), hd = R() * Math.PI * 2, sp = R() * 4;
  const only = arg('only', null), tr = only !== null && +only === k;
  if (only !== null && !tr) continue;
  ph.reset(p, hd);
  ph.vel.copy(ph.fwd).multiplyScalar(sp);
  const ap = new Autopilot(ph, { seed: k + 1 });
  ap.reset();
  let t = 0, bails = 0, back = -1, dist = 0, s0 = null, slow = 0, stuck = 0;
  const prev = ph.pos.clone();
  while (t < secs) {
    ph.events.length = 0;
    ph.step(STEP, ap.sample(STEP, ph.mode === 'air'));
    t += STEP;
    if (ph.mode === 'bail' && ph.bail && ph.bail.t > 2 && (ph.bail.board.asleep || ph.bail.t > 6)) {
      const q = new Vector3(), f = new Vector3(), u = new Vector3(); ph.bail.board.ridePose(q, f, u); ph.finishRecover(q, f);
    }
    for (const e of ph.events) if (e.type === 'bail') bails++;
    if (tr && (Math.round(t * 120) % 30 === 0 || ph.events.length)) console.log(`${t.toFixed(2)} ${ph.mode} ${ph.pos.x.toFixed(2)},${ph.pos.y.toFixed(2)},${ph.pos.z.toFixed(2)} v${ph.speed.toFixed(2)} seg${ap.seg} ${ap.state} [${ap.lineName}] ${ph.events.map((e) => e.type + (e.name ? '[' + e.name + ']' : '') + (e.reason ? '{' + e.reason + '}' : '')).join(' ')}`);
    if (ph.mode === 'ride' && ph.speed < 0.3 && ph.kickturn.t < 0) { slow += STEP; if (slow > 3 && slow - STEP <= 3) stuck++; } else slow = 0;
    // back on the line: within 1.2 m of the lap polyline
    if (back < 0 && t > 0.5) {
      const n = ap.nodes, a = n[ap.seg], b = n[(ap.seg + 1) % n.length];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((ph.pos.x - a.x) * dx + (ph.pos.z - a.z) * dz) / l2));
      if (Math.hypot(ph.pos.x - a.x - dx * u, ph.pos.z - a.z - dz * u) < 1.2) { back = t; s0 = ap.s; }
    }
    dist += ph.pos.distanceTo(prev); prev.copy(ph.pos);
  }
  let prog = s0 === null ? 0 : ap.s - s0 + (ap.lap > 0 ? 0 : 0);
  if (prog < 0) prog += ap.len;
  const good = bails === 0 && stuck === 0 && back >= 0 && back < 12 && prog > 60;
  if (good) ok++;
  bailsT += bails; stuckT += stuck; if (back >= 0) backT.push(back);
  console.log(`#${k} start (${p.x.toFixed(1)},${p.z.toFixed(1)}) hd ${(hd * 57.3).toFixed(0)} v ${sp.toFixed(1)}: back on line ${back < 0 ? 'NEVER' : back.toFixed(1) + ' s'}, progress ${prog.toFixed(0)} m, bails ${bails}, stuck ${stuck}, now [${ap.lineName}]${good ? '' : '  <-- FAIL'}`);
}
backT.sort((a, b) => a - b);
console.log(`\nREACQUIRE: ${ok}/${N} ok, bails ${bailsT}, stuck ${stuckT}, median time back on the line ${backT.length ? backT[backT.length >> 1].toFixed(1) : '-'} s, max ${backT.length ? backT[backT.length - 1].toFixed(1) : '-'} s`);
