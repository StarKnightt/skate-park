// Bail board rest check (pass 5 #75). Runs many bails (main bowl E wall as in the critic's clip, the other bowls, flat
// ground, random spots) and records how the board comes to rest: boards asleep with the deck within 25 deg of vertical
// ("on the rail", must be 0), the longest time a nearly still board stands on its rail before it falls over, and, for the
// quick recovery (fast), how far the board moves toward the rider after it came to rest (must be 0 except flagged unsafe
// spots, where it may only be nudged). Mirrors Skater.tryPlan for the quick recovery.
//   node tools/sim/build_src.mjs tools/sim/.build-c-bail && node tools/sim/board_rail_sim.mjs [N random] [fast] [v]
globalThis.location = { search: '' };
const B = new URL(process.env.SIMB ?? './.build-c-bail/', import.meta.url).href;
const { Vector3 } = await import('three');
const { buildPark } = await import(B + 'world/park.js');
const { CollisionWorld } = await import(B + 'world/collision.js');
const { SkatePhysics, emptyInput } = await import(B + 'player/physics.js');
const R = await import(B + 'player/recovery.js');

const park = buildPark();
const b = park.builder;
const world = new CollisionWorld(b.collisionGeometry(), b.cSurf, park.grindLines);
const N = +(process.argv[2] ?? 200);
const FAST = process.argv.includes('fast');
const V = process.argv.includes('v');
const STEP = 1 / 120;
const KINDS = ['face', 'back', 'knock', 'roll'];
const RAIL = Math.sin((25 * Math.PI) / 180);
let seed = 4242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const cases = [];
// the critic's case: main bowl E wall, 6 m/s, bail 'back' once above y -0.7 (bail randomness comes from the sim time)
for (let i = 0; i < 24; i++) cases.push({ name: `bowl E wall #${i}`, pos: [-21, -2.3, 0.6 + (i % 5) * 0.15], heading: 90, speed: 6.0, bailY: -0.7, kind: KINDS[i % 4], t0: i * 0.013 });
for (let i = 0; i < 12; i++) cases.push({ name: `bowl W wall #${i}`, pos: [-27, -2.3, (i % 3 - 1) * 1.5], heading: 270, speed: 6 + (i % 3), bailY: -0.8, kind: KINDS[i % 4], t0: i * 0.017 });
for (let i = 0; i < 8; i++) cases.push({ name: `pocket bowl #${i}`, pos: [-24, -1.4, 15], heading: i * 45, speed: 5.5, bailY: -0.5, kind: KINDS[i % 4], t0: i * 0.011 });
for (let i = 0; i < 8; i++) cases.push({ name: `half pipe #${i}`, pos: [24, 0, -9 + i * 0.5], heading: i % 2 ? 90 : 270, speed: 7 + (i % 3), bailY: 1.8, kind: KINDS[i % 4], t0: i * 0.019 });
// flat ground with room to roll (plaza)
for (let i = 0; i < 40; i++) cases.push({ name: `flat plaza #${i}`, pos: [-12 + (i % 8) * 2.2, 0, 2 + Math.floor(i / 8) * 1.3], heading: (i * 47) % 360, speed: 3 + (i % 5), kind: KINDS[i % 4], t: 0.15 + (i % 3) * 0.1, drop: true, t0: i * 0.007 });
for (let i = 0; i < N; i++) {
  const x = -37 + rnd() * 74, z = -26 + rnd() * 50;
  cases.push({ name: `random #${i}`, pos: [x, 3, z], heading: rnd() * 360, speed: 2 + rnd() * 6, kind: KINDS[i % 4], t: 0.02 + rnd() * 0.3, drop: true, t0: rnd() });
}

