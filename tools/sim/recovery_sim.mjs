// Headless bail-recovery check on the real park collision. For many bails (bowls, half pipe, quarter pipes, banks,
// stairs, ledges, rails, funbox, walls, fences, random spots) it runs the physics through the bail until the body and
// the board are at rest, plans the walk back (src/player/recovery.ts), moves the board if the plan says so, and asserts:
// the body ends on walkable ground with room to stand, the walk never crosses steep ground or big steps, the final
// rider spot is flat open ground near the bail, nothing is inside the park geometry.
//   node tools/sim/build_src.mjs tools/sim/.build-d && node tools/sim/recovery_sim.mjs [N random] [fast]
globalThis.location = { search: '' };
const B = new URL('./.build-d/', import.meta.url).href;
const { Vector3 } = await import('three');
const { buildPark } = await import(B + 'world/park.js');
const { CollisionWorld } = await import(B + 'world/collision.js');
const { SkatePhysics, emptyInput } = await import(B + 'player/physics.js');
const R = await import(B + 'player/recovery.js');

const park = buildPark();
const b = park.builder;
const world = new CollisionWorld(b.collisionGeometry(), b.cSurf, park.grindLines);
const N = +(process.argv[2] ?? 300);
const FAST = process.argv.includes('fast');
const STEP = 1 / 120;
const KINDS = ['face', 'back', 'knock', 'roll'];
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const cases = [];
// ride up a wall and bail high on it (or at the peak / in the air over the coping)
const wall = (name, x, y, z, hd, sp, bailY, opts = {}) => cases.push({ name, pos: [x, y, z], heading: hd, speed: sp, bailY, ...opts });
for (const [i, hd] of [90, 60, 120, 75, 105].entries()) for (const sp of [4.5, 5.5, 6.5, 7.5])
  wall(`main bowl E wall h${hd} v${sp}`, -21, -2.3, (i - 2) * 1.2, hd, sp, -0.9 + 0.3 * (i % 3), { kind: KINDS[(i + sp * 2) % 4] });
for (const [i, hd] of [270, 240, 300].entries()) for (const sp of [5, 6.5, 8]) wall(`main bowl W wall h${hd} v${sp}`, -27, -2.3, (i - 1) * 1.5, hd, sp, -0.7, { kind: KINDS[i % 4] });
for (const [i, hd] of [0, 20, 340].entries()) for (const sp of [5, 6.5]) wall(`main bowl S wall h${hd} v${sp}`, -24 + (i - 1) * 2, -2.3, 2, hd, sp, -0.8, { kind: KINDS[(i + 1) % 4] });
for (const [i, hd] of [180, 160, 200].entries()) for (const sp of [5, 6.5]) wall(`main bowl N wall h${hd} v${sp}`, -24 + (i - 1) * 2, -2.3, -2, hd, sp, -0.8, { kind: KINDS[(i + 2) % 4] });
for (const [i, hd] of [45, 135, 225, 315].entries()) wall(`main bowl corner h${hd}`, -24, -2.3, 0, hd, 7, -1.0, { kind: KINDS[i] });
for (const [i, hd] of [90, 270, 0, 180].entries()) wall(`pocket bowl h${hd}`, -24, -1.4, 15, hd, 5.5, -0.5, { kind: KINDS[i] });
for (const [i, sp] of [6, 7, 8, 9].entries()) {
  wall(`half pipe W wall v${sp}`, 24, 0, -9 + i, 270, sp, 1.6 + 0.3 * i, { kind: KINDS[i] });
  wall(`half pipe E wall v${sp}`, 24, 0, -9 - i * 0.7, 90, sp, 1.6 + 0.3 * i, { kind: KINDS[(i + 1) % 4] });
}
for (const [i, sp] of [5, 6.5].entries()) {
  wall(`north quarter v${sp}`, -7.5 + i * 2, 0, -14, 180, sp, 0.7, { kind: KINDS[i] });
  wall(`nw quarter v${sp}`, -30 + i * 2, 0, -15.5, 180, sp, 0.8, { kind: KINDS[i + 2] });
  wall(`ne mini quarter v${sp}`, 24 + i, 0, -17, 180, sp, 0.5, { kind: KINDS[(i + 1) % 4] });
  wall(`north bank v${sp}`, 2 + i * 2, 0, -14, 180, sp, 0.6, { kind: KINDS[(i + 3) % 4] });
}
// wall / curb ride-ins (natural bails from the body collision) and bails next to ledges, rails, stairs, the funbox, fences
const flat = (name, x, z, hd, sp, kind, t = 0.25) => cases.push({ name, pos: [x, 0, z], heading: hd, speed: sp, kind, t });
flat('wall ride-in half pipe mural', 12, -9, 90, 7.5, null);
flat('east seat step trip', 33, 0, 90, 7.5, null);
flat('kiosk wall', 25, 22, 0, 7.5, null);
flat('fence E', 36, 0, 90, 7, null);
flat('fence N', 0, -24.5, 180, 7, null);
flat('fence W', -36.5, 8, 270, 7, null);
flat('long ledge across', -5, -10.5, 180, 5.5, 'face', 0.18);
flat('long ledge along', -9, -11.6, 90, 5.5, 'back', 0.3);
flat('flat rail across', 7, -11, 180, 5, 'knock', 0.22);
flat('funbox up the side', 0, 3, 180, 5, 'face', 0.35);
flat('funbox top', 0, -1.5, 90, 4, 'roll', 0.1);
flat('terrace stairs down', 7, 9.5, 0, 5, 'face', 0.4);
flat('terrace bank', 0, 9, 0, 6, 'back', 0.45);
flat('se bank', 25.5, 18, 90, 6, 'knock', 0.3);
flat('ne platform', 8, -17, 180, 5, 'face', 0.3);
flat('ne stairs', 11, -17.5, 180, 4.5, 'roll', 0.35);
flat('red curb', 22, 7.2, 0, 5, 'face', 0.2);
flat('pyramid', -29, -10.5, 180, 5.5, 'back', 0.35);
// random bails anywhere on the pad
for (let i = 0; i < N; i++) {
  const x = -37 + rnd() * 74, z = -26 + rnd() * 50;
  cases.push({ name: `random #${i}`, pos: [x, 3, z], heading: rnd() * 360, speed: 2 + rnd() * 6, kind: KINDS[i % 4], t: 0.02 + rnd() * 0.3, drop: true });
}

const stats = { n: 0, pass: 0, noBail: 0, relocate: 0, walk: 0, here: 0, fails: [] };
const bodyStandFail = [], times = [], shuffles = [];
let flatBodies = 0;
const whyMoved = {};
let farMax = 0, farBodyMax = 0, levelMoves = 0, rolls = 0;
const check = (ok, msg, c, extra = '') => { if (!ok) c.fail.push(msg + extra); return ok; };