const st = { n: 0, onRail: 0, upside: 0, wheels: 0, balanceMax: 0, balanceOver: 0, moved: 0, movedToward: 0, unsafe: 0, restDist: [], restT: [], boardT: [], fails: [] };
for (const c of cases) {
  const ph = new SkatePhysics(world);
  if (FAST) Object.assign(ph.assist, { landing: false, autoGrind: false, fastRecover: true });
  const p0 = new Vector3(...c.pos);
  if (c.drop) {
    const g = world.raycast(p0, new Vector3(0, -1, 0), 20);
    if (!g || g.normal.y < 0.97) continue;
    p0.copy(g.point);
  }
  ph.reset(p0, (c.heading * Math.PI) / 180);
  ph.time += c.t0 ?? 0;
  ph.vel.copy(ph.fwd).multiplyScalar(c.speed);
  const inp = emptyInput();
  let t = 0, bailAt = null, railT = 0, railMax = 0;
  for (let i = 0; i < 120 * 12; i++) {
    if (ph.mode !== 'bail') {
      const trig = c.bailY !== undefined ? (ph.pos.y > c.pos[1] + 0.1 && (ph.pos.y >= c.bailY || (ph.vel.y < 0 && t > 0.3))) : t >= c.t;
      if (trig) ph.toBail(c.kind, 'test');
    }
    if (ph.mode === 'bail' && !bailAt) bailAt = ph.pos.clone();
    ph.step(STEP, inp);
    t += STEP;
    const bb = ph.bail?.board;
    if (bb && !bb.gliding) {
      // nearly still with the deck near vertical: the board is balancing on its rail
      const up = new Vector3(0, 1, 0).applyQuaternion(bb.q);
      const g = world.raycast(bb.com.clone().add(new Vector3(0, 0.3, 0)), new Vector3(0, -1, 0), 1);
      const n = g ? g.normal : new Vector3(0, 1, 0);
      const slow = bb.v.length() < 0.25 && bb.contacts >= 2;
      railT = slow && Math.abs(up.dot(n)) < RAIL ? railT + STEP : 0;
      railMax = Math.max(railMax, railT);
    }
    if (bailAt && ph.bail && ph.bail.checked && !ph.bail.standAt && ph.bail.board.asleep) break;
    if (t > 6 && !bailAt) break;
  }
  if (!bailAt || !ph.bail) continue;
  st.n++;
  const bl = ph.bail, bb = bl.board;
  st.restT.push(bl.t); st.boardT.push(bl.board.t);
  const up = new Vector3(0, 1, 0).applyQuaternion(bb.q);
  const rest = { pos: new Vector3(), fwd: new Vector3(), up: new Vector3() };
  bb.ridePose(rest.pos, rest.fwd, rest.up);
  const c2 = Math.abs(up.dot(rest.up));
  if (c2 < RAIL) { st.onRail++; st.fails.push(`${c.name} [${c.kind}] asleep on its rail: deck ${(90 - Math.acos(c2) * 180 / Math.PI).toFixed(0)} deg from vertical`); }
  else if (up.dot(rest.up) < 0) st.upside++; else st.wheels++;
  st.balanceMax = Math.max(st.balanceMax, railMax);
  if (railMax > 0.15) st.balanceOver++;
  if (V) console.log(`${c.name.padEnd(18)} rest ${bl.t.toFixed(2)} s  up.n ${up.dot(rest.up).toFixed(2)}  rail-balance ${railMax.toFixed(2)} s  board ${rest.pos.toArray().map((v) => v.toFixed(2)).join(',')}`);
  if (FAST) {
    // as Skater.tryPlan for the quick recovery: where he stands up ~0.45 m along the heading from the body
    const body = bl.body.clone(), hd = bl.heading;
    let stand = body.clone().add(new Vector3(Math.sin(hd) * 0.45, 0, Math.cos(hd) * 0.45));
    const g = R.groundAt(world, stand.x, stand.z, body.y, 0.35, 0.5);
    if (g) stand.copy(g.point);
    if (!g || !R.standable(world, stand)) stand = R.findStandSpot(world, body, 4) ?? body;
    const plan = R.planRecovery(world, stand, rest, R.quickPlan ? R.quickPlan(rest.fwd) : { maxWalk: 1.2, face: hd, prefer: rest.fwd, tight: true });
    const from = bb.rootPos(new Vector3());
    const d = plan.relocate ? Math.hypot(plan.ride.x - from.x, plan.ride.z - from.z) : 0;
    st.restDist.push(Math.hypot(rest.pos.x - stand.x, rest.pos.z - stand.z));
    if (plan.relocate) {
      st.moved++;
      const toward = Math.hypot(from.x - stand.x, from.z - stand.z) - Math.hypot(plan.ride.x - stand.x, plan.ride.z - stand.z);
      const flagged = /unsafe|nudged|here/.test(plan.why);
      if (flagged) st.unsafe++;
      if (toward > 0.05 && !flagged) { st.movedToward++; st.fails.push(`${c.name} [${c.kind}] board moved ${toward.toFixed(2)} m toward him (${plan.why}, ${d.toFixed(2)} m)`); }
      if (V) console.log(`   plan ${plan.why} moved ${d.toFixed(2)} m, toward ${toward.toFixed(2)} m, walk ${plan.path.length * 0.075 | 0} m`);
    } else if (V) console.log(`   plan ${plan.why}, walk ${(plan.path.reduce((s, p, i, a) => s + (i ? p.distanceTo(a[i - 1]) : 0), 0)).toFixed(2)} m`);
  }
}
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(2) : '-'; };
console.log(`${FAST ? 'FAST ' : ''}board rest: ${st.n} bails; asleep on its rail ${st.onRail}; wheels down ${st.wheels}, upside down ${st.upside}`);
console.log(`longest balance on the rail while nearly still: ${st.balanceMax.toFixed(2)} s (cases > 0.15 s: ${st.balanceOver}); settle median ${q(st.restT, 0.5)} s, p90 ${q(st.restT, 0.9)} s; board asleep after median ${q(st.boardT, 0.5)} s, p90 ${q(st.boardT, 0.9)} s`);
if (FAST) console.log(`quick recovery: board moved after rest ${st.moved} (flagged unsafe/nudge ${st.unsafe}), moved toward him unflagged ${st.movedToward}; board rest from his stand spot median ${q(st.restDist, 0.5)} m, p90 ${q(st.restDist, 0.9)} m, max ${q(st.restDist, 1)} m`);
for (const f of st.fails.slice(0, 30)) console.log('  FAIL ' + f);