for (const c of cases.filter((c) => !process.env.ONLY || c.name === process.env.ONLY)) {
  const ph = new SkatePhysics(world);
  if (FAST) Object.assign(ph.assist, { landing: false, autoGrind: false, fastRecover: true });
  const p0 = new Vector3(...c.pos);
  if (c.drop) {
    const g = world.raycast(p0, new Vector3(0, -1, 0), 20);
    if (!g || g.normal.y < 0.3) continue;
    p0.copy(g.point);
  }
  ph.reset(p0, (c.heading * Math.PI) / 180);
  ph.vel.copy(ph.fwd).multiplyScalar(c.speed);
  const inp = emptyInput();
  let t = 0, bailAt = null, peakY = -99;
  c.fail = [];
  for (let i = 0; i < 120 * 14; i++) {
    if (ph.mode !== 'bail') {
      peakY = Math.max(peakY, ph.pos.y);
      const trig = c.bailY !== undefined ? (ph.pos.y > c.pos[1] + 0.1 && (ph.pos.y >= c.bailY || (ph.vel.y < 0 && t > 0.3))) : c.kind && t >= c.t;
      if (trig && c.kind) ph.toBail(c.kind, 'test');
      else if (trig && c.bailY !== undefined) ph.toBail('back', 'test');
    }
    if (ph.mode === 'bail' && !bailAt) bailAt = ph.pos.clone();
    if (ph.bail?.standAt && c.shuffle === undefined) { c.shuffle = ph.bail.body.distanceTo(ph.bail.standAt); shuffles.push(c.shuffle); }
    ph.step(STEP, inp);
    t += STEP;
    if (bailAt && ph.bail && ph.bail.checked && !ph.bail.standAt && ph.bail.board.asleep) break;
    if (t > 6 && !bailAt) break;
  }
  if (!bailAt) { stats.noBail++; continue; }
  stats.n++;
  const bl = ph.bail;
  times.push(bl.t);
  if (process.env.SLOW && bl.t > 8.5) {
    const r = bl.board.rootPos(new Vector3()), u = new Vector3(0, 1, 0).applyQuaternion(bl.board.q);
    console.log(`slow board: ${c.name} root(${r.x.toFixed(2)},${r.y.toFixed(2)},${r.z.toFixed(2)}) upY ${u.y.toFixed(2)} v ${bl.board.v.length().toFixed(2)} w ${bl.board.w.length().toFixed(2)} c${bl.board.contacts} asleep ${bl.board.asleep}`);
  }
  // the body: walkable ground with room to stand (after the shuffle if it needed one)
  const body = bl.body.clone();
  const sh = R.standable(world, body);
  if (sh && sh.normal.y >= 0.96) flatBodies++;
  if (!check(!!sh, 'body not standable', c, ` @(${body.x.toFixed(2)},${body.y.toFixed(2)},${body.z.toFixed(2)})`)) bodyStandFail.push(c.name);
  // the get-up moves the hips ~0.5 m: stand where they end (nearest standable spot if that is no good)
  const hd = bl.heading;
  let stand = body.clone().add(new Vector3(Math.sin(hd) * 0.45, 0, Math.cos(hd) * 0.45));
  const g = R.groundAt(world, stand.x, stand.z, body.y, 0.35, 0.5);
  if (g) stand.copy(g.point);
  if (!g || !R.standable(world, stand)) stand = R.findStandSpot(world, body, 4) ?? body;
  const rest = { pos: new Vector3(), fwd: new Vector3(), up: new Vector3() };
  bl.board.ridePose(rest.pos, rest.fwd, rest.up);
  const plan = R.planRecovery(world, stand, rest, FAST ? { maxWalk: 1.2, face: hd, tight: true } : { maxWalk: 5 });
  stats[plan.why === 'walk' ? 'walk' : plan.why.startsWith('here') ? 'here' : 'relocate']++;
  if (process.env.ONLY) console.log('plan', plan.why, 'ride', plan.ride.toArray().map((v) => v.toFixed(2)).join(','), 'path', plan.path.length, 'stand', stand.toArray().map((v) => v.toFixed(2)).join(','));
  if (plan.relocate) whyMoved[plan.why.split(' ').slice(1).join(' ')] = (whyMoved[plan.why.split(' ').slice(1).join(' ')] ?? 0) + 1;
  if (process.env.HERE && plan.why.startsWith('here')) console.log(`here: ${c.name} stand (${stand.x.toFixed(2)},${stand.y.toFixed(2)},${stand.z.toFixed(2)})`);
  if (plan.relocate) {
    // as the skater does it: to another level the board rolls along the ground, otherwise a short hop
    const from = bl.board.rootPos(new Vector3());
    const level = Math.abs(plan.ride.y - from.y) > 0.3;
    const route = level ? R.groundRoute(world, from, plan.ride) : null;
    if (level) { levelMoves++; if (route) rolls++; }
    if (route) bl.board.rollTo(route, plan.fwd, FAST ? Math.min(0.75, Math.max(0.45, route.len / 6)) : Math.min(1.8, Math.max(0.7, route.len / 3.2)));
    else bl.board.moveTo(plan.ride, plan.fwd, plan.up, 0.6);
    for (let i = 0; i < 300 && bl.board.gliding; i++) ph.step(STEP, inp);
    const rp = new Vector3(), rf = new Vector3(), ru = new Vector3();
    bl.board.ridePose(rp, rf, ru);
    check(rp.distanceTo(plan.ride) < 0.08, 'relocated board off its spot', c, ` d=${rp.distanceTo(plan.ride).toFixed(2)}`);
    check(bl.board.wheelsDown, 'relocated board upside down', c);
  }
  // final rider spot: on the board at plan.ride
  const rg = R.groundAt(world, plan.ride.x, plan.ride.z, plan.ride.y, 0.3, 0.4);
  check(!!rg && rg.normal.y >= R.WALK_NY, 'ride spot not walkable', c, rg ? ` ny=${rg.normal.y.toFixed(2)}` : ' no ground');
  check(R.standClear(world, plan.ride.clone().add(new Vector3(0, 0.12, 0))), 'rider on the board clips geometry', c);
  check(R.standClear(world, plan.target), 'step-on spot clips geometry', c);
  check(!R.onTop(world, plan.ride), 'ride spot on top of a ledge / pad / funbox', c, ` (${plan.why})`);
  const far = Math.hypot(plan.ride.x - bailAt.x, plan.ride.z - bailAt.z);
  const farBody = Math.hypot(plan.ride.x - body.x, plan.ride.z - body.z);
  check(far < 7.5 || farBody < 5.5, 'ride spot far from the bail', c, ` ${far.toFixed(1)} m from the bail, ${farBody.toFixed(1)} m from the body (${plan.why})`);
  farMax = Math.max(farMax, far); farBodyMax = Math.max(farBodyMax, farBody);
  // independent re-check of the walk (finer sampling): walkable, small steps, room to stand
  // (a steep reading must cover two sub-samples in a row, ~2.5 cm: the foot of a bank flush with the plaza is a sliver)
  let prev = plan.path[0], steepRun = 0;
  for (let i = 1; i < plan.path.length; i++) {
    const a = plan.path[i - 1], z = plan.path[i];
    for (let k = 1; k <= 3; k++) {
      const q = a.clone().lerp(z, k / 3);
      const h = R.groundAt(world, q.x, q.z, prev.y, R.STEP_UP + 0.25, R.STEP_DOWN + 0.3);
      steepRun = h && R.levelness(world, h) < R.WALK_NY - 0.01 ? steepRun + 1 : 0;
      if (!check(!!h && steepRun < 2, 'walk crosses steep ground', c, h ? ` ny=${R.levelness(world, h).toFixed(2)} at (${h.point.x.toFixed(2)},${h.point.y.toFixed(2)},${h.point.z.toFixed(2)}) seg ${i}/${plan.path.length - 1}` : ' (no ground)')) break;
      if (!check(h.point.y - prev.y <= R.STEP_UP + 0.02 && prev.y - h.point.y <= R.STEP_DOWN + 0.02, 'walk step too big', c, ` ${(h.point.y - prev.y).toFixed(2)}`)) break;
      prev = h.point;
    }
    if (c.fail.length) break;
  }
  if (!c.fail.length) stats.pass++;
  else stats.fails.push(`${c.name} [${c.kind ?? 'ride-in'}] ${plan.why}: ${c.fail.join('; ')}`);
}
times.sort((a, b) => a - b);
console.log(`${FAST ? 'FAST ' : ''}recovery sim: ${stats.pass}/${stats.n} pass (no bail: ${stats.noBail}); walk to board ${stats.walk}, board moved ${stats.relocate}, board at his feet ${stats.here}`);
console.log(`settle time (body + board at rest) median ${times[times.length >> 1]?.toFixed(2)} s, p90 ${times[Math.floor(times.length * 0.9)]?.toFixed(2)} s`);
if (bodyStandFail.length) console.log(`body not standable: ${bodyStandFail.length}`);
console.log(`body at rest on level ground (normal.y >= 0.96): ${flatBodies}/${stats.n}`);
console.log(`board moved to another level (deck <-> bowl etc.): ${levelMoves}, rolled along the ground ${rolls}, hopped ${levelMoves - rolls}`);
console.log(`why the board could not stay where it lay: ${JSON.stringify(whyMoved)}; ride spot max ${farMax.toFixed(1)} m from the bail point, ${farBodyMax.toFixed(1)} m from where the body came to rest`);
shuffles.sort((a, b) => a - b);
console.log(`body shuffled over to a standable spot: ${shuffles.length} cases, median ${shuffles[shuffles.length >> 1]?.toFixed(2) ?? '-'} m, max ${shuffles[shuffles.length - 1]?.toFixed(2) ?? '-'} m`);
for (const f of stats.fails.slice(0, 40)) console.log('  FAIL ' + f);
